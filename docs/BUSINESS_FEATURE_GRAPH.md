# Business Feature Graph — Komerce (Lot O3)

> Généré par `scripts/business-graph-gen.js`. Ne pas éditer à la main.
> Source d'autorité : FEATURE_DOCTRINE > APP_FEATURE_REGISTRY > features/*.feature.js > ce document.
> Vérifié par `node scripts/business-graph-gen.js --check` (`npm run business-graph:check`).

## Feature Map

### Business features

- `auth-identity`
- `auth-passkey`
- `catalog`
- `customs`
- `economic-engine`
- `inventory`
- `local-stock`
- `logistics`
- `loyalty`
- `market`
- `market-autonomy`
- `market-control-plane`
- `market-delegation`
- `orders`
- `payments`
- `providers-services`
- `purchasing`
- `recommendations`
- `settlement`
- `shared-cart`
- `sourcing`
- `unsold-resolution`
- `wallet`

### Business transversals

- `business-rules`
- `dashboard`
- `documents`
- `incident-management`
- `notifications`
- `refunds`

### Technical transversals

- `auth`
- `external-provider-contracts`
- `platform-ops`

### Piloting capabilities

- `decision-signals`

### Projections / UI shells

- `admin-dashboard`
- `platform`

### Deprecated

- `legacy-control-tower`
- `wallet-loyalty`

## Big Map — couverture cross-scope (Lot O4)

Synthèse de couverture par scope et identités métier cross-scope. Voir mission O4 §13.

> **Note de terminologie (Lot O4-2, point 9)** — "cross-repo" dans les livrables O4 précédents désignait en réalité un franchissement de **scope** (frontière de gouvernance : manifests/registre/autorité propres à backend, dash, boutique), pas nécessairement un franchissement d'**arbre** séparé. Le tableau ci-dessous constate la relation réelle par scope, dérivée uniquement des chemins configurés (déterministe, indépendante de la présence de `.git`). Tant qu'une ligne n'affiche pas `external-path-scope`, "cross-repo" doit se lire "cross-scope" — un franchissement de frontière de gouvernance à l'intérieur du même arbre.

### Topologie des scopes (relation de chemin constatée)

| Scope | Chemin monté | Relation constatée | Sous ROOT ? |
|---|---|---|---|
| backend | `.` | `self` | — |
| dash | `public` | `same-tree-scope` | oui |
| boutique | `public/boutique` | `same-tree-scope` | oui |

_"cross-repo" ailleurs dans ce document = cross-scope (frontière de gouvernance), sauf si relation="external-path-scope" ci-dessus pour le scope concerné._

### Par dépôt

| Dépôt | Manifests découverts | Manifests connectés | Nœuds techniques | Owned | Orphelins |
|---|---|---|---|---|---|
| backend | 36 | 36 | 725 | 725 | 0 |
| dash | 3 | 3 | N/A | N/A | N/A |
| boutique | 16 | 16 | 106 | 106 | 0 |

_dash_ : pas de Technical Architecture Graph propre au dépôt dash dans ce pipeline — non scanné par arch:gen backend, couverture non mesurable ici (SCOPE, pas un gap)

### Identités canoniques

- **Cross-repo features** (11) : `auth-identity`, `auth-passkey`, `catalog`, `notifications`, `orders`, `payments`, `platform-ops`, `providers-services`, `recommendations`, `shared-cart`, `wallet`
- **Single-repo features** (29) : `admin-dashboard`, `auth`, `business-rules`, `customs`, `dashboard`, `decision-signals`, `documents`, `economic-engine`, `external-provider-contracts`, `incident-management`, `infrastructure`, `inventory`, `legacy-control-tower`, `local-stock`, `logistics`, `loyalty`, `market`, `market-autonomy`, `market-control-plane`, `market-delegation`, `market-operator-dashboard`, `platform`, `purchasing`, `refunds`, `settlement`, `sourcing`, `supplier-connectivity`, `unsold-resolution`, `wallet-loyalty`
- **Unmapped local manifests** (0) : —

### Ontology gaps

- **tracking-no-canonical-owner** (manifest boutique `tracking`)
  - constat : boutique/features/tracking.feature.js décrit un service d'analytics/tracking événementiel UI (suivi parcours, événements). Aucune feature backend ou dash canonique ne représente ce service : vérifié explicitement contre logistics (tracking colis physique — identité métier différente malgré le nom proche), infrastructure (middlewares/bootstrap transverses), notifications (émission de messages sortants, pas de collecte d'événements) et platform-ops (santé applicative). C'est un cas E pur (mission O4 §3) : véritable ONTOLOGY GAP, pas une erreur de nommage à corriger par une fusion.
  - décision actuelle : canonicalFeature reste null. sliceKind fixé à 'frontend-transversal' à titre PROVISOIRE — seule valeur du enum ALLOWED_SLICE_KINDS permettant d'éviter que ce manifeste retombe en BOUTIQUE-MANIFEST-UNGOVERNED, sans pour autant inventer une business feature. Ce n'est pas un vrai transversal multi-feature comme le manifeste `boutique` générique ou `platform` côté dash — c'est un classement de repli documenté.
  - question ouverte : Faut-il créer une feature 'analytics' dédiée côté backend/dash (si un service de collecte équivalent existe ou est prévu côté serveur), ou rattacher ce manifeste à une feature existante par proximité fonctionnelle (ex. platform-ops) ? Décision produit non tranchée par O4.

## Feature → implémentation

### admin-dashboard _(projection)_

> Tableau de bord admin SPA multi-vues.

- js: 38
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 0
- dependencies (consumes): 11 — catalog, customs, dashboard, decision-signals, documents, economic-engine, inventory, logistics, orders, payments, sourcing
- consumers: 0

### auth _(technical-transversal)_

> Fournir les gardes transverses d'authentification et de vérification d'identité (middlewares JWT/session/rôles) consommées par toutes les autres features.

- middleware: 7
- utils: 4
- tests: 16
- tables owned (lifecycle): 0
- tables written: 0
- interfaces exposed: 0
- internal APIs: 6
- dependencies (consumes): 3 — auth-identity, infrastructure, notifications
- consumers: 27 — auth-identity, auth-passkey, business-rules, catalog, customs, dashboard, documents, economic-engine, infrastructure, inventory, logistics, loyalty, market-control-plane, market-delegation, market-operator-dashboard, notifications, orders, payments, platform-ops, providers-services, purchasing, settlement, shared-cart, sourcing, unsold-resolution, wallet, decision-signals

### auth-identity _(business-feature)_

> Authentifier un utilisateur et gérer son identité active (OTP, login/register, magic-link, guest-checkout, profil) via les routes exposées.

- scripts: 1
- services: 7
- routes: 4
- boutique: 3
- utils: 2
- migrations: 4
- tests: 15
- tables owned (lifecycle): 5 — `revoked_tokens`, `users`, `otp_codes`, `credential_action_tokens`, `user_pickup_authorizations`
- tables written: 5
- interfaces exposed: 28
- internal APIs: 13
- dependencies (consumes): 11 — orders, loyalty, logistics, catalog, platform-ops, infrastructure, auth, auth-passkey, notifications, wallet, documents
- consumers: 20 — auth, auth-passkey, business-rules, catalog, dashboard, documents, economic-engine, infrastructure, logistics, loyalty, market-autonomy, market-delegation, notifications, orders, payments, platform-ops, providers-services, settlement, shared-cart, wallet

### auth-passkey _(business-feature)_

> Gérer le cycle de vie Passkey Komerce : enrôlement, login nominal, métadonnées sûres et révocation explicite des authentificateurs du compte (AUTH-2→7).

- services: 3
- routes: 1
- migrations: 2
- tests: 8
- tables owned (lifecycle): 2 — `webauthn_credentials`, `webauthn_challenges`
- tables written: 2
- interfaces exposed: 8
- internal APIs: 0
- dependencies (consumes): 4 — auth, auth-identity, infrastructure, platform-ops
- consumers: 1 — auth-identity

### business-rules _(business-transversal)_

> Detenir le referentiel des regles metier parametrables, versionner chaque changement, et servir a toute feature la valeur en vigueur avec un repli garanti sur la valeur codee en dur.

- utils: 1
- routes: 1
- tests: 3
- tables owned (lifecycle): 2 — `business_rules`, `business_rules_history`
- tables 