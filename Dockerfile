FROM node:23-slim

WORKDIR /app

COPY package*.json ./

# Install all dependencies (including dev dependencies for building)
RUN npm ci

COPY . .

# Build the TypeScript files
RUN npm run build

# Remove dev dependencies after building
RUN npm ci --only=production && npm cache clean --force

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

CMD ["npm", "run", "run-server"]
