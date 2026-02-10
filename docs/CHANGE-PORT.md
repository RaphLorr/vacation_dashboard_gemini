# How to Change the Application Port

If port 3000 is already in use, follow these steps to change to a different port.

## Quick Check: Is Port 3000 in Use?

Run on your server:
```bash
./check-port.sh
```

Or manually:
```bash
# Check what's using port 3000
sudo lsof -i :3000
sudo netstat -tuln | grep :3000
ss -tuln | grep :3000
```

---

## Option 1: Kill the Conflicting Process

If another application is using port 3000 and you don't need it:

```bash
# Find what's using the port
sudo lsof -i :3000

# Output example:
# COMMAND   PID USER   FD   TYPE DEVICE SIZE/OFF NODE NAME
# node    12345 user   23u  IPv4 123456      0t0  TCP *:3000 (LISTEN)

# Stop it
sudo kill 12345

# Or force kill if needed
sudo kill -9 12345
```

---

## Option 2: Change Leave Board to a Different Port

If you need port 3000 for another app, change Leave Board to use a different port (e.g., 3001, 8080, etc.)

### Step 1: Update Jenkinsfile

Edit `Jenkinsfile`:
```groovy
environment {
    APP_NAME = 'leave-board-app'
    DEPLOY_PATH = '/var/www/leave-board-app'
    PORT = '3001'  // ← Change this
    NODE_ENV = 'production'
}
```

### Step 2: Update server.js

Edit `server.js`:
```javascript
const PORT = process.env.PORT || 3001;  // ← Change default
```

### Step 3: Update ecosystem.config.js

Edit `ecosystem.config.js`:
```javascript
env: {
    NODE_ENV: 'production',
    PORT: 3001  // ← Change this
}
```

### Step 4: Update nginx.conf (if using Nginx)

Edit `nginx.conf`:
```nginx
location / {
    proxy_pass http://localhost:3001;  # ← Change this
    # ...
}
```

### Step 5: Update Firewall

```bash
# Allow new port
sudo ufw allow 3001/tcp

# Remove old port (optional)
sudo ufw delete allow 3000/tcp
```

### Step 6: Commit and Deploy

```bash
git add Jenkinsfile server.js ecosystem.config.js nginx.conf
git commit -m "chore: change application port to 3001"
git push origin main

# Jenkins will auto-deploy with new port
```

### Step 7: Restart Application Manually (if needed)

```bash
# On your server
pm2 stop leave-board-app
pm2 delete leave-board-app
pm2 start ecosystem.config.js
pm2 save
```

---

## Option 3: Run Multiple Instances on Different Ports

You can run both applications on different ports:

- App A: Port 3000
- Leave Board: Port 3001

Then use Nginx to route by domain/path:

```nginx
# App A
server {
    listen 80;
    server_name appa.example.com;
    location / {
        proxy_pass http://localhost:3000;
    }
}

# Leave Board
server {
    listen 80;
    server_name leaveboard.example.com;
    location / {
        proxy_pass http://localhost:3001;
    }
}
```

---

## Common Port Choices

| Port | Common Use |
|------|------------|
| 3000 | Node.js default, React dev server |
| 3001 | Secondary Node.js app |
| 8080 | Common alternative web port |
| 8000 | Django, Python apps |
| 5000 | Flask, .NET apps |
| 4000 | Ruby, Elixir apps |

**Choose an unused port between 3000-9000 for your Leave Board app.**

---

## Verify New Port Works

After changing the port:

```bash
# Test locally on server
curl http://localhost:3001/api/leave-records

# Test externally
curl http://your-server-ip:3001/api/leave-records

# Check if port is listening
sudo netstat -tuln | grep :3001

# Check PM2 logs
pm2 logs leave-board-app
```

---

## Troubleshooting

### Port still in use after changing config

```bash
# Check if old process is still running
pm2 list
pm2 delete leave-board-app  # Remove old instance
pm2 start ecosystem.config.js  # Start with new config
```

### Can't access from outside server

```bash
# Check firewall
sudo ufw status
sudo ufw allow 3001/tcp

# Check if app is listening on 0.0.0.0 (all interfaces)
sudo netstat -tuln | grep :3001
# Should show: 0.0.0.0:3001 (not 127.0.0.1:3001)
```

### Nginx 502 Bad Gateway

```bash
# Check if app is running
pm2 list

# Check nginx config points to correct port
sudo nginx -t
sudo systemctl reload nginx

# Check app logs
pm2 logs leave-board-app
```

---

## Quick Reference: All Files to Update

When changing port, update these files:

1. ✅ `Jenkinsfile` - PORT environment variable
2. ✅ `server.js` - Default PORT value
3. ✅ `ecosystem.config.js` - env.PORT
4. ✅ `nginx.conf` - proxy_pass port (if using Nginx)
5. ✅ Firewall rules - ufw/iptables

Then:
```bash
git add .
git commit -m "chore: change port to XXXX"
git push origin main
```

Jenkins will redeploy automatically! 🚀
