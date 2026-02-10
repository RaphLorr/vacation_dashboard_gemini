#!/bin/bash
# One-time server setup script
# Run this once on your deployment server to prepare for Jenkins deployments

set -e

echo "🚀 Leave Board Application - Server Setup"
echo "=========================================="

# Configuration
DEPLOY_PATH="/var/www/leave-board-app"
JENKINS_USER="jenkins"

# Check if running as root or with sudo
if [ "$EUID" -ne 0 ]; then
    echo "⚠️  Please run with sudo:"
    echo "   sudo ./server-setup.sh"
    exit 1
fi

echo ""
echo "📦 Step 1: Installing required packages..."

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "Installing Node.js 18.x..."
    curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
    apt-get install -y nodejs
else
    echo "✅ Node.js already installed: $(node --version)"
fi

# Install PM2 globally if not present
if ! command -v pm2 &> /dev/null; then
    echo "Installing PM2 process manager..."
    npm install -g pm2
else
    echo "✅ PM2 already installed: $(pm2 --version)"
fi

# Install rsync if not present
if ! command -v rsync &> /dev/null; then
    echo "Installing rsync..."
    apt-get install -y rsync
else
    echo "✅ rsync already installed"
fi

echo ""
echo "📁 Step 2: Setting up deployment directory..."

# Create deployment directory
mkdir -p ${DEPLOY_PATH}
mkdir -p ${DEPLOY_PATH}/logs
mkdir -p ${DEPLOY_PATH}/backups

# Check if Jenkins user exists
if id "$JENKINS_USER" &>/dev/null; then
    echo "✅ Jenkins user found: $JENKINS_USER"

    # Set ownership to Jenkins user
    chown -R ${JENKINS_USER}:${JENKINS_USER} ${DEPLOY_PATH}
    chmod -R 755 ${DEPLOY_PATH}

    echo "✅ Ownership set to ${JENKINS_USER}:${JENKINS_USER}"
else
    echo "⚠️  Jenkins user not found!"
    echo "   The directory will be owned by root."
    echo "   Jenkins might need sudo permissions to deploy."
fi

echo ""
echo "🔥 Step 3: Configuring PM2 startup..."

# Configure PM2 to start on system boot (as Jenkins user if exists)
if id "$JENKINS_USER" &>/dev/null; then
    su - $JENKINS_USER -c "pm2 startup systemd -u $JENKINS_USER --hp /var/lib/jenkins" || true
    echo "✅ PM2 configured to start on boot for Jenkins user"
else
    pm2 startup systemd || true
    echo "✅ PM2 configured to start on boot"
fi

echo ""
echo "🌐 Step 4: Firewall configuration..."

# Check if UFW is installed
if command -v ufw &> /dev/null; then
    echo "Configuring UFW firewall..."

    # Allow Node.js application port
    ufw allow 3000/tcp comment 'Leave Board App'

    # Allow Nginx if it will be used
    if command -v nginx &> /dev/null; then
        ufw allow 'Nginx Full'
    fi

    echo "✅ Firewall rules configured"
else
    echo "ℹ️  UFW not installed, skipping firewall configuration"
fi

echo ""
echo "📋 Step 5: Creating environment file template..."

# Create .env template
cat > ${DEPLOY_PATH}/.env.template << 'EOF'
NODE_ENV=production
PORT=3000
EOF

echo "✅ Environment template created at ${DEPLOY_PATH}/.env.template"

echo ""
echo "✅ Server setup complete!"
echo ""
echo "📊 Summary:"
echo "  - Deployment path: ${DEPLOY_PATH}"
echo "  - Node.js version: $(node --version)"
echo "  - npm version: $(npm --version)"
echo "  - PM2 version: $(pm2 --version)"
echo "  - Owner: ${JENKINS_USER:-root}"
echo ""
echo "🎯 Next steps:"
echo "  1. Configure your Jenkins pipeline job"
echo "  2. Push code to trigger deployment"
echo "  3. Access application at http://your-server:3000"
echo ""
echo "ℹ️  Optional: Install Nginx as reverse proxy"
echo "   sudo apt-get install nginx"
echo "   sudo cp nginx.conf /etc/nginx/sites-available/leave-board-app"
echo "   sudo ln -s /etc/nginx/sites-available/leave-board-app /etc/nginx/sites-enabled/"
echo "   sudo systemctl reload nginx"
echo ""
