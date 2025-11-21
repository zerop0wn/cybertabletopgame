# Simple Upload to AWS CloudFormation

## Quick Upload (PowerShell)

Run this single command from the `aws` directory:

```powershell
.\upload-stack.ps1
```

Or manually:

```powershell
aws cloudformation create-stack --stack-name pewpew-prod --template-body file://cloudformation-template.yaml --parameters ParameterKey=ProjectName,ParameterValue=pewpew ParameterKey=Environment,ParameterValue=prod ParameterKey=BackendImageUri,ParameterValue=placeholder ParameterKey=FrontendBuildPath,ParameterValue=frontend/dist ParameterKey=AppRunnerCpu,ParameterValue="0.25 vCPU" ParameterKey=AppRunnerMemory,ParameterValue="0.5 GB" ParameterKey=AppRunnerMinInstances,ParameterValue=0 ParameterKey=AppRunnerMaxInstances,ParameterValue=3 --capabilities CAPABILITY_NAMED_IAM --region us-east-1
```

## Via AWS Console

1. Go to: https://console.aws.amazon.com/cloudformation/
2. Click **"Create stack"** → **"With new resources (standard)"**
3. Select **"Upload a template file"**
4. Click **"Choose file"** and select `cloudformation-template.yaml`
5. Click **"Next"**
6. Enter stack name: `pewpew-prod`
7. Fill parameters:
   - ProjectName: `pewpew`
   - Environment: `prod`
   - BackendImageUri: `placeholder` (you'll update this later)
   - FrontendBuildPath: `frontend/dist`
   - AppRunnerCpu: `0.25 vCPU`
   - AppRunnerMemory: `0.5 GB`
   - AppRunnerMinInstances: `0`
   - AppRunnerMaxInstances: `3`
8. Click **"Next"** → **"Next"**
9. Check **"I acknowledge that AWS CloudFormation might create IAM resources"**
10. Click **"Submit"**

## Wait for Creation

The stack will take 5-10 minutes to create. You can:
- Watch progress in the AWS Console
- Or run: `aws cloudformation describe-stack-events --stack-name pewpew-prod --max-items 20`

## After Stack is Created

1. Get the ECR repository URI from stack outputs
2. Build and push your Docker image
3. Update App Runner service
4. Deploy frontend to S3

See `DEPLOY-COMMANDS.md` for complete instructions.

