#!/bin/bash
# Fix Docker Buildx installation for Docker Compose

set -e

echo "=== Installing/Updating Docker Buildx ==="

# Check if buildx is already installed
if docker buildx version &> /dev/null; then
    CURRENT_VERSION=$(docker buildx version | grep -oP 'v\d+\.\d+' | head -1)
    echo "Current Buildx version: $CURRENT_VERSION"
    
    # Check if version is >= 0.17
    VERSION_NUM=$(echo $CURRENT_VERSION | sed 's/v//' | cut -d. -f1)
    MINOR_NUM=$(echo $CURRENT_VERSION | sed 's/v//' | cut -d. -f2)
    
    if [ "$VERSION_NUM" -gt 0 ] || ([ "$VERSION_NUM" -eq 0 ] && [ "$MINOR_NUM" -ge 17 ]); then
        echo "Buildx version is sufficient (>= 0.17)"
        exit 0
    fi
fi

echo "Installing/updating Docker Buildx..."

# Create plugins directory if it doesn't exist
mkdir -p ~/.docker/cli-plugins/

# Download latest buildx
BUILDX_VERSION=$(curl -s https://api.github.com/repos/docker/buildx/releases/latest | grep 'tag_name' | cut -d\" -f4)
echo "Latest Buildx version: $BUILDX_VERSION"

# Download buildx binary
curl -SL "https://github.com/docker/buildx/releases/download/${BUILDX_VERSION}/buildx-${BUILDX_VERSION}.linux-amd64" -o ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx

# Also install system-wide (optional)
sudo mkdir -p /usr/local/lib/docker/cli-plugins/
sudo cp ~/.docker/cli-plugins/docker-buildx /usr/local/lib/docker/cli-plugins/
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

# Create a builder instance
docker buildx create --name mybuilder --use 2>/dev/null || docker buildx use mybuilder

# Verify installation
echo ""
echo "Verifying Buildx installation..."
docker buildx version

echo ""
echo "✓ Docker Buildx installed successfully!"
echo "You can now use: docker-compose build"

