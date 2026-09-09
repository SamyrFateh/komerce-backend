# Registre Canonique des Features — Application complète Komerce

> **Version** : 1.9 — 2026-09 (`market-delegation` ajouté comme feature de première classe ; clôture AUTH et lots O1/O2 antérieurs conservés)
> **Statut** : registre actif — gouverné par `docs/doctrine/FEATURE_DOCTRINE.md`
> **Construit à partir de** : headers `@komerce-arch` réels (`@domain`) du dépôt
> **backend**, croisés avec les fichiers réels des dépôts **bout** (boutique frontend)
> et **dash** (dashboards/hub/relais). Pas de feature inventée, pas de chemin supposé.
> **Vérifié par** : `node scripts/feature-registry-check.js`
>
> **Komerce n'est pas un monorepo.** Trois dépôts distincts composent l'application :
> `backend` (API + logique métier), `bout` (boutique client, dépôt séparé avec son
> propre `package.json`), `dash` (dashboards admin/hub/relais). Une feature métier
> traverse souvent les trois. Le champ `repos` de chaque manifest dit explicitement
> dans quel dépôt vit chaque groupe de fichiers — ne jamais supposer qu'un chemin
> backend (`services/`, `routes/`) et un chemin boutique (`js/`, `css/`) partagent une
> racine commune : ils n'en ont pas.

---

## Comment lire ce registre

Chaque ligne = une feature ou un domaine transversal (voir distinction dans
`FEATURE_DOCTRINE.md`). Le manifest associé contient le détail (périmètre exact,
interfaces, autorité, invariants). Ce registre est l'index — pas le détail.

| # | Feature | Type | Dépôts couverts | Manifest | Statut | Service rendu (résumé) |
|---:|---|---|---|---|---|---|
| 1 | `shared-cart` | feature | backend + boutique | [`shared-cart.feature.js`](../../features/shared-cart.feature.js) | production | Panier partagé multi-participants, de la création au règlement |
| 2 | `orders` | feature | backend | [`orders.feature.js`](../../features/orders.feature.js) | production | Commande : création, statut, coût, rattachement colis/achats |
| 2b | `purchasing` | feature | backend | [`purchasing.feature.js`](../../features/purchasing.feature.js) | production | Engagement fournisseur : bon de commande déclenché par une commande, confirmation, réception — scindé d'`orders` au Lot O1.4 (2026-07-12) |
| 3 | `payments` | feature | backend + boutique | [`payments.feature.js`](../../features/payments.feature.js) | production | Encaissement (Stripe, PayPal, cash) et confirmation de paiement |
| 4a | `wallet` | feature | backend + boutique | [`wallet.feature.js`](../../features/wallet.feature.js) | production | Solde client : historique de crédit/débit, application exactement une fois |
| 4b | `loyalty` | feature | backend | [`loyalty.feature.js`](../../features/loyalty.feature.js) | production | Statut de fidélité (paliers, compteur gros panier) et récompenses associées |
| 4c | `wallet-loyalty` | deprecated | backend + boutique | [`wallet-loyalty.feature.js`](../../features/wallet-loyalty.feature.js) | deprecated | Scindé au Lot O1.2 (2026-07-12) en `wallet` (#4a) et `loyalty` (#4b) — voir note ⚠ ci-dessous |
| 5 | `logistics` | feature | backend + boutique | [`logistics.feature.js`](../../features/logistics.feature.js) | production | Colis : scan, transit, tracking, relais, transporteurs |
| 6 | `economic-engine` | feature | backend | [`economic-engine.feature.js`](../../features/economic-engine.feature.js) | production | Pricing, coûts, marges, stratégies tarifaires |
| 7 | `catalog` | feature | backend + boutique | [`catalog.feature.js`](../../features/catalog.feature.js) | production | Produits, connecteurs fournisseurs, publication boutique |
| 8 | `customs` | feature | backend | [`customs.feature.js`](../../features/customs.feature.js) | production | Classification douanière, déclaration, analytics douane |
| 9 | `notifications` | feature | backend | [`notifications.feature.js`](../../features/notifications.feature.js) | production | Alertes et messages sortants (WhatsApp, notifications internes) |
| 10 | `documents` | feature | backend | [`documents.feature.js`](../../features/documents.feature.js) | production | Génération de documents (preuve retrait, facture douane, reçu) |
| 11 | `recommendations` | feature | backend | [`recommendations.feature.js`](../../features/recommendations.feature.js) | staging | Classement et suggestions boutique |
| 12 | `inventory` | feature | backend | [`inventory.feature.js`](../../features/inventory.feature.js) | staging | Réception, affectation et dispatch des articles au hub — invendus scindés vers `unsold-resolution` (Lot O2, 2026-07-12) |
| 13 | `refunds` | feature | backend | [`refunds.feature.js`](../../features/refunds.feature.js) | production | Remboursement transverse (wallet, cash, panier partagé) |
| 14 | `dashboard` | transversal (legacy, agrégation + opérations mixtes) | backend + dash | [`dashboard.feature.js`](../../features/dashboard.feature.js) | production | Tableaux de bord et back-office (admin, hub, relais, finance) — voir note ⚠ ci-dessous |
| 15 | `auth` | transversal | backend | [`auth.feature.js`](../../features/auth.feature.js) | production | Garde transverse (middlewares OTP/session/identité vérifiée) — consommée par toutes les features |
| 16 | `auth-identity` | transversal | backend | [`auth-identity.feature.js`](../../features/auth-identity.feature.js) | production | Routes actives d'identité : OTP, login, magic-link, inscription |
| 16b | `auth-passkey` | transversal | backend | [`auth-passkey.feature.js`](../../features/auth-passkey.feature.js) | production | WebAuthn/passkeys : enrôlement, login nominal, gestion des authentificateurs et step-up |
| 17 | `platform-ops` | transversal | backend | [`platform-ops.feature.js`](../../features/platform-ops.feature.js) | production | Santé applicative, config, modules — infrastructure d'exploitation ; incidents scindés vers `incident-management` |
| 18 | `infrastructure` | transversal | backend | [`infrastructure.feature.js`](../../features/infrastructure.feature.js) | production | Middleware non-auth, utilitaires partagés, bootstrap applicatif |
| 19 | `admin-dashboard` | projection/ui-shell | dash | [`admin-dashboard.feature.js`](../../public/dashboards/features/admin-dashboard.feature.js) | production | Tableau de bord admin SPA multi-vues (`dashboards/admin/**`) |
| 20 | `legacy-control-tower` | deprecated | dash | [`legacy-control-tower.feature.js`](../../public/dashboards/features/legacy-control-tower.feature.js) | deprecated | Ancien control tower, remplacé par `admin-dashboard` |
| 21 | `platform` | frontend-transversal | dash | [`platform.feature.js`](../../public/features/platform.feature.js) | production | Infrastructure transversale dashboards |
| 22 | `admin-dashboard` (copie `public/features/`) | projection/ui-shell | dash | [`admin-dashboard.feature.js`](../../public/features/admin-dashboard.feature.js) | production | Copie du manifest #19 présente dans `public/features/` |
| 23 | `legacy-control-tower` (copie `public/features/`) | deprecated | dash | [`legacy-control-tower.feature.js`](../../public/features/legacy-control-tower.feature.js) | deprecated | Copie du manifest #20 présente dans `public/features/` |
| 24 | `sourcing` | feature | backend | [`sourcing.feature.js`](../../features/sourcing.feature.js) | production | Qualification de candidats fournisseur avant catalogue |
| 25 | `unsold-resolution` | feature | backend | [`unsold-resolution.feature.js`](../../features/unsold-resolution.feature.js) | production | Arbitrage et liquidation de la valeur immobilisée d'une commande invendue |
| 26 | `incident-management` | transversal (business) | backend | [`incident-management.feature.js`](../../features/incident-management.feature.js) | production | Détection, qualification et résolution d'écarts opérationnels |
| 27 | `business-rules` | transversal (business) | backend | [`business-rules.feature.js`](../../features/business-rules.feature.js) | production | Référentiel versionné des règles métier paramétrables |
| 28 | `market-operator-dashboard` | feature | backend + dash | [`market-operator-dashboard.feature.js`](../../features/market-operator-dashboard.feature.js) | staging | Accès market_operator au dashboard Canonical scopé marché |
| 29 | `market-delegation` | feature | backend | [`market-delegation.feature.js`](../../features/market-delegation.feature.js) | staging | Mandat d'exploitation d'un Market ID, plafond de capacités, équipe locale, audit et projection d'autorisation |

> ⚠️ **Note sur les lignes #19/#20 vs #22/#23** : le dépôt dashboards contient deux
> emplacements de manifests historiques. Tant que leur duplication n'est pas tranchée,
> les deux copies restent enregistrées afin de préserver la bijection stricte du registre.

> ℹ️ **`market-delegation` (#29)** : cette feature est volontairement distincte de
> `market`. `market` porte le référentiel et la Currency Boundary ; `market-delegation`
> porte qui exploite un Market ID, dans quelle limite, avec quels membres et quelles
> capacités. `operator_market_scopes` devient progressivement un read model de
> compatibilité ; `require-market-scope.js` reste inchangé pendant la transition.

---

## Les trois dépôts et leur gouvernance propre

| Dépôt | Contient | Gouvernance détaillée |
|---|---|---|
| `backend` | API, services métier, migrations | Ce registre + manifests `features/*.feature.js` |
| `bout` | Boutique client (HTML/CSS/JS) | `docs/BOUTIQUE_COMPONENT_OWNERSHIP.md` + `docs/BOUTIQUE_OWNERSHIP_LIVE.md` |
| `dash` | Dashboards admin, hub, relais | Gouvernance dédiée dans le dépôt dash ; prudence sur les fichiers partagés |

---

## Lecture rapide des interfaces inter-features

```text
market ──► market-delegation ──► operator_market_scopes (projection)
                         │
                         ├──► market-operator-dashboard
                         ├──► economic-engine (capacités MARKET uniquement)
                         └──► futures surfaces réseau / équipe / offre locale
```

La flèche signifie « consomme ». `market-delegation` ne possède ni les règles GROUP,
ni les fonctions Hub/transit mutualisées, ni le contrat juridique complet du partenaire.

---

## Fichiers actuellement sans feature déclarée (dette connue)

`scripts/feature-registry-check.js --orphans` reste la source de vérité machine pour
les fichiers backend non couverts. Toute modification d'un fichier historique encore
orphelin doit le rattacher explicitement à sa feature au lieu d'élargir une exception.

---

## Règle de mise à jour

Toute feature nouvelle, fusionnée, scindée ou dépréciée met à jour ce tableau et son
manifest dans la même PR. `registry-doc-check.js --strict` vérifie la bijection stricte
entre les manifests présents sur disque et les liens du registre.
