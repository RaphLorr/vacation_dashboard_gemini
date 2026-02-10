# Dockerfile for Leave Board Application
# This is optional - you can deploy directly with Node.js or use Docker

FROM node:18-alpine

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install production dependencies
RUN npm ci --production && npm cache clean --force

# Copy application files
COPY server.js ./
COPY index.html ./
COPY index.tsx ./
COPY App.tsx ./
COPY tsconfig.json ./
COPY leave-board.html ./
COPY metadata.json ./
COPY README.md ./
COPY CLAUDE.md ./
COPY LICENSE ./

# Create directory for data persistence
RUN mkdir -p /app/data

# Set environment variables
ENV NODE_ENV=production
ENV PORT=3000

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/leave-records', (r) => {process.exit(r.statusCode === 200 ? 0 : 1)})"

# Start application
CMD ["node", "server.js"]
