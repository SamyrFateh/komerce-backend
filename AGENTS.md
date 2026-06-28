# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

En cas de désaccord, `AGENTS.md` fait foi.

---

## 0. Avant de coder — protocole carte-first obligatoire

Ne pas coder puis corriger. Coder avec l'analyse en tête.

Toute intervention commence par :

1. `docs/CARTE_FIRST_INDEX.md`
2. la carte `features/<feature>.feature.js` ou le transversal concerné
3. un plan d'attaque annoncé à l'utilisateur
4. les gates applicables

Un agent ne doit pas démarrer depuis un ancien audit, un rapport daté, un prompt historique, un `_LIVE.md`, un `MEMO_*` ou une sortie générée.

## 1. Plan d'attaque obligatoire

Avant toute modification substantielle, l'agent doit annoncer un plan d'attaque court avant de coder.

Le plan d'attaque doit être opérationnel, pas narratif : 8 à 12 lignes maximum dans le cas standard. Il ne doit pas paraphraser `AGENTS.md`, l'index, la carte ou les README ; il doit seulement nommer les fichiers lus et les décisions utiles.

Le plan doit contenir :

- la demande comprise ;
- la feature ou le transversal concerné ;
- l'opération : Create, Read, Update, Delete/Archive/Deprecate ;
- les fichiers de gouvernance lus ;
- le périmètre probable et le hors périmètre ;
- les invariants à protéger ;
- les risques ou points à vérifier ;
- les gates et tests prévus.

Format recommandé :

```md
## Plan d'attaque

Demande : ...
Feature/transversal : ...
Opération : ...
Fichiers lus : AGENTS.md, docs/CARTE_FIRST_INDEX.md, features/<feature>.feature.js, <README si applicable>
Périmètre : ...
Hors périmètre : ...
Invariants : ...
Risques : ...
Vérification : npm run ...
```

Un plan plus long est acceptable seulement pour une intervention risquée, multi-feature, DB, paiement, sécurité, migration ou architecture transverse. Dans ce cas, il doit expliquer pourquoi il dépasse le format court.

Exceptions : lecture simple, explication sans modification, commande triviale explicitement demandée, ou correction purement typographique sans impact métier. Même dans ces cas, l'agent doit rester capable de nommer la carte ou le transversal si la demande touche au produit.

## 2. Parcours obligatoire

1. Identifier la feature ou le transversal concerné.
2. Ouvrir la carte correspondante.
3. Qualifier l'opération : Create, Read, Update, Delete/Archive/Deprecate.
4. Vérifier `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants` et `files`.
5. Annoncer le plan d'attaque avant de modifier.
6. Vérifier que les fichiers touchés appartiennent à la carte ou à un transversal déclaré.
7. Si l'intention métier change, mettre à jour la carte dans la même PR.
8. Régénérer les sorties dérivées pertinentes.
9. Lancer les gates.

## 3. Gates carte-first

| Gate | Commande | Rôle |
|------|----------|------|
| Registre features | `npm run feature:registry` | cohérence des features déclarées |
| Schéma cartes | `npm run gate:schema` | carte structurellement valide |
| Schéma complet | `npm run gate:schema:full` | cible stricte de maturité |
| Fichiers touchés | `npm run gate:touched-files` | tout fichier applicatif touché appartient à une carte ou transversal |
| Audit feature | `npm run gate:feature-audit` | contrats/tests/features vérifiables |
| Docs lint | `npm run gate:docs-lint` | empêche le bruit historique documentaire |
| Map globale | `npm run map:check` | reconstruction globale |

## 4. Vérification minimale

```bash
npm run feature:registry
npm run gate:schema
npm run gate:touched-files
npm run gate:docs-lint
```

## 5. Vérification complète

```bash
npm run map:check
```

## 6. Hiérarchie documentaire

1. Code de production
2. DB live
3. `AGENTS.md`
4. `docs/CARTE_FIRST_INDEX.md`
5. `features/*.feature.js`
6. Doctrines actives
7. Générateurs
8. Sorties générées à jour
9. Archives

## 7. Règles techniques non négociables

- Statuts commande : `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : services propriétaires.
- Webhooks Stripe : body brut avant `express.json`.
- Wallet : créditer, débiter, contre-passer, jamais supprimer.
- Pricing : composantes DB, jamais de coefficient dur.
- Toute transition laisse une trace.

## 8. Divergence

Si code, DB, cartes et docs divergent : ne pas corriger silencieusement. Noter la divergence, corriger dans la même PR ou créer une dette explicite.
