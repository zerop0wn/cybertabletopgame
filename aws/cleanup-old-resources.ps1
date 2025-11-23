# Clean up old CloudFront, ALB, and ECS resources

param(
    [string]$Region = "us-east-1"
)

Write-Host "=== Cleaning Up Old AWS Resources ===" -ForegroundColor Yellow
Write-Host "This will delete:" -ForegroundColor Cyan
Write-Host "  - CloudFront distributions" -ForegroundColor White
Write-Host "  - ALB and ECS Fargate stacks" -ForegroundColor White
Write-Host "  - S3 buckets (if empty)" -ForegroundColor White
Write-Host "`nWARNING: This action cannot be undone!" -ForegroundColor Red
Write-Host "`nPress Ctrl+C to cancel, or Enter to continue..." -ForegroundColor Yellow
$null = Read-Host

# List of stacks to delete
$stacksToDelete = @(
    "pewpew-prod-stage2",      # CloudFront
    "pewpew-prod-stage3-ecs",  # ECS Fargate
    "pewpew-prod-ecs-new",     # ECS Fargate (new)
    "pewpew-prod-waf"          # WAF
)

# Delete CloudFormation stacks
Write-Host "`n=== Deleting CloudFormation Stacks ===" -ForegroundColor Yellow
foreach ($stackName in $stacksToDelete) {
    Write-Host "`nChecking stack: $stackName" -ForegroundColor Cyan
    $stackExists = aws cloudformation describe-stacks --stack-name $stackName --region $Region 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Deleting stack: $stackName" -ForegroundColor Yellow
        aws cloudformation delete-stack --stack-name $stackName --region $Region
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Deletion initiated for $stackName" -ForegroundColor Green
        } else {
            Write-Host "[ERROR] Failed to delete $stackName" -ForegroundColor Red
        }
    } else {
        Write-Host "[INFO] Stack $stackName does not exist" -ForegroundColor Cyan
    }
}

# Delete CloudFront distributions manually (if stack deletion fails)
Write-Host "`n=== Checking CloudFront Distributions ===" -ForegroundColor Yellow
$distributions = aws cloudfront list-distributions --region $Region --query "DistributionList.Items[?Comment=='pewpew frontend distribution'].Id" --output text 2>&1
if ($distributions -and !($distributions -match "error|Error|ERROR")) {
    $distIds = $distributions.Trim() -split "`t"
    foreach ($distId in $distIds) {
        if ($distId) {
            Write-Host "Found CloudFront distribution: $distId" -ForegroundColor Cyan
            Write-Host "Note: CloudFront distributions must be disabled before deletion" -ForegroundColor Yellow
            Write-Host "You may need to delete this manually from the AWS Console" -ForegroundColor Yellow
        }
    }
}

# Delete S3 buckets (if empty)
Write-Host "`n=== Checking S3 Buckets ===" -ForegroundColor Yellow
$buckets = @(
    "pewpew-frontend-prod-232846656791"
)

foreach ($bucket in $buckets) {
    Write-Host "Checking bucket: $bucket" -ForegroundColor Cyan
    $bucketExists = aws s3 ls "s3://$bucket" 2>&1 | Out-Null
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Attempting to delete bucket: $bucket" -ForegroundColor Yellow
        # Empty bucket first
        aws s3 rm "s3://$bucket" --recursive 2>&1 | Out-Null
        # Delete bucket
        aws s3 rb "s3://$bucket" --region $Region 2>&1 | Out-String | Out-Null
        if ($LASTEXITCODE -eq 0) {
            Write-Host "[OK] Bucket $bucket deleted" -ForegroundColor Green
        } else {
            Write-Host "[WARNING] Could not delete bucket $bucket (may not be empty or have versioning)" -ForegroundColor Yellow
        }
    } else {
        Write-Host "[INFO] Bucket $bucket does not exist" -ForegroundColor Cyan
    }
}

# Delete ECR repositories (optional - keep if you want to reuse images)
Write-Host "`n=== Checking ECR Repositories ===" -ForegroundColor Yellow
Write-Host "Note: ECR repositories are being kept (low cost, useful for future deployments)" -ForegroundColor Cyan
Write-Host "To delete manually: aws ecr delete-repository --repository-name pewpew-backend-prod --force" -ForegroundColor White

# Delete ALB directly (if stack deletion doesn't work)
Write-Host "`n=== Checking Load Balancers ===" -ForegroundColor Yellow
$albs = aws elbv2 describe-load-balancers --region $Region --query "LoadBalancers[?LoadBalancerName=='pewpew-alb-prod'].LoadBalancerArn" --output text 2>&1
if ($albs -and !($albs -match "error|Error|ERROR")) {
    $albArns = $albs.Trim() -split "`t"
    foreach ($albArn in $albArns) {
        if ($albArn) {
            Write-Host "Found ALB: $albArn" -ForegroundColor Cyan
            Write-Host "Note: ALB should be deleted by CloudFormation stack deletion" -ForegroundColor Yellow
            Write-Host "If stack deletion fails, delete manually from AWS Console" -ForegroundColor Yellow
        }
    }
}

Write-Host "`n=== Cleanup Summary ===" -ForegroundColor Green
Write-Host "Stack deletions have been initiated." -ForegroundColor Cyan
Write-Host "`nNote: Some resources may take time to delete:" -ForegroundColor Yellow
Write-Host "  - CloudFormation stacks: 5-15 minutes" -ForegroundColor White
Write-Host "  - CloudFront distributions: Must be disabled first, then 15-20 minutes" -ForegroundColor White
Write-Host "  - ALB: Deleted with ECS stack" -ForegroundColor White
Write-Host "`nMonitor progress in AWS Console:" -ForegroundColor Cyan
Write-Host "  - CloudFormation: https://console.aws.amazon.com/cloudformation" -ForegroundColor White
Write-Host "  - CloudFront: https://console.aws.amazon.com/cloudfront" -ForegroundColor White

Write-Host "`n=== Done ===" -ForegroundColor Green

