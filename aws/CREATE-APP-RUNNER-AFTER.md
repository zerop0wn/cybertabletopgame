# Creating App Runner Service After Stack Creation

If you created the CloudFormation stack without providing a `BackendImageUri`, the App Runner service won't be created. Follow these steps to create it after pushing your Docker image.

## Step 1: Push Docker Image to ECR

```powershell
# Get ECR URI from stack outputs
$ECR_URI = aws cloudformation describe-stacks --stack-name pewpew-prod --query "Stacks[0].Outputs[?OutputKey=='BackendECRRepositoryURI'].OutputValue" --output text --region us-east-1

# Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_URI

# Build and push
cd ..\backend
docker build -t "$ECR_URI:latest" .
docker push "$ECR_URI:latest"
```

## Step 2: Update CloudFormation Stack

```powershell
# Update stack with the image URI
aws cloudformation update-stack `
    --stack-name pewpew-prod `
    --use-previous-template `
    --parameters `
        ParameterKey=ProjectName,UsePreviousValue=true `
        ParameterKey=Environment,UsePreviousValue=true `
        ParameterKey=BackendImageUri,ParameterValue="$ECR_URI:latest" `
        ParameterKey=FrontendBuildPath,UsePreviousValue=true `
        ParameterKey=AppRunnerCpu,UsePreviousValue=true `
        ParameterKey=AppRunnerMemory,UsePreviousValue=true `
        ParameterKey=AppRunnerMinInstances,UsePreviousValue=true `
        ParameterKey=AppRunnerMaxInstances,UsePreviousValue=true `
    --capabilities CAPABILITY_NAMED_IAM `
    --region us-east-1
```

## Alternative: Create App Runner Service Manually

If you prefer to create the App Runner service manually via AWS Console:

1. Go to AWS App Runner Console
2. Click "Create service"
3. Choose "Container registry" → "Amazon ECR"
4. Select your ECR repository and image
5. Configure:
   - Service name: `pewpew-backend-prod`
   - CPU: 0.25 vCPU
   - Memory: 0.5 GB
   - Port: 8000
   - Auto scaling: Min 0, Max 3
6. Use the IAM role created by CloudFormation: `pewpew-apprunner-role-prod`
7. Create the service

## Verify

After the stack update completes, check the outputs:

```powershell
aws cloudformation describe-stacks --stack-name pewpew-prod --query "Stacks[0].Outputs" --output table --region us-east-1
```

You should now see the `BackendServiceURL` output.

