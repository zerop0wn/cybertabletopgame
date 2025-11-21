#!/bin/bash
# Deployment script for PewPew game to AWS

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
PROJECT_NAME="${PROJECT_NAME:-pewpew}"
ENVIRONMENT="${ENVIRONMENT:-prod}"
AWS_REGION="${AWS_REGION:-us-east-1}"
STACK_NAME="${PROJECT_NAME}-${ENVIRONMENT}"

echo -e "${GREEN}Starting deployment of ${PROJECT_NAME} to ${ENVIRONMENT}...${NC}"

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo -e "${RED}Error: AWS CLI is not installed. Please install it first.${NC}"
    exit 1
fi

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo -e "${RED}Error: Docker is not installed. Please install it first.${NC}"
    exit 1
fi

# Get AWS account ID
AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
echo -e "${GREEN}AWS Account ID: ${AWS_ACCOUNT_ID}${NC}"

# Step 1: Deploy CloudFormation stack
echo -e "${YELLOW}Step 1: Deploying CloudFormation stack...${NC}"
aws cloudformation deploy \
    --template-file cloudformation-template.yaml \
    --stack-name "${STACK_NAME}" \
    --parameter-overrides \
        ProjectName="${PROJECT_NAME}" \
        Environment="${ENVIRONMENT}" \
        AppRunnerCpu="0.25 vCPU" \
        AppRunnerMemory="0.5 GB" \
        AppRunnerMinInstances=0 \
        AppRunnerMaxInstances=3 \
    --capabilities CAPABILITY_NAMED_IAM \
    --region "${AWS_REGION}"

# Get outputs from CloudFormation
FRONTEND_BUCKET=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" \
    --output text \
    --region "${AWS_REGION}")

BACKEND_ECR_URI=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='BackendECRRepositoryURI'].OutputValue" \
    --output text \
    --region "${AWS_REGION}")

BACKEND_SERVICE_ARN=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='BackendServiceURL'].OutputValue" \
    --output text \
    --region "${AWS_REGION}")

CLOUDFRONT_URL=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" \
    --output text \
    --region "${AWS_REGION}")

echo -e "${GREEN}CloudFormation stack deployed successfully!${NC}"
echo -e "${GREEN}Frontend Bucket: ${FRONTEND_BUCKET}${NC}"
echo -e "${GREEN}Backend ECR URI: ${BACKEND_ECR_URI}${NC}"

# Step 2: Build and push backend Docker image
echo -e "${YELLOW}Step 2: Building and pushing backend Docker image...${NC}"

# Login to ECR
echo -e "${YELLOW}Logging into ECR...${NC}"
aws ecr get-login-password --region "${AWS_REGION}" | \
    docker login --username AWS --password-stdin "${BACKEND_ECR_URI}"

# Build backend image
echo -e "${YELLOW}Building backend Docker image...${NC}"
cd ../backend
docker build -t "${BACKEND_ECR_URI}:latest" .
docker tag "${BACKEND_ECR_URI}:latest" "${BACKEND_ECR_URI}:$(date +%Y%m%d-%H%M%S)"

# Push image
echo -e "${YELLOW}Pushing backend Docker image to ECR...${NC}"
docker push "${BACKEND_ECR_URI}:latest"
docker push "${BACKEND_ECR_URI}:$(date +%Y%m%d-%H%M%S)"

cd ../aws

# Step 3: Update App Runner service with new image
echo -e "${YELLOW}Step 3: Updating App Runner service...${NC}"
# Get the service ARN
SERVICE_ARN=$(aws apprunner list-services \
    --region "${AWS_REGION}" \
    --query "ServiceSummaryList[?ServiceName=='${PROJECT_NAME}-backend-${ENVIRONMENT}'].ServiceArn" \
    --output text)

if [ -n "$SERVICE_ARN" ]; then
    echo -e "${YELLOW}Starting deployment to App Runner...${NC}"
    aws apprunner start-deployment \
        --service-arn "${SERVICE_ARN}" \
        --region "${AWS_REGION}"
    echo -e "${GREEN}App Runner deployment started!${NC}"
else
    echo -e "${YELLOW}App Runner service not found. It will be created by CloudFormation.${NC}"
fi

# Step 4: Build and deploy frontend
echo -e "${YELLOW}Step 4: Building and deploying frontend...${NC}"
cd ../frontend

# Check if node_modules exists, if not install dependencies
if [ ! -d "node_modules" ]; then
    echo -e "${YELLOW}Installing frontend dependencies...${NC}"
    npm install
fi

# Build frontend
echo -e "${YELLOW}Building frontend...${NC}"
npm run build

# Sync to S3
echo -e "${YELLOW}Uploading frontend to S3...${NC}"
aws s3 sync dist/ "s3://${FRONTEND_BUCKET}" --delete --region "${AWS_REGION}"

# Invalidate CloudFront cache
echo -e "${YELLOW}Invalidating CloudFront cache...${NC}"
DISTRIBUTION_ID=$(aws cloudformation describe-stacks \
    --stack-name "${STACK_NAME}" \
    --query "Stacks[0].Outputs[?OutputKey=='CloudFrontDistributionId'].OutputValue" \
    --output text \
    --region "${AWS_REGION}" 2>/dev/null || \
    aws cloudfront list-distributions \
    --query "DistributionList.Items[?Aliases.Items[0]=='${CLOUDFRONT_URL}'].Id" \
    --output text \
    --region "${AWS_REGION}")

if [ -n "$DISTRIBUTION_ID" ]; then
    aws cloudfront create-invalidation \
        --distribution-id "${DISTRIBUTION_ID}" \
        --paths "/*" \
        --region "${AWS_REGION}"
    echo -e "${GREEN}CloudFront cache invalidated!${NC}"
fi

cd ../aws

# Step 5: Display deployment information
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Deployment completed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Frontend URL: https://${CLOUDFRONT_URL}${NC}"
echo -e "${GREEN}Backend URL: ${BACKEND_SERVICE_ARN}${NC}"
echo -e "${GREEN}========================================${NC}"

# Update frontend environment variables if needed
echo -e "${YELLOW}Note: You may need to update frontend environment variables to point to the backend URL.${NC}"
echo -e "${YELLOW}Create a .env.production file in the frontend directory with:${NC}"
echo -e "${YELLOW}VITE_PUBLIC_BACKEND_URL=https://${BACKEND_SERVICE_ARN}${NC}"
