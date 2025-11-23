#!/bin/bash
# Install Docker Compose on Amazon Linux 2023

set -e

echo "=== Installing Docker Compose ==="

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "ERROR: Docker is not installed. Please install Docker first."
    exit 1
fi

echo "Docker version: $(docker --version)"

# Method 1: Install Docker Compose V2 as a plugin (recommended)
echo ""
echo "Installing Docker Compose V2 as a plugin..."
mkdir -p ~/.docker/cli-plugins/

# Get latest version
COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep 'tag_name' | cut -d\" -f4)
echo "Latest version: $COMPOSE_VERSION"

# Download and install
curl -SL "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-linux-x86_64" -o ~/.docker/cli-plugins/docker-compose
chmod +x ~/.docker/cli-plugins/docker-compose

# Verify installation
if docker compose version &> /dev/null; then
    echo ""
    echo "✓ Docker Compose V2 installed successfully!"
    echo "Version: $(docker compose version)"
    echo ""
    echo "You can now use: docker compose"
    exit 0
fi

# Method 2: Install standalone docker-compose (fallback)
echo ""
echo "Installing standalone docker-compose..."
sudo curl -L "https://github.com/docker/compose/releases/download/${COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -sf /usr/local/bin/docker-compose /usr/bin/docker-compose

# Verify installation
if docker-compose --version &> /dev/null; then
    echo ""
    echo "✓ Docker Compose installed successfully!"
    echo "Version: $(docker-compose --version)"
    echo ""
    echo "You can now use: docker-compose"
    exit 0
fi

echo ""
echo "ERROR: Failed to install Docker Compose"
exit 1

