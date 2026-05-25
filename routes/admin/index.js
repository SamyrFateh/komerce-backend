'use strict';

/**
 * routes/admin/index.js
 * Monte les sous-routers du domaine admin.
 * Importé par routes/admin.js (façade rétrocompat).
 *
 * Ordre de montage : du plus spécifique au plus général
 * pour éviter les conflits de paramètres (:id).
 */

const express = require('express');
const router  = express.Router();

// Groupe B — douane (stub)
router.use('/', require('./customs'));

// Groupe C — partenaires / fournisseurs
router.use('/', require('./partners'));

// Groupe D — utilisateurs et rôles
router.use('/', require('./users'));

// Groupe F — redirections rétro-compatibles dashboard/margins/alerts
router.use('/', require('./dashboard'));

// Groupe E — opérations système (reset, seed-test, counts)
router.use('/', require('./system'));

// Groupe A — commandes (deleteOrderCascade — en dernier, le plus sensible)
router.use('/', require('./orders'));

module.exports = router;
