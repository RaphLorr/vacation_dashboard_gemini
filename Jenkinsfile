pipeline {
    agent any

    environment {
        APP_NAME = 'leave-board-app'
        DEPLOY_PATH = '/var/www/leave-board-app'
        PORT = '3000'
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
                    test -f App.tsx || (echo "Error: App.tsx not found" && exit 1)
                    test -f index.html || (echo "Error: index.html not found" && exit 1)
                    test -f package.json || (echo "Error: package.json not found" && exit 1)

                    # Verify server.js syntax
                    node -c server.js

                    echo "✅ All verification checks passed"
                '''
            }
        }

        stage('Backup Current Data') {
            when {
                expression { fileExists("${DEPLOY_PATH}/leave_data.json") }
            }
            steps {
                echo 'Backing up current leave data...'
                sh '''
                    BACKUP_DIR="${DEPLOY_PATH}/backups"
                    mkdir -p "$BACKUP_DIR"
                    TIMESTAMP=$(date +%Y%m%d_%H%M%S)
                    cp ${DEPLOY_PATH}/leave_data.json "$BACKUP_DIR/leave_data_${TIMESTAMP}.json"
                    echo "✅ Backup created: $BACKUP_DIR/leave_data_${TIMESTAMP}.json"
                '''
            }
        }

        stage('Deploy') {
            steps {
                echo 'Deploying application to server...'
                sh '''
                    # Create deploy directory if it doesn't exist
                    sudo mkdir -p ${DEPLOY_PATH}

                    # Copy application files
                    sudo rsync -av --delete \
                        --exclude 'node_modules' \
                        --exclude '.git' \
                        --exclude '.reports' \
                        --exclude '.claude' \
                        --exclude 'leave_data.json' \
                        --exclude 'backups' \
                        ./ ${DEPLOY_PATH}/

                    # Copy node_modules
                    sudo rsync -av node_modules/ ${DEPLOY_PATH}/node_modules/

                    # Restore leave_data.json if it exists
                    if [ -f "${DEPLOY_PATH}/leave_data.json" ]; then
                        echo "✅ Preserving existing leave_data.json"
                    else
                        echo "ℹ️ No existing leave_data.json found"
                    fi

                    # Set proper permissions
                    sudo chown -R $USER:$USER ${DEPLOY_PATH}
                    sudo chmod -R 755 ${DEPLOY_PATH}

                    echo "✅ Deployment complete"
                '''
            }
        }

        stage('Restart Application') {
            steps {
                echo 'Restarting application...'
                sh '''
                    # Stop existing process (PM2)
                    pm2 stop ${APP_NAME} || true
                    pm2 delete ${APP_NAME} || true

                    # Start application with PM2
                    cd ${DEPLOY_PATH}
                    pm2 start server.js --name ${APP_NAME} --env production

                    # Save PM2 configuration
                    pm2 save

                    echo "✅ Application restarted"
                '''
            }
        }

        stage('Health Check') {
            steps {
                echo 'Running health check...'
                sh '''
                    # Wait for application to start
                    sleep 3

                    # Check if process is running
                    pm2 list | grep ${APP_NAME} | grep online || (echo "❌ Application not running" && exit 1)

                    # Check if port is listening
                    netstat -tuln | grep ${PORT} || (echo "❌ Port ${PORT} not listening" && exit 1)

                    # Test API endpoint
                    RESPONSE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:${PORT}/api/leave-records)
                    if [ "$RESPONSE" = "200" ]; then
                        echo "✅ Health check passed - API responding"
                    else
                        echo "❌ Health check failed - API returned $RESPONSE"
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
