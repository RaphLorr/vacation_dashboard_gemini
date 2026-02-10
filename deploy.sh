#!/bin/bash
# Manual deployment script (alternative to Jenkins)

set -e

APP_NAME="leave-board-app"
DEPLOY_PATH="/var/www/leave-board-app"
PORT=10890

echo "🚀 Starting deployment of $APP_NAME..."

# Step 1: Pull latest code
echo "📦 Pulling latest code..."
git pull origin main

# Step 2: Install dependencies
echo "📥 Installing dependencies..."
rm -rf node_modules
npm install --production --no-optional

# Step 3: Verify application
echo "✓ Verifying application files..."
node -c server.js
test -f App.tsx
test -f index.html

# Step 4: Backup existing data
if [ -f "$DEPLOY_PATH/leave_data.json" ]; then
    echo "💾 Backing up existing data..."
    mkdir -p "$DEPLOY_PATH/backups"
    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
    cp "$DEPLOY_PATH/leave_data.json" "$DEPLOY_PATH/backups/leave_data_$TIMESTAMP.json"
    echo "✓ Backup created"
fi

# Step 5: Deploy files
echo "📂 Deploying files..."
sudo mkdir -p $DEPLOY_PATH
sudo rsync -av --delete \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude '.reports' \
    --exclude '.claude' \
    --exclude 'leave_data.json' \
    --exclude 'backups' \
    ./ $DEPLOY_PATH/

# Copy node_modules
sudo rsync -av node_modules/ $DEPLOY_PATH/node_modules/

# Set permissions
sudo chown -R $USER:$USER $DEPLOY_PATH
sudo chmod -R 755 $DEPLOY_PATH

# Step 6: Restart application
echo "🔄 Restarting application..."
pm2 stop $APP_NAME || true
pm2 delete $APP_NAME || true
cd $DEPLOY_PATH
pm2 start ecosystem.config.js --env production
pm2 save

# Step 7: Health check
echo "🏥 Running health check..."
sleep 3
if pm2 list | grep -q "$APP_NAME.*online"; then
    echo "✅ Application is running"
else
    echo "❌ Application failed to start"
    exit 1
fi

# Test API endpoint
RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/leave-records)
if [ "$RESPONSE" = "200" ]; then
    echo "✅ API health check passed"
else
    echo "❌ API health check failed (HTTP $RESPONSE)"
    exit 1
fi

echo "🎉 Deployment successful!"
echo "📊 Application status:"
pm2 status $APP_NAME
