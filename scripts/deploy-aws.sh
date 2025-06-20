#!/bin/bash

# scripts/deploy-aws.sh - Deploy to AWS ECS/EC2
set -e

echo "🚀 Deploying to AWS..."

# Configuration
AWS_REGION=${AWS_REGION:-us-east-1}
ECR_REPO=${ECR_REPO:-your-account.dkr.ecr.us-east-1.amazonaws.com/screen-capture-api}
ECS_CLUSTER=${ECS_CLUSTER:-screen-capture-cluster}
ECS_SERVICE=${ECS_SERVICE:-screen-capture-service}

# Build and push Docker image
echo "📦 Building Docker image..."
docker build -f Dockerfile.production -t screen-capture-api:latest .

echo "🏷️ Tagging image for ECR..."
docker tag screen-capture-api:latest $ECR_REPO:latest
docker tag screen-capture-api:latest $ECR_REPO:$(date +%Y%m%d%H%M%S)

echo "🔐 Logging into ECR..."
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_REPO

echo "📤 Pushing image to ECR..."
docker push $ECR_REPO:latest
docker push $ECR_REPO:$(date +%Y%m%d%H%M%S)

echo "🔄 Updating ECS service..."
aws ecs update-service \
    --cluster $ECS_CLUSTER \
    --service $ECS_SERVICE \
    --force-new-deployment \
    --region $AWS_REGION

echo "⏳ Waiting for deployment to complete..."
aws ecs wait services-stable \
    --cluster $ECS_CLUSTER \
    --services $ECS_SERVICE \
    --region $AWS_REGION

echo "✅ Deployment completed successfully!"

# Health check
echo "🏥 Running health check..."
sleep 10
HEALTH_URL="https://api.yourdomain.com/api/health"
if curl -f $HEALTH_URL; then
    echo "✅ Health check passed"
else
    echo "❌ Health check failed"
    exit 1
fi
