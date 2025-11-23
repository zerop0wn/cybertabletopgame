# Required IAM Permissions for CloudFormation Deployment

## Issue
The IAM user `svc_windmill` doesn't have the necessary permissions to deploy CloudFormation stacks.

## Required Permissions

### Option 1: Use an IAM User with Admin Access (Easiest)
If you have access to create IAM users, create a new user with `PowerUserAccess` or `AdministratorAccess` policy attached.

### Option 2: Grant Specific CloudFormation Permissions

Attach the following policy to the `svc_windmill` user:

```json
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "cloudformation:*",
                "s3:*",
                "ecr:*",
                "cloudfront:*",
                "apprunner:*",
                "iam:CreateRole",
                "iam:DeleteRole",
                "iam:GetRole",
                "iam:PassRole",
                "iam:AttachRolePolicy",
                "iam:DetachRolePolicy",
                "iam:PutRolePolicy",
                "iam:DeleteRolePolicy",
                "iam:GetRolePolicy",
                "iam:ListRolePolicies",
                "iam:ListAttachedRolePolicies"
            ],
            "Resource": "*"
        }
    ]
}
```

### Option 3: Use AWS CLI with Different Credentials

If you have another AWS profile or user with the necessary permissions:

```powershell
# Set AWS profile
$env:AWS_PROFILE = "your-admin-profile"

# Or use access keys
$env:AWS_ACCESS_KEY_ID = "your-access-key"
$env:AWS_SECRET_ACCESS_KEY = "your-secret-key"

# Then run deployment
.\DEPLOY-STAGE2-NOW.ps1
```

## Quick Fix: Use AWS Console

If you have console access with admin permissions, you can deploy the stack directly from the AWS Console:

1. Go to CloudFormation in AWS Console
2. Click "Create stack" → "With new resources (standard)"
3. Upload `cloudformation-stage2-cloudfront.yaml`
4. Enter parameters:
   - ProjectName: `pewpew`
   - Environment: `prod`
   - FrontendBucketName: `pewpew-frontend-prod-232846656791`
   - BucketRegion: `us-east-1`
5. Click through and create the stack

## Minimum Required Permissions for Each Stage

### Stage 1 (Basic Infrastructure)
- `cloudformation:*`
- `s3:CreateBucket`, `s3:PutBucketPolicy`, `s3:GetBucketLocation`
- `ecr:CreateRepository`, `ecr:PutLifecyclePolicy`
- `iam:CreateRole`, `iam:AttachRolePolicy`, `iam:PassRole`

### Stage 2 (CloudFront)
- `cloudformation:*`
- `cloudfront:CreateDistribution`, `cloudfront:CreateOriginAccessControl`
- `s3:GetBucketPolicy`, `s3:PutBucketPolicy`

### Stage 3 (App Runner)
- `cloudformation:*`
- `apprunner:CreateService`, `apprunner:CreateAutoScalingConfiguration`
- `ecr:GetAuthorizationToken`, `ecr:BatchGetImage`
- `iam:PassRole`

## Check Current Permissions

To check what permissions your current user has:

```powershell
aws iam get-user
aws iam list-attached-user-policies --user-name svc_windmill
aws iam list-user-policies --user-name svc_windmill
```

## Solution

You need to either:
1. **Grant permissions** to `svc_windmill` user (requires IAM admin access)
2. **Use a different AWS user/profile** with the necessary permissions
3. **Deploy via AWS Console** if you have console access with admin permissions

