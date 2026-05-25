'use strict';
// Façade rétrocompat — bootstrap/api-routes.js fait : require('./routes/admin')
// La logique est dans routes/admin/ (GOD-FILES-2, 2026-05-25)
module.exports = require('./admin/index');
