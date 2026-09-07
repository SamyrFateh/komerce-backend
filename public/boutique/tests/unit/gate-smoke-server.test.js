'use strict';

const http = require('http');
const path = require('path');
const { startStaticServer, stopStaticServer } = require('../../scripts/lib/static-server.cjs');

function get(url) {
  return new Promise((resolve, reject) => {
    http.get(url, (res) => {
      let body = '';
      res.setEncoding('utf8');
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => resolve({ status: res.statusCode, body }));
    }).on('error', reject);
  });
}

describe('gate-smoke in-process static server', () => {
  test('sert la boutique sans process enfant', async () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const server = await startStaticServer({ root, port: 0, healthPath: '/boutique/' });
    try {
      const port = server.address().port;
      const res = await get(`http://127.0.0.1:${port}/boutique/`);
      expect(res.status).toBe(200);
      expect(res.body).toMatch(/<!doctype html|<html/i);
    } finally {
      await stopStaticServer(server);
    }
  });
});
