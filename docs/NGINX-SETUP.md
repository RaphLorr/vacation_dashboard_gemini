# Nginx Setup Guide for Leave Board Application

## Quick Setup

Your subdomain: **digi-leave-dashboard.butik.com.cn**
Application port: **10890**
Certificate: **\*.butik.com.cn** (wildcard)

---

## Installation Steps

### 1. Copy Nginx Configuration

```bash
# SSH to your server
ssh your-server

# Copy nginx config to sites-available
sudo cp /path/to/nginx.conf /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf

# Or create directly
sudo nano /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf
# Then paste the content from nginx.conf
```

### 2. Create Symlink

```bash
# Enable the site
sudo ln -s /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf /etc/nginx/sites-enabled/

# Verify symlink created
ls -la /etc/nginx/sites-enabled/ | grep digi-leave-dashboard
```

### 3. Test Nginx Configuration

```bash
# Test for syntax errors
sudo nginx -t

# Expected output:
# nginx: the configuration file /etc/nginx/nginx.conf syntax is ok
# nginx: configuration file /etc/nginx/nginx.conf test is successful
```

### 4. Reload Nginx

```bash
# Reload nginx to apply changes
sudo systemctl reload nginx

# Or restart if needed
sudo systemctl restart nginx

# Check status
sudo systemctl status nginx
```

### 5. Verify Setup

```bash
# Check if nginx is listening on ports 80 and 443
sudo netstat -tuln | grep -E ':80|:443'

# Test HTTP redirect
curl -I http://digi-leave-dashboard.butik.com.cn
# Should return: 301 Moved Permanently

# Test HTTPS
curl -I https://digi-leave-dashboard.butik.com.cn
# Should return: 200 OK (after app is running)
```

---

## Verify DNS

Your subdomain **digi-leave-dashboard.butik.com.cn** should point to your server IP:

```bash
# Check DNS resolution
nslookup digi-leave-dashboard.butik.com.cn
dig digi-leave-dashboard.butik.com.cn

# Should return your server's IP address
```

---

## Troubleshooting

### Issue: 502 Bad Gateway

**Cause:** Application not running on port 10890

**Solution:**
```bash
# Check if app is running
pm2 list

# Check if port is listening
sudo netstat -tuln | grep 10890

# Start app if not running
pm2 start /var/www/leave-board-app/ecosystem.config.js

# Check app logs
pm2 logs leave-board-app
```

### Issue: SSL Certificate Error

**Cause:** Certificate path incorrect

**Solution:**
```bash
# Verify certificate files exist
ls -la /etc/nginx/cert/butik.com.cn/

# Should show:
# fullchain.pem
# privkey.pem

# Test certificate
sudo nginx -t
```

### Issue: Permission Denied

**Cause:** Nginx user can't access files

**Solution:**
```bash
# Check nginx user
ps aux | grep nginx

# Set proper permissions
sudo chmod 644 /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf
sudo chown root:root /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf
```

### Issue: Port Already in Use

**Cause:** Another service using port 80 or 443

**Solution:**
```bash
# Check what's using the ports
sudo lsof -i :80
sudo lsof -i :443

# Usually it's just nginx, which is correct
```

---

## Check Nginx Logs

```bash
# Access log
sudo tail -f /var/log/nginx/digi-leave-dashboard.access.log

# Error log
sudo tail -f /var/log/nginx/digi-leave-dashboard.error.log

# General nginx error log
sudo tail -f /var/log/nginx/error.log
```

---

## Full Deployment Checklist

- [ ] DNS record points to server IP
- [ ] Application running on port 10890 (check with `pm2 list`)
- [ ] Nginx config copied to `/etc/nginx/sites-available/`
- [ ] Symlink created in `/etc/nginx/sites-enabled/`
- [ ] Nginx config tested (`sudo nginx -t`)
- [ ] Nginx reloaded (`sudo systemctl reload nginx`)
- [ ] HTTP redirects to HTTPS (test with curl)
- [ ] HTTPS returns 200 OK (test with curl)
- [ ] Can access via browser: https://digi-leave-dashboard.butik.com.cn

---

## Test Commands Reference

```bash
# Test HTTP redirect
curl -I http://digi-leave-dashboard.butik.com.cn

# Test HTTPS endpoint
curl -I https://digi-leave-dashboard.butik.com.cn

# Test API directly (bypass nginx)
curl http://localhost:10890/api/leave-records

# Test API through nginx
curl https://digi-leave-dashboard.butik.com.cn/api/leave-records

# Check nginx syntax
sudo nginx -t

# Reload nginx
sudo systemctl reload nginx

# Check nginx status
sudo systemctl status nginx

# View nginx logs
sudo tail -f /var/log/nginx/digi-leave-dashboard.access.log
sudo tail -f /var/log/nginx/digi-leave-dashboard.error.log
```

---

## Quick Commands

```bash
# One-liner setup (after copying config file)
sudo ln -s /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf /etc/nginx/sites-enabled/ && \
sudo nginx -t && \
sudo systemctl reload nginx && \
echo "✅ Nginx configured and reloaded!"

# Check everything
pm2 list && \
sudo netstat -tuln | grep 10890 && \
curl -I https://digi-leave-dashboard.butik.com.cn && \
echo "✅ All checks passed!"
```

---

## Configuration Summary

| Setting | Value |
|---------|-------|
| **Domain** | digi-leave-dashboard.butik.com.cn |
| **HTTP Port** | 80 (redirects to HTTPS) |
| **HTTPS Port** | 443 |
| **App Port** | 10890 |
| **Certificate** | /etc/nginx/cert/butik.com.cn/fullchain.pem |
| **Key** | /etc/nginx/cert/butik.com.cn/privkey.pem |
| **Max Upload** | 50MB |
| **Config File** | /etc/nginx/sites-available/digi-leave-dashboard.butik.com.cn.conf |

---

## After Setup

Access your application at:
```
https://digi-leave-dashboard.butik.com.cn
```

✅ Secure HTTPS connection
✅ Automatic HTTP → HTTPS redirect
✅ Wildcard SSL certificate
✅ 50MB file upload limit for Excel files
✅ Production-ready configuration
