# Doctrine Feature Slice — Komerce

> **Version** : 1.0 — 2026-06
> **Statut** : doctrine active
> **Hiérarchie** : complète `AGENTS.md` — en cas de conflit, `AGENTS.md` fait foi.
> **Gouvernée par** : `docs/doctrine/FEATURE_DOCTRINE.md` (niveau 0) — cette doctrine
> définit *comment* une feature déjà reconnue par `APP_FEATURE_REGISTRY.md` se
> découpe techniquement ; elle ne définit pas *ce qu'est* une feature, c'est le rôle
> du document parent.
> **Commande** : `node scripts/feature-guard.js`

---

## Pourquoi cette doctrine existe

Komerce dispose déjà de :

| Outil | Granularité |
|---|---|
| `@komerce-arch` headers | Fichier — contrat par fichier |
| `ZONE_IMPACT.md` | Invariants absolus cross-feature |
| `CONTRACTS.md` | Signatures des services critiques |
| `SCHEMA.md` | Schéma DB canonique |
| Gates CI | Invariants exécutables |

Ce qui n'existait pas : **la granularité feature**.

Sans elle, un développeur ou un agent IA qui touche `shared-cart-engine.js` sait où est ce fichier. Il ne sait pas, sans grepper l'intégralité du repo, quels sont les 15 autres fichiers qui forment la feature, quelles migrations lui appartiennent, quels tests la couvrent, ni si elle est saine en tant qu'unité.

La doctrine Feature Slice comble ce manque en **un fichier par feature**.

---

## Principe fondamental

> Une feature est une unité de livraison autonome.
> Elle se monte en une passe, se teste en isolation, se démonte sans laisser de fantômes.
> Son état de santé est vérifiable en une commande.

Ce n'est **pas** un feature flag runtime (toggle en prod).
C'est une **garantie structurelle au moment du commit** : périmètre déclaré, cohérence vérifiée par le guard, impacts connus, régression impossible à masquer.

Nom industriel le plus proche : *Architecture Decision Record exécutable*.

---

## Structure — où vivent les slices

```
features/
  shared-cart.feature.js      ← feature panier partagé
  pricing-v2.feature.js       ← feature moteur pricing v2
  paypal.feature.js           ← future feature PayPal
  douane-keystone.feature.js  ← feature douane (en cours)
  ...
```

Un seul répertoire, un fichier par feature, nom kebab-case, extension `.feature.js`.

---

## Format canonique

```js
/**
 * @feature       shared-cart
 * @domain        panier-partage
 * @status        production          ← draft | staging | production | deprecated
 * @owner         backend-core
 * @since         2026-03
 * @doctrine      docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md
 */
module.exports = {

  // ── Identité ─────────────────────────────────────────────────────────────
  name:     'shared-cart',
  domain:   'panier-partage',
  status:   'production',   // draft | staging | production | deprecated
  owner:    'backend-core',
  since:    '2026-03',
  doctrine: 'docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md',

  // ── Périmètre fichiers ────────────────────────────────────────────────────
  // Règle : tout fichier qui existe PARCE QUE cette feature existe.
  // Un fichier appartient à UN seul slice (owner) ou à aucun (utils/, shared/).
  files: {
    services: [
      'services/shared-cart-engine.js',
      // ...
    ],
    routes: [
      'routes/shared-cart.js',
      // ...
    ],
    migrations: [
      'migrations/044_shared_cart.sql',
      // ...
    ],
    tests: [
      'tests/unit/shared-cart-v4.test.js',
      // ...
    ],
    boutique: [                           // présent seulement si la feature a du front
      'public/boutique/js/b-share-cart.js',
      // ...
    ],
    // Clés libres : 'validators', 'middleware', 'utils', 'crons', ...
  },

  // ── Contrat d'interface ───────────────────────────────────────────────────
  // Ce que la feature expose (routes publiques) et consomme (domaines tiers).
  // Pas de signature exhaustive ici — ça vit dans CONTRACTS.md.
  // Juste assez pour que le guard et l'IA sachent qui est impacté.
  contract: {
    exposes: [
      'POST   /api/shared-carts',
      'GET    /api/shared-carts/:id',
    ],
    consumes: [
      'orders',        // domaine propriétaire : order-status-machine
      'wallet',        // domaine propriétaire : wallet-service
      'products',      // lecture seule
      'notifications', // émission uniquement
    ],
  },

  // ── Invariants propres ────────────────────────────────────────────────────
  // Invariants métier SPÉCIFIQUES à cette feature (complémentaires à ZONE_IMPACT.md).
  // Format : string lisible — utilisé dans les messages d'erreur du guard.
  invariants: [
    'snapshot figé après 1ère contribution payée',
    'idempotence webhook Stripe sur shared_cart_contributions',
    'fenêtre paiement 48h — aucune extension sans machine de statut',
    'annulation restores wallet si contribution confirmée',
  ],

};
```

---

## Les quatre statuts

| Statut | Signification | Ce que le guard vérifie en plus |
|---|---|---|
| `draft` | En cours de développement — pas livrée | Fichiers déclarés existent |
| `staging` | Livrée sur staging — pas encore en prod | + migrations séquentielles |
| `production` | Active en prod | + aucun fichier `@domain` orphelin dans le périmètre |
| `deprecated` | Désactivée — en attente de suppression | + aucun import résiduel hors allowlist |

---

## Règle d'appartenance d'un fichier

Un fichier appartient à **un seul slice** (owner). Si un fichier est partagé entre deux features, il va dans `utils/`, `shared/` ou `middleware/` et n'appartient à aucun slice.

```
services/shared-cart-engine.js   → slice shared-cart         (owner)
utils/reference.js               → aucun slice               (shared)
middleware/auth.js               → aucun slice               (infrastructure)
```

**Règle d'or** : si tu hésites entre deux slices pour un fichier, le fichier est trop couplé. Extrais la partie partagée.

---

## Ce que le Feature Guard vérifie

`scripts/feature-guard.js` — même philosophie que les autres gates CI Komerce :

```bash
node scripts/feature-guard.js                          # rapport complet tous slices
node scripts/feature-guard.js --strict                 # exit(1) si écart (CI / pre-commit)
node scripts/feature-guard.js --feature shared-cart    # un seul slice
node scripts/feature-guard.js --save                   # fige la baseline
```

### Checks universels (tous statuts)

- Chaque fichier déclaré dans `files.*` existe sur le disque.
- Aucune migration déclarée n'a de collision de numéro avec une migration d'un autre slice.
- Le `name` est unique dans `features/`.

### Checks `staging` et `production`

- Les migrations déclarées sont séquentielles (pas de trou non expliqué).
- Chaque fichier `services/` ou `routes/` déclaré a au moins un fichier `tests/` associé dans le slice (coverage structurelle minimale — pas de %).

### Checks `production` uniquement

- Tout fichier portant `@domain: <domain>` dans son header est listé dans un slice de ce domain. Aucun orphelin silencieux.

### Checks `deprecated` uniquement

- Aucun fichier du périmètre n'est `require()`'d ou `import`'d par un fichier hors périmètre (sauf allowlist explicite dans le slice).
- Toutes les routes `exposes` répondent 410 ou sont absentes du routeur.

### Ce que le guard ne vérifie PAS

- La qualité du code (rôle de la review).
- Le contenu des tests (rôle de Jest).
- La cohérence des migrations (rôle de `I-BACK-10` / `ci-migrate.js`).
- Le pourcentage de couverture (rôle de Jest `--coverage`).

Le guard vérifie la **structure déclarée**, pas le comportement. Il est **complémentaire** des tests et des autres gates — jamais concurrent.

---

## Workflow — monter une feature

```bash
# 1. Créer le slice
touch features/ma-feature.feature.js
#    → renseigner name, status: 'draft', files, contract, invariants

# 2. Écrire les fichiers avec @komerce-arch + @domain: ma-feature

# 3. Écrire les tests

# 4. Écrire les migrations

# 5. Vérifier
node scripts/feature-guard.js --feature ma-feature

# 6. Passer en staging quand prêt → status: 'staging'

# 7. Passer en production après validation → status: 'production'

# 8. Commiter slice + fichiers + tests + migrations dans la même PR
```

**La PR est le grain de livraison. Le slice est la checklist.**

---

## Workflow — démonter une feature

```bash
# 1. Passer status: 'deprecated' dans le slice
# 2. node scripts/feature-guard.js --feature ma-feature --strict
#    → le guard liste les imports résiduels à couper

# 3. Couper les imports résiduels un par un

# 4. Supprimer les fichiers du périmètre

# 5. Supprimer le slice

# 6. node scripts/feature-guard.js --strict
#    → doit passer proprement
```

Le démontage est aussi propre que le montage. **Aucun fantôme.**

---

## Numérotation des migrations — par feature, pas globale

> **Décision de gouvernance — 2026-07-06**, suite à l'audit feature governance.

Komerce **n'a pas** de séquence de numéro de migration unique et globale à travers les
features. Un même numéro de base (ex. `071`, `074`, `023`, `036`) peut légitimement porter
plusieurs migrations-sœurs indépendantes, une par feature, désambiguïsées par un suffixe
lettre : `071_relay_dashboard_tables.sql` (`dashboard`) et
`071b_shared_cart_commitments.sql` (`shared-cart`) ne sont pas deux candidats pour le même
créneau — ce sont deux migrations distinctes qui partagent un numéro de base par
coïncidence chronologique. Les deux existent déjà, sont hashées et appliquées
(`governance/migration-hashes.json`) : ce ne sont pas des doublons à corriger.

Ce que `feature-guard.js` vérifie (fonction `migrationSlot()`) : le **créneau exact**
(numéro + suffixe lettre, ou absence de suffixe) doit être unique à travers tout le repo.
Deux features ne peuvent pas déclarer toutes les deux `071_....sql` (sans suffixe, ou avec
le même suffixe) — ça, c'est une vraie collision, signe que deux migrations distinctes ont
reçu le même nom de fichier par erreur. Mais `071` et `071b` ne collisionnent jamais entre
eux, quelle que soit la feature qui les porte.

**Ce que cette règle ne fait pas** : elle ne garantit aucun ordre d'exécution global des
migrations entre features (deux features peuvent avoir des historiques de migration
totalement indépendants). L'ordre d'exécution réel est celui du système de migration
utilisé en production (fichiers triés, appliqués en séquence) — cette doctrine ne le
remplace pas, elle documente juste que la collision de *nommage* n'implique pas une
collision d'*exécution*.

---

## Workflow — l'IA intervient sur une feature

Au lieu de grepper le repo entier, l'agent lit dans cet ordre :

```
1. features/<feature>.feature.js           ← périmètre complet en ~40 lignes
2. Headers @komerce-arch des fichiers listés ← contrat de chaque fichier
3. interventionIndex[<fichier>]             ← impacts connus (graphe JSON)
4. doctrine du slice                        ← règles métier
```

C'est la totalité du contexte nécessaire. Rien à deviner, rien à revérifier.

---

## Règle de mise à jour

Le slice est mis à jour dans la **même PR** que le code qu'il décrit.

- Fichier ajouté sans mise à jour du slice → PR bloquée par `--strict`.
- Fichier supprimé sans mise à jour du slice → idem.

**Le slice vieillit avec son code. Jamais séparément.**

---

## Ce que cette doctrine ne remplace pas

| Document existant | Rôle conservé |
|---|---|
| `@komerce-arch` headers | Contrat par fichier — granularité maximale |
| `ZONE_IMPACT.md` | Invariants absolus cross-feature |
| `CONTRACTS.md` | Signatures publiques des services critiques |
| `SCHEMA.md` | Source de vérité DB |
| `AGENTS.md` | Point d'entrée et hiérarchie documentaire |
| Tests Jest | Vérification comportement |
| Gates CI existantes | Invariants exécutables par domaine |

Le Feature Slice est la **couche macro** qui relie ces documents **par feature**. Il ne se substitue à aucun d'eux.
