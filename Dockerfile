FROM node:23-slim

WORKDIR /app

COPY package*.json ./

RUN npm ci --only=production

COPY . .

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

ENTRYPOINT [ "bash", "generate-docs.sh" ]

CMD ["npm", "run", "run-server"]
