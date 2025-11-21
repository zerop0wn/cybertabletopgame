# PowerShell script to upload CloudFormation template directly to AWS
# This creates the stack in AWS CloudFormation

param(
    [string]$StackName = "pewpew-prod",
    [string]$Region = "us-east-1"
)

Write-Host "Uploading CloudFormation template to AWS..." -ForegroundColor Green

# Create the stack
aws cloudformation create-stack `
    --stack-name $StackName `
    --template-body file://cloudformation-template.yaml `
    --parameters `
        ParameterKey=ProjectName,ParameterValue=pewpew `
        ParameterKey=Environment,ParameterValue=prod `
        ParameterKey=BackendImageUri,ParameterValue=placeholder `
        ParameterKey=FrontendBuildPath,ParameterValue=frontend/dist `
        ParameterKey=AppRunnerCpu,ParameterValue="0.25 vCPU" `
        ParameterKey=AppRunnerMemory,ParameterValue="0.5 GB" `
        ParameterKey=AppRunnerMinInstances,ParameterValue=0 `
        ParameterKey=AppRunnerMaxInstances,ParameterValue=3 `
    --capabilities CAPABILITY_NAMED_IAM `
    --region $Region

if ($LASTEXITCODE -eq 0) {
    Write-Host "`nStack creation initiated successfully!" -ForegroundColor Green
    Write-Host "Stack Name: $StackName" -ForegroundColor Cyan
    Write-Host "Region: $Region" -ForegroundColor Cyan
    Write-Host "`nWaiting for stack creation to complete..." -ForegroundColor Yellow
    Write-Host "This may take 5-10 minutes. You can monitor progress in AWS Console." -ForegroundColor Yellow
    Write-Host "`nTo check status, run:" -ForegroundColor Yellow
    Write-Host "aws cloudformation describe-stacks --stack-name $StackName --region $Region" -ForegroundColor Cyan
    
    # Wait for stack creation
    Write-Host "`nWaiting for stack creation..." -ForegroundColor Yellow
    aws cloudformation wait stack-create-complete --stack-name $StackName --region $Region
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "`nStack created successfully!" -ForegroundColor Green
        Write-Host "`nGetting stack outputs..." -ForegroundColor Yellow
        
        # Get outputs
        aws cloudformation describe-stacks `
            --stack-name $StackName `
            --query "Stacks[0].Outputs" `
            --output table `
            --region $Region
        
        Write-Host "`nNext steps:" -ForegroundColor Yellow
        Write-Host "1. Get the ECR URI from outputs above" -ForegroundColor White
        Write-Host "2. Build and push your Docker image to ECR" -ForegroundColor White
        Write-Host "3. Update the App Runner service with the image" -ForegroundColor White
        Write-Host "4. Build and deploy frontend to S3" -ForegroundColor White
        Write-Host "`nSee DEPLOY-COMMANDS.md for detailed steps." -ForegroundColor Cyan
    } else {
        Write-Host "`nStack creation failed or timed out. Check AWS Console for details." -ForegroundColor Red
    }
} else {
    Write-Host "`nFailed to create stack. Check the error message above." -ForegroundColor Red
    exit 1
}

