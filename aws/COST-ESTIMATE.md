# AWS Infrastructure Cost Estimate

This document provides a cost estimate for the PewPew game infrastructure deployed via CloudFormation.

## Current Configuration

- **Region**: us-east-1 (N. Virginia)
- **ECS Fargate**: 0.5 vCPU, 1 GB RAM, 1 task running 24/7
- **CloudFront**: PriceClass_100 (North America & Europe only)
- **WAF**: Enabled with IP whitelisting

## Monthly Cost Breakdown

### Stage 1: Basic Infrastructure (FREE)
- **ECR Repository**: $0 (pay only for storage/transfer)
- **S3 Bucket**: $0 (pay only for storage/requests/transfer)
- **IAM Roles**: $0

**Stage 1 Total: ~$0/month** (assuming minimal storage/transfer)

---

### Stage 2: CloudFront Distribution

**Fixed Costs:**
- CloudFront Distribution: $0 (no fixed monthly fee)

**Variable Costs (depends on usage):**
- **Data Transfer Out to Internet**:
  - First 10 TB/month: $0.085 per GB
  - Next 40 TB/month: $0.080 per GB
  - Next 100 TB/month: $0.060 per GB
- **HTTP/HTTPS Requests**:
  - $0.0075 per 10,000 requests
- **Invalidation Requests**:
  - First 1,000/month: FREE
  - Additional: $0.005 per path

**Example (Low Traffic - 10 GB/month, 100K requests):**
- Data Transfer: 10 GB × $0.085 = **$0.85**
- Requests: 100,000 ÷ 10,000 × $0.0075 = **$0.08**
- **Subtotal: ~$0.93/month**

**Example (Medium Traffic - 100 GB/month, 1M requests):**
- Data Transfer: 100 GB × $0.085 = **$8.50**
- Requests: 1,000,000 ÷ 10,000 × $0.0075 = **$0.75**
- **Subtotal: ~$9.25/month**

**Stage 2 Total: ~$1-10/month** (depends on traffic)

---

### Stage 3: ECS Fargate + ALB

#### ECS Fargate (Running 24/7)
- **vCPU**: 0.5 vCPU × $0.04048/hour × 730 hours = **$14.78/month**
- **Memory**: 1 GB × $0.004445/hour × 730 hours = **$3.24/month**
- **ECS Fargate Total: ~$18.02/month**

#### Application Load Balancer
- **Fixed Cost**: $0.0225/hour × 730 hours = **$16.43/month**
- **LCU (Load Balancer Capacity Units)**:
  - New connections: $0.008 per LCU-hour
  - Active connections: $0.008 per LCU-hour
  - Processed bytes: $0.008 per LCU-hour
  - Rule evaluations: $0.008 per LCU-hour
  - **Estimated LCU cost (low traffic): ~$2-5/month**

**ALB Total: ~$18-22/month**

#### CloudWatch Logs
- **Ingestion**: $0.50 per GB ingested
- **Storage**: $0.03 per GB/month (7-day retention)
- **Example (100 MB logs/day = 3 GB/month):**
  - Ingestion: 3 GB × $0.50 = **$1.50**
  - Storage: ~0.5 GB × $0.03 = **$0.02**
  - **Subtotal: ~$1.52/month**

**Stage 3 Total: ~$37-42/month**

---

### Stage 4: AWS WAF

- **Web ACL**: $5.00/month per web ACL
- **IP Set**: $0 (FREE)
- **Rules**: $1.00/month per rule (you have 1 rule)
- **Requests**: $0.60 per million requests

**Example (1M requests/month):**
- Web ACL: **$5.00**
- Rule: **$1.00**
- Requests: 1M × $0.60/1M = **$0.60**
- **Subtotal: ~$6.60/month**

**Stage 4 Total: ~$6-7/month**

---

## Total Monthly Cost Estimate

### Low Traffic Scenario (10 GB CloudFront, 100K requests)
- Stage 1: $0
- Stage 2: $1
- Stage 3: $37
- Stage 4: $7
- **Total: ~$45/month**

### Medium Traffic Scenario (100 GB CloudFront, 1M requests)
- Stage 1: $0
- Stage 2: $9
- Stage 3: $42
- Stage 4: $7
- **Total: ~$58/month**

### High Traffic Scenario (500 GB CloudFront, 10M requests)
- Stage 1: $0
- Stage 2: $42
- Stage 3: $50 (higher ALB LCU)
- Stage 4: $12
- **Total: ~$104/month**

---

## Cost Optimization Tips

### 1. **Reduce ECS Fargate Costs**
- **Use Fargate Spot**: Can save up to 70% (currently configured but not used)
  - Change `DesiredCount` to use Spot capacity provider
  - **Potential savings: ~$12/month** (if using Spot 50% of the time)

- **Scale to Zero**: Stop the ECS service when not in use
  - **Potential savings: ~$37/month** (if stopped 50% of the time)

- **Reduce Resources**: Use 256 CPU (0.25 vCPU) and 512 MB RAM if possible
  - **Potential savings: ~$9/month**

### 2. **Reduce ALB Costs**
- **Use NLB instead of ALB**: Network Load Balancer is cheaper ($0.0225/hour + $0.006/LCU-hour)
  - **Potential savings: ~$5-10/month** (for low traffic)

- **Remove ALB if not needed**: Direct ECS service with public IP (less secure)
  - **Potential savings: ~$18-22/month**

### 3. **Reduce CloudFront Costs**
- Already using `PriceClass_100` (cheapest option)
- Consider CloudFront caching to reduce origin requests

### 4. **Reduce WAF Costs**
- Remove WAF if IP whitelisting isn't critical
  - **Potential savings: ~$6-7/month**

### 5. **Reduce CloudWatch Costs**
- Reduce log retention from 7 days to 1 day
  - **Potential savings: ~$0.50/month**

---

## Minimum Viable Cost (Development/Testing)

If you want to minimize costs for development/testing:

1. **Stop ECS service when not in use**: $0 (when stopped)
2. **Keep CloudFront**: ~$1/month (minimal traffic)
3. **Remove WAF**: $0
4. **Keep S3/ECR**: ~$0 (minimal storage)

**Minimum Cost: ~$1-5/month** (when ECS is stopped)

---

## Cost Monitoring

### AWS Cost Explorer
- Enable AWS Cost Explorer to track actual costs
- Set up billing alerts at $50, $75, $100 thresholds

### AWS Budgets
- Create a budget for the CloudFormation stacks
- Get alerts when costs exceed thresholds

### Resource Tagging
- All resources are tagged with `Project` and `Environment`
- Use tags to filter costs in Cost Explorer

---

## Notes

- **Prices are for us-east-1 region** (prices vary by region)
- **Prices are current as of 2024** (AWS prices can change)
- **Actual costs depend on actual usage** (traffic, requests, data transfer)
- **Free Tier**: New AWS accounts get 12 months of free tier (doesn't apply to most of these services)

---

## References

- [ECS Fargate Pricing](https://aws.amazon.com/fargate/pricing/)
- [Application Load Balancer Pricing](https://aws.amazon.com/elasticloadbalancing/pricing/)
- [CloudFront Pricing](https://aws.amazon.com/cloudfront/pricing/)
- [AWS WAF Pricing](https://aws.amazon.com/waf/pricing/)
- [CloudWatch Logs Pricing](https://aws.amazon.com/cloudwatch/pricing/)

