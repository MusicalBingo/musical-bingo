FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build
ENV PORT=3000 DATA_DIR=/data NODE_ENV=production
EXPOSE 3000
CMD ["npx", "tsx", "server/index.ts"]
