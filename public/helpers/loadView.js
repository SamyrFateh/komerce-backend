'use strict';

const path = require('path');
const fs   = require('fs');

const ROOT = path.resolve(__dirname, '..');

const BASE_DEPS = [
  'dashboards/admin/js/utils.js',
  'dashboards/admin/js/filters-store.js',
  'dashboards/admin/js/api-client.js',
];

const VIEWS_DIR = 'dashboards/admin/js/views';

function requireFresh(relPath) {
  const abs = path.join(ROOT, relPath);
  delete require.cache[require.resolve(abs)];
  require(abs);
}

function loadView(file, opts = {}) {
  const extraDeps = opts.extraDeps || [];
  BASE_DEPS.forEach(requireFresh);
  extraDeps.forEach(requireFresh);
  requireFresh(path.join(VIEWS_DIR, file));
}

function stubFetchOk(payload) {
  const body = JSON.stringify(payload === undefined ? {} : payload);
  global.fetch = jest.fn(() =>
    Promise.resolve({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: () => Promise.resolve(body),
    })
  );
  return global.fetch;
}

module.exports = { loadView, stubFetchOk, ROOT, BASE_DEPS };
