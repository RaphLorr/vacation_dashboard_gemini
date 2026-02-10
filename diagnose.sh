#!/bin/bash
# Comprehensive diagnostic script for Leave Board Application

echo "🔍 Leave Board Application Diagnostics"
echo "========================================"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

PORT=10890
DOMAIN="digi-leave-dashboard.butik.com.cn"

# Function to print status
print_status() {
    if [ $1 -eq 0 ]; then
        echo -e "${GREEN}✅ $2${NC}"
    else
        echo -e "${RED}❌ $2${NC}"
    fi
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

echo "1️⃣  CHECKING PM2 APPLICATION STATUS"
echo "-----------------------------------"
if command -v pm2 &> /dev/null; then
    echo "PM2 is installed"
    echo ""
    echo "All PM2 processes:"
    pm2 list
    echo ""

    if pm2 list 2>/dev/null | grep -q "leave-board-app"; then
        print_status 0 "leave-board-app process found"
        echo ""
        echo "Process details:"
        pm2 describe leave-board-app 2>/dev/null | head -30
        echo ""

        if pm2 jlist 2>/dev/null | grep -q "\"name\":\"leave-board-app\".*\"status\":\"online\""; then
            print_status 0 "Application status: ONLINE"
        else
            print_status 1 "Application status: NOT ONLINE"
            echo "Checking process status:"
            pm2 jlist 2>/dev/null | grep -A 5 "leave-board-app" | head -10
        fi
    else
        print_status 1 "leave-board-app process NOT found in PM2"
        print_warning "Try: pm2 start /var/www/leave-board-app/ecosystem.config.js"
    fi
else
    print_status 1 "PM2 is not installed"
fi
echo ""

echo "2️⃣  CHECKING PORT $PORT STATUS"
echo "-----------------------------------"
if netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
    print_status 0 "Port $PORT is LISTENING"
    netstat -tuln | grep ":$PORT "
else
    print_status 1 "Port $PORT is NOT listening"
    print_warning "Application may not be running or bound to different port"
fi
echo ""

echo "3️⃣  CHECKING APPLICATION RESPONSE"
echo "-----------------------------------"
echo "Testing localhost:$PORT..."
if curl -s --connect-timeout 5 http://localhost:$PORT >/dev/null 2>&1; then
    print_status 0 "Application responding on localhost:$PORT"

    echo "Testing API endpoint..."
    API_RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/leave-records 2>/dev/null)
    if [ "$API_RESPONSE" = "200" ]; then
        print_status 0 "API endpoint returns HTTP $API_RESPONSE"
        echo "API Response:"
        curl -s http://localhost:$PORT/api/leave-records | head -c 200
        echo ""
    else
        print_status 1 "API endpoint returns HTTP $API_RESPONSE"
    fi
else
    print_status 1 "Application NOT responding on localhost:$PORT"
    print_warning "Check PM2 logs: pm2 logs leave-board-app"
fi
echo ""

echo "4️⃣  CHECKING NGINX CONFIGURATION"
echo "-----------------------------------"
if command -v nginx &> /dev/null; then
    print_status 0 "Nginx is installed"

    echo "Nginx version:"
    nginx -v 2>&1
    echo ""

    echo "Testing nginx configuration..."
    if sudo nginx -t 2>&1 | grep -q "successful"; then
        print_status 0 "Nginx configuration is valid"
    else
        print_status 1 "Nginx configuration has errors"
        sudo nginx -t 2>&1
    fi
    echo ""

    echo "Checking nginx status..."
    if systemctl is-active --quiet nginx; then
        print_status 0 "Nginx is running"
    else
        print_status 1 "Nginx is NOT running"
        print_warning "Try: sudo systemctl start nginx"
    fi
    echo ""

    echo "Checking site configuration..."
    SITE_CONFIG="/etc/nginx/sites-enabled/digi-leave-dashboard.butik.com.cn.conf"
    if [ -f "$SITE_CONFIG" ]; then
        print_status 0 "Site configuration exists: $SITE_CONFIG"
        echo "Configuration preview:"
        sudo grep -E "server_name|proxy_pass|listen" "$SITE_CONFIG" 2>/dev/null | head -10
    else
        print_status 1 "Site configuration NOT found: $SITE_CONFIG"
        print_warning "Available configs:"
        ls -la /etc/nginx/sites-enabled/ 2>/dev/null
    fi
else
    print_status 1 "Nginx is not installed"
fi
echo ""

echo "5️⃣  CHECKING FIREWALL"
echo "-----------------------------------"
if command -v ufw &> /dev/null; then
    echo "UFW Status:"
    sudo ufw status | grep -E "$PORT|80|443|Status"
    echo ""

    if sudo ufw status | grep -q "$PORT.*ALLOW"; then
        print_status 0 "Port $PORT is allowed in firewall"
    else
        print_warning "Port $PORT may not be allowed in firewall"
        print_warning "Run: sudo ufw allow $PORT/tcp"
    fi

    if sudo ufw status | grep -q "80.*ALLOW\|80/tcp.*ALLOW"; then
        print_status 0 "Port 80 (HTTP) is allowed"
    else
        print_warning "Port 80 may not be allowed"
    fi

    if sudo ufw status | grep -q "443.*ALLOW\|443/tcp.*ALLOW"; then
        print_status 0 "Port 443 (HTTPS) is allowed"
    else
        print_warning "Port 443 may not be allowed"
    fi
else
    echo "UFW not installed, checking iptables..."
    if sudo iptables -L -n | grep -q "$PORT"; then
        echo "Found iptables rules for port $PORT"
    else
        echo "No specific iptables rules found"
    fi
fi
echo ""

echo "6️⃣  CHECKING DNS RESOLUTION"
echo "-----------------------------------"
echo "Resolving $DOMAIN..."
if host $DOMAIN >/dev/null 2>&1; then
    print_status 0 "DNS resolution successful"
    host $DOMAIN
    echo ""

    SERVER_IP=$(hostname -I | awk '{print $1}')
    RESOLVED_IP=$(host $DOMAIN | grep "has address" | awk '{print $4}' | head -1)

    echo "Server IP: $SERVER_IP"
    echo "Resolved IP: $RESOLVED_IP"

    if [ "$SERVER_IP" = "$RESOLVED_IP" ]; then
        print_status 0 "DNS points to this server"
    else
        print_warning "DNS may not point to this server"
    fi
else
    print_status 1 "DNS resolution failed"
    print_warning "Domain may not be configured yet"
fi
echo ""

echo "7️⃣  CHECKING SSL CERTIFICATE"
echo "-----------------------------------"
CERT_PATH="/etc/nginx/cert/butik.com.cn/fullchain.pem"
KEY_PATH="/etc/nginx/cert/butik.com.cn/privkey.pem"

if [ -f "$CERT_PATH" ]; then
    print_status 0 "Certificate file exists: $CERT_PATH"
    echo "Certificate details:"
    sudo openssl x509 -in "$CERT_PATH" -noout -subject -dates 2>/dev/null | head -5
else
    print_status 1 "Certificate file NOT found: $CERT_PATH"
fi
echo ""

if [ -f "$KEY_PATH" ]; then
    print_status 0 "Private key exists: $KEY_PATH"
else
    print_status 1 "Private key NOT found: $KEY_PATH"
fi
echo ""

echo "8️⃣  TESTING HTTP/HTTPS ENDPOINTS"
echo "-----------------------------------"
echo "Testing HTTP (should redirect to HTTPS)..."
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L http://$DOMAIN 2>/dev/null)
if [ "$HTTP_CODE" = "301" ] || [ "$HTTP_CODE" = "302" ]; then
    print_status 0 "HTTP redirects (HTTP $HTTP_CODE)"
elif [ "$HTTP_CODE" = "200" ]; then
    print_status 0 "HTTP returns 200 (working, but no redirect configured)"
else
    print_status 1 "HTTP returns HTTP $HTTP_CODE"
fi
echo ""

echo "Testing HTTPS..."
HTTPS_CODE=$(curl -s -o /dev/null -w "%{http_code}" --connect-timeout 10 https://$DOMAIN 2>/dev/null)
if [ "$HTTPS_CODE" = "200" ]; then
    print_status 0 "HTTPS returns HTTP $HTTPS_CODE"
    echo "Testing HTTPS API..."
    HTTPS_API=$(curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/api/leave-records 2>/dev/null)
    if [ "$HTTPS_API" = "200" ]; then
        print_status 0 "HTTPS API returns HTTP $HTTPS_API"
    else
        print_status 1 "HTTPS API returns HTTP $HTTPS_API"
    fi
else
    print_status 1 "HTTPS returns HTTP $HTTPS_CODE"
    print_warning "Common causes: SSL cert issue, nginx not configured, app not running"
fi
echo ""

echo "9️⃣  CHECKING APPLICATION LOGS"
echo "-----------------------------------"
echo "Recent PM2 logs (last 20 lines):"
pm2 logs leave-board-app --lines 20 --nostream 2>/dev/null || echo "No PM2 logs available"
echo ""

echo "Recent Nginx error logs (last 10 lines):"
sudo tail -10 /var/log/nginx/digi-leave-dashboard.error.log 2>/dev/null || \
sudo tail -10 /var/log/nginx/error.log 2>/dev/null || \
echo "No nginx logs found"
echo ""

echo "🔟  CHECKING FILE PERMISSIONS"
echo "-----------------------------------"
if [ -d "/var/www/leave-board-app" ]; then
    print_status 0 "Application directory exists"
    echo "Directory contents:"
    ls -lah /var/www/leave-board-app/ | head -15
    echo ""

    echo "Owner and permissions:"
    ls -ld /var/www/leave-board-app/
else
    print_status 1 "Application directory NOT found: /var/www/leave-board-app"
fi
echo ""

echo "==============================================="
echo "📋 DIAGNOSTIC SUMMARY"
echo "==============================================="
echo ""

# Create summary
ISSUES=0

if ! pm2 jlist 2>/dev/null | grep -q "\"name\":\"leave-board-app\".*\"status\":\"online\""; then
    echo "❌ Issue: Application not running in PM2"
    echo "   Fix: pm2 start /var/www/leave-board-app/ecosystem.config.js"
    ISSUES=$((ISSUES+1))
    echo ""
fi

if ! netstat -tuln 2>/dev/null | grep -q ":$PORT "; then
    echo "❌ Issue: Port $PORT not listening"
    echo "   Fix: Check PM2 logs: pm2 logs leave-board-app"
    ISSUES=$((ISSUES+1))
    echo ""
fi

if ! systemctl is-active --quiet nginx 2>/dev/null; then
    echo "❌ Issue: Nginx not running"
    echo "   Fix: sudo systemctl start nginx"
    ISSUES=$((ISSUES+1))
    echo ""
fi

if [ ! -f "/etc/nginx/sites-enabled/digi-leave-dashboard.butik.com.cn.conf" ]; then
    echo "❌ Issue: Nginx site configuration not enabled"
    echo "   Fix: See docs/NGINX-SETUP.md"
    ISSUES=$((ISSUES+1))
    echo ""
fi

if [ $ISSUES -eq 0 ]; then
    echo "✅ No critical issues detected!"
    echo ""
    echo "🌐 Try accessing: https://$DOMAIN"
else
    echo "⚠️  Found $ISSUES issue(s) that need attention"
    echo ""
    echo "📚 See docs/NGINX-SETUP.md for detailed setup instructions"
fi

echo ""
echo "💡 Quick Fix Commands:"
echo "   pm2 restart leave-board-app       # Restart application"
echo "   pm2 logs leave-board-app           # View application logs"
echo "   sudo systemctl reload nginx        # Reload nginx config"
echo "   sudo nginx -t                      # Test nginx config"
echo "   curl http://localhost:$PORT        # Test app directly"
