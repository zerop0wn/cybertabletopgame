#!/bin/bash
# Build frontend Docker image locally (for EC2 deployment)

set -e

# Default values
PROJECT_ROOT="${1:-..}"
IMAGE_TAG="${2:-latest}"
IMAGE_NAME="pewpew-frontend:${IMAGE_TAG}"

echo "=== Building Frontend Docker Image ==="
echo ""

# Get absolute path to frontend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FRONTEND_DIR="$(cd "$SCRIPT_DIR/$PROJECT_ROOT/frontend" && pwd)"

if [ ! -d "$FRONTEND_DIR" ]; then
    echo "ERROR: Frontend directory not found at: $FRONTEND_DIR"
    echo "Make sure you're running this script from the aws/ directory"
    exit 1
fi

echo "Building from: $FRONTEND_DIR"
echo "Image name: $IMAGE_NAME"
echo ""

# Check for Dockerfile
if [ -f "$FRONTEND_DIR/Dockerfile.prod" ]; then
    echo "Using Dockerfile.prod for production build"
    DOCKERFILE="$FRONTEND_DIR/Dockerfile.prod"
elif [ -f "$FRONTEND_DIR/Dockerfile" ]; then
    echo "Using Dockerfile for build"
    DOCKERFILE="$FRONTEND_DIR/Dockerfile"
else
    echo "ERROR: No Dockerfile found in $FRONTEND_DIR"
    exit 1
fi

# Build the image
echo "Building Docker image..."
cd "$FRONTEND_DIR"
sudo docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .

if [ $? -eq 0 ]; then
    echo ""
    echo "=== Build Complete ==="
    echo "Image: $IMAGE_NAME"
    echo ""
    echo "Next steps:"
    echo "  1. Start containers: ./aws/build-and-start-containers.sh"
    echo "     (or use: ./aws/start-containers-manual.sh if images are already built)"
else
    echo ""
    echo "ERROR: Docker build failed"
    exit 1
fi

