# AWS CloudFormation Deployment Guide

This guide explains how to deploy the PewPew game to AWS using CloudFormation for a low-cost, scalable deployment.

## Architecture

The deployment uses:
- **S3 + CloudFront**: Static frontend hosting (~$1-5/month)
- **App Runner**: Backend API with WebSocket support (~$5-20/month for low traffic)
- **ECR**: Docker image repository for backend

## Cost Estimate

For low traffic (1-10 concurrent users):
- **S3 + CloudFront**: ~$1-3/month
- **App Runner** (0.25 vCPU, 0.5 GB, scale-to-zero): ~$5-15/month
- **ECR**: ~$0.10/month (first 500MB free)
- **Data Transfer**: ~$1-5/month
- **Total**: ~$7-23/month

For zero traffic (scale-to-zero enabled):
- **S3 + CloudFront**: ~$1/month
- **App Runner**: ~$0/month (when scaled to zero)
- **Total**: ~$1-2/month

## Prerequisites

1. **AWS CLI** installed and configured
   ```bash
   aws configure
   ```

2. **Docker** installed and running

3. **Node.js and npm** installed (for frontend build)

4. **AWS Account** with appropriate permissions:
   - CloudFormation
   - S3
   - CloudFront
   - App Runner
   - ECR
   - IAM (for role creation)

## Quick Start

### 1. Deploy Infrastructure

```bash
cd aws
chmod +x deploy.sh
./deploy.sh
```

Or manually:

```bash
# Deploy CloudFormation stack
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

### 2. Get Stack Outputs

```bash
aws cloudformation describe-stacks \
    --stack-name pewpew-prod \
    --query "Stacks[0].Outputs" \
    --output table
```

### 3. Build and Push Backend

```bash
# Get ECR login
aws ecr get-login-password --region us-east-1 | \
    docker login --username AWS --password-stdin <ECR_URI>

# Build and push
cd ../backend
docker build -t <ECR_URI>:latest .
docker push <ECR_URI>:latest
```

### 4. Build and Deploy Frontend

```bash
cd ../frontend

# Install dependencies (if needed)
npm install

# Build
npm run build

# Upload to S3
aws s3 sync dist/ s3://<BUCKET_NAME> --delete
```

### 5. Update App Runner Service

After pushing a new backend image, update the App Runner service:

```bash
# Get service ARN
SERVICE_ARN=$(aws apprunner list-services \
    --query "ServiceSummaryList[?ServiceName=='pewpew-backend-prod'].ServiceArn" \
    --output text)

# Start deployment
aws apprunner start-deployment --service-arn $SERVICE_ARN
```

## Configuration

### Environment Variables

Update the CloudFormation template to add environment variables for the backend:

```yaml
RuntimeEnvironmentVariables:
  - Name: FEATURE_WS_SNAPSHOT
    Value: 'true'
  - Name: FEATURE_JOIN_CODES
    Value: 'true'
  - Name: CORS_ORIGINS
    Value: 'https://your-cloudfront-url.cloudfront.net'
```

### Frontend Configuration

Create `frontend/.env.production`:

```env
VITE_PUBLIC_BACKEND_URL=https://your-apprunner-url.us-east-1.awsapprunner.com
```

Then rebuild and redeploy the frontend.

### Cost Optimization

1. **Scale to Zero**: Set `AppRunnerMinInstances: 0` to scale down when idle
2. **Small Instance Size**: Use 0.25 vCPU and 0.5 GB memory
3. **CloudFront Price Class**: Use `PriceClass_100` (only North America and Europe)
4. **S3 Lifecycle**: Configure lifecycle policies to delete old files

### Security

1. **Enable CloudFront OAI**: Already configured in the template
2. **HTTPS Only**: CloudFront enforces HTTPS
3. **CORS Configuration**: Update CORS settings in the template
4. **Environment Variables**: Store secrets in AWS Secrets Manager or Parameter Store

## Monitoring

### View App Runner Logs

```bash
aws apprunner list-services
aws logs tail /aws/apprunner/pewpew-backend-prod --follow
```

### View CloudFront Metrics

```bash
aws cloudwatch get-metric-statistics \
    --namespace AWS/CloudFront \
    --metric-name Requests \
    --dimensions Name=DistributionId,Value=<DISTRIBUTION_ID> \
    --start-time 2024-01-01T00:00:00Z \
    --end-time 2024-01-02T00:00:00Z \
    --period 3600 \
    --statistics Sum
```

## Troubleshooting

### Backend Not Starting

1. Check App Runner logs:
   ```bash
   aws logs tail /aws/apprunner/pewpew-backend-prod --follow
   ```

2. Verify Docker image:
   ```bash
   docker run -p 8000:8000 <ECR_URI>:latest
   ```

### Frontend Not Loading

1. Check S3 bucket:
   ```bash
   aws s3 ls s3://<BUCKET_NAME>/
   ```

2. Check CloudFront distribution status:
   ```bash
   aws cloudfront get-distribution --id <DISTRIBUTION_ID>
   ```

3. Invalidate cache:
   ```bash
   aws cloudfront create-invalidation \
       --distribution-id <DISTRIBUTION_ID> \
       --paths "/*"
   ```

### WebSocket Connection Issues

App Runner supports WebSockets, but ensure:
1. CORS is configured correctly
2. Frontend points to the correct backend URL
3. No proxy or load balancer is blocking WebSocket upgrades

## Cleanup

To delete all resources:

```bash
# Delete CloudFormation stack (this will delete most resources)
aws cloudformation delete-stack --stack-name pewpew-prod

# Delete ECR images (optional, to save storage costs)
aws ecr batch-delete-image \
    --repository-name pewpew-backend-prod \
    --image-ids imageTag=latest
```

## Additional Resources

- [AWS App Runner Pricing](https://aws.amazon.com/apprunner/pricing/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [S3 Pricing](https://aws.amazon.com/s3/pricing/)

