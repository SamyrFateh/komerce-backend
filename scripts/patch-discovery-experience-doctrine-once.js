'use strict';

const fs = require('fs');

const file = 'docs/doctrine/DOCTRINE_DISCOVERY_LOCALE_UNIFIEE.md';
let source = fs.readFileSync(file, 'utf8');

function mustContain(needle, label) {
  if (!source.includes(needle)) throw new Error(`Doctrine anchor missing: ${label}`);
}

source = source.replace(/^> \*\*Date\*\* : 2026-08-28\s*$/m, '> **Date** : 2026-09-02');

const oldCommander = 'Le CTA `Commander` sur une offre physique V0 crée une `inquiry`, **pas** une ligne dans `orders`.';
const newCommander = 'L’action finale `Commander`, déclenchée depuis le détail Komerce d’une offre physique V0, crée une `inquiry`, **pas** une ligne dans `orders`. Le rail lui-même ne déclenche aucune mutation métier.';
mustContain(oldCommander, 'Commander Inquiry boundary');
source = source.replace(oldCommander, newCommander);

const sectionStart = source.indexOf('## 7. Un rail, trois verbes');
const sectionEndMarker = '\n---\n\n## 8. Discovery est une projection de lecture';
const sectionEnd = source.indexOf(sectionEndMarker, sectionStart);
if (sectionStart < 0 || sectionEnd < 0) throw new Error('Doctrine section 7 bounds missing');

const section7 = `## 7. Un rail, un contrat de carte, un détail Komerce, trois actions

Le rail local reste unique.

La différence métier n’est pas portée par une taxonomie ou une composition différente, mais par la promesse affichée et l’action finale.

\`\`\`text
Product Komerce
Disponible maintenant
[Acheter]

Physical offer
Préparation sur commande
[Commander]

Service
Sur demande
[Demander]
\`\`\`

### Invariant UX — One Card Contract

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

Les slots structurels restent présents même lorsque leur donnée est absente. Une donnée optionnelle ne doit donc jamais :

- déplacer le CTA ;
- changer la hauteur du squelette ;
- créer une mini-carte dédiée ;
- créer une colonne ou une pile réservée à un kind ;
- modifier l’ordre structurel entre mobile et desktop.

Le \`subtitle\` reste obligatoire. Il porte la nuance de promesse dans le badge et évite d’ajouter une nouvelle taxonomie visuelle.

> **Même expérience ne veut pas dire même métier. Même expérience veut dire même contrat de présentation.**

### Invariant UX — One Open Contract

Une carte Discovery possède un seul contrat d’ouverture :

\`\`\`text
clic carte ─┐
            ├──> openDiscoveryDetail(kind, ref)
CTA rail ───┘
                    ↓
                 #k-modal
\`\`\`

Le CTA visible dans le rail exprime l’intention de l’utilisateur ; il ne déclenche pas directement une mutation métier.

Donc :

- le rail ne crée jamais une \`Inquiry\` ;
- le rail ne crée jamais une \`Order\` ;
- aucun kind ne possède un opener parallèle ;
- aucun second overlay ou second système de modale n’est autorisé.

> **Discover ≠ Act : la carte et son CTA ouvrent le détail ; l’action métier finale appartient au détail Komerce.**

### Une seule surface de détail Komerce

La carte Discovery n’ouvre jamais une marketplace, une page artisan ni un second système de modale.

\`Product\`, \`Physical Offer\` et \`Service\` restent des vérités métier distinctes, mais utilisent le **même shell de détail Komerce**. La nature métier détermine les capacités affichées et l’interaction finale, pas une nouvelle expérience.

\`\`\`text
Carte Komerce
      ↓
openDiscoveryDetail(kind, ref)
      ↓
#k-modal
      ↓
Product        → Acheter
Physical Offer → Commander
Service        → Demander / Contacter
\`\`\`

Les blocs de détail (média, fournisseur, variantes, livraison, références, contact autorisé) sont optionnels et apparaissent uniquement lorsque leur domaine source possède réellement la donnée. Discovery ne les invente jamais.

### Capability-driven, geometry-stable

La richesse future d’une fiche ne doit pas remettre en cause le contrat d’expérience.

Une capacité supplémentaire peut alimenter un slot ou un bloc optionnel :

\`\`\`text
provider
variants
quantity / format
fulfillment
livraison
références
contact autorisé
\`\`\`

mais elle ne crée ni nouveau kind d’interface, ni nouvelle navigation, ni nouveau shell.

Le système peut donc devenir plus riche sans devenir plus fragmenté.

Le client n’a pas besoin de connaître les mots internes :

- Provider ;
- Service table ;
- Physical offer ;
- Inquiry ;
- local-stock ;
- commercial exposure ;
- fulfillment ;
- settlement.

> **Le système sait. Le client agit.**

> **Une seule expérience de découverte et de détail Komerce ; seule la nature de l’interaction finale change.**
`;

source = source.slice(0, sectionStart) + section7 + source.slice(sectionEnd);

const antiPatternAnchor = "15. activer toutes les familles d'offre en même temps.";
mustContain(antiPatternAnchor, 'anti-pattern tail');
source = source.replace(
  antiPatternAnchor,
  `${antiPatternAnchor}\n16. varier la géométrie de carte selon le kind ou isoler les services dans une composition dédiée ;\n17. déclencher une Inquiry ou une autre mutation métier directement depuis le rail ;\n18. créer un opener, un overlay ou un shell de détail parallèle pour un kind Discovery.`
);

const finalAnchor = '> **Le backend et le frontend peuvent être construits en avance. L\'exposition est activée séquentiellement lorsque les données, l\'exploitation et la promesse client sont suffisamment fiables.**';
mustContain(finalAnchor, 'final invariant anchor');
source = source.replace(
  finalAnchor,
  `${finalAnchor}\n\n> **Une même surface Discovery impose une géométrie de carte commune : le kind change les données disponibles et l’action finale, jamais le squelette de présentation.**\n\n> **Carte et CTA de rail partagent une seule entrée de détail ; aucune mutation métier ne part directement du rail.**\n\n> **Product, Physical Offer et Service utilisent un seul shell de détail Komerce. La richesse future s’ajoute par capacités optionnelles, pas par multiplication des expériences.**`
);

fs.writeFileSync(file, source);
console.log('Discovery experience doctrine aligned with executable invariants.');
