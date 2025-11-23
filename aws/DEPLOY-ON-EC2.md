# Deploy on EC2 - Step by Step

## Current Status
You're in `/home/ec2-user/cybertabletopgame` with all the project files.

## Option 1: Build Images Manually (Recommended - No Buildx Needed)

```bash
# Make sure you're in the project root
cd ~/cybertabletopgame

# Build backend image
cd backend
sudo docker build -f Dockerfile.prod -t pewpew-backend:latest .
cd ..

# Build frontend image
cd frontend
sudo docker build -f Dockerfile.prod -t pewpew-frontend:latest .
cd ..

# Update docker-compose.prod.yml to use the built images
# Or just start without --build flag
sudo docker-compose -f docker-compose.prod.yml up -d
```

## Option 2: Fix Buildx and Use docker-compose build

```bash
# Update Docker Buildx to latest version
mkdir -p ~/.docker/cli-plugins/
curl -SL "https://github.com/docker/buildx/releases/latest/download/buildx-v0.12.1.linux-amd64" -o ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx

# Also install system-wide
sudo mkdir -p /usr/local/lib/docker/cli-plugins/
sudo cp ~/.docker/cli-plugins/docker-buildx /usr/local/lib/docker/cli-plugins/
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

# Create builder (without --name for older versions)
docker buildx create --use

# Now you can use docker-compose with --build
sudo docker-compose -f docker-compose.prod.yml up -d --build
```

## Quick Deploy (Recommended - Bypasses Docker Compose Bug)

Use the automated script that builds and starts everything:

```bash
# Make script executable
chmod +x aws/build-and-start-containers.sh

# Run the script
sudo ./aws/build-and-start-containers.sh
```

Or manually:

```bash
# Build images manually
sudo docker build -f backend/Dockerfile.prod -t pewpew-backend:latest ./backend
sudo docker build -f frontend/Dockerfile.prod -t pewpew-frontend:latest ./frontend

# Start containers using manual script (bypasses docker-compose)
chmod +x aws/start-containers-manual.sh
sudo ./aws/start-containers-manual.sh
```

## Verify It's Working

```bash
# Check if containers are running
sudo docker ps

# Test the application
curl http://localhost

# Check backend health
curl http://localhost/api/health
```

## Access Your Application

Once containers are running, access your application at:
```
http://<EC2_PUBLIC_IP>
```

You can find your public IP in the EC2 console or by running:
```bash
curl http://169.254.169.254/latest/meta-data/public-ipv4
```

