
FROM node:22-slim

ENV DEBIAN_FRONTEND=noninteractive

RUN apt-get update \
    && apt-get -y install libpq-dev python3 g++ make \
    && apt-get autoremove -y \
    && apt-get clean -y \
    && rm -rf /var/lib/apt/lists/*

RUN mkdir -p /home/node/app/node_modules && chown -R node:node /home/node/app

WORKDIR /home/node/app
COPY package*.json ./
USER node

RUN npm install

COPY --chown=node:node . .

CMD [ "node", "index.js" ]