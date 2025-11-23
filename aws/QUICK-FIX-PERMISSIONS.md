# Quick Fix: IAM Permissions Issue

## Problem
```
AccessDenied: User: arn:aws:iam::232846656791:user/svc_windmill is not authorized to perform: cloudformation:DescribeStacks
```

## Solutions (Choose One)

### Solution 1: Use AWS Console (Easiest if you have console access)

1. Go to: https://console.aws.amazon.com/cloudformation/
2. Click **"Create stack"** → **"With new resources (standard)"**
3. Choose **"Upload a template file"**
4. Upload: `cloudformation-stage2-cloudfront.yaml`
5. Click **"Next"**
6. Stack name: `pewpew-prod-stage2`
7. Parameters:
   - **ProjectName**: `pewpew`
   - **Environment**: `prod`
   - **FrontendBucketName**: `pewpew-frontend-prod-232846656791`
   - **BucketRegion**: `us-east-1`
8. Click **"Next"** → **"Next"** → **"Submit"**

### Solution 2: Use Different AWS Credentials

If you have another AWS profile or admin account:

```powershell
# Option A: Use a different profile
aws configure list-profiles
aws configure set profile.your-admin-profile
$env:AWS_PROFILE = "your-admin-profile"
.\DEPLOY-STAGE2-NOW.ps1

# Option B: Use access keys directly
$env:AWS_ACCESS_KEY_ID = "AKIA..."
$env:AWS_SECRET_ACCESS_KEY = "your-secret-key"
.\DEPLOY-STAGE2-NOW.ps1
```

### Solution 3: Grant Permissions to svc_windmill (Requires IAM Admin)

If you have IAM admin access, attach this policy to `svc_windmill`:

**Via AWS Console:**
1. Go to IAM → Users → `svc_windmill`
2. Click "Add permissions" → "Attach policies directly"
3. Search for and attach: **"PowerUserAccess"** (or create custom policy below)

**Via AWS CLI (if you have admin access):**
```powershell
aws iam attach-user-policy --user-name svc_windmill --policy-arn arn:aws:iam::aws:policy/PowerUserAccess
```

**Custom Policy (if you want minimal permissions):**
Create a policy with these permissions and attach it to the user:
- `cloudformation:*`
- `s3:*`
- `cloudfront:*`
- `iam:CreateRole`, `iam:PassRole`, `iam:AttachRolePolicy`

## Recommended: Use AWS Console

Since you have the bucket name and the template is ready, the **easiest solution is to use the AWS Console** to create the stack. This avoids IAM permission issues if your CLI user has limited access.

