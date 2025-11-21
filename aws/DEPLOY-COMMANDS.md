# Step-by-Step Deployment Commands

Copy and paste these commands in order to deploy your PewPew game to AWS.

## Prerequisites Check

```bash
# Check AWS CLI is installed and configured
aws --version
aws sts get-caller-identity

# Check Docker is running
docker --version
docker ps

# Check Node.js is installed (for frontend build)
node --version
npm --version
```

## Step 1: Navigate to AWS Directory

```bash
cd aws
```

## Step 2: Deploy CloudFormation Stack

```bash
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
```

**Note:** Change `us-east-1` to your preferred AWS region if different.

## Step 3: Get Stack Outputs

```bash
# Get all outputs
aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs" \
    --output table \
    --region us-east-1

# Get specific values (save these for later steps)
export ECR_URI=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='BackendECRRepositoryURI'].OutputValue" \
    --output text \
    --region us-east-1)

export S3_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
    --output text \
    --region us-east-1)

export BACKEND_URL=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='BackendServiceURL'].OutputValue" \
    --output text \
    --region us-east-1)

export FRONTEND_URL=$(aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" \
    --output text \
    --region us-east-1)

# Display the values
echo "ECR URI: $ECR_URI"
echo "S3 Bucket: $S3_BUCKET"
echo "Backend URL: $BACKEND_URL"
echo "Frontend URL: $FRONTEND_URL"
```

## Step 4: Build and Push Backend Docker Image

```bash
# Login to ECR
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin $ECR_URI

# Navigate to backend directory
cd ../backend

# Build the Docker image
docker build -t $ECR_URI:latest .

# Tag with timestamp (optional, for versioning)
docker tag $ECR_URI:latest $ECR_URI:$(date +%Y%m%d-%H%M%S)

# Push the image
docker push $ECR_URI:latest
docker push $ECR_URI:$(date +%Y%m%d-%H%M%S)
```

## Step 5: Update App Runner Service

```bash
# Get the App Runner service ARN
export SERVICE_ARN=$(aws apprunner list-services \
    --region us-east-1 \
    --query "ServiceSummaryList[?ServiceName=='pewpew-backend-prod'].ServiceArn" \
    --output text)

# Start deployment with new image
aws apprunner start-deployment \
    --service-arn $SERVICE_ARN \
    --region us-east-1

# Wait for deployment to complete (check status)
aws apprunner describe-service \
    --service-arn $SERVICE_ARN \
    --region us-east-1 \
    --query "Service.Status" \
    --output text
```

## Step 6: Configure Frontend Environment Variables

```bash
# Navigate to frontend directory
cd ../frontend

# Create .env.production file with backend URL
echo "VITE_PUBLIC_BACKEND_URL=$BACKEND_URL" > .env.production

# Verify the file was created
cat .env.production
```

## Step 7: Build and Deploy Frontend

```bash
# Install dependencies (if not already done)
npm install

# Build the frontend
npm run build

# Upload to S3
aws s3 sync dist/ s3://$S3_BUCKET --delete --region us-east-1

# Get CloudFront distribution ID
export DISTRIBUTION_ID=$(aws cloudfront list-distributions \
    --query "DistributionList.Items[?Aliases.Items[0]=='$FRONTEND_URL'].Id" \
    --output text \
    --region us-east-1)

# Invalidate CloudFront cache
aws cloudfront create-invalidation \
    --distribution-id $DISTRIBUTION_ID \
    --paths "/*" \
    --region us-east-1
```

## Step 8: Verify Deployment

```bash
# Check App Runner service status
aws apprunner describe-service \
    --service-arn $SERVICE_ARN \
    --region us-east-1 \
    --query "Service.{Status:Status,ServiceUrl:ServiceUrl}" \
    --output table

# Check S3 bucket contents
aws s3 ls s3://$S3_BUCKET --region us-east-1

# Test backend endpoint
curl $BACKEND_URL/api/game/state

# Display final URLs
echo "=========================================="
echo "Deployment Complete!"
echo "=========================================="
echo "Frontend URL: https://$FRONTEND_URL"
echo "Backend URL: $BACKEND_URL"
echo "=========================================="
```

## All-in-One Script (Alternative)

If you prefer to run everything at once, use the deploy script:

```bash
cd aws
chmod +x deploy.sh
./deploy.sh
```

## Troubleshooting Commands

```bash
# View App Runner logs
aws logs tail /aws/apprunner/pewpew-backend-prod --follow --region us-east-1

# Check CloudFormation stack events
aws cloudformation describe-stack-events \
    --stack-name pewpew-prod \
    --max-items 20 \
    --region us-east-1

# Check App Runner service health
aws apprunner describe-service \
    --service-arn $SERVICE_ARN \
    --region us-east-1 \
    --query "Service.HealthCheckConfiguration"

# List ECR images
aws ecr list-images \
    --repository-name pewpew-backend-prod \
    --region us-east-1
```

## Cleanup (if needed)

```bash
# Delete CloudFormation stack (deletes all resources)
aws cloudformation delete-stack --stack-name pewpew-prod --region us-east-1

# Wait for deletion to complete
aws cloudformation wait stack-delete-complete \
    --stack-name pewpew-prod \
    --region us-east-1
```

