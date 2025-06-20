#!/bin/bash

# scripts/deploy-digitalocean.sh - Deploy to DigitalOcean Droplet
set -e

echo "🚀 Deploying to DigitalOcean..."

# Configuration
DROPLET_IP=${DROPLET_IP:-your.droplet.ip}
DEPLOY_USER=${DEPLOY_USER:-deploy}
APP_DIR=${APP_DIR:-/var/www/screen-capture-api}

# Build locally
echo "📦 Building application..."
npm run build

# Create deployment package
echo "📁 Creating deployment package..."
tar -czf deploy.tar.gz \
    --exclude=node_modules \
    --exclude=.git \
    --exclude=logs \
    --exclude=uploads \
    .

# Upload to server
echo "📤 Uploading to server..."
scp deploy.tar.gz $DEPLOY_USER@$DROPLET_IP:/tmp/

# Deploy on server
echo "🚀 Deploying on server..."
ssh $DEPLOY_USER@$DROPLET_IP << 'ENDSSH'
set -e

# Backup current version
if [ -d "/var/www/screen-capture-api" ]; then
    sudo cp -r /var/www/screen-capture-api /var/www/screen-capture-api.backup.$(date +%Y%m%d%H%M%S)
fi

# Extract new version
sudo mkdir -p /var/www/screen-capture-api
cd /var/www/screen-capture-api
sudo tar -xzf /tmp/deploy.tar.gz
sudo chown -R $USER:$USER .

# Install dependencies
npm ci --only=production

# Run database migrations
npm run migrate

# Restart services
sudo systemctl restart screen-capture-api
sudo systemctl restart nginx

# Cleanup
rm /tmp/deploy.tar.gz

echo "✅ Deployment completed!"
ENDSSH

# Health check
echo "🏥 Running health check..."
sleep 10
if curl -f http://$DROPLET_IP:3001/api/health; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi

# Cleanup local files
rm deploy.tar.gz

echo "🎉 Deployment to DigitalOcean completed successfully!"
