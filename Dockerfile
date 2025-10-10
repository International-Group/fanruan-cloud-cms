# 1. 使用官方 Node LTS 镜像
FROM node:22-alpine

# 2. 设置工作目录
WORKDIR /app

# 3. 复制 package.json 和 package-lock.json
COPY package*.json ./

# 4. 安装所有依赖（包括开发依赖，用于构建）
RUN npm ci

# 5. 复制项目文件
COPY . .

# 6. 构建 Strapi
RUN npm run build

# 7. 暴露端口（Strapi 默认端口为 1337）
EXPOSE 1337

# 8. 启动 Strapi
CMD ["npm", "run", "start"]
