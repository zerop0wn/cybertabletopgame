# Upload CloudFormation Template to AWS

## Option 1: AWS Console (Web UI)

### Step 1: Prepare the Template
1. Open `cloudformation-template.yaml` in your editor
2. Make sure it's saved and ready

### Step 2: Upload via AWS Console
1. Go to [AWS CloudFormation Console](https://console.aws.amazon.com/cloudformation/)
2. Click **"Create stack"** → **"With new resources (standard)"**
3. Choose **"Upload a template file"**
4. Click **"Choose file"** and select `cloudformation-template.yaml`
5. Click **"Next"**

### Step 3: Configure Stack Parameters
Fill in the parameters:
- **Stack name**: `pewpew-prod` (or your preferred name)
- **ProjectName**: `pewpew`
- **Environment**: `prod`
- **BackendImageUri**: Leave empty for now (you'll update this after pushing Docker image)
- **FrontendBuildPath**: `frontend/dist`
- **AppRunnerCpu**: `0.25 vCPU`
- **AppRunnerMemory**: `0.5 GB`
- **AppRunnerMinInstances**: `0`
- **AppRunnerMaxInstances**: `3`

Click **"Next"**

### Step 4: Configure Stack Options
- **Tags**: (Optional) Add tags like `Project=pewpew`, `Environment=prod`
- **Permissions**: Use default IAM role or create new one
- **Stack failure options**: Use defaults
- **Advanced options**: Use defaults

Click **"Next"**

### Step 5: Review and Create
1. Review all settings
2. Check the **"I acknowledge that AWS CloudFormation might create IAM resources"** checkbox
3. Click **"Submit"**

### Step 6: Wait for Stack Creation
- The stack will take 5-10 minutes to create
- Watch the **Events** tab for progress
- Once status is **CREATE_COMPLETE**, proceed to next steps

### Step 7: Get Stack Outputs
1. Click on your stack name
2. Go to **"Outputs"** tab
3. Note down:
   - `BackendECRRepositoryURI` - You'll need this for Docker push
   - `FrontendBucketName` - For frontend upload
   - `BackendServiceURL` - Backend API URL
   - `FrontendURL` - Frontend CloudFront URL

## Option 2: AWS CLI (Command Line)

### Single Command to Create Stack

```bash
aws cloudformation create-stack \
    --stack-name pewpew-prod \
    --template-body file://cloudformation-template.yaml \
    --parameters \
        ParameterKey=ProjectName,ParameterValue=pewpew \
        ParameterKey=Environment,ParameterValue=prod \
        ParameterKey=BackendImageUri,ParameterValue=placeholder \
        ParameterKey=FrontendBuildPath,ParameterValue=frontend/dist \
        ParameterKey=AppRunnerCpu,ParameterValue="0.25 vCPU" \
        ParameterKey=AppRunnerMemory,ParameterValue="0.5 GB" \
        ParameterKey=AppRunnerMinInstances,ParameterValue=0 \
        ParameterKey=AppRunnerMaxInstances,ParameterValue=3 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-1
```

### Wait for Stack Creation

```bash
aws cloudformation wait stack-create-complete \
    --stack-name pewpew-prod \
    --region us-east-1
```

### Get Stack Outputs

```bash
aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs" \
    --output table \
    --region us-east-1
```

## Option 3: Upload Template to S3 First (For Large Templates)

If your template is large or you want to reference it from S3:

### Step 1: Upload Template to S3

```bash
# Create S3 bucket for templates (one-time)
aws s3 mb s3://pewpew-cloudformation-templates --region us-east-1

# Upload template
aws s3 cp cloudformation-template.yaml \
    s3://pewpew-cloudformation-templates/cloudformation-template.yaml \
    --region us-east-1
```

### Step 2: Create Stack from S3 URL

```bash
aws cloudformation create-stack \
    --stack-name pewpew-prod \
    --template-url https://pewpew-cloudformation-templates.s3.us-east-1.amazonaws.com/cloudformation-template.yaml \
    --parameters \
        ParameterKey=ProjectName,ParameterValue=pewpew \
        ParameterKey=Environment,ParameterValue=prod \
        ParameterKey=AppRunnerCpu,ParameterValue="0.25 vCPU" \
        ParameterKey=AppRunnerMemory,ParameterValue="0.5 GB" \
        ParameterKey=AppRunnerMinInstances,ParameterValue=0 \
        ParameterKey=AppRunnerMaxInstances,ParameterValue=3 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-1
```

## After Stack Creation

Once the stack is created, you need to:

1. **Build and push backend Docker image** to ECR
2. **Update App Runner service** with the image URI
3. **Build and deploy frontend** to S3

See `DEPLOY-COMMANDS.md` for the complete deployment steps.

## Troubleshooting

### Stack Creation Fails

Check the events:
```bash
aws cloudformation describe-stack-events \
    --stack-name pewpew-prod \
    --max-items 20 \
    --region us-east-1
```

### Update Existing Stack

If you need to update the stack:
```bash
aws cloudformation update-stack \
    --stack-name pewpew-prod \
    --template-body file://cloudformation-template.yaml \
    --parameters \
        ParameterKey=ProjectName,ParameterValue=pewpew \
        ParameterKey=Environment,ParameterValue=prod \
        ParameterKey=AppRunnerCpu,ParameterValue="0.25 vCPU" \
        ParameterKey=AppRunnerMemory,ParameterValue="0.5 GB" \
        ParameterKey=AppRunnerMinInstances,ParameterValue=0 \
        ParameterKey=AppRunnerMaxInstances,ParameterValue=3 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-1
```

### Delete Stack

```bash
aws cloudformation delete-stack \
    --stack-name pewpew-prod \
    --region us-east-1
```

