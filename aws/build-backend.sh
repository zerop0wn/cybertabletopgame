#!/bin/bash
# Build backend Docker image locally (for EC2 deployment)

set -e

# Default values
PROJECT_ROOT="${1:-..}"
IMAGE_TAG="${2:-latest}"
IMAGE_NAME="pewpew-backend:${IMAGE_TAG}"

echo "=== Building Backend Docker Image ==="
echo ""

# Get absolute path to backend directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BACKEND_DIR="$(cd "$SCRIPT_DIR/$PROJECT_ROOT/backend" && pwd)"

if [ ! -d "$BACKEND_DIR" ]; then
    echo "ERROR: Backend directory not found at: $BACKEND_DIR"
    echo "Make sure you're running this script from the aws/ directory"
    exit 1
fi

echo "Building from: $BACKEND_DIR"
echo "Image name: $IMAGE_NAME"
echo ""

# Check for Dockerfile
if [ -f "$BACKEND_DIR/Dockerfile.prod" ]; then
    echo "Using Dockerfile.prod for production build"
    DOCKERFILE="$BACKEND_DIR/Dockerfile.prod"
elif [ -f "$BACKEND_DIR/Dockerfile" ]; then
    echo "Using Dockerfile for build"
    DOCKERFILE="$BACKEND_DIR/Dockerfile"
else
    echo "ERROR: No Dockerfile found in $BACKEND_DIR"
    exit 1
fi

# Build the image
echo "Building Docker image..."
cd "$BACKEND_DIR"
sudo docker build -f "$DOCKERFILE" -t "$IMAGE_NAME" .

if [ $? -eq 0 ]; then
    echo ""
    echo "=== Build Complete ==="
    echo "Image: $IMAGE_NAME"
    echo ""
    echo "Next steps:"
    echo "  1. Build frontend: ./aws/build-frontend.sh"
    echo "  2. Start containers: ./aws/build-and-start-containers.sh"
else
    echo ""
    echo "ERROR: Docker build failed"
    exit 1
fi

