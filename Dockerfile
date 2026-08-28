FROM node:22-alpine

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY index.html manifest.json sw.js icon.svg server.js ./

ENV PORT=8080
EXPOSE 8080

CMD ["node", "server.js"]
