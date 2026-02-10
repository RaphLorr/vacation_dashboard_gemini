// PM2 Ecosystem Configuration
// Used for process management and deployment

module.exports = {
  apps: [{
    name: 'leave-board-app',
    script: './server.js',
    instances: 1,
    exec_mode: 'fork',

    // Environment variables
    env: {
      NODE_ENV: 'production',
      PORT: 10890
    },

    // Logging
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',

    // Process management
    watch: false,
    max_memory_restart: '500M',

    // Restart behavior
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',

    // Graceful shutdown
    kill_timeout: 5000
  }]
};
