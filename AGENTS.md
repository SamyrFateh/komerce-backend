# AGENTS.md — Règles obligatoires Komerce

Ce fichier est l'instruction racine du dépôt pour tout agent IA ou développeur.

En cas de désaccord, `AGENTS.md` fait foi.

---

## 0. Avant de coder — protocole carte-first obligatoire

Ne pas coder puis corriger. Coder avec l'analyse en tête.

Toute intervention commence par :

1. `docs/CARTE_FIRST_INDEX.md`
2. la carte `features/<feature>.feature.js` ou le transversal concerné
3. les gates applicables

Un agent ne doit pas démarrer depuis un ancien audit, un rapport daté, un prompt historique, un `_LIVE.md`, un `MEMO_*` ou une sortie générée.

## 1. Parcours obligatoire

1. Identifier la feature ou le transversal concerné.
2. Ouvrir la carte correspondante.
3. Qualifier l'opération : Create, Read, Update, Delete/Archive/Deprecate.
4. Vérifier `service`, `perimeter.in`, `perimeter.out`, `authority`, `contract`, `invariants` et `files`.
5. Vérifier que les fichiers touchés appartiennent à la carte ou à un transversal déclaré.
6. Si l'intention métier change, mettre à jour la carte dans la même PR.
7. Régénérer les sorties dérivées pertinentes.
8. Lancer les gates.

## 2. Gates carte-first

| Gate | Commande | Rôle |
|------|----------|------|
| Registre features | `npm run feature:registry` | cohérence des features déclarées |
| Schéma cartes | `npm run gate:schema` | carte structurellement valide |
| Schéma complet | `npm run gate:schema:full` | cible stricte de maturité |
| Fichiers touchés | `npm run gate:touched-files` | tout fichier applicatif touché appartient à une carte ou transversal |
| Audit feature | `npm run gate:feature-audit` | contrats/tests/features vérifiables |
| Docs lint | `npm run gate:docs-lint` | empêche le bruit historique documentaire |
| Map globale | `npm run map:check` | reconstruction globale |

## 3. Vérification minimale

```bash
npm run feature:registry
npm run gate:schema
npm run gate:touched-files
npm run gate:docs-lint
```

## 4. Vérification complète

```bash
npm run map:check
```

## 5. Hiérarchie documentaire

1. Code de production
2. DB live
3. `AGENTS.md`
4. `docs/CARTE_FIRST_INDEX.md`
5. `features/*.feature.js`
6. Doctrines actives
7. Générateurs
8. Sorties générées à jour
9. Archives

## 6. Règles techniques non négociables

- Statuts commande : `services/order-status-machine.js`.
- Paiements Stripe/cash/wallet/shared-cart : services propriétaires.
- Webhooks Stripe : body brut avant `express.json`.
- Wallet : créditer, débiter, contre-passer, jamais supprimer.
- Pricing : composantes DB, jamais de coefficient dur.
- Toute transition laisse une trace.

## 7. Divergence

Si code, DB, cartes et docs divergent : ne pas corriger silencieusement. Noter la divergence, corriger dans la même PR ou créer une dette explicite.
