#!/bin/bash
# Build and start containers manually (workaround for Docker Compose panic bug)

set -e

echo "=== Building and Starting Containers ==="

# Get current directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# Stop and remove existing containers
echo "Stopping existing containers..."
sudo docker stop backend pewpew-backend pewpew-frontend 2>/dev/null || true
sudo docker rm backend pewpew-backend pewpew-frontend 2>/dev/null || true

# Build backend image
echo ""
echo "=== Building Backend Image ==="
cd "$PROJECT_DIR/backend"
sudo docker build -f Dockerfile.prod -t pewpew-backend:latest .

# Build frontend image
echo ""
echo "=== Building Frontend Image ==="
cd "$PROJECT_DIR/frontend"
sudo docker build -f Dockerfile.prod -t pewpew-frontend:latest .

# Create network if it doesn't exist
echo ""
echo "=== Creating Network ==="
sudo docker network create pewpew-network 2>/dev/null || true

# Start backend container
echo ""
echo "=== Starting Backend Container ==="
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
echo ""
echo "=== Starting Frontend Container ==="
sudo docker run -d \
  --name pewpew-frontend \
  --network pewpew-network \
  -p 80:80 \
  --restart unless-stopped \
  pewpew-frontend:latest

# Wait a moment for containers to start
echo ""
echo "Waiting for containers to start..."
sleep 5

# Check status
echo ""
echo "=== Container Status ==="
sudo docker ps --filter "name=backend" --filter "name=pewpew-frontend"

echo ""
echo "=== Backend Logs (last 10 lines) ==="
sudo docker logs --tail 10 backend 2>&1 || echo "Backend container not found"

echo ""
echo "=== Frontend Logs (last 10 lines) ==="
sudo docker logs --tail 10 pewpew-frontend 2>&1 || echo "Frontend container not found"

# Get public IP
PUBLIC_IP=$(curl -s http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || curl -s ifconfig.me 2>/dev/null || echo "YOUR_EC2_IP")

echo ""
echo "=== Deployment Complete ==="
echo "Backend: http://${PUBLIC_IP}:8000"
echo "Frontend: http://${PUBLIC_IP}"
echo ""
echo "To view logs:"
echo "  sudo docker logs -f backend"
echo "  sudo docker logs -f pewpew-frontend"

