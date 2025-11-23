# EC2 Deployment Guide

This guide explains how to deploy PewPew to a single EC2 instance using Docker Compose.

## Architecture

- **Single EC2 instance** running Docker Compose
- **Nginx** (in frontend container) serves static files and proxies API/WebSocket
- **Backend** (FastAPI) handles API and WebSocket connections
- **Single public IP** - simple and straightforward

## Prerequisites

- AWS CLI configured
- Key pair: `windmill-key-20251010-164622` (already set as default)
- Docker Compose files ready

## Step 1: Deploy EC2 Instance

```powershell
cd aws
.\deploy-ec2.ps1
```

This will:
- Create EC2 instance (t3.small by default)
- Set up security group (ports 22, 80, 443)
- Install Docker and Docker Compose
- Output the public IP and DNS

## Step 2: Deploy Application

Once the EC2 instance is ready, SSH into it:

```bash
ssh -i ~/.ssh/windmill-key-20251010-164622.pem ec2-user@<PUBLIC_IP>
```

Then deploy the application:

```bash
# Navigate to app directory
cd /opt/pewpew

# Clone your repository (or upload files)
git clone <your-repo-url> .

# Or use SCP to copy files from local machine:
# scp -i ~/.ssh/windmill-key-20251010-164622.pem -r . ec2-user@<PUBLIC_IP>:/opt/pewpew

# Build and start containers
docker-compose -f docker-compose.prod.yml up -d --build

# Check logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Step 3: Access Application

Open your browser and navigate to:
```
http://<PUBLIC_IP>
```

Or use the public DNS name from the CloudFormation outputs.

## Configuration

### Environment Variables

Create a `.env` file in `/opt/pewpew`:

```bash
JWT_SECRET=your-secret-key-here
GM_ADMIN_USER=admin
GM_ADMIN_PASSWORD=your-password
FEATURE_AUTH_GM=true
FEATURE_JOIN_CODES=true
```

Then update docker-compose.prod.yml to use it:
```yaml
env_file:
  - .env
```

### Nginx Configuration

The nginx configuration (`frontend/nginx.conf`) is already set up to:
- Serve frontend static files
- Proxy `/api/*` to backend
- Proxy `/socket.io/*` to backend (WebSocket support)

## Updating the Application

To update the application:

```bash
# SSH into instance
ssh -i ~/.ssh/windmill-key-20251010-164622.pem ec2-user@<PUBLIC_IP>

# Navigate to app directory
cd /opt/pewpew

# Pull latest changes (if using git)
git pull

# Rebuild and restart
docker-compose -f docker-compose.prod.yml up -d --build

# View logs
docker-compose -f docker-compose.prod.yml logs -f
```

## Monitoring

### Check Container Status

```bash
docker-compose -f docker-compose.prod.yml ps
```

### View Logs

```bash
# All services
docker-compose -f docker-compose.prod.yml logs -f

# Specific service
docker-compose -f docker-compose.prod.yml logs -f backend
docker-compose -f docker-compose.prod.yml logs -f frontend
```

### Check Resource Usage

```bash
# Docker stats
docker stats

# System resources
htop
# or
top
```

## Troubleshooting

### Containers won't start

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs

# Check if ports are in use
sudo netstat -tulpn | grep -E ':(80|8000)'

# Restart Docker
sudo systemctl restart docker
```

### Can't access from browser

1. Check security group allows port 80 from 0.0.0.0/0
2. Check containers are running: `docker-compose ps`
3. Check nginx is listening: `curl http://localhost`
4. Check EC2 instance status in AWS Console

### WebSocket not working

1. Check nginx config has `/socket.io/*` location block
2. Check backend is running: `docker-compose logs backend`
3. Check browser console for errors

## Cost

- **EC2 t3.small**: ~$10-15/month
- **EBS storage (20GB)**: ~$2/month
- **Data transfer**: First 1GB free, then ~$0.09/GB
- **Total**: ~$12-17/month

## Cleanup

To delete everything:

```powershell
# Delete CloudFormation stack (deletes EC2 instance)
aws cloudformation delete-stack --stack-name pewpew-prod-ec2 --region us-east-1
```

## Next Steps

1. **SSL Certificate**: Set up Let's Encrypt for HTTPS
2. **Domain Name**: Point a domain to the EC2 public IP
3. **Backup**: Set up automated backups of `/opt/pewpew/backend/data`
4. **Monitoring**: Set up CloudWatch alarms for instance health

