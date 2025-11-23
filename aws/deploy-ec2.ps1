# Deploy EC2 instance for PewPew game

param(
    [string]$StackName = "pewpew-prod-ec2",
    [string]$Region = "us-east-1",
    [string]$KeyPairName = "windmill-key-20251010-164622",
    [string]$InstanceType = "t3.small",
    [string]$AllowedCIDR = "0.0.0.0/0"
)

Write-Host "=== Deploying EC2 Instance for PewPew ===" -ForegroundColor Green

# Use default key pair if not provided
if ([string]::IsNullOrWhiteSpace($KeyPairName)) {
    $KeyPairName = "windmill-key-20251010-164622"
    Write-Host "`nUsing default key pair: $KeyPairName" -ForegroundColor Cyan
}

# Check if stack already exists
Write-Host "`nChecking if stack exists..." -ForegroundColor Yellow
$stackInfo = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].[StackStatus]" --output text 2>&1
if ($LASTEXITCODE -eq 0 -and $stackInfo) {
    $status = $stackInfo.Trim()
    Write-Host "Stack exists with status: $status" -ForegroundColor Cyan
    
    # Handle failed/rollback states
    if ($status -match "ROLLBACK|FAILED|DELETE") {
        Write-Host "Stack is in a failed state. Waiting for rollback to complete..." -ForegroundColor Yellow
        if ($status -match "ROLLBACK") {
            aws cloudformation wait stack-rollback-complete --stack-name $StackName --region $Region 2>&1 | Out-Null
        }
        Write-Host "Deleting failed stack..." -ForegroundColor Yellow
        aws cloudformation delete-stack --stack-name $StackName --region $Region
        aws cloudformation wait stack-delete-complete --stack-name $StackName --region $Region
        Write-Host "[OK] Failed stack deleted" -ForegroundColor Green
        $action = "create-stack"
    } else {
        Write-Host "Updating existing stack..." -ForegroundColor Yellow
        $action = "update-stack"
    }
} else {
    Write-Host "Stack does not exist. Creating..." -ForegroundColor Yellow
    $action = "create-stack"
}

# Deploy stack
Write-Host "`nDeploying CloudFormation stack..." -ForegroundColor Yellow
$templatePath = Join-Path $PSScriptRoot "cloudformation-ec2-simple.yaml"

# Use file path directly - AWS CLI on Windows should handle it
# If that doesn't work, try: file:///C:/path/to/file format
$templateUri = $templatePath

$params = @(
    "--stack-name", $StackName,
    "--template-body", $templateUri,
    "--parameters",
    "ParameterKey=ProjectName,ParameterValue=pewpew",
    "ParameterKey=Environment,ParameterValue=prod",
    "ParameterKey=InstanceType,ParameterValue=$InstanceType",
    "ParameterKey=KeyPairName,ParameterValue=$KeyPairName",
    "ParameterKey=AllowedCIDRBlocks,ParameterValue=$AllowedCIDR",
    "--capabilities", "CAPABILITY_NAMED_IAM",
    "--region", $Region
)

if ($action -eq "update-stack") {
    $output = & aws cloudformation update-stack @params 2>&1 | Out-String
} else {
    $output = & aws cloudformation create-stack @params 2>&1 | Out-String
}

if ($LASTEXITCODE -ne 0) {
    if ($output -match "No updates are to be performed") {
        Write-Host "`n[INFO] No updates needed" -ForegroundColor Cyan
    } else {
        Write-Host "`n[ERROR] Failed to deploy stack" -ForegroundColor Red
        Write-Host $output -ForegroundColor Red
        exit 1
    }
} else {
    Write-Host "`n[OK] Stack deployment initiated" -ForegroundColor Green
}

# Wait for stack to complete
Write-Host "`nWaiting for stack to complete..." -ForegroundColor Yellow
if ($action -eq "create-stack") {
    aws cloudformation wait stack-create-complete --stack-name $StackName --region $Region
} else {
    aws cloudformation wait stack-update-complete --stack-name $StackName --region $Region
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "`n[SUCCESS] Stack deployment completed!" -ForegroundColor Green
    
    # Get outputs
    Write-Host "`n=== Stack Outputs ===" -ForegroundColor Cyan
    $outputsJson = aws cloudformation describe-stacks --stack-name $StackName --region $Region --query "Stacks[0].Outputs" --output json 2>&1 | Out-String
    $outputs = $outputsJson | ConvertFrom-Json
    
    foreach ($output in $outputs) {
        Write-Host "$($output.OutputKey): $($output.OutputValue)" -ForegroundColor White
    }
    
    $publicIP = ($outputs | Where-Object { $_.OutputKey -eq "PublicIP" }).OutputValue
    $publicDNS = ($outputs | Where-Object { $_.OutputKey -eq "PublicDNS" }).OutputValue
    
    Write-Host "`n=== Next Steps ===" -ForegroundColor Green
    Write-Host "1. SSH into the instance:" -ForegroundColor Cyan
    Write-Host "   ssh -i your-key.pem ec2-user@$publicIP" -ForegroundColor White
    Write-Host "`n2. Clone your repository and deploy:" -ForegroundColor Cyan
    Write-Host "   cd /opt/pewpew" -ForegroundColor White
    Write-Host "   git clone <your-repo-url> ." -ForegroundColor White
    Write-Host "   docker-compose -f docker-compose.prod.yml up -d --build" -ForegroundColor White
    Write-Host "`n3. Access your application:" -ForegroundColor Cyan
    Write-Host "   http://$publicDNS" -ForegroundColor White
} else {
    Write-Host "`n[ERROR] Stack deployment failed or timed out" -ForegroundColor Red
    Write-Host "Check CloudFormation console for details" -ForegroundColor Yellow
    exit 1
}

