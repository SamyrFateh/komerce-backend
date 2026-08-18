// Lanceur de démo LOCAL uniquement : neutralise ../db (dotenv/pg absents du sandbox)
// avant de charger le vrai service. computeCDR est pur → n'appelle jamais db.
const path = require('path');
const Module = require('module');
const dbPath = path.resolve(__dirname, '../../db.js');
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { query: async () => ({ rows: [] }) } };
// Enchaîne sur le harnais réel
process.argv = [process.argv[0], 'golden-cdr.js', ...process.argv.slice(2)];
require('./golden-cdr.js');
