FROM node:20-alpine

WORKDIR /app

# 直接把代码打入镜像（每次 build 都是当前最新版）
COPY server.js ./
COPY index.html ./
COPY settings.html ./
COPY assets ./assets
COPY sites.json ./

# 持久化卷只放用户数据（sites.json + 上传文件）
VOLUME ["/data"]

ENV PORT=8080 \
    PROBE_TIMEOUT=5000 \
    PROBE_CONCURRENCY=8 \
    LOG_LEVEL=info

EXPOSE 8080

CMD ["node", "server.js"]
