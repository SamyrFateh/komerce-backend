/**
 * ⚠️  DEPRECATED — Ce fichier est conservé pour rétro-compatibilité uniquement.
 *
 * Tous les endpoints pilotage ont été absorbés dans /api/dashboard/* (v11.0) :
 *   - GET /api/pilotage          → GET /api/dashboard/pilotage
 *   - GET /api/pilotage/history  → GET /api/dashboard/history
 *   - GET /api/pilotage/clients  → GET /api/dashboard/clients
 *
 * Ce fichier sera supprimé dans une prochaine version.
 * Ne pas ajouter de nouveaux endpoints ici.
 */

'use strict';

const express = require('express');
const router  = express.Router();
const { authenticate, requireRole } = require('../middleware/auth');

router.use(authenticate, requireRole(['admin']));

router.get('/', (req, res) => {
  res.status(301).json({ redirect: '/api/dashboard/pilotage', message: 'Utilisez GET /api/dashboard/pilotage' });
});

router.get('/history', (req, res) => {
  res.status(301).json({ redirect: '/api/dashboard/history', message: 'Utilisez GET /api/dashboard/history' });
});

router.get('/clients', (req, res) => {
  res.status(301).json({ redirect: '/api/dashboard/clients', message: 'Utilisez GET /api/dashboard/clients' });
});

module.exports = router;
