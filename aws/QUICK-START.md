# Quick Start - Copy & Paste Commands

## For Windows (PowerShell)

Open PowerShell in the `aws` directory and run:

```powershell
.\deploy.ps1
```

Or manually:

```powershell
# 1. Deploy infrastructure
aws cloudformation deploy --template-file cloudformation-template.yaml --stack-name pewpew-prod --parameter-overrides ProjectName=pewpew Environment=prod AppRunnerCpu="0.25 vCPU" AppRunnerMemory="0.5 GB" AppRunnerMinInstances=0 AppRunnerMaxInstances=3 --capabilities CAPABILITY_NAMED_IAM --region us-east-1

# 2. Get ECR URI (save this value)
$ECR_URI = aws cloudformation describe-stacks --stack-name pewpew-prod --query "Stacks[0].Outputs[?OutputKey=='BackendECRRepositoryURI'].OutputValue" --output text --region us-east-1

# 3. Login to ECR
aws ecr get-login-password --region us-east-1 | docker login --username AWS --password-stdin $ECR_URI

# 4. Build and push backend
cd ..\backend
docker build -t "$ECR_URI:latest" .
docker push "$ECR_URI:latest"

# 5. Get backend URL and S3 bucket
$BACKEND_URL = aws cloudformation describe-stacks --stack-name pewpew-prod --query "Stacks[0].Outputs[?OutputKey=='BackendServiceURL'].OutputValue" --output text --region us-east-1
$S3_BUCKET = aws cloudformation describe-stacks --stack-name pewpew-prod --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" --output text --region us-east-1

# 6. Build and deploy frontend
cd ..\frontend
"VITE_PUBLIC_BACKEND_URL=$BACKEND_URL" | Out-File -FilePath .env.production -Encoding utf8
npm run build
aws s3 sync dist/ "s3://$S3_BUCKET" --delete --region us-east-1
```

## For Linux/Mac (Bash)

Open terminal in the `aws` directory and run:

```bash
chmod +x deploy.sh
./deploy.sh
```

Or manually:

```bash
# 1. Deploy infrastructure
aws cloudformation deploy \
    --template-file cloudformation-template.yaml \
    --stack-name pewpew-prod \
    --parameter-overrides \
        ProjectName=pewpew \
        Environment=prod \
        AppRunnerCpu="0.25 vCPU" \
        AppRunnerMemory="0.5 GB" \
        AppRunnerMinInstances=0 \
        AppRunnerMaxInstances=3 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region us-east-1

# 2. Get ECR URI (save this value)
export ECR_URI=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='BackendECRRepositoryURI'].OutputValue" \
    --output text \
    --region us-east-1)

# 3. Login to ECR
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin $ECR_URI

# 4. Build and push backend
cd ../backend
docker build -t $ECR_URI:latest .
docker push $ECR_URI:latest

# 5. Get backend URL and S3 bucket
export BACKEND_URL=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='BackendServiceURL'].OutputValue" \
    --output text \
    --region us-east-1)

export S3_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
    --output text \
    --region us-east-1)

# 6. Build and deploy frontend
cd ../frontend
echo "VITE_PUBLIC_BACKEND_URL=$BACKEND_URL" > .env.production
npm run build
aws s3 sync dist/ s3://$S3_BUCKET --delete --region us-east-1
```

## Prerequisites

Make sure you have:
- ✅ AWS CLI installed and configured (`aws configure`)
- ✅ Docker installed and running
- ✅ Node.js and npm installed
- ✅ AWS account with appropriate permissions

## What Gets Created

- **S3 Bucket**: Stores frontend static files
- **CloudFront Distribution**: CDN for frontend
- **ECR Repository**: Stores backend Docker images
- **App Runner Service**: Runs backend API
- **IAM Roles**: Permissions for App Runner

## Estimated Cost

- **Low traffic**: ~$7-23/month
- **Zero traffic (scale-to-zero)**: ~$1-2/month

