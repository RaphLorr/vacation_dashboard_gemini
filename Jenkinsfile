pipeline {
    agent any

    environment {
        APP_NAME = 'leave-board-app'
        DEPLOY_PATH = '/var/www/leave-board-app'
        REMOTE_SERVER = 'root@146.56.193.45'
        PORT = '10890'
        NODE_ENV = 'production'
    }

    stages {
        stage('Checkout') {
            steps {
                echo 'Checking out code from repository...'
                checkout scm
            }
        }

        stage('Install Dependencies') {
            steps {
                echo 'Installing Node.js dependencies...'
                sh '''
                    # Check npm version
                    echo "npm version: $(npm --version)"
                    echo "node version: $(node --version)"

                    # Clean install dependencies
                    rm -rf node_modules
                    npm install --production --no-optional
                '''
            }
        }

        stage('Verify') {
            steps {
                echo 'Verifying application files...'
                sh '''
                    # Check required files exist
                    test -f server.js || (echo "Error: server.js not found" && exit 1)
                    test -f leave-board.html || (echo "Error: leave-board.html not found" && exit 1)
                    test -f package.json || (echo "Error: package.json not found" && exit 1)
                    test -f ecosystem.config.js || (echo "Error: ecosystem.config.js not found" && exit 1)

                    # Verify server.js syntax
                    node -c server.js

                    echo "✅ All verification checks passed"
                '''
            }
        }

        stage('Backup Current Data') {
            steps {
                echo 'Backing up current data files from remote server...'
                sh '''
                    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
                    ssh ${REMOTE_SERVER} "mkdir -p ${DEPLOY_PATH}/backups"

                    # Backup leave_data.json (critical user data)
                    if ssh ${REMOTE_SERVER} "test -f ${DEPLOY_PATH}/leave_data.json"; then
                        ssh ${REMOTE_SERVER} "cp ${DEPLOY_PATH}/leave_data.json ${DEPLOY_PATH}/backups/leave_data_${TIMESTAMP}.json"
                        echo "✅ Backup created: leave_data_${TIMESTAMP}.json"
                    else
                        echo "ℹ️ No existing leave_data.json found"
                    fi

                    # Backup .sync_state.json (operational state)
                    if ssh ${REMOTE_SERVER} "test -f ${DEPLOY_PATH}/.sync_state.json"; then
                        ssh ${REMOTE_SERVER} "cp ${DEPLOY_PATH}/.sync_state.json ${DEPLOY_PATH}/backups/sync_state_${TIMESTAMP}.json"
                        echo "✅ Backup created: sync_state_${TIMESTAMP}.json"
                    else
                        echo "ℹ️ No existing .sync_state.json found"
                    fi

                    # Backup .active_approvals.json (operational state)
                    if ssh ${REMOTE_SERVER} "test -f ${DEPLOY_PATH}/.active_approvals.json"; then
                        ssh ${REMOTE_SERVER} "cp ${DEPLOY_PATH}/.active_approvals.json ${DEPLOY_PATH}/backups/active_approvals_${TIMESTAMP}.json"
                        echo "✅ Backup created: active_approvals_${TIMESTAMP}.json"
                    else
                        echo "ℹ️ No existing .active_approvals.json found"
                    fi

                    echo "✅ Backup complete"
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploying application to remote server...'
                sh '''
                    # Create deploy directories on remote server
                    ssh ${REMOTE_SERVER} "mkdir -p ${DEPLOY_PATH}/{logs,backups}"

                    # Copy application files to remote server
                    rsync -avz --delete \
                        -e "ssh" \
                        --exclude 'node_modules' \
                        --exclude '.git' \
                        --exclude '.reports' \
                        --exclude '.claude' \
                        --exclude 'leave_data.json' \
                        --exclude '.sync_state.json' \
                        --exclude '.active_approvals.json' \
                        --exclude 'backups' \
                        --exclude 'logs' \
                        ./ ${REMOTE_SERVER}:${DEPLOY_PATH}/

                    # Copy node_modules to remote server
                    rsync -avz \
                        -e "ssh" \
                        node_modules/ ${REMOTE_SERVER}:${DEPLOY_PATH}/node_modules/

                    # Set proper permissions on remote server
                    ssh ${REMOTE_SERVER} "chmod -R 755 ${DEPLOY_PATH}"

                    # Check if leave_data.json exists on remote
                    if ssh ${REMOTE_SERVER} "test -f ${DEPLOY_PATH}/leave_data.json"; then
                        echo "✅ Preserving existing leave_data.json on remote server"
                    else
                        echo "ℹ️ No existing leave_data.json found (will be created on first use)"
                    fi

                    echo "✅ Deployment to remote server complete"
                '''
            }
        }

        stage('Restart Application') {
            steps {
                echo 'Restarting application on remote server...'
                sh '''
                    # Stop and delete existing PM2 process on remote server
                    ssh ${REMOTE_SERVER} "
                        pm2 stop ${APP_NAME} || true
                        pm2 delete ${APP_NAME} || true

                        # Start application with PM2
                        cd ${DEPLOY_PATH}
                        pm2 start server.js --name ${APP_NAME} --env production

                        # Save PM2 configuration
                        pm2 save

                        echo '✅ Application restarted on remote server'
                    "
                '''
            }
        }

        stage('Health Check') {
            steps {
                echo 'Running health check on remote server...'
                sh '''
                    # Wait for application to start
                    sleep 5

                    # Check if process is running using PM2 on remote server
                    echo "Checking PM2 process status on remote server..."
                    PM2_STATUS=$(ssh ${REMOTE_SERVER} "pm2 jlist | grep -o '\\"name\\":\\"${APP_NAME}\\".*\\"status\\":\\"online\\"'" || echo "")
                    if [ -n "$PM2_STATUS" ]; then
                        echo "✅ PM2 process is online on remote server"
                    else
                        echo "❌ Application not running in PM2 on remote server"
                        ssh ${REMOTE_SERVER} "pm2 list"
                        exit 1
                    fi

                    # Check if port is listening on remote server
                    echo "Checking if port ${PORT} is listening on remote server..."
                    if ssh ${REMOTE_SERVER} "netstat -tuln | grep -q ':${PORT} '"; then
                        echo "✅ Port ${PORT} is listening on remote server"
                    else
                        echo "❌ Port ${PORT} not listening on remote server"
                        ssh ${REMOTE_SERVER} "netstat -tuln | grep ${PORT} || true"
                        exit 1
                    fi

                    # Test API endpoint on remote server
                    echo "Testing API endpoint on remote server..."
                    RESPONSE=$(ssh ${REMOTE_SERVER} "curl -s -o /dev/null -w '%{http_code}' http://localhost:${PORT}/api/leave-records")
                    if [ "$RESPONSE" = "200" ]; then
                        echo "✅ Health check passed - API responding with HTTP 200"
                        echo ""
                        echo "🎉 Application successfully deployed and running on remote server!"
                        ssh ${REMOTE_SERVER} "pm2 list | grep ${APP_NAME}"
                    else
                        echo "❌ Health check failed - API returned HTTP $RESPONSE"
                        echo "Application logs:"
                        ssh ${REMOTE_SERVER} "pm2 logs ${APP_NAME} --lines 20 --nostream"
                        exit 1
                    fi
                '''
            }
        }
    }

    post {
        success {
            echo '✅ Deployment successful!'
            // Optional: Send notification (Slack, email, etc.)
        }
        failure {
            echo '❌ Deployment failed!'
            // Optional: Send alert
        }
        always {
            echo 'Cleaning up workspace...'
            cleanWs()
        }
    }
}
