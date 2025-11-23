# Building and Deploying Frontend

## If npm is not found:

### Option 1: Install Node.js (if not installed)
1. Download Node.js from: https://nodejs.org/
2. Install it (this will add npm to your PATH)
3. Restart your terminal/PowerShell
4. Verify: `npm --version`

### Option 2: Use nvm (Node Version Manager)
If you have nvm installed:
```powershell
nvm use 18  # or whatever version you have
npm --version
```

### Option 3: Build on a Different Machine
If you have the frontend built elsewhere, you can:
1. Build it on a machine with npm
2. Copy the `dist/` folder
3. Upload directly to S3:
   ```powershell
   aws s3 sync dist/ "s3://pewpew-frontend-prod-232846656791" --delete --region us-east-1
   ```

## Once npm is working:

```powershell
# Navigate to frontend
cd frontend

# Get backend URL
$BACKEND_URL = aws apprunner list-services --region us-east-1 --query "ServiceSummaryList[?ServiceName=='pewpew-backend-prod'].ServiceUrl" --output text

# Create .env.production
"VITE_PUBLIC_BACKEND_URL=$BACKEND_URL" | Out-File -FilePath .env.production -Encoding utf8

# Install dependencies (if needed)
npm install

# Build
npm run build

# Deploy to S3
aws s3 sync dist/ "s3://pewpew-frontend-prod-232846656791" --delete --region us-east-1

# Invalidate CloudFront
aws cloudfront create-invalidation --distribution-id E119ULFXEJSX9C --paths "/*" --region us-east-1
```

## Quick Check:
```powershell
# Check if Node.js is installed
node --version

# Check if npm is installed  
npm --version

# If both work, you're good to go!
```

