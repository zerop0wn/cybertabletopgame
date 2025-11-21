# PowerShell deployment script for PewPew game to AWS
# Run this script from the aws directory

param(
    [string]$ProjectName = "pewpew",
    [string]$Environment = "prod",
    [string]$Region = "us-east-1"
)

$ErrorActionPreference = "Stop"

$StackName = "$ProjectName-$Environment"

Write-Host "Starting deployment of $ProjectName to $Environment..." -ForegroundColor Green

# Check prerequisites
Write-Host "Checking prerequisites..." -ForegroundColor Yellow

if (-not (Get-Command aws -ErrorAction SilentlyContinue)) {
    Write-Host "Error: AWS CLI is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Error: Docker is not installed. Please install it first." -ForegroundColor Red
    exit 1
}

# Step 1: Deploy CloudFormation stack
Write-Host "`nStep 1: Deploying CloudFormation stack..." -ForegroundColor Yellow
aws cloudformation deploy `
    --template-file cloudformation-template.yaml `
    --stack-name $StackName `
    --parameter-overrides `
        ProjectName=$ProjectName `
        Environment=$Environment `
        AppRunnerCpu="0.25 vCPU" `
        AppRunnerMemory="0.5 GB" `
        AppRunnerMinInstances=0 `
        AppRunnerMaxInstances=3 `
    --capabilities CAPABILITY_NAMED_IAM `
    --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Host "CloudFormation deployment failed!" -ForegroundColor Red
    exit 1
}

# Step 2: Get stack outputs
Write-Host "`nStep 2: Getting stack outputs..." -ForegroundColor Yellow

$ECR_URI = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --query "Stacks[0].Outputs[?OutputKey=='BackendECRRepositoryURI'].OutputValue" `
    --output text `
    --region $Region

$S3_BUCKET = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --query "Stacks[0].Outputs[?OutputKey=='FrontendBucketName'].OutputValue" `
    --output text `
    --region $Region

$BACKEND_URL = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --query "Stacks[0].Outputs[?OutputKey=='BackendServiceURL'].OutputValue" `
    --output text `
    --region $Region

$FRONTEND_URL = aws cloudformation describe-stacks `
    --stack-name $StackName `
    --query "Stacks[0].Outputs[?OutputKey=='FrontendURL'].OutputValue" `
    --output text `
    --region $Region

Write-Host "ECR URI: $ECR_URI" -ForegroundColor Cyan
Write-Host "S3 Bucket: $S3_BUCKET" -ForegroundColor Cyan
Write-Host "Backend URL: $BACKEND_URL" -ForegroundColor Cyan
Write-Host "Frontend URL: $FRONTEND_URL" -ForegroundColor Cyan

# Step 3: Build and push backend Docker image
Write-Host "`nStep 3: Building and pushing backend Docker image..." -ForegroundColor Yellow

# Login to ECR
Write-Host "Logging into ECR..." -ForegroundColor Yellow
$ecrPassword = aws ecr get-login-password --region $Region
$ecrPassword | docker login --username AWS --password-stdin $ECR_URI

if ($LASTEXITCODE -ne 0) {
    Write-Host "ECR login failed!" -ForegroundColor Red
    exit 1
}

# Build backend image
Write-Host "Building backend Docker image..." -ForegroundColor Yellow
Set-Location ..\backend
docker build -t "${ECR_URI}:latest" .

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker build failed!" -ForegroundColor Red
    exit 1
}

# Tag with timestamp
$timestamp = Get-Date -Format "yyyyMMdd-HHmmss"
docker tag "${ECR_URI}:latest" "${ECR_URI}:$timestamp"

# Push image
Write-Host "Pushing Docker image to ECR..." -ForegroundColor Yellow
docker push "${ECR_URI}:latest"
docker push "${ECR_URI}:$timestamp"

if ($LASTEXITCODE -ne 0) {
    Write-Host "Docker push failed!" -ForegroundColor Red
    exit 1
}

Set-Location ..\aws

# Step 4: Update App Runner service
Write-Host "`nStep 4: Updating App Runner service..." -ForegroundColor Yellow

$SERVICE_ARN = aws apprunner list-services `
    --region $Region `
    --query "ServiceSummaryList[?ServiceName=='$ProjectName-backend-$Environment'].ServiceArn" `
    --output text

if ($SERVICE_ARN) {
    Write-Host "Starting deployment to App Runner..." -ForegroundColor Yellow
    aws apprunner start-deployment `
        --service-arn $SERVICE_ARN `
        --region $Region
    
    Write-Host "App Runner deployment started! Waiting for service to be ready..." -ForegroundColor Yellow
    Start-Sleep -Seconds 10
} else {
    Write-Host "App Runner service not found. It should be created by CloudFormation." -ForegroundColor Yellow
}

# Step 5: Build and deploy frontend
Write-Host "`nStep 5: Building and deploying frontend..." -ForegroundColor Yellow

Set-Location ..\frontend

# Create .env.production file
Write-Host "Creating .env.production file..." -ForegroundColor Yellow
"VITE_PUBLIC_BACKEND_URL=$BACKEND_URL" | Out-File -FilePath .env.production -Encoding utf8

# Install dependencies if needed
if (-not (Test-Path "node_modules")) {
    Write-Host "Installing frontend dependencies..." -ForegroundColor Yellow
    npm install
}

# Build frontend
Write-Host "Building frontend..." -ForegroundColor Yellow
npm run build

if ($LASTEXITCODE -ne 0) {
    Write-Host "Frontend build failed!" -ForegroundColor Red
    exit 1
}

# Upload to S3
Write-Host "Uploading frontend to S3..." -ForegroundColor Yellow
aws s3 sync dist/ "s3://$S3_BUCKET" --delete --region $Region

if ($LASTEXITCODE -ne 0) {
    Write-Host "S3 upload failed!" -ForegroundColor Red
    exit 1
}

# Invalidate CloudFront cache
Write-Host "Invalidating CloudFront cache..." -ForegroundColor Yellow
$DISTRIBUTION_ID = aws cloudfront list-distributions `
    --query "DistributionList.Items[?Aliases.Items[0]=='$FRONTEND_URL'].Id" `
    --output text `
    --region $Region

if ($DISTRIBUTION_ID) {
    aws cloudfront create-invalidation `
        --distribution-id $DISTRIBUTION_ID `
        --paths "/*" `
        --region $Region
    
    Write-Host "CloudFront cache invalidated!" -ForegroundColor Green
}

Set-Location ..\aws

# Step 6: Display deployment information
Write-Host "`n========================================" -ForegroundColor Green
Write-Host "Deployment completed successfully!" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host "Frontend URL: https://$FRONTEND_URL" -ForegroundColor Cyan
Write-Host "Backend URL: $BACKEND_URL" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Green

Write-Host "`nNote: It may take a few minutes for CloudFront distribution to be fully ready." -ForegroundColor Yellow
Write-Host "Note: App Runner service may take 2-5 minutes to deploy the new image." -ForegroundColor Yellow

