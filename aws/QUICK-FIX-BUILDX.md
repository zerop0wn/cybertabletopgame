# Quick Fix: Docker Buildx Error

If you're getting the error: `compose build requires buildx 0.17 or later`

## Quick Fix (Run on EC2)

```bash
# Install Docker Buildx
mkdir -p ~/.docker/cli-plugins/
curl -SL "https://github.com/docker/buildx/releases/latest/download/buildx-v0.12.1.linux-amd64" -o ~/.docker/cli-plugins/docker-buildx
chmod +x ~/.docker/cli-plugins/docker-buildx

# Also install system-wide
sudo mkdir -p /usr/local/lib/docker/cli-plugins/
sudo cp ~/.docker/cli-plugins/docker-buildx /usr/local/lib/docker/cli-plugins/
sudo chmod +x /usr/local/lib/docker/cli-plugins/docker-buildx

# Create builder instance
docker buildx create --name mybuilder --use

# Verify
docker buildx version
```

## Alternative: Use Docker Build Instead

If you don't want to install buildx, you can build images manually:

```bash
# Build backend image
cd backend
docker build -f Dockerfile.prod -t pewpew-backend:latest .

# Build frontend image
cd ../frontend
docker build -f Dockerfile.prod -t pewpew-frontend:latest .

# Then use docker-compose without --build flag
cd ..
docker-compose -f docker-compose.prod.yml up -d
```

## Or: Update Docker Compose

The issue might be with an older version of docker-compose. Try updating:

```bash
# Remove old version
sudo rm /usr/local/bin/docker-compose
sudo rm /usr/bin/docker-compose

# Install latest version
sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose
sudo ln -s /usr/local/bin/docker-compose /usr/bin/docker-compose

# Verify
docker-compose --version
```

