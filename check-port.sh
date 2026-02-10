#!/bin/bash
# Script to check port usage and diagnose port conflicts

PORT=3000

echo "🔍 Checking Port $PORT Status"
echo "================================"
echo ""

# Method 1: Check with netstat
echo "📊 Method 1: Using netstat"
echo "---"
if command -v netstat &> /dev/null; then
    NETSTAT_OUTPUT=$(netstat -tuln | grep ":$PORT ")
    if [ -n "$NETSTAT_OUTPUT" ]; then
        echo "⚠️  Port $PORT is IN USE:"
        echo "$NETSTAT_OUTPUT"
    else
        echo "✅ Port $PORT is AVAILABLE (not in use)"
    fi
else
    echo "netstat not available"
fi
echo ""

# Method 2: Check with ss (socket statistics)
echo "📊 Method 2: Using ss (socket statistics)"
echo "---"
if command -v ss &> /dev/null; then
    SS_OUTPUT=$(ss -tuln | grep ":$PORT ")
    if [ -n "$SS_OUTPUT" ]; then
        echo "⚠️  Port $PORT is IN USE:"
        echo "$SS_OUTPUT"
    else
        echo "✅ Port $PORT is AVAILABLE"
    fi
else
    echo "ss not available"
fi
echo ""

# Method 3: Check with lsof (list open files)
echo "📊 Method 3: Using lsof (shows which process)"
echo "---"
if command -v lsof &> /dev/null; then
    LSOF_OUTPUT=$(sudo lsof -i :$PORT 2>/dev/null)
    if [ -n "$LSOF_OUTPUT" ]; then
        echo "⚠️  Port $PORT is IN USE by:"
        echo "$LSOF_OUTPUT"
        echo ""
        echo "Process details:"
        sudo lsof -i :$PORT | tail -n +2 | while read line; do
            PID=$(echo $line | awk '{print $2}')
            echo "  PID: $PID"
            ps -p $PID -o pid,user,cmd 2>/dev/null
        done
    else
        echo "✅ Port $PORT is AVAILABLE"
    fi
else
    echo "lsof not available (try: sudo apt-get install lsof)"
fi
echo ""

# Method 4: Check with fuser
echo "📊 Method 4: Using fuser"
echo "---"
if command -v fuser &> /dev/null; then
    FUSER_OUTPUT=$(sudo fuser $PORT/tcp 2>/dev/null)
    if [ -n "$FUSER_OUTPUT" ]; then
        echo "⚠️  Port $PORT is IN USE by PID: $FUSER_OUTPUT"
    else
        echo "✅ Port $PORT is AVAILABLE"
    fi
else
    echo "fuser not available"
fi
echo ""

# Method 5: Try to bind to the port
echo "📊 Method 5: Test connection"
echo "---"
if curl -s --connect-timeout 2 http://localhost:$PORT >/dev/null 2>&1; then
    echo "⚠️  Port $PORT is RESPONDING to HTTP requests"
    echo "Testing API endpoint:"
    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:$PORT/api/leave-records 2>/dev/null)
    if [ "$RESPONSE" = "200" ]; then
        echo "  ✅ Leave Board API is responding (HTTP $RESPONSE)"
    else
        echo "  ⚠️  Something else is on port $PORT (HTTP $RESPONSE)"
    fi
else
    echo "✅ Port $PORT is NOT responding (likely available)"
fi
echo ""

# Check PM2 processes
echo "📊 PM2 Processes"
echo "---"
if command -v pm2 &> /dev/null; then
    echo "All PM2 processes:"
    pm2 list
    echo ""

    # Check leave-board-app specifically
    if pm2 list | grep -q "leave-board-app"; then
        echo "Leave Board App details:"
        pm2 show leave-board-app 2>/dev/null || pm2 describe leave-board-app 2>/dev/null
    fi
else
    echo "PM2 not installed"
fi
echo ""

# Summary
echo "📋 Summary & Recommendations"
echo "==========================="
if lsof -i :$PORT >/dev/null 2>&1 || ss -tuln 2>/dev/null | grep -q ":$PORT "; then
    echo "❌ Port $PORT is OCCUPIED"
    echo ""
    echo "Options:"
    echo "1. Stop the conflicting process:"
    echo "   sudo lsof -i :$PORT  # Find the PID"
    echo "   sudo kill <PID>      # Stop it"
    echo ""
    echo "2. Change Leave Board to use a different port:"
    echo "   Edit ecosystem.config.js and Jenkinsfile"
    echo "   Change PORT environment variable"
    echo ""
    echo "3. If it's your Leave Board app, it's working! 🎉"
    echo "   Access it at: http://$(hostname -I | awk '{print $1}'):$PORT"
else
    echo "✅ Port $PORT is AVAILABLE"
    echo ""
    echo "Your Leave Board app should be able to use this port."
    echo "If deployment fails, check PM2 logs:"
    echo "   pm2 logs leave-board-app"
fi
