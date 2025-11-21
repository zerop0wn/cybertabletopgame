#!/bin/bash
# SSL/TLS Setup Script using Let's Encrypt
# Run this after setting up your domain DNS

set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: ./setup-ssl.sh your-domain.com your-email@example.com"
    exit 1
fi

echo "🔒 Setting up SSL/TLS for $DOMAIN..."

# Install certbot
if command -v yum &> /dev/null; then
    # Amazon Linux
    sudo yum install -y certbot python3-certbot-nginx
elif command -v apt-get &> /dev/null; then
    # Ubuntu/Debian
    sudo apt-get update
    sudo apt-get install -y certbot python3-certbot-nginx
fi

# Install nginx if not already installed
if ! command -v nginx &> /dev/null; then
    if command -v yum &> /dev/null; then
        sudo yum install -y nginx
    else
        sudo apt-get install -y nginx
    fi
    sudo systemctl enable nginx
    sudo systemctl start nginx
fi

# Create directory for ACME challenge
sudo mkdir -p /var/www/certbot

# Copy nginx config template
sudo cp nginx-reverse-proxy.conf /etc/nginx/conf.d/cybertabletop.conf
sudo sed -i "s/your-domain.com/$DOMAIN/g" /etc/nginx/conf.d/cybertabletop.conf

# Test nginx config
sudo nginx -t

# Obtain certificate
sudo certbot certonly --webroot \
    -w /var/www/certbot \
    -d $DOMAIN \
    -d www.$DOMAIN \
    --email $EMAIL \
    --agree-tos \
    --non-interactive

# Update nginx config with certificate paths
sudo sed -i "s|/etc/letsencrypt/live/your-domain.com|/etc/letsencrypt/live/$DOMAIN|g" /etc/nginx/conf.d/cybertabletop.conf

# Reload nginx
sudo nginx -t && sudo systemctl reload nginx

# Set up auto-renewal
echo "0 0,12 * * * root certbot renew --quiet && systemctl reload nginx" | sudo tee -a /etc/crontab > /dev/null

echo "✅ SSL/TLS setup complete!"
echo "🌐 Your site is now available at https://$DOMAIN"
echo ""
echo "⚠️  Remember to:"
echo "   1. Update VITE_BACKEND_URL in .env to use https://$DOMAIN"
echo "   2. Update backend CORS settings to allow $DOMAIN"
echo "   3. Restart Docker containers: docker-compose -f docker-compose.prod.yml restart"


