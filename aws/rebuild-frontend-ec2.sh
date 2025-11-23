#!/bin/bash
# Rebuild and restart frontend on EC2

set -e

echo "=== Rebuilding Frontend on EC2 ==="

# Navigate to project root
cd ~/cybertabletopgame || cd /opt/pewpew || { echo "Error: Could not find project directory"; exit 1; }

# Pull latest changes
echo "Pulling latest changes from git..."
git pull origin main

# Build frontend image
echo "Building frontend Docker image..."
sudo docker build -f frontend/Dockerfile.prod -t pewpew-frontend:latest ./frontend

# Restart frontend container
echo "Restarting frontend container..."
sudo docker-compose -f docker-compose.prod.yml up -d --no-deps frontend

# Or if using manual script:
# sudo docker stop pewpew-frontend 2>/dev/null || true
# sudo docker rm pewpew-frontend 2>/dev/null || true
# sudo docker run -d --name frontend --network pewpew-network -p 80:80 pewpew-frontend:latest

echo "=== Frontend rebuild complete ==="
echo "Frontend should now use relative URLs for backend connections (Nginx will proxy)"

