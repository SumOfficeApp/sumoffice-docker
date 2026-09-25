FROM node:22-alpine
WORKDIR /app
COPY server.mjs .
RUN mkdir -p /data && chown node /data
USER node
EXPOSE 8789
CMD ["node", "server.mjs"]
