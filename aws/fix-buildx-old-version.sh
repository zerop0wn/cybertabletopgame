#!/bin/bash
# Fix for older Docker Buildx versions

set -e

echo "=== Setting up Docker Buildx (compatible with older versions) ==="

# Check current buildx version
if docker buildx version &> /dev/null; then
    echo "Current Buildx version:"
    docker buildx version
fi

# Try creating builder without --name flag (older syntax)
echo ""
echo "Creating builder instance..."
docker buildx create --use 2>/dev/null || docker buildx create --driver docker-container --use

# If that doesn't work, try the simplest approach
if [ $? -ne 0 ]; then
    echo "Trying alternative method..."
    docker buildx create --driver docker --use
fi

# Verify
echo ""
echo "Verifying builder..."
docker buildx ls

echo ""
echo "✓ Builder created. You can now use docker-compose build"

