# Deployment Guide

Complete guide for deploying the Leave Board Application to production using Jenkins CI/CD.

---

## 📋 Table of Contents

1. [Prerequisites](#prerequisites)
2. [Server Setup](#server-setup)
3. [Jenkins Setup](#jenkins-setup)
4. [Deployment Options](#deployment-options)
5. [Configuration](#configuration)
6. [Monitoring](#monitoring)
7. [Troubleshooting](#troubleshooting)

---

## Prerequisites

### Server Requirements

- **OS**: Ubuntu 20.04+ / CentOS 7+ / Debian 10+
- **Node.js**: v18.x or v20.x
- **Memory**: Minimum 512MB RAM (1GB recommended)
- **Storage**: 1GB free space
- **Network**: Port 3000 (or custom port) open

### Software Requirements

1. **Node.js & npm**
   ```bash
   # Install Node.js 18.x
   curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
   sudo apt-get install -y nodejs

   # Verify installation
   node --version  # Should show v18.x or v20.x
   npm --version
   ```

2. **PM2 (Process Manager)**
   ```bash
   sudo npm install -g pm2
   pm2 startup  # Configure PM2 to start on boot
   ```

3. **Nginx (Optional - for reverse proxy)**
   ```bash
   sudo apt-get install -y nginx
   ```

4. **Git**
   ```bash
   sudo apt-get install -y git
   ```

---

## Server Setup

### 1. Create Application Directory

```bash
sudo mkdir -p /var/www/leave-board-app
sudo chown -R $USER:$USER /var/www/leave-board-app
```

### 2. Configure Firewall

```bash
# Allow HTTP/HTTPS (if using Nginx)
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Or allow direct access to Node.js port
sudo ufw allow 3000/tcp
```

### 3. Setup Nginx (Optional but Recommended)

```bash
# Copy nginx configuration
sudo cp nginx.conf /etc/nginx/sites-available/leave-board-app

# Edit domain name
sudo nano /etc/nginx/sites-available/leave-board-app
# Replace 'your-domain.com' with your actual domain

# Enable site
sudo ln -s /etc/nginx/sites-available/leave-board-app /etc/nginx/sites-enabled/

# Test configuration
sudo nginx -t

# Reload Nginx
sudo systemctl reload nginx
```

### 4. Setup SSL (Optional - HTTPS)

```bash
# Install Certbot
sudo apt-get install -y certbot python3-certbot-nginx

# Obtain SSL certificate
sudo certbot --nginx -d your-domain.com

# Certbot will automatically configure Nginx for HTTPS
```

---

## Jenkins Setup

### 1. Install Jenkins

```bash
# Add Jenkins repository
curl -fsSL https://pkg.jenkins.io/debian-stable/jenkins.io-2023.key | sudo tee \
  /usr/share/keyrings/jenkins-keyring.asc > /dev/null

echo deb [signed-by=/usr/share/keyrings/jenkins-keyring.asc] \
  https://pkg.jenkins.io/debian-stable binary/ | sudo tee \
  /etc/apt/sources.list.d/jenkins.list > /dev/null

# Install Jenkins
sudo apt-get update
sudo apt-get install -y jenkins

# Start Jenkins
sudo systemctl start jenkins
sudo systemctl enable jenkins
```

Access Jenkins at: `http://your-server:8080`

### 2. Install Required Jenkins Plugins

Go to **Manage Jenkins → Manage Plugins → Available**, install:

- Git plugin
- Pipeline plugin
- NodeJS plugin
- Workspace Cleanup plugin

### 3. Configure NodeJS in Jenkins

**Manage Jenkins → Global Tool Configuration → NodeJS**

- Name: `NodeJS 18`
- Install automatically: Yes
- Version: NodeJS 18.x

### 4. Create Jenkins Pipeline Job

1. **New Item → Pipeline**
2. Name: `leave-board-app-deploy`
3. **Pipeline section:**
   - Definition: `Pipeline script from SCM`
   - SCM: `Git`
   - Repository URL: `https://github.com/your-username/your-repo.git`
   - Branch: `*/main`
   - Script Path: `Jenkinsfile`
4. **Build Triggers:**
   - ✅ Poll SCM: `H/5 * * * *` (check every 5 minutes)
   - Or use GitHub webhooks for instant builds
5. **Save**

### 5. Configure Jenkins User Permissions

```bash
# Add Jenkins user to your group (for file access)
sudo usermod -aG $USER jenkins

# Restart Jenkins
sudo systemctl restart jenkins
```

### 6. Setup GitHub Webhook (Optional - for auto-deployment)

**In your GitHub repository:**

1. Settings → Webhooks → Add webhook
2. Payload URL: `http://your-jenkins:8080/github-webhook/`
3. Content type: `application/json`
4. Events: `Just the push event`
5. Active: ✅
6. Save

---

## Deployment Options

### Option 1: Jenkins Pipeline (Recommended)

Automated deployment using the `Jenkinsfile`:

```bash
# Commit and push code
git add .
git commit -m "feat: add new feature"
git push origin main

# Jenkins will automatically:
# 1. Detect push (via webhook or polling)
# 2. Checkout code
# 3. Install dependencies
# 4. Verify application
# 5. Backup data
# 6. Deploy
# 7. Restart with PM2
# 8. Health check
```

### Option 2: Manual Deployment Script

Use the included `deploy.sh` script:

```bash
# Run deployment script
./deploy.sh

# Or with sudo if needed
sudo ./deploy.sh
```

### Option 3: Docker Deployment

```bash
# Build Docker image
docker build -t leave-board-app:latest .

# Run container
docker run -d \
  --name leave-board-app \
  -p 3000:3000 \
  -v $(pwd)/leave_data.json:/app/leave_data.json \
  --restart unless-stopped \
  leave-board-app:latest

# Check logs
docker logs -f leave-board-app
```

### Option 4: Docker Compose

Create `docker-compose.yml`:

```yaml
version: '3.8'

services:
  app:
    build: .
    container_name: leave-board-app
    ports:
      - "3000:3000"
    volumes:
      - ./leave_data.json:/app/leave_data.json
      - ./logs:/app/logs
    environment:
      - NODE_ENV=production
      - PORT=3000
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/api/leave-records', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
```

Deploy:
```bash
docker-compose up -d
```

---

## Configuration

### Environment Variables

Create `.env` file (optional):

```bash
NODE_ENV=production
PORT=3000
DATA_FILE=./leave_data.json
```

Modify `server.js` to use environment variables:

```javascript
require('dotenv').config();  // Add at top

const PORT = process.env.PORT || 3000;
const DATA_FILE = process.env.DATA_FILE || path.join(__dirname, 'leave_data.json');
```

### PM2 Configuration

The `ecosystem.config.js` file controls PM2 behavior:

```javascript
// Modify as needed
{
  instances: 1,              // Number of instances (use 'max' for cluster mode)
  max_memory_restart: '500M', // Restart if memory exceeds 500MB
  error_file: './logs/err.log',
  out_file: './logs/out.log',
}
```

### Nginx Configuration

Edit `/etc/nginx/sites-available/leave-board-app`:

```nginx
# Change server name
server_name your-domain.com;

# Change upstream port if needed
proxy_pass http://localhost:3000;

# Adjust file upload size
client_max_body_size 50M;  # For large Excel files
```

---

## Monitoring

### PM2 Monitoring

```bash
# View application status
pm2 status

# View logs
pm2 logs leave-board-app

# Monitor in real-time
pm2 monit

# View detailed info
pm2 show leave-board-app
```

### Application Logs

```bash
# View PM2 logs
tail -f /var/www/leave-board-app/logs/out.log
tail -f /var/www/leave-board-app/logs/err.log

# View Nginx logs
sudo tail -f /var/log/nginx/leave-board-app-access.log
sudo tail -f /var/log/nginx/leave-board-app-error.log
```

### Health Check Endpoint

```bash
# Check API health
curl http://localhost:3000/api/leave-records

# Expected response: {"leaveData":{},"employeeInfo":{},"updatedAt":null}
```

### PM2 Web Dashboard (Optional)

```bash
# Install PM2 web interface
pm2 install pm2-server-monit

# Access at: http://your-server:9615
```

---

## Troubleshooting

### Issue: Application Not Starting

```bash
# Check PM2 status
pm2 status

# Check logs
pm2 logs leave-board-app --lines 50

# Restart application
pm2 restart leave-board-app

# Delete and recreate
pm2 delete leave-board-app
pm2 start ecosystem.config.js
```

### Issue: Port Already in Use

```bash
# Find process using port 3000
sudo lsof -i :3000

# Kill the process
sudo kill -9 <PID>

# Or change port in server.js and ecosystem.config.js
```

### Issue: Permission Denied

```bash
# Fix file permissions
sudo chown -R $USER:$USER /var/www/leave-board-app
sudo chmod -R 755 /var/www/leave-board-app

# Ensure Jenkins has access
sudo usermod -aG $USER jenkins
sudo systemctl restart jenkins
```

### Issue: Data File Not Persisting

```bash
# Check file exists and permissions
ls -la /var/www/leave-board-app/leave_data.json

# Create directory if needed
mkdir -p /var/www/leave-board-app
touch /var/www/leave-board-app/leave_data.json
chmod 644 /var/www/leave-board-app/leave_data.json
```

### Issue: Jenkins Build Fails

```bash
# Check Jenkins logs
sudo tail -f /var/log/jenkins/jenkins.log

# Check pipeline console output in Jenkins UI

# Verify Node.js is available
node --version  # Run as Jenkins user

# Test deployment manually
cd /var/www/leave-board-app
npm ci --production
node -c server.js
```

### Issue: 502 Bad Gateway (Nginx)

```bash
# Check if application is running
pm2 status

# Check Nginx error logs
sudo tail -f /var/log/nginx/error.log

# Test direct access
curl http://localhost:3000

# Restart Nginx
sudo systemctl restart nginx
```

---

## Maintenance

### Backup Strategy

```bash
# Manual backup
cp /var/www/leave-board-app/leave_data.json \
   /var/www/leave-board-app/backups/leave_data_$(date +%Y%m%d).json

# Automated daily backup (add to crontab)
crontab -e

# Add this line:
0 2 * * * cp /var/www/leave-board-app/leave_data.json /var/www/leave-board-app/backups/leave_data_$(date +\%Y\%m\%d).json
```

### Update Application

```bash
# Option 1: Via Jenkins
# Push code to Git → Jenkins auto-deploys

# Option 2: Manual
cd /var/www/leave-board-app
git pull origin main
npm ci --production
pm2 restart leave-board-app
```

### Security Updates

```bash
# Update Node.js packages
npm audit
npm audit fix

# Update system packages
sudo apt-get update
sudo apt-get upgrade
```

---

## Quick Reference

### Common Commands

```bash
# Start application
pm2 start ecosystem.config.js

# Stop application
pm2 stop leave-board-app

# Restart application
pm2 restart leave-board-app

# View logs
pm2 logs leave-board-app

# Check status
pm2 status

# Deploy manually
./deploy.sh

# Test API
curl http://localhost:3000/api/leave-records
```

### Important Files

- **Jenkinsfile** - Jenkins pipeline definition
- **ecosystem.config.js** - PM2 configuration
- **nginx.conf** - Nginx reverse proxy config
- **deploy.sh** - Manual deployment script
- **Dockerfile** - Docker container definition
- **leave_data.json** - Application data (persisted)

---

## Support

For issues or questions:
1. Check logs: `pm2 logs leave-board-app`
2. Review CLAUDE.md for architecture details
3. Check GitHub issues
4. Review this deployment guide

---

**Deployment Status Checklist:**

- [ ] Server setup complete
- [ ] Jenkins installed and configured
- [ ] Pipeline job created
- [ ] PM2 installed
- [ ] Nginx configured (optional)
- [ ] SSL certificate installed (optional)
- [ ] First deployment successful
- [ ] Health check passing
- [ ] Monitoring setup
- [ ] Backup strategy in place
