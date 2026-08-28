FROM node:22-alpine

WORKDIR /app
COPY index.html manifest.json sw.js icon.svg server.js ./
RUN mkdir -p /data

ENV PORT=8080
ENV DATA_DIR=/data
EXPOSE 8080

CMD ["node", "server.js"]
