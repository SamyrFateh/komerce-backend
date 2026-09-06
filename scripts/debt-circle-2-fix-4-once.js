'use strict';

const fs = require('fs');
const file = 'features/providers-services.feature.js';
const src = fs.readFileSync(file, 'utf8');
const needle = "      'local-stock — déclaration et exposition du stock local Product Komerce du seed Discovery staging via les primitives owner',\n      'infrastructure — dépendance technique db.js et résolution KOMERCE_ENV',";
const replacement = "      'local-stock — déclaration et exposition du stock local Product Komerce du seed Discovery staging via les primitives owner',\n      'recommendations — réutilise le tooling Discovery CJ pour construire les candidats staging ; recommendations reste propriétaire de la sélection et de l ordre éditorial',\n      'infrastructure — dépendance technique db.js et résolution KOMERCE_ENV',";
if (!src.includes(needle)) throw new Error('providers-services consumes insertion point not found');
fs.writeFileSync(file, src.replace(needle, replacement));
console.log('✅ providers-services -> recommendations declared as an explicit consumed boundary.');
