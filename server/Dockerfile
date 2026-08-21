FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json ./
COPY src ./src
EXPOSE 4000
CMD ["npx", "tsx", "src/index.ts"]
