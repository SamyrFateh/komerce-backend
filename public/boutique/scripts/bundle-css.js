#!/usr/bin/env node
/**
 * bundle-css.js — wrapper de compatibilité.
 *
 * ⚠️ Source de vérité actuelle : scripts/deploy-css.js
 *
 * Ce fichier est conservé uniquement parce que certains scripts historiques
 * appellent encore `node public/boutique/scripts/bundle-css.js` ou
 * `npm run bundle:css`. Il ne doit plus contenir de tableau BUNDLES séparé.
 * Toute évolution du pipeline CSS doit être faite dans deploy-css.js.
 */

'use strict';

require('./deploy-css.js');
