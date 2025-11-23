# Quick Deploy on EC2

## Overview
For EC2 deployment, you build Docker images **locally** on the EC2 instance (no need to push to ECR).

## Option 1: All-in-One Script (Recommended)

This builds both images and starts containers:

```bash
cd ~/cybertabletopgame
git pull origin main
chmod +x aws/build-and-start-containers.sh
sudo ./aws/build-and-start-containers.sh
```

## Option 2: Build Separately, Then Start

If you want more control:

```bash
cd ~/cybertabletopgame
git pull origin main

# Build backend
chmod +x aws/build-backend.sh
sudo ./aws/build-backend.sh

# Build frontend
chmod +x aws/build-frontend.sh
sudo ./aws/build-frontend.sh

# Start containers
chmod +x aws/start-containers-manual.sh
sudo ./aws/start-containers-manual.sh
```

## Option 3: Manual Docker Commands

```bash
cd ~/cybertabletopgame

# Build backend
cd backend
sudo docker build -f Dockerfile.prod -t pewpew-backend:latest .
cd ..

# Build frontend
cd frontend
sudo docker build -f Dockerfile.prod -t pewpew-frontend:latest .
cd ..

# Start containers (using manual script)
chmod +x aws/start-containers-manual.sh
sudo ./aws/start-containers-manual.sh
```

## Available Scripts

### For EC2 (Linux) - Use `.sh` scripts:
- `build-and-start-containers.sh` - Builds both images and starts containers
- `build-backend.sh` - Builds backend image only
- `build-frontend.sh` - Builds frontend image only
- `start-containers-manual.sh` - Starts containers (assumes images are already built)

### For Windows - Use `.ps1` scripts:
- `build-and-push-backend.ps1` - Builds and pushes to ECR (for ECS deployment)
- `deploy-ec2.ps1` - Deploys EC2 infrastructure via CloudFormation

## After Deployment

Your application will be available at:
- **Frontend**: `http://YOUR_EC2_PUBLIC_IP`
- **Backend API**: `http://YOUR_EC2_PUBLIC_IP:8000`

Find your public IP:
```bash
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

## Troubleshooting

### Check container status:
```bash
sudo docker ps
```

### View logs:
```bash
sudo docker logs -f backend
sudo docker logs -f pewpew-frontend
```

### Restart containers:
```bash
sudo docker restart backend pewpew-frontend
```

### Rebuild and restart:
```bash
sudo ./aws/build-and-start-containers.sh
```

