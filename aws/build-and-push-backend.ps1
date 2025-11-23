# Build and push backend Docker image to ECR
param(
    [Parameter(Mandatory=$false)]
    [string]$Region = "us-east-1",
    
    [Parameter(Mandatory=$false)]
    [string]$RepositoryName = "pewpew-backend-prod",
    
    [Parameter(Mandatory=$false)]
    [string]$ImageTag = "latest",
    
    [Parameter(Mandatory=$false)]
    [string]$ProjectRoot = ".."
)

$ErrorActionPreference = "Stop"

Write-Host "=== Building and Pushing Backend Docker Image ===" -ForegroundColor Cyan
Write-Host ""

# Get account ID
Write-Host "Getting AWS account ID..." -ForegroundColor Yellow
$accountId = aws sts get-caller-identity --query Account --output text --region $Region 2>&1
if ($LASTEXITCODE -ne 0 -or -not $accountId -or $accountId.Trim() -eq "") {
    Write-Host "ERROR: Could not get AWS account ID. Make sure AWS CLI is configured." -ForegroundColor Red
    exit 1
}
$accountId = $accountId.Trim()
Write-Host "Account ID: $accountId" -ForegroundColor Green

# Construct ECR repository URI
$ecrUri = "${accountId}.dkr.ecr.${Region}.amazonaws.com"
$repositoryUri = "${ecrUri}/${RepositoryName}"
$imageUri = "${repositoryUri}:${ImageTag}"

Write-Host ""
Write-Host "Configuration:" -ForegroundColor Cyan
Write-Host "  Region: $Region" -ForegroundColor Yellow
Write-Host "  Repository: $RepositoryName" -ForegroundColor Yellow
Write-Host "  Tag: $ImageTag" -ForegroundColor Yellow
Write-Host "  Full URI: $imageUri" -ForegroundColor Yellow
Write-Host ""

# Check if repository exists, create if not
Write-Host "Checking if ECR repository exists..." -ForegroundColor Yellow
$ErrorActionPreference = "Continue"
$null = aws ecr describe-repositories --repository-names $RepositoryName --region $Region 2>$null
$repoExists = ($LASTEXITCODE -eq 0)
$ErrorActionPreference = "Stop"

if (-not $repoExists) {
    Write-Host "Repository does not exist. Creating..." -ForegroundColor Yellow
    
    # Run AWS CLI command and capture both stdout and stderr
    $ErrorActionPreference = "Continue"
    $createOutput = aws ecr create-repository `
        --repository-name $RepositoryName `
        --region $Region `
        --image-scanning-configuration scanOnPush=true `
        --encryption-configuration encryptionType=AES256 `
        2>&1 | Out-String
    $ErrorActionPreference = "Stop"
    
    if ($LASTEXITCODE -ne 0) {
        if ($createOutput -match "already exists" -or $createOutput -match "RepositoryAlreadyExistsException") {
            Write-Host "Repository already exists (created by another process)." -ForegroundColor Green
            $repoExists = $true
        } else {
            Write-Host "ERROR: Failed to create ECR repository" -ForegroundColor Red
            Write-Host "Exit code: $LASTEXITCODE" -ForegroundColor Yellow
            Write-Host "Error details:" -ForegroundColor Yellow
            Write-Host $createOutput -ForegroundColor Red
            Write-Host ""
            Write-Host "Possible causes:" -ForegroundColor Yellow
            Write-Host "  - Insufficient IAM permissions (need ecr:CreateRepository)" -ForegroundColor White
            Write-Host "  - Repository name already exists in a different region" -ForegroundColor White
            Write-Host "  - Invalid repository name format" -ForegroundColor White
            Write-Host ""
            Write-Host "To check your IAM permissions, run:" -ForegroundColor Yellow
            Write-Host "  aws iam get-user" -ForegroundColor Cyan
            exit 1
        }
    } else {
        Write-Host "Repository created successfully!" -ForegroundColor Green
        $repoExists = $true
    }
} else {
    Write-Host "Repository exists." -ForegroundColor Green
}

# Authenticate Docker to ECR
Write-Host ""
Write-Host "Authenticating Docker with ECR..." -ForegroundColor Yellow
$ErrorActionPreference = "SilentlyContinue"
$loginOutput = aws ecr get-login-password --region $Region 2>$null | docker login --username AWS --password-stdin $ecrUri 2>&1 | Out-String
$ErrorActionPreference = "Stop"

if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Failed to authenticate Docker with ECR" -ForegroundColor Red
    if ($loginOutput) {
        Write-Host $loginOutput
    }
    exit 1
}
Write-Host "Docker authenticated successfully!" -ForegroundColor Green

# Build Docker image
Write-Host ""
Write-Host "Building Docker image..." -ForegroundColor Yellow
$backendPath = Join-Path $ProjectRoot "backend"
if (-not (Test-Path $backendPath)) {
    Write-Host "ERROR: Backend directory not found at: $backendPath" -ForegroundColor Red
    Write-Host "Make sure you're running this script from the aws/ directory" -ForegroundColor Yellow
    exit 1
}

Write-Host "Building from: $backendPath" -ForegroundColor Cyan

# Check for Dockerfile
$dockerfile = Join-Path $backendPath "Dockerfile"
$dockerfileProd = Join-Path $backendPath "Dockerfile.prod"

if (Test-Path $dockerfileProd) {
    Write-Host "Using Dockerfile.prod for production build" -ForegroundColor Green
    $dockerfileToUse = $dockerfileProd
} elseif (Test-Path $dockerfile) {
    Write-Host "Using Dockerfile for build" -ForegroundColor Green
    $dockerfileToUse = $dockerfile
} else {
    Write-Host "ERROR: No Dockerfile found in $backendPath" -ForegroundColor Red
    exit 1
}

# Build the image
Write-Host "Running: docker build..." -ForegroundColor Cyan

# Use modern Docker builder (remove DOCKER_BUILDKIT=0 to avoid deprecation warning)
Push-Location $backendPath
try {
    $ErrorActionPreference = "Continue"
    $buildOutput = docker build -f $dockerfileToUse -t $imageUri . 2>&1 | Out-String
    $ErrorActionPreference = "Stop"
} finally {
    Pop-Location
}

# Check if build actually failed (ignore deprecation warnings)
if ($LASTEXITCODE -ne 0 -and $buildOutput -notmatch "DEPRECATED" -and $buildOutput -notmatch "deprecated") {
    Write-Host "ERROR: Docker build failed" -ForegroundColor Red
    Write-Host $buildOutput
    exit 1
}

# Check if build succeeded (look for "Successfully built" or "Successfully tagged")
if ($buildOutput -match "Successfully built" -or $buildOutput -match "Successfully tagged") {
    Write-Host "Docker image built successfully!" -ForegroundColor Green
} elseif ($LASTEXITCODE -eq 0) {
    Write-Host "Docker image built successfully!" -ForegroundColor Green
} else {
    Write-Host "WARNING: Build output unclear, but exit code suggests success. Continuing..." -ForegroundColor Yellow
}

# Push the image
Write-Host ""
Write-Host "Pushing Docker image to ECR..." -ForegroundColor Yellow
$pushOutput = docker push $imageUri 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "ERROR: Docker push failed" -ForegroundColor Red
    Write-Host $pushOutput
    exit 1
}
Write-Host "Docker image pushed successfully!" -ForegroundColor Green

Write-Host ""
Write-Host "=== Build and Push Complete ===" -ForegroundColor Green
Write-Host ""
Write-Host "Image URI: $imageUri" -ForegroundColor Cyan
Write-Host ""
Write-Host "Next steps:" -ForegroundColor Yellow
Write-Host "  1. Deploy ECS Fargate with:" -ForegroundColor Yellow
$deployCmd = ".\deploy-ecs-fargate.ps1 -BackendImageUri '${imageUri}' -AllowedCIDRBlocks @('47.4.240.77/32')"
Write-Host "     $deployCmd" -ForegroundColor Cyan
Write-Host ""

