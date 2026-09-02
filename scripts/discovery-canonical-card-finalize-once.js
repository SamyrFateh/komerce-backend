'use strict';

const fs = require('fs');

const file = 'docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md';
let source = fs.readFileSync(file, 'utf8');

const oldBlock = `### Invariant UX — One Card Contract

Sur une même surface Discovery, \`Product\`, \`Physical Offer\` et \`Service\` partagent **la même géométrie de carte**.

Le kind métier peut modifier le contenu d’un slot ; il ne peut jamais modifier le squelette de la carte.

\`\`\`text
DiscoveryCard
├── media slot
├── title slot
├── primary meta slot
├── context slot
└── action slot
\`\`\`

Les slots structurels restent présents même lorsque leur donnée est absente. Une donnée optionnelle ne doit donc jamais :`;

const newBlock = `### Invariant UX — One Card Contract

Sur une même surface Discovery, \`Product\`, \`Physical Offer\` et \`Service\` ne créent pas un nouveau modèle de carte : ils **réutilisent le shell visuel canonique de la Boutique Komerce**.

La référence est le Product Display Contract existant :

\`\`\`text
ProductCardViewModel
      ↓
renderProductCard()
      ↓
k-card / products.css
\`\`\`

Discovery peut ajouter des capacités et des hooks de comportement, mais ne peut jamais devenir propriétaire d’un second cadre visuel. \`.k-discovery-card\` est donc un hook de projection / interaction ; sa géométrie appartient au shell \`k-card\`.

Le kind métier peut modifier le contenu d’un slot ; il ne peut jamais modifier le squelette ni recréer \`background / border / radius / media ratio / info padding / title geometry / action placement\` dans un shell parallèle.

\`\`\`text
k-card
├── k-card-img-wrap   ← media + badge de promesse
├── k-card-info
│   ├── k-card-name
│   ├── context capability
│   └── k-card-bottom
└── k-card-add        ← Acheter / Commander / Demander
\`\`\`

Les slots structurels restent présents même lorsque leur donnée est absente. Une donnée optionnelle ne doit donc jamais :`;

if (!source.includes(oldBlock)) {
  throw new Error('One Card Contract doctrine anchor missing');
}
source = source.replace(oldBlock, newBlock);

const statement = '> **Même expérience ne veut pas dire même métier. Même expérience veut dire même contrat de présentation.**';
const strengthened = `${statement}\n\n> **Unification signifie réemploi du modèle Komerce existant, pas création d’un modèle Discovery cohérent avec lui-même.**`;
if (!source.includes(statement)) throw new Error('Doctrine statement missing');
source = source.replace(statement, strengthened);

const antiPattern = '16. varier la géométrie de carte selon le kind ou isoler les services dans une composition dédiée ;';
const strongerAntiPattern = '16. créer un second shell visuel de carte Discovery, redéfinir la géométrie de `.k-discovery-card`, varier la géométrie selon le kind ou isoler les services dans une composition dédiée ;';
if (!source.includes(antiPattern)) throw new Error('Anti-pattern 16 anchor missing');
source = source.replace(antiPattern, strongerAntiPattern);

const finalInvariant = '> **Une même surface Discovery impose une géométrie de carte commune : le kind change les données disponibles et l’action finale, jamais le squelette de présentation.**';
const strongerFinalInvariant = '> **Une même surface Discovery réutilise le shell visuel canonique `k-card` : le kind change les données disponibles et l’action finale, jamais le modèle de présentation.**';
if (!source.includes(finalInvariant)) throw new Error('Final invariant anchor missing');
source = source.replace(finalInvariant, strongerFinalInvariant);

fs.writeFileSync(file, source);
console.log('Discovery doctrine bound to canonical k-card shell.');
