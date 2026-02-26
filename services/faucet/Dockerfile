FROM node:20-alpine

WORKDIR /app

COPY package.json ./
RUN npm install --omit=dev

COPY index.js ./

ENV FAUCET_PORT=8085
ENV RPC_URL=ws://node:9944
ENV DRIP_AMOUNT=10000000000000

EXPOSE 8085

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD wget -q --spider http://localhost:8085/health || exit 1

CMD ["node", "index.js"]
