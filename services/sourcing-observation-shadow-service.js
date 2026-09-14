'use strict';

const crypto = require('crypto');

function sourceTypeOf(value) {
  const v = String(value || '').trim().toLowerCase();
  if (!['api', 'csv', 'manual', 'json'].includes(v)) throw new Error('source_type shadow non supporte');
  return v;
}

function hash12(value) {
  return crypto.createHash('sha256').update(String(value || '').trim().toLowerCase(), 'utf8').digest('hex').slice(0, 12);
}

module.exports = { sourceTypeOf, hash12 };
