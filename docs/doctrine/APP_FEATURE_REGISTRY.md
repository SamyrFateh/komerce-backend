# Registre Canonique des Features — Application complète Komerce

> **Version** : 1.7 — 2026-08 (Lot O1.2 : scission `wallet-loyalty` → `wallet` + `loyalty` ; Lot O1.3 : `sourcing` ajouté au registre canonique (précédemment absent malgré manifest et code déjà en place) ; Lot O1.4 : scission `purchasing` d'`orders` ; Lot O1.5 : `dashboard` reclassé `transversal` dans ce tableau, `admin-dashboard` reclassé projection/ui-shell — gouvernance corrective, aucun code runtime déplacé ; Lot O2 : scission `unsold-resolution` d'`inventory` et `incident-management` de `platform-ops` ; retags `purchasing-admin-service.js` → `purchasing` et `admin-risk-provisions.js` → `economic-engine` ; correction du copié-collé `auth`/`auth-identity`)
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
| 16 | `auth-identity` | transversal | backend | [`auth-identity.feature.js`](../../features/auth-identity.feature.js) | production | Routes actives d'identité : OTP, login, magic-link, inscription — partage `domain: 'auth'` avec la ligne #15, voir note ⚠ ci-dessous |
| 17 | `platform-ops` | transversal | backend | [`platform-ops.feature.js`](../../features/platform-ops.feature.js) | production | Santé applicative, config, modules — infrastructure d'exploitation ; incidents scindés vers `incident-management` (Lot O2, 2026-07-12) |
| 18 | `infrastructure` | transversal | backend | [`infrastructure.feature.js`](../../features/infrastructure.feature.js) | production | Middleware non-auth (error-handler, rate-limit, upload, validate), utilitaires partagés, bootstrap applicatif |
| 19 | `admin-dashboard` | projection/ui-shell | dash | [`admin-dashboard.feature.js`](../../public/dashboards/features/admin-dashboard.feature.js) | production | Tableau de bord admin SPA multi-vues (`dashboards/admin/**`) — voir note ⚠ ci-dessous |
| 20 | `legacy-control-tower` | deprecated | dash | [`legacy-control-tower.feature.js`](../../public/dashboards/features/legacy-control-tower.feature.js) | deprecated | Ancien control tower, remplacé par `admin-dashboard` (`dashboards/admin-legacy/**`) |
| 21 | `platform` | frontend-transversal | dash | [`platform.feature.js`](../../public/features/platform.feature.js) | production | Infrastructure transversale dashboards (auth-guard, service worker, composants colis partagés, QR viewer) — hors `admin/` |
| 22 | `admin-dashboard` (copie `public/features/`) | projection/ui-shell | dash | [`admin-dashboard.feature.js`](../../public/features/admin-dashboard.feature.js) | production | Copie octet-pour-octet du manifest #19 (à une divergence pré-existante près, `ClientsView.js`, non liée à ce lot), présente dans `public/features/` en plus de `public/dashboards/features/` — voir note ⚠ ci-dessous |
| 23 | `legacy-control-tower` (copie `public/features/`) | deprecated | dash | [`legacy-control-tower.feature.js`](../../public/features/legacy-control-tower.feature.js) | deprecated | Copie octet-pour-octet du manifest #20, présente dans `public/features/` en plus de `public/dashboards/features/` — voir note ⚠ ci-dessous |
| 24 | `sourcing` | feature | backend | [`sourcing.feature.js`](../../features/sourcing.feature.js) | production | Qualification de candidats fournisseur avant catalogue (scan, décision garder/watchlist/rejeter) — extrait de `logistics` (Lot O1.3, 2026-07-12) |
| 25 | `unsold-resolution` | feature | backend | [`unsold-resolution.feature.js`](../../features/unsold-resolution.feature.js) | production | Arbitrage et liquidation de la valeur immobilisée d'une commande invendue (WhatsApp, revendeur, don, destruction) — scindé d'`inventory` (Lot O2, 2026-07-12) |
| 26 | `incident-management` | transversal (business) | backend | [`incident-management.feature.js`](../../features/incident-management.feature.js) | production | Détection, qualification et résolution d'écarts opérationnels avec impact client traçable — scindé de `platform-ops` (Lot O2, 2026-07-12) |
| 27 | `business-rules` | transversal (business) | backend | [`business-rules.feature.js`](../../features/business-rules.feature.js) | production | Référentiel versionné des règles métier paramétrables, servi aux features consommatrices avec valeur de repli |

> ⚠️ **Note sur les lignes #19/#20 vs #22/#23** : le dépôt dashboards contient un
> sous-dossier `dashboards/` imbriqué (donc `public/dashboards/**` une fois déployé)
> qui duplique intégralement `admin/`, `admin-legacy/`, `features/`, `docs/`,
> `scripts/`, `tests/` — fichiers identiques byte-for-byte, y compris les deux
> manifests `admin-dashboard.feature.js` et `legacy-control-tower.feature.js`.
> Origine non déterminée (mirroring volontaire d'anciennes URLs `/dashboards/...`,
> ou copie accidentelle) — **à trancher avec l'équipe avant suppression**, `db:sync`
> et le service statique Express pouvant dépendre de l'un ou l'autre chemin. En
> attendant l'arbitrage, les deux copies sont enregistrées ici pour que
> `registry-doc-check.js` reste en bijection stricte avec le disque.
> Si la duplication est confirmée accidentelle : supprimer `dashboards/dashboards/`
> (dépôt dashboards) ou `public/dashboards/` (déployé), puis retirer les lignes
> #19/#20 (ou #22/#23) ci-dessus en conséquence.

> ℹ️ **Note sur les lignes #2/#2b** : `purchasing` a été scindé d'`orders` au Lot O1.4
> (2026-07-12, `docs/chantier/LOT_O1_4_LIVRABLE.md`). `orders` fait exister la commande
> cliente et garantit son cycle d'état exclusivement via `order-status-machine.js` ;
> `purchasing` transforme un besoin d'approvisionnement issu d'une commande en engagement
> fournisseur traçable (bon de commande), puis constate sa réception — deux services
> métier distincts vérifiés par grep `.query()` réel : `orders` ne conserve qu'une seule
> responsabilité résiduelle sur `purchase_orders` (`cancel-order-purchase-orders.js`,
> appelé exclusivement par `order-status-machine.js`, qui libère les bons de commande liés
> à l'annulation), tandis que `purchasing` possède la création, la confirmation et la
> réception. `product_suppliers` et `suppliers` ont quitté `orders` en totalité. Fichiers
> retaggés `@domain orders` → `purchasing` : `services/purchasing-trigger-service.js`,
> `services/purchasing-receive-service.js`, `services/receive-purchase-order.js`,
> `services/repair-ordered-purchasing.js`, `services/repair-ordered-without-purchase-orders.js`,
> `routes/purchasing.js`. Un `ONTOLOGY_GAP` restait ouvert : `services/purchasing-admin-service.js`
> écrivait dans les mêmes tables (`purchase_orders`, `suppliers`, `product_suppliers`, `orders`)
> mais restait `@domain dashboard` — **résolu au Lot O2** (2026-07-12) : retaggé `@domain purchasing`.

> ℹ️ **Note sur les lignes #4a/#4b/#4c** : `wallet-loyalty` regroupait initialement dans un
> seul manifest le solde client (wallet) et le programme de fidélité (loyalty). Scindé au
> Lot O1.2 (2026-07-12, `docs/chantier/LOT_O1_2_LIVRABLE.md`) après vérification empirique
> (grep `.query()` réel, headers `@komerce-arch`, `schema_railway.sql`) qu'aucune table
> (hors `users`, sur des colonnes disjointes), aucun cycle de vie ni invariant n'était
> réellement partagé entre les deux : l'assemblage initial reposait sur un rapport d'usage
> (même client) et non un rapport de service. `wallet-loyalty.feature.js` (#4c) est conservé
> en `deprecated`, vide de tout fichier, comme trace historique — ne pas y ajouter de fichier
> ni réutiliser ce nom sans décision explicite de gouvernance. Un `ONTOLOGY_GAP` reste ouvert :
> `routes/admin-loyalty.js` écrit `loyalty_rewards.status` mais est actuellement rattaché au
> domaine `dashboard`, ce qui en fait un multi-writer réel avec `services/loyalty-service.js`
> sur cette même table — non résolu dans ce lot (déplacement de fichier hybride hors périmètre
> O1.2 sans audit de flux dédié).

> ℹ️ **Note sur la ligne #14 (`dashboard`) et Lot O1.5** : revu au Lot O1.5 (2026-07-12,
> Business Feature Ontology Refactor). Confirmé : `dashboard` n'est **pas** un
> business-feature — `classification.kind` reste `business-transversal` (`decision:
> aggregation-lecture`), jamais `business-feature`. `FEATURE_DOCTRINE.md` §Schéma de
> classification cite pourtant `dashboard` comme exemple canonique du kind
> `aggregation-readonly` (lecture pure) — écart documenté en `ONTOLOGY_GAP` plutôt que
> corrigé sans audit : ce manifest écrit réellement dans ~15 tables via ses routes
> hub/relay/admin opérationnelles (`db.tables`, entrées W/RW), ce qui rend
> `aggregation-readonly` inassignable sans mentir sur le header (le gate
> `feature-classification-check.js` le bloquerait explicitement). Tant que ces mutations
> n'ont pas été auditées et redistribuées vers leurs features propriétaires (hors
> périmètre O1, qui est un ontology refactor et non un product refactor),
> `business-transversal` reste le verdict le plus honnête disponible.
>
> **Delta gouvernance (2026-07-12, audit froid post-merge)** : ce même verdict
> `business-transversal` n'avait pas été répercuté sur le champ binaire `type` de
> `dashboard.feature.js` (resté `feature`) ni sur la colonne *Type* de la ligne #14
> ci-dessus, qui continuaient toutes deux à présenter `dashboard` comme une feature
> métier ordinaire — contradiction corrigée : `type` passe à `transversal`,
> `feature-registry-check.js` compte désormais `dashboard` parmi les domaines
> transversaux. L'invariant "dashboard = lecture seule" du manifest, lui aussi
> contredit par les entrées `db.tables` en W/RW et par les routes hub/relay
> mutantes, a été reformulé pour distinguer les surfaces de pilotage (lecture pure)
> des routes opérationnelles (mutantes) ; l'`ONTOLOGY_GAP` sur la redistribution de
> ces ~15 tables vers leurs features propriétaires est désormais formalisé dans
> `debt.knownGaps` du manifest, pas seulement en commentaire. Aucun fichier ni route
> n'a été déplacé pour ce delta.
>
> Le dépôt `dash` (`admin-dashboard` #19/#22, `legacy-control-tower` #20/#23,
> `platform` #21), absent lors du premier passage O1.5, est désormais disponible et a
> été revalidé pour ce même delta : `admin-dashboard` (#19/#22) — vérification
> empirique de `dashboards/admin/js/**` (0 accès DB direct, mutations HTTP observées
> ciblant des routes possédées par catalog/customs/orders, jamais de table propre) —
> est reclassé `projection/ui-shell` dans la colonne *Type* et documenté comme tel
> dans les deux copies du manifest (`classification.verdict`, voir fichiers). Un
> `ONTOLOGY_GAP` reste ouvert : le schéma `kind` de `feature-classification-check.js`
> ne couvre que `backend/features/` et n'a pas de valeur prévue pour une projection
> cross-repo avec manifest propre — non résolu ici, à trancher en O2 si une doctrine
> de classification dash-repo est créée. `legacy-control-tower` (#20/#23, déjà
> `deprecated`) et `platform` (#21, déjà `transversal`) n'ont pas été retouchés : leur
> classification actuelle n'est pas mise en cause par ce delta.

> ℹ️ **Note sur les lignes #15/#16** : `auth` et `auth-identity` étaient initialement deux
> manifests distincts déclarant le même `domain: 'auth'`, ce qui produisait 5 faux
> positifs dans `feature-guard.js`. Corrigé le 2026-07-06 : `auth-identity` a désormais
> son propre `domain: 'auth-identity'` (manifest + headers `@komerce-arch` des 5 fichiers
> concernés : `routes/otp.js`, `routes/auth.js`, `routes/client-auth.js`,
> `services/otp-test-mode.js`, `services/authkey-client.js`). Les deux manifests restent
> légitimement distincts (garde transverse pure côté `auth`, routes actives OTP/login côté
> `auth-identity`) — seule l'étiquette de domaine était en cause, pas le découpage.

---

## Les trois dépôts et leur gouvernance propre

| Dépôt | Contient | Gouvernance détaillée |
|---|---|---|
| `backend` | API, services métier, migrations | Ce registre + manifests `features/*.feature.js` |
| `bout` | Boutique client (HTML/CSS/JS) | `docs/BOUTIQUE_COMPONENT_OWNERSHIP.md` + `docs/BOUTIQUE_OWNERSHIP_LIVE.md` (auto-générée par `scripts/gen-ownership.js` **du dépôt bout**) — source de vérité pour le détail CSS/DOM, ce registre ne fait que pointer vers les fichiers, pas dupliquer leur contrat |
| `dash` | Dashboards admin, hub, relais | **Aucune doctrine d'ownership dédiée aujourd'hui** — dette explicite, voir section suivante |

Ce registre ne remplace pas le système d'ownership déjà en place côté boutique — il s'y
branche. Pour une feature qui a des fichiers boutique (`repos.boutique` dans le manifest),
le détail CSS/DOM précis (qui style quoi, qui écrit quel DOM) vit dans
`BOUTIQUE_OWNERSHIP_LIVE.md`, pas ici. Dupliquer cette information créerait deux sources
de vérité qui divergeraient à la première PR boutique non répercutée ici.

---

## Lecture rapide des interfaces inter-features

```
            ┌───────────────┐
            │ auth │  (transversal — consommé par tout le reste)
            └───────┬───────┘
                     │
   ┌─────────────────┼──────────────────────────────────────┐
   ▼                 ▼                                      ▼
sourcing ──► catalog ──► shared-cart ──► orders ──► payment       economic-engine
              │                │           │           (pricing pour
              │                ▼           ▼            catalog, orders,
              │           purchasing   refunds          shared-cart)
              │        (scindé au Lot O1.4)  │
              ▼                │           ▼
   wallet / loyalty      logistics       │
   (scindés au Lot O1.2)      │           ▼
              │                │           ▼
              └──────► refunds ◄───── documents (génère les preuves
                          │                       pour orders, refunds,
                          ▼                       customs)
                    notification (émission, consommée par toutes)
                          │
                    customs (déclaration, consommée par logistics,
                              dashboard)
                          │
                    dashboard (agrégation en lecture pour le pilotage/reporting ;
                              routes hub/relais/admin opérationnelles mutantes —
                              transversal legacy, ONTOLOGY_GAP voir manifest)
```

Règle de lecture du schéma : une flèche `A ──► B` signifie *A consomme un service de B*,
jamais l'inverse. `dashboard` est en lecture seule sur ses surfaces de pilotage/reporting
uniquement ; ses routes hub/relais/admin opérationnelles écrivent réellement dans les
domaines d'autres features (voir `debt.knownGaps` de son manifest pour le détail table
par table et le plan de redistribution, hors périmètre O1).

---

## Fichiers actuellement sans feature déclarée (dette connue)

`scripts/feature-registry-check.js --orphans` liste en continu les fichiers de
`services/`, `routes/`, `middleware/`, `utils/`, `validators/`, `core/` non couverts par
un manifest. Au moment de la rédaction de ce registre, les familles suivantes restent à
cartographier précisément (rattachées provisoirement par approximation de nommage, à
corriger au fil de l'eau plutôt qu'en bloquant ce registre) :

- fichiers historiques sans header `@komerce-arch` du tout (`@domain unknown`, 35 fichiers
  au moment de la rédaction) — chacun doit recevoir un header daté avant ou pendant son
  prochain changement, puis rejoindre le manifest de la feature correspondante ;
- `sourcing` a été scindé de `logistics` au Lot O1.3 (2026-07-12) — voir ligne #24 et
  `features/sourcing.feature.js`. Un homonyme sans rapport a été détecté au même lot :
  `routes/sourcing.js` (moteur margin/rail admin d'`economic-engine`) — les deux ne
  doivent jamais être confondus ni fusionnés. `ONTOLOGY_GAP catalog/sourcing` documenté
  dans `sourcing.feature.js` et non résolu ici (frontière fine explicitement hors
  périmètre O1) : (1) `migrations/041_sourcing_candidates.sql` crée conjointement
  `supplier_catalog_imports` (table `catalog`) et `sourcing_candidates` /
  `sourcing_candidate_events` (tables `sourcing`) dans le même fichier, non scindée ;
  (2) `services/supplier-catalog-scanner.js` et
  `services/suppliers/catalog-import-orchestrator.js` restent dans `catalog` malgré leur
  rôle dans le pipeline sourcing — non déplacés faute de démonstration que leur service
  principal a cessé d'être l'entrée catalogue. Ce gap fin catalog/sourcing (`/catalogs/import`,
  écriture `products`, délégation au catalog-import-orchestrator dans le périmètre
  `sourcing`) est **conservé pour O2** et doit y être challengé, pas corrigé au fil de l'eau ;
- `purchasing` (bon de commande fournisseur) a été scindé d'`orders` au Lot O1.4
  (2026-07-12, voir note ⚠ lignes #2/#2b) — `services/purchasing-admin-service.js` restait
  `@domain dashboard` malgré une écriture dans les mêmes tables que `purchasing`
  (`purchase_orders`, `suppliers`, `product_suppliers`) : **RÉSOLU au Lot O2** (2026-07-12) —
  retaggé `@domain purchasing`, fichier et test déplacés dans `purchasing.feature.js` ;
- **le dépôt `dash`** (dashboards admin, hub, relais) n'a aucune doctrine d'ownership
  équivalente à `BOUTIQUE_OWNERSHIP_LIVE.md` côté boutique. Le manifest `dashboard.feature.js`
  liste les fichiers connus (`dashboards/admin/*`, `hub/index.html`, `relais/index.html`,
  quelques modules JS partagés) mais sans le détail de qui écrit quel DOM ni de
  multipropriété CSS. Tant que cette doctrine n'existe pas, toute modification dans `dash`
  doit être traitée avec la même prudence qu'une zone non cartographiée — vérifier
  manuellement les usages avant de toucher un fichier partagé comme `js/auth-guard.js`.
  **Mise à jour 2026-07-06** : les 3 manifests dash existants (`admin-dashboard`,
  `legacy-control-tower`, `platform`, lignes #19-21) sont désormais présents dans ce
  registre — ils décrivaient déjà du code réel mais n'y étaient pas indexés. Cela ne
  résout pas la dette de doctrine d'ownership ci-dessus, seulement son absence
  d'indexation. Audit connexe : `public/admin/` (arbre non servi, doublon de
  `public/dashboards/admin/`) supprimé le même jour après vérification `esc()`/AUD-06
  et re-câblage des tests — voir `docs/chantier/STATUS.md` §AUD-06.

Cette section n'est pas un satisfecit : c'est la liste de ce que le registre ne couvre
**pas encore**, à traiter explicitement plutôt qu'à laisser invisible.

---

## Règle de mise à jour

Toute feature nouvelle, fusionnée, scindée ou dépréciée met à jour ce tableau et son
manifest dans la même PR. `feature-registry-check.js --strict` échoue si un manifest
référence un fichier absent du disque — il ne détecte pas (encore) l'inverse de manière
automatique pour tous les répertoires ; la liste de dette ci-dessus reste donc à jour
manuellement jusqu'à ce que tous les `@domain unknown` soient résorbés.
