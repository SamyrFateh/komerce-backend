'use strict';

const http = require('http');
const handler = require('serve-handler');

function waitForServer(url, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', () => {
        if (Date.now() > deadline) {
          reject(new Error(`serveur non prêt après ${timeoutMs} ms (${url})`));
          return;
        }
        setTimeout(attempt, 100);
      });
    };
    attempt();
  });
}

async function startStaticServer({ root, port, healthPath = '/boutique/', timeoutMs = 15_000 } = {}) {
  if (!root || typeof root !== 'string') throw new TypeError('root statique requis');
  const requestedPort = port == null ? 0 : Number(port);
  if (!Number.isInteger(requestedPort) || requestedPort < 0 || requestedPort > 65535) {
    throw new TypeError('port invalide');
  }
  const server = http.createServer((req, res) => handler(req, res, { public: root, cleanUrls: false }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(requestedPort, '127.0.0.1', resolve);
  });
  const actualPort = server.address().port;
  try {
    await waitForServer(`http://127.0.0.1:${actualPort}${healthPath}`, timeoutMs);
  } catch (error) {
    await stopStaticServer(server).catch(() => {});
    throw error;
  }
  return server;
}

function stopStaticServer(server) {
  if (!server) return Promise.resolve();
  return new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}

module.exports = { startStaticServer, stopStaticServer };
