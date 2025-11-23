#!/bin/bash
# Manual container startup script (workaround for Docker Compose panic bug)

set -e

echo "=== Starting Containers Manually ==="

# Stop and remove existing containers
echo "Stopping existing containers..."
sudo docker stop backend pewpew-backend pewpew-frontend 2>/dev/null || true
sudo docker rm backend pewpew-backend pewpew-frontend 2>/dev/null || true

# Create network if it doesn't exist
echo "Creating network..."
sudo docker network create pewpew-network 2>/dev/null || true

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Start backend container
echo "Starting backend container..."
sudo docker run -d \
  --name backend \
  --network pewpew-network \
  -p 8000:8000 \
  -v "$PROJECT_DIR/backend/data:/app/data" \
  -e PYTHONUNBUFFERED=1 \
  -e JWT_SECRET=${JWT_SECRET:-change-me-in-production} \
  -e GM_ADMIN_USER=${GM_ADMIN_USER:-admin} \
  -e GM_ADMIN_PASSWORD=${GM_ADMIN_PASSWORD:-admin} \
  -e FEATURE_AUTH_GM=${FEATURE_AUTH_GM:-true} \
  -e FEATURE_JOIN_CODES=${FEATURE_JOIN_CODES:-true} \
  --restart unless-stopped \
  pewpew-backend:latest

# Start frontend container
echo "Starting frontend container..."
sudo docker run -d \
  --name pewpew-frontend \
  --network pewpew-network \
  -p 80:80 \
  --restart unless-stopped \
  pewpew-frontend:latest

# Wait a moment for containers to start
sleep 2

# Check status
echo ""
echo "=== Container Status ==="
sudo docker ps --filter "name=pewpew-"

echo ""
echo "=== Backend Logs (last 10 lines) ==="
sudo docker logs --tail 10 backend

echo ""
echo "=== Frontend Logs (last 10 lines) ==="
sudo docker logs --tail 10 pewpew-frontend

echo ""
echo "Done! Containers should be running."
echo "Backend: http://$(curl -s ifconfig.me):8000"
echo "Frontend: http://$(curl -s ifconfig.me)"

