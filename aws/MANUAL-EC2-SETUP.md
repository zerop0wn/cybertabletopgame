# Manual EC2 Setup Guide

## Recommended EC2 Instance Specifications

### Instance Type
- **Recommended**: `t3.small` (2 vCPU, 2 GB RAM)
- **Minimum**: `t3.micro` (2 vCPU, 1 GB RAM) - may struggle under load
- **For more users**: `t3.medium` (2 vCPU, 4 GB RAM)

### Storage
- **EBS Volume Type**: `gp3` (General Purpose SSD)
- **Volume Size**: 20 GB (minimum 8 GB)
- **Encryption**: Enabled (recommended)

### Network
- **VPC**: Default VPC or your existing VPC
- **Subnet**: Public subnet (for internet access)
- **Auto-assign Public IP**: Enabled
- **Security Group**: See below

### Security Group Rules

| Type | Protocol | Port Range | Source | Description |
|------|----------|------------|--------|-------------|
| SSH | TCP | 22 | Your IP or 0.0.0.0/0 | SSH access |
| HTTP | TCP | 80 | 0.0.0.0/0 | Web access |
| HTTPS | TCP | 443 | 0.0.0.0/0 | HTTPS (optional) |

### IAM Role (Optional but Recommended)
- **Policy**: `CloudWatchAgentServerPolicy` (for monitoring)
- Allows CloudWatch metrics and logs

## Step-by-Step Manual Setup

### 1. Launch EC2 Instance

1. Go to **EC2 Console** → **Instances** → **Launch Instance**

2. **Name**: `pewpew-prod`

3. **AMI**: 
   - Search for: `Amazon Linux 2023`
   - Select: `Amazon Linux 2023 AMI` (latest)

4. **Instance Type**: 
   - Select `t3.small` (or your preferred size)

5. **Key Pair**: 
   - Select: `windmill-key-20251010-164622`
   - Or create a new one and download the `.pem` file

6. **Network Settings**:
   - **VPC**: Default VPC (or your VPC)
   - **Subnet**: Public subnet
   - **Auto-assign Public IP**: Enable
   - **Security Group**: Create new security group
     - Name: `pewpew-sg`
     - Description: `Security group for PewPew game`
     - Add rules:
       - SSH (22) from your IP or 0.0.0.0/0
       - HTTP (80) from 0.0.0.0/0
       - HTTPS (443) from 0.0.0.0/0 (optional)

7. **Storage**:
   - **Volume Type**: `gp3`
   - **Size**: 20 GB
   - **Encryption**: Enable

8. **Advanced Details** (Optional):
   - **IAM Instance Profile**: Create/select role with CloudWatch access
   - **User Data**: See script below

9. Click **Launch Instance**

### 2. User Data Script (Optional - for automatic setup)

Paste this into **Advanced Details** → **User Data**:

```bash
#!/bin/bash
yum update -y

# Install Docker
yum install -y docker
systemctl start docker
systemctl enable docker
usermod -a -G docker ec2-user

# Install Docker Compose (plugin version - recommended)
# Docker Compose V2 is included with Docker Desktop, but for Linux we install it separately
DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-linux-x86_64" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose

# Alternative: Install Docker Compose V2 as a plugin (newer method)
# This allows using 'docker compose' instead of 'docker-compose'
mkdir -p ~/.docker/cli-plugins/
curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose

# Install Git
yum install -y git

# Create app directory
mkdir -p /opt/pewpew
chown ec2-user:ec2-user /opt/pewpew
```

### 3. Connect to Instance

```bash
ssh -i ~/.ssh/windmill-key-20251010-164622.pem ec2-user@<PUBLIC_IP>
```

### 4. Install Docker (if not using User Data)

```bash
# Update system
sudo yum update -y

# Install Docker
sudo yum install -y docker
sudo systemctl start docker
sudo systemctl enable docker
sudo usermod -a -G docker ec2-user

# Log out and back in for group changes to take effect
exit
# SSH back in

# Install Docker Compose V2 (as plugin - recommended)
# This allows using 'docker compose' command
mkdir -p ~/.docker/cli-plugins/
sudo curl -SL "https://github.com/docker/compose/releases/latest/download/docker-compose-linux-x86_64" -o ~/.docker/cli-plugins/docker-compose
sudo chmod +x ~/.docker/cli-plugins/docker-compose

# Alternative: Install standalone docker-compose
# sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
# sudo chmod +x /usr/local/bin/docker-compose
# sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

# Verify installations
docker --version
docker compose version  # Note: 'docker compose' (space, not hyphen) for V2 plugin
# OR if using standalone: docker-compose --version
```

### 5. Deploy Application

```bash
# Navigate to app directory
cd /opt/pewpew

# Option 1: Clone from Git
git clone <your-repo-url> .

# Option 2: Upload files via SCP (from your local machine)
# scp -i ~/.ssh/windmill-key-20251010-164622.pem -r . ec2-user@<PUBLIC_IP>:/opt/pewpew

# Create .env file (optional)
cat > .env << EOF
JWT_SECRET=your-secret-key-here-change-this
GM_ADMIN_USER=admin
GM_ADMIN_PASSWORD=your-secure-password
FEATURE_AUTH_GM=true
FEATURE_JOIN_CODES=true
EOF

# Build and start containers
# Use 'docker compose' (space) if you installed the plugin version
docker compose -f docker-compose.prod.yml up -d --build

# OR use 'docker-compose' (hyphen) if you installed the standalone version
# docker-compose -f docker-compose.prod.yml up -d --build

# Check status
docker compose -f docker-compose.prod.yml ps
# OR: docker-compose -f docker-compose.prod.yml ps

# View logs
docker compose -f docker-compose.prod.yml logs -f
# OR: docker-compose -f docker-compose.prod.yml logs -f
```

### 6. Access Application

Open your browser and navigate to:
```
http://<PUBLIC_IP>
```

Or use the public DNS name from the EC2 console.

## Cost Estimate

### t3.small Instance
- **On-Demand**: ~$0.0208/hour = ~$15/month
- **Reserved (1-year)**: ~$10/month
- **Spot**: ~$6-8/month (can be interrupted)

### Storage
- **20 GB gp3**: ~$1.60/month

### Data Transfer
- **First 1 GB**: Free
- **Additional**: ~$0.09/GB

### Total Monthly Cost
- **On-Demand**: ~$16-17/month
- **Reserved**: ~$11-12/month
- **Spot**: ~$7-9/month

## Useful Commands

### Container Management
```bash
# Note: Use 'docker compose' (space) for plugin version, or 'docker-compose' (hyphen) for standalone

# Start containers
docker compose -f docker-compose.prod.yml up -d
# OR: docker-compose -f docker-compose.prod.yml up -d

# Stop containers
docker compose -f docker-compose.prod.yml down
# OR: docker-compose -f docker-compose.prod.yml down

# Restart containers
docker compose -f docker-compose.prod.yml restart
# OR: docker-compose -f docker-compose.prod.yml restart

# View logs
docker compose -f docker-compose.prod.yml logs -f
# OR: docker-compose -f docker-compose.prod.yml logs -f

# Rebuild and restart
docker compose -f docker-compose.prod.yml up -d --build
# OR: docker-compose -f docker-compose.prod.yml up -d --build
```

### System Monitoring
```bash
# Check disk usage
df -h

# Check memory usage
free -h

# Check CPU usage
top

# Check Docker stats
docker stats

# Check container logs
docker-compose -f docker-compose.prod.yml logs backend
docker-compose -f docker-compose.prod.yml logs frontend
```

### Troubleshooting
```bash
# Check if containers are running
docker compose -f docker-compose.prod.yml ps
# OR: docker-compose -f docker-compose.prod.yml ps

# Check if ports are in use
sudo netstat -tulpn | grep -E ':(80|8000)'

# Check nginx is working
curl http://localhost

# Restart Docker service
sudo systemctl restart docker

# Check system logs
sudo journalctl -u docker -f
```

## Security Recommendations

1. **Restrict SSH Access**: 
   - Change security group to only allow SSH from your IP
   - Use: `Your.IP.Address/32` instead of `0.0.0.0/0`

2. **Set Up SSL** (Optional):
   - Use Let's Encrypt with Certbot
   - Point a domain name to the EC2 public IP
   - Configure nginx for HTTPS

3. **Regular Updates**:
   ```bash
   sudo yum update -y
   ```

4. **Backup Data**:
   - Backup `/opt/pewpew/backend/data` regularly
   - Consider using AWS Backup or manual S3 uploads

## Next Steps

1. **Domain Name**: Point a domain to the EC2 public IP
2. **SSL Certificate**: Set up Let's Encrypt for HTTPS
3. **Monitoring**: Set up CloudWatch alarms
4. **Backups**: Automate backups of game data
5. **Auto-restart**: Ensure containers restart on reboot (already configured with `restart: unless-stopped`)

