# Lot O1.1 — recommendations / decision-signals — Livrable

> **Statut** : livré et vérifié. Sous-lot 1 du Lot O1 (Business Feature
> Ontology Refactor). Les sous-lots O1.2 (wallet/loyalty), O1.3
> (logistics/sourcing), O1.4 (orders/purchasing) et O1.5 (dashboard) suivent
> séparément, à la demande.

---

## 0. Préalable — écart trouvé avant d'attaquer

Le prompt de cadrage demandait de lire 7 documents avant toute chose. **4 sur
7 n'existaient pas dans le dépôt** :

- `docs/doctrine/FEATURE_DOCTRINE_RUNTIME_EVIDENCE_V1_2.md` — absent (hors
  scope O1 de toute façon, non traité)
- `docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md` — absent
- `docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md` — absent
- `docs/chantier/BUSINESS_FEATURE_ONTOLOGY_AUDIT_V1.md` — absent

Le prompt lui-même interdit d'inventer silencieusement une convention quand la
gouvernance ne suit pas. J'ai donc créé les deux premiers documents comme
prérequis réels (ce ne sont pas des stubs cosmétiques : ils gouvernent le
nouveau concept "piloting capability" et sont câblés dans les gates, voir §3).
Le troisième (Runtime Evidence) reste hors scope, non créé. Le quatrième
(l'audit lui-même) est remplacé de facto par ce document et son inspection
du code réel — je n'ai pas fabriqué un audit séparé pour ensuite le relire.

**Autre écart découvert à la lecture** : `FEATURE_DOCTRINE.md` a déjà, en
réalité, un schéma de classification (`kind`) plus riche que ce que supposait
le prompt (`business-feature | business-transversal | technical-transversal |
aggregation-readonly | integration-adapter | deprecated`, avec `projection`
explicitement **non assignable**). Ça change la portée de O1.5 (voir sous-lot
séparé) et ça confirme qu'il ne fallait *pas* réinventer une taxonomie
`projection/aggregation/ui-shell` en O1.5 — elle existe déjà sous une autre
forme.

---

## 1. Constat réel (remplace l'audit manquant, pour ce périmètre)

`features/recommendations.feature.js` couvrait deux familles sans rapport :

| Fichier | Service réel | Table(s) touchée(s) |
|---|---|---|
| `services/boutique-ranking-engine.js` | Classement produit boutique | lecture seule catalog/orders/parcels |
| `routes/boutique-suggestions.js` | Endpoint public de suggestions | — |
| `services/radar-queries.js` | Requêtes cross-feature (cash, colis, incidents) alimentant la détection de signaux | lecture cash_collections, cash_deposits, finance_config, incidents, orders, parcels, products, users, wallets |
| `services/signal-service.js` | Génération/écriture de signaux | `signals` (RW) |
| `routes/signals.js` | Consultation/admin des signaux (ack/resolve/snooze/generate/stats) | `signals` (RW) |

Aucun rapport entre "classer des produits pour la boutique" et "détecter des
signaux opérationnels cash/colis/incidents pour l'admin". Les deux familles
étaient assemblées uniquement parce qu'un premier découpage historique avait
choisi le nom `recommendations` comme fourre-tout pour "tout ce qui n'est ni
une commande ni un paiement".

`services/radar-queries.js` déclarait même `@used-by routes/admin-radar.js`
(pas `routes/signals.js`) — signe supplémentaire qu'il ne vivait pas
naturellement à côté du ranking boutique. `routes/admin-radar.js` est déjà
possédé par `dashboard.feature.js`, qui en fait une projection de lecture
correcte (aucun changement nécessaire là).

---

## 2. Décision appliquée

- `recommendations` reste **feature seule propriétaire** du ranking boutique.
  Rien dans son service, ses invariants ou son autorité n'a changé.
- `decision-signals` devient une **piloting capability** (jamais une feature,
  jamais un `.feature.js` — conformément à la consigne explicite du prompt),
  gouvernée par la doctrine créée en §0 et déclarée dans
  `capabilities/decision-signals.capability.js`.

---

## 3. Manifests créés

| Manifest | Rôle |
|---|---|
| `docs/doctrine/PILOTING_CAPABILITY_DOCTRINE.md` | Doctrine du nouveau concept (prérequis manquant, créé) |
| `docs/doctrine/PILOTING_CAPABILITY_REGISTRY.md` | Registre dédié des piloting capabilities (prérequis manquant, créé) |
| `capabilities/decision-signals.capability.js` | Manifest de la capability `decision-signals` |

## Manifests modifiés

| Manifest | Changement |
|---|---|
| `features/recommendations.feature.js` | Retrait des fichiers/tables/routes `decision-signals` ; `db.tables` et `contract.exposes` resserrés au ranking réel ; bloc `security` recalculé (1 route publique restante, plus 8) ; ajout de `classification` (ratchet phase 2, manifest modifié dans cette PR) |
| `scripts/feature-registry-check.js` | Étendu pour charger aussi `capabilities/*.capability.js` comme source légitime de fichiers couverts (anti-orphelins), **sans** les soumettre à `REQUIRED_FIELDS` des features — voir doctrine §4 |

Aucun manifest supprimé ou déprécié dans ce sous-lot.

---

## 4. Fichiers retaggés

| Ancien owner | Fichier | Nouvel owner | Justification métier |
|---|---|---|---|
| `recommendations` | `services/radar-queries.js` | `decision-signals` (capability) | Alimente la détection de signaux cross-feature, aucun rapport avec le ranking produit ; `@used-by` pointait déjà vers `routes/admin-radar.js` (dashboard), pas vers le ranking |
| `recommendations` | `services/signal-service.js` | `decision-signals` (capability) | Écrit la table `signals` — cycle de vie propre (ack/resolve/snooze), aucun rapport avec le ranking |
| `recommendations` | `routes/signals.js` | `decision-signals` (capability) | Expose le CRUD des signaux, 7/8 routes protégées admin — surface distincte du endpoint public de suggestions |
| `recommendations` | `tests/unit/radar-queries.test.js` | `decision-signals` (capability) | Suit son fichier source |
| `recommendations` | `tests/unit/signals.test.js` | `decision-signals` (capability) | Suit son fichier source |
| `recommendations` | `tests/unit/signal-service.test.js` | `decision-signals` (capability) | Suit son fichier source |

Headers `@komerce-arch` corrigés (`@domain recommendations` → `@domain
decision-signals`) sur les 3 fichiers de code (les tests n'ont pas de header
`@komerce-arch`).

---

## 5. Objets créés/modifiés — avant/après

| Objet | Avant | Après | Décision |
|---|---|---|---|
| `decision-signals` | N'existait dans aucune gouvernance (mélangé dans `recommendations`) | Piloting capability déclarée, gouvernée, registrée | Créé |
| `recommendations.files` | 2 services + 2 routes (mélangés) | 1 service + 1 route (ranking seul) | Resserré |
| `recommendations.db.tables` | 11 tables (dont 7 propres à decision-signals) | 4 tables, toutes en lecture | Resserré |
| `recommendations.contract.exposes` | 8 routes | 1 route | Resserré |
| `recommendations.security` | 7/8 protégées, 1 publique | 0/1 protégée, 1 publique (seule restante) | Recalculé |
| `scripts/feature-registry-check.js` | Ne scanne que `features/*.feature.js` | Scanne aussi `capabilities/*.capability.js` pour l'anti-orphelins | Étendu |

---

## 6. Fichiers hybrides refusés au déplacement

Aucun dans ce sous-lot. La frontière `recommendations` / `decision-signals`
était nette (aucun fichier ne mélangeait les deux responsabilités).

---

## 7. ONTOLOGY_GAP identifiés

1. **Collision de nom `sourcing` hors périmètre O1.1, notée ici car détectée
   pendant la reconnaissance** : `routes/sourcing.js`,
   `services/sourcing-analysis.js`, `services/sourcing-mutations.js`
   (`@domain economic-engine`, montés sur `/api/admin/sourcing` en parallèle
   de `routes/sourcing-scanner.js`) n'ont rien à voir avec le sourcing
   fournisseur traité en O1.3 — ce sont des routes de pricing/marge par rail
   de transport. Ne pas les confondre au sous-lot O1.3. `economic-engine`
   reste hors scope de tout le Lot O1.
2. **Tests mal rangés, hors scope O1.1** :
   `tests/integration/sourcing-engine-routes.test.js` et
   `tests/integration/sourcing-flow-g5.test.js`, actuellement déclarés dans
   `features/logistics.feature.js`, exercent en réalité `routes/sourcing.js`
   (`@domain economic-engine`), pas `routes/sourcing-scanner.js`. Divergence
   documentée, non corrigée ici (`economic-engine` hors scope Lot O1).

---

## 8. Résultats des gates

| Gate | Commande | Résultat |
|---|---|---|
| Registre features | `npm run feature:registry` | ✔ 0 erreur, 2 orphelins pré-existants (`.github/workflows/*.yml`, non liés à ce lot) |
| Schéma cartes | `npm run gate:schema` | ✔ 18 cartes, 0 cassée |
| Fichiers touchés | `node scripts/touched-files-feature-gate.js --files <fichiers O1.1>` | ✔ (pas de dépôt git dans ce conteneur — testé en mode `--files` explicite) |
| Docs lint | `npm run gate:docs-lint` | ✖ 1 violation — **pré-existante**, `docs/_archive/rex/REX_2026-07-10_PR563_ALERTS_DB_POOL.md`, non créée par ce lot, non liée à O1 |
| Classification | `node scripts/feature-classification-check.js --strict --feature recommendations` | ✔ classifiée `business-feature` |
| Arch/DB | `npm run arch:check` | ✔ 295 headers, 0 violation bloquante |

---

## 9. Tests ciblés

```
npx jest tests/unit/boutique-ranking-engine.test.js tests/unit/boutique-suggestions.test.js \
         tests/unit/radar-queries.test.js tests/unit/signals.test.js tests/unit/signal-service.test.js
```

```
Test Suites: 5 passed, 5 total
Tests:       121 passed, 121 total
```

---

## 10. Diff résumé par service métier

- **recommendations** : périmètre resserré au ranking boutique seul. Aucun
  changement de comportement, de formule, ou d'invariant.
- **decision-signals** (nouveau) : aucun changement de comportement — le code
  n'a pas bougé de fichier, seuls les headers et la gouvernance ont changé.
- **dashboard** : aucun changement (consomme déjà `routes/admin-radar.js`
  correctement, en projection).
- **economic-engine** : non touché, collision de nom notée en gap.
