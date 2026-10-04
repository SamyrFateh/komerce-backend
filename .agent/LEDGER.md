# LEDGER — état de clôture Komerce

Mis à jour : 2026-10-03

## Source de vérité opérationnelle

- Branche unique : `main`.
- Parcours : `AGENTS.md` → `docs/CARTE_FIRST_INDEX.md` → carte de feature → présent ledger.
- Aucun ancien fichier de tâche, state, worklog, lane, prompt ou preuve brute ne peut rouvrir un travail.

## Paliers acquis

- **P0-A** : clos ; rapport conservé dans `paliers/`.
- **P1** : cinq invariants exécutables acquis.
- **P2** : 25/25 gates applicables couverts par un test de détection, plus une exclusion documentée.
- **P3** : split réalisé ; le manifeste transversal `boutique` ne possède plus de source active et reste à 15 arêtes de compatibilité.
- **P3b** : clos ; 18/18 sources de gates attribuables, 0 source en échec, projection sur 28/28 features et contrat rendu bloquant.
- **O6** : inventaire classifié sans paire `UNCLASSIFIED` ; 7 décisions étroites enregistrées dans le ledger d'exceptions :
  - 3 imports directs observés et acceptés, 0 import direct non arbitré ;
  - 2 cycles topologiques expliqués direction par direction, sans masquer les coutures brutes ;
  - 0 exception stale, dupliquée, vide ou illégitime au run de clôture.
- **P5-N1/N2/N3** : clos sur le périmètre contesté :
  - matrice `payment_status` centralisée, `paid → refunded` seul remboursement autorisé ;
  - émission, rotation et consommation QR centralisées et atomiques ;
  - `total_kmf` reste facial et immuable ;
  - duplicate wallet sans réécriture de `wallet_applied_kmf` ni appel à `markPaid()` ;
  - test du scénario application partielle puis second `/wallet/apply` présent.

## P3b `gateHealth` — CLOS

Mesure de clôture :

- 18 sources configurées ;
- 18 sources attribuables ;
- 0 source en échec ;
- couverture vérifiée avant interprétation des violations ;
- `gateHealth` présent sur 28/28 features ;
- 43 findings projetés et attribués ;
- 0 finding non attribué ;
- 0 fichier non projetable ;
- 0 double projection ;
- 0 feature `gateHealth` bloquée ;
- messages détaillés conservés ;
- tests négatifs et seuil `MIN_GATE_SOURCES = 18` exécutables dans `feature:360:check`.

Preuve d'exécution :

```text
GitHub Actions run : 30312357239
Commit vérifié    : ad6addfa3bdfa06edfb7db8e4e362e8272c6ea7f
Résultat           : tests ciblés, feature:360:check et map:check verts
```

Rapport : `.agent/paliers/P3b-rapport.md`.

## Nettoyage dépôt

Clos pour le périmètre indiscutable :

- ancien runtime `.agent` supprimé ;
- tâches, states, worklogs, handoffs, lanes, prompts, preuves brutes, livraisons et sources PDP retirés ;
- coverage versionné retiré ;
- ancien prompt racine pré-golive retiré ;
- `.gitignore` empêche leur réintroduction ;
- `.agent` ne conserve que `README.md`, `LEDGER.md` et `paliers/` ;
- finaliseur P3b one-shot supprimé après son run vert ;
- job temporaire `p3b-closure` retiré de `carte-first.yml` ;
- workflow Carte First remis en permissions de lecture seule.

## Verdict global du périmètre traité

- **P3b : CLOS.**
- **P5 : CLOS.**
- **Nettoyage runtime : CLOS.**
- Les dettes et attentions encore projetées restent visibles dans Feature 360 et O6 ; elles ne sont pas transformées en faux vert.
- Ce ledger ne déclare pas P6, P7 ou P8 ouverts ou clos : ces paliers restent hors du chantier terminé ici.

## Certification finale — gouvernance et tests, 2026-07-28

- Unités racine : toutes vertes avec couverture et périmètre explicite `tests/unit`.
- Intégration : 31/31 suites vertes avec PostgreSQL 16 et bootstrap CI canonique.
- Boutique et Dashboards : gates et couvertures verts.
- Projections 360, dispositions O6, invariants, sécurité, Feature 360 et `map:check` : verts.
- Preuve complète : GitHub Actions run `30349485657`.
- Audit npm : advisory réel dédupliqué ; exception dev-only `brace-expansion` expirant le 2026-08-15.
- Les anciens nombres « 13 tests/suites cassés » ne décrivent plus l’état courant.
- Les workflows de diagnostic, prompts, patches, archives de travail et marqueurs temporaires ont été retirés.

## Documents clients privés — 2026-08-14

- Le manifeste `documents` possède désormais le cycle complet des factures et documents transactionnels.
- Les PDF sont générés côté serveur, stockés avec `owner_user_id`, nom, version et SHA-256, puis servis avec contrôle d'identité et réponse `404` en cas d'IDOR.
- `Mon Komerce` donne la priorité aux factures et remboursements ; le wallet y est réduit au solde et à l'échéance, sans historique.
- L'onglet Commandes rattache à chaque commande authentifiée ses seules factures et remboursements disponibles, avec téléchargement privé, puis le solde wallet s'il est positif.
- La recherche publique par référence n'expose jamais ces ressources privées et l'API client ne fournit un lien que pour un PDF déjà disponible.
- Les routes publiques de facture et la notification WhatsApp de facture ont été retirées ; WhatsApp ne transporte ni document ni lien de document.
- Le paiement confirmé crée l'instantané de facture dans la transaction, y compris wallet et liste partagée ; les reprises restent idempotentes.
- Tests ciblés documents, paiements et boutique : verts. Suite unitaire globale : 349 suites vertes sur 352 exécutées ; trois échecs de baseline hors périmètre (ordre du modal mobile, date locale pickup, générateur sécurité sans environnement complet).

## Décision UX notifications métier — 2026-08-14

- Une notification essentielle est un petit bandeau actionnable qui reste visible jusqu'à acquittement, pas un fil bavard.
- Après acquittement, la vérité reste dans l'onglet métier concerné, notamment Commandes.
- Le statut « colis prêt au relais » peut recevoir un signal visuel fort et temporaire ; le clignotement est réservé à cette urgence actionnable pour éviter le spam perceptif.
- Le cycle client couvre trois jalons idempotents : `preparation`, `shipped` et `available`. Un jalon plus récent remplace l'ancien ; `in_transit` ne crée pas de quatrième message.
- Le contrat `order.exception.*` est disponible pour les seuls événements exceptionnels actionnables ; aucun faux déclencheur générique n'est inventé.
- Le bandeau reste compact, renvoie vers Commandes, exige un acquittement propriétaire et se résout au retrait/annulation/remboursement.
- Une lecture authentifiée réconcilie toute émission manquée depuis la vérité commande ; aucune panne de notification ne bloque une transition terrain.
- La commande disponible reste mise en évidence jusqu'au retrait, indépendamment de l'acquittement ; `prefers-reduced-motion` supprime l'animation.
- Le chargement sans session reste silencieux et ne déclenche jamais l'OTP.
- Aucun envoi WhatsApp métier n'est réintroduit.
- Les nouvelles factures utilisent le HTML canonique avec le vrai logo Komerce et la version `2026-08-html-logo-v2` ; les PDF déjà émis restent immuables.

## Localisation du relais avant confirmation — 2026-08-24

- Le récapitulatif du relais sélectionné dans le checkout expose un lien compact « 📍 Localiser ce relais » avant toute confirmation ou tout paiement.
- Le lien recherche dans Google Maps le nom et l'adresse publics déjà fournis par l'API relais ; aucune géolocalisation client ni permission navigateur n'est demandée.
- Son activation ouvre un nouvel onglet, ne change jamais le relais et n'ouvre pas le picker « Changer ».
- Le lien suit immédiatement un changement de relais et reste absent lorsque le relais ne fournit aucune donnée de localisation exploitable.
- Aucun contrat de commande, paiement, OTP ou notification n'est modifié.
- Tests checkout ciblés : 148/148 verts ; cartes, ownership, projections et gardes CSS sans régression.

## HUB-000 — fondations Hub closes — 2026-09-15

- **F0 PASS** : outbox transactionnelle durable, causalité intra-agrégat, retry et receipt idempotent.
- **F1 PASS** : audit live Market Integrity sans anomalie inexpliquée puis activation append-only des guards `orders.market_id ↔ relais.market_id`.
- **F2 PASS** : gouvernance incidents avec `origin_domain`, `resolver_domain`, `resolution_class` et transition policy fail-closed.
- **F3 PASS** : SLA persisté, escalade durable vers Action Center, preuve physique dans `scan_events` et revalidation atomique.
- **F4 PASS** : gate d'autorité empêchant Logistics d'écrire directement les vérités Purchasing/Sourcing et les colonnes protégées de `orders`.
- HUB-000 est clos sur `main` au merge de la PR #1531 ; HUB-001 ne devait pas commencer avant ce point.

## HUB-001 — Physical Identity, Allocation & Custody — OUVERT — 2026-09-15

- Branche : `feat/hub001-physical-identity-custody`, créée depuis le `main` post-HUB-000.
- PR : #1532.
- Autorités : Purchasing/Sourcing/Orders/Market gardent leurs vérités ; Logistics possède uniquement identité physique, placement et custody.
- Allocation Hub = snapshot économique immuable de la PO exacte vers `order_item_id`, `product_sku_id`, Supplier Order Identity, `market_id` et destination.
- Un colis fournisseur entrant peut être multi-market ; tout outbound `PACKED`/`DISPATCHED` doit être homogène sur exactement un Market dérivé serveur.
- `SPLIT`/`MERGE`/`REPACK` déplacent uniquement des placements physiques ; ils ne réassignent jamais une allocation économique.
- Quantité physique active plafonnée à la quantité achetée sous verrou DB ; custody append-only ; identités ambiguës mises en quarantaine au lieu d'être devinées.
- Outcomes physiques irréversibles publient l'événement F0 dans la même transaction, sans refund/reorder implicite.
- Verdict HUB-001 reste **PENDING** jusqu'à PR enforcement + preuve PostgreSQL adversariale entièrement verts.

## MARKET-DELEGATION-P0B — Cohérence capability ↔ route (pricing / market_config / clients) — FERMÉ — 2026-09-26

Contexte : un audit humain (compte manager réel vs code/tests) sur l'autonomie marché a confirmé que la feature `market-delegation` fonctionne pour Réseau, Provider, Catalogue, Offre locale, Litiges (`client.case.handle`), Règlements et Hub/Relais (bridge `execution.*`), mais a relevé trois gaps P0. Vérification code faite dans cette session, avec preuve fichier/ligne — aucune correction encore appliquée.

**Gap 1 — pricing.* est LIVE dans le registre mais aucune route ne le consomme.**
- `config/market-delegation-capabilities.js` déclare `pricing.decide`, `pricing.activate`, `pricing.policy.set`, `pricing.cost_component.update/reset`, `market.observation.record` en `class: DELEGATION`, `status: LIVE`.
- `routes/admin-pricing-workspace.js` (lignes ~187-188) protège l'atelier prix avec `attachMarketDelegatedRoleFor(['admin','market_operator'])` + `requireRole(['admin','market_operator'])` — jamais une capability précise.
- `middleware/require-market-delegated-role.js` → `attachMarketDelegatedRoleFor` projette `market_operator` dès qu'une membership active quelconque existe dans `operator_market_scopes`, sans lire `membership_capabilities`.
- Conséquence reproductible : attribuer/retirer `pricing.decide` (ou les autres capabilities pricing) à un membre d'équipe via l'écran Équipe n'a aucun effet sur l'atelier prix. C'est un bypass rôle → capability, interdit par la doctrine de la carte `market-delegation` (LOT 1A) mais non appliqué ici.
- Fix prévu (non fait) : remplacer ce garde par un middleware capability-based réutilisant `resolveAuthorization()` (`services/market-delegation-service.js`, déjà utilisé par le bridge EXECUTION dans `middleware/require-market-execution-capability.js`), avec un mapping explicite endpoint → capability (decide/activate/policy.set/cost_component.update/cost_component.reset/observation.record). `routes/pricing.js` (moteur global admin-only, hors marché) est hors périmètre.
- La carte `features/market-delegation.feature.js` ne liste pas `routes/admin-pricing-workspace.js` dans `files.routes` : à ajouter dans la même PR que le fix (règle AGENTS §2.7).
- **FERMÉ (2026-09-26)**, PR #1801 (`fix/market-delegation-p0b-gap1-pricing-capability`, merge `81de00ba5`). Nouveau bridge `middleware/require-market-delegated-capability.js` (capability DELEGATION exacte via `resolveAuthorization()`, sur le modèle du bridge EXECUTION existant) ; `routes/admin-pricing-workspace.js` remplace `requireMarketPricingManager`/`requireCountryStrategyManager` (rôle→scope) par deux gardes capability : `requirePricingCapability` (conserve le bypass autorité pricing centrale) et `requireLocalStrategyCapability` (aucun bypass, doctrine `country_manager_owns_local_strategy` préservée à la lettre). Cartes `economic-engine`, `market-autonomy` et `market-delegation` mises à jour. 805/805 suites `tests/unit` vertes (9339 tests), `feature:check` et `feature:registry --strict` sans nouvelle erreur.

**Gap 2 — FERMÉ (2026-09-26), sans code métier.** Audit du schéma réel `markets` (migration 135_markets_foundation.sql, jamais altérée) : `code`/`currency`/`minor_unit` sont réservés central, `is_active` porte la même autorité que `market.create` (doit rester central), il ne reste que `name` — insuffisant pour justifier une capability dédiée. Verdict : aucun périmètre local substantiel à déléguer aujourd'hui. Décision : ne pas inventer de configuration marché fictive (pas de formulaire, pas de route PATCH générique, pas de droit local sur `is_active`). `market_config.update` bascule de `DELEGABLE/MISSING` à `CENTRAL_ONLY/CENTRAL_HELD` (migration 246) — MISSING implique un backlog de construction restant ; CENTRAL_HELD documente un non-délégable *par constat*, pas par oubli. `market_config.read` audité en parallèle et **laissé LIVE** : contrairement à l'hypothèse initiale, il a un usage réel (bundle `LEGACY_VIEWER_CAPABILITIES` dans `services/market-scope-projector.js`, case à cocher "Lire la configuration pays" dans `market-team.js`, attendu par 3 suites de tests de provisioning/backfill/E2E) — ce n'est donc pas une phantom capability, même sans écran dédié. Règle retenue pour l'avenir : si de vrais paramètres opérationnels locaux apparaissent un jour dans le produit, préférer une capability nommée précisément plutôt que rouvrir ce `market_config.update` générique. PR : (à ouvrir, branche `fix/market-config-p0b-gap2-governance-closure`). Vérifié avant commit : suite `market-delegation-p0.test.js` (14/14), 25 suites market-delegation (167/167), suite complète `tests/unit` (9337/9339 verts — 2 échecs pré-existants et sans rapport dans `allegro-golden-preflight-contract.test.js`, confirmés identiques hors branche), `feature:check` (0 erreur), `feature:registry --strict` (0 erreur, 7 orphelins CI préexistants sans rapport).

**Gap 3 — `client.read` est `LIVE` et délégable mais l'écran Clients reste admin-only.** À raccorder avec projection scoped au marché (pas d'exposition de l'API admin globale telle quelle).
- **FERMÉ (2026-09-26)**, PR #1806 (`feature/gap3-client-delegation`, merge `0c34da607`). Nouvelle route `routes/market-delegation-client.js` : `GET /api/market-delegation/markets/:marketCode/clients` (index) et `GET /api/market-delegation/markets/:marketCode/clients/:clientPhone` (360), gardées par `requireMarketDelegatedCapability('client.read')` — jamais de bypass par rôle, `market_id`/`marketId` client explicitement rejeté (400). Réutilise telles quelles `services/client-index.js` et `services/client-360.js` (déjà consommées par les routes admin globales), sans dupliquer la logique de projection ; `includeSecurity` forcé à `false` pour ne jamais exposer passkeys/rôle compte à un market_operator (doctrine `client_account_facets_global_only`). Deux corrections nécessaires après le premier push pour repasser la CI au vert : (1) `contract.consumes` de `market-delegation.feature.js` ne déclarait pas la dépendance réelle vers la feature `dashboard` (services réutilisés en `@domain admin-dashboard`) — `business-graph:ratchet-check` bloque toute nouvelle catégorie de drift non revue ; (2) `docs/SECURITY_360.json` était périmé (nouvelles routes absentes du snapshot) — régénéré via `npm run security:360`, 0 route non protégée. 7/7 tests sur le nouveau fichier, 163/163 `market-delegation-*`, 11/11 `admin-client-index-route`/`admin-client-360-route`.

**Verdict MARKET-DELEGATION-P0B : les 3 gaps sont fermés** (Gap 1 PR #1801, Gap 2 PR #1804, Gap 3 PR #1806). L'audit initial (Réseau, Provider, Catalogue, Offre locale, Litiges, Règlements, Hub/Relais) reste valide ; aucun nouveau gap P0 identifié à ce stade.

## CREDENTIAL-AUTHORITY — Provider Credential Authority — EN COURS — 2026-10-01

Branche : `feat/provider-credential-authority` (basée sur `feat/sourcing-source-archive-update`, PR #1997 ; la PR finale dépend de #1997).
Mission : l'opérateur configure / remplace / teste les identifiants fournisseur depuis Sources, sans Railway. Chaîne :
Sources UI → API admin → Provider Credential Authority → AES-256-GCM serveur → `credential_ref` → `sourcing_sources` → connecteur.
Règle absolue : le navigateur ne relit JAMAIS un secret (pas même masqué). Pas de big bang ; le repli `process.env` reste actif ; aucune variable Railway supprimée dans cette PR.

### Décisions (analyse Opus, ne pas rouvrir)

- Coffre : table `provider_credentials` (migration 262). Enveloppe JSON chiffrée AES-256-GCM, IV aléatoire, tag, `key_version`, AAD = provider + credential_ref + version + auth_type. Clé maître `KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY` (32 octets, hex64 ou base64), `KOMERCE_PROVIDER_CREDENTIALS_KEY_VERSION` (défaut 1) ; Railway uniquement, jamais en base. Clé absente/invalide → échec fermé.
- Statuts : pending / active / superseded / revoked / failed. Seuls pending/active gardent une enveloppe (crypto-shredding des autres, imposé par CHECK).
- `supplier_oauth_connections` est conservée comme backend OAuth spécialisé (option C) : une ligne `auth_type='oauth'` référence la session via `oauth_session_key`, sans token.
- Portée par fournisseur : AliExpress = plateforme (APP_KEY/SECRET en env, session OAuth par source) ; CJ = source (clé API dans le coffre, access token en cache mémoire par empreinte, jamais persisté) ; Allegro = client_id/secret par source + refresh token en session OAuth serveur ; eBay = `client_credentials`/plateforme, pas d'autopilot, non migré ; Noon = `none`, indisponible.
- Contrat `auth` déclaré dans `CONNECTORS.api` (`mode` oauth|api_key|client_credentials|none, `scope` platform|source, `fields`). L'UI en dérive son formulaire : jamais de branche par nom de fournisseur côté front. `sourceConnectorFacts()` l'expose sans valeur ni nom de variable.
- Les secrets passent hors-bande au connecteur (`dispatchToConnector(body, {credentials})`, `testConnection(adapter, {credentials})`), jamais dans le corps d'import, le lot ou les logs.
- Autopilot fail-closed : `credential_status` ∈ valid | untested | invalid | missing | not_required, décidé par `deriveCredentialState` (backend). Pas `valid`/`not_required` → ni autopilot-ready, ni activation, ni import opérateur, ni run planifié. Un échec de test du coffre l'emporte sur une certification passée. Le repli env n'est `valid` que si la connexion est testée OK ou la source certifiée.
- Création initiale : `configure` (actif, non testé) puis test distinct. Remplacement : `rotate` (pending → vrai test → bascule transactionnelle ; échec = ancien intact, nouveau `failed` et effacé). Écritures réservées au rôle `admin`.

### Fait (commité)

- Migration 262 + FK `sourcing_sources.credential_ref` (NOT VALID) + capacité `credentials` dans `sourcing_provider_control_events`.
- Connecteurs CJ et Allegro : identifiants du coffre d'abord, repli env ; `testConnection` force un vrai échange. `allegro-sandbox-client` : `platformConfiguration`, `hasEnvironmentClientCredentials`.
- `sourcing-import-dispatch` : contrats `auth`, `authContract()`, codes `credentials_missing` / `authorization_expired`, passage des credentials.
- `services/provider-credential-service.js` : chiffrement, validation par contrat, configure / test / rotate / revoke / status / forSource / resolveForRun / linkOAuthSession, `deriveCredentialState`, `redactSecrets`.
- Autopilot (`runSourceOnce`, `runSourceImportNow`, `setSourceActive`, `listSources`) et registre (`testSourceConnection`) passent par le coffre ; `projectSourceControl` expose `credential_status` + `auth` et bloque en fail-closed.
- Routes admin : `GET /sources/:ref/credentials/status`, `POST /credentials`, `/credentials/test`, `/credentials/rotate`, `/credentials/revoke` (body `{credentials:{…}}`, `Cache-Control: no-store`).
- Redaction pino : api_key, client_secret, access/refresh_token, credentials (+ variantes `*.`).
- Tests unitaires verts : provider-credential-service (13), admin-sourcing-credentials-route (9), autopilot, projection, registre, dispatch, CJ, Allegro.

### Fait depuis (commits suivants)

- Tests réel-DB : `tests/integration/provider-credential-vault-real-db.test.js` (10 cas : chiffrement, IV, rotation atomique, refus = ancien intact, mauvaise clé, enveloppe altérée, révocation, CHECK) ; parcours CJ complet dans `sourcing-source-registry-real-db.test.js`. Postgres local : dump `docs/db/railway-live-schema.sql` + `scripts/ci-migrate.js` ; le dump est en retard sur 255–259 et sur certaines colonnes (appliquer `migrations/22x–25x` à la main sur la base jetable).
- Clean-room : `provider_credentials` préservée + test.
- UI : panneau d'identifiants dérivé de `source.auth` (carte + assistant), secrets `type=password` jamais préremplis ni conservés en mémoire JS, saisie en cours protégée du rafraîchissement ; spec `tests/e2e/import-runtime-credentials.spec.js` (CJ, remplacement, OAuth, erreur) ; 65/65 specs import-runtime vertes (`@playwright/test` installé hors dépôt, ex. `/var/tmp/pw`, avec `executablePath` chromium).
- OAuth AliExpress : callback relie la session aux sources (`linkSessionToSources`), routes OAuth sans message brut, état de session lu en direct (session absente = À CONFIGURER).
- Gouvernance : cartes de features (sourcing, dashboard), SCHEMA.md (migration 262 + bloc schema-pending), sorties régénérées (arch graph, FEATURE_360, SECURITY_360) ; `feature:360:check`, `gate:schema(:full)`, `gate:touched-files`, `gate:docs-lint`, `check-schema-intent-doc --base origin/main --head HEAD`, `arch-schema-drift-check`, `arch-header-sql-check` verts.

### Reste à faire (ordre)

1. **Autorisation Allegro depuis l'UI** (non fait) : flux OAuth serveur (state CSPRNG en cookie httpOnly, échange du code côté serveur, jetons chiffrés dans `supplier_oauth_connections`, `linkOAuthSession`) ; aujourd'hui le refresh token Allegro s'obtient hors UI. Ajouter alors le parcours E2E « OAuth Allegro ».
2. **Migration des connexions existantes** (env → coffre) : après validation staging, jamais dans cette PR.
3. **PR** (API GitHub, sections Pourquoi / Quoi / Tests, dépendance à #1997) ; vérifier le CI.
4. Dette hors chantier, constatée sur la branche : `arch:gate` rouge sur `check-currency-format` (migrations 235 et 259) et `check-currency-truncation` (87 > cliquet 86, `services/cost-allocation/variance.js`) ; `tests/unit/logger.test.js` (18 échecs) ; orphelins `.github/workflows/*` du registre de features.

### Points d'attention

- `tests/unit/logger.test.js` : 18 échecs déjà présents avant ce chantier (vérifié en retirant le changement de `utils/logger.js`) ; non traités ici.
- `IS_ACTIVE` / `INACTIVE_REASON` du connecteur CJ sont encore calculés depuis l'env au chargement ; la disponibilité du registre CJ est maintenant `true` (la clé relève de la source).
- Suivi opérateur, hors PR : appliquer les migrations 260/261/262 sur Railway, définir `KOMERCE_PROVIDER_CREDENTIALS_MASTER_KEY`, `npm run schema:promote:write` après confirmation live, test réel fournisseur sur staging, puis seulement migrer les connexions existantes du repli env vers le coffre.

## MARKET-CONTROL-PLANE — Un seul plan de contrôle des marchés — EN COURS — 2026-10-03

Mission : « Créer un nouveau marché » en un clic, cohérent jusqu'aux utilisateurs, rôles et droits. Règle : aucune nouvelle primitive si une primitive existante peut être étendue. Aucune nouvelle table ; cinq migrations qui étendent l'existant. Plan complet figé ci-dessous (ne pas rouvrir sans fait nouveau) ; une hypothèse fausse du dépôt = s'arrêter et proposer l'ajustement minimal (AGENTS.md §9).

### Fait (mergé sur main)

- PR #2076 (A1) : `gen-security-360` expose `marketGuards` + `file` par route ; `npm run market:guard-inventory [-- --checklist|--json]` (dérivé, non committé). Mesure : 13 fichiers / 76 routes sous les gardes legacy `require-market-scope` ; 52 routes avec autorité centrale explicite (domaines dashboard et pricing), 24 routes par rôle seul (hub 4, hub-dashboard 7, relay-dashboard 7, admin/partners 6).
- PR #2078 (A2) : `GET /api/admin/markets` et `/:marketCode/control-plane` (admin central déclaré, lecture seule), `services/market-control-plane.js` (`computeGaps`, 9 codes d'écart), carte `market-control-plane`. UNKNOWN contrat inchangé (22).
- **C1 faite (#2083, mergée)** : migration 270 (`capability_registry.effect` READ|ACT + `amount_bearing`), 45 effets déclarés, pricing.simulate et hub.supervise = ACT (confirmé). **C2 faite (#2085, mergée)** : autorité centrale déclarée (`CENTRAL_AUTHORITY`), `services/central-authority.js`, `GET /api/admin/markets/central-authority`. **B + B2 faits (#2089 mergée)** : provisioning partagé par script/route, suppression de `grantOrReplaceMarketScope`, migration 271 et révocations via memberships ; `operator_market_scopes` est désormais projection de compatibilité seulement. **D1 fait (#2090 mergée)** : transitaire lié à exactement un marché via membership ; `logistics.read` pour lire, `execution.transit.confirm` pour confirmer le transit ; migration 272. **D2 fait (#2091 mergée)** : Finance / Comptabilité ne dépend plus de `require-market-scope` ; `finance.read` porte la lecture, `finance.act` les validations/contestations, agent_relais reste borné par `relais_id` serveur. **D3 fait (#2092 mergée)** : Workspace Opérations ne dépend plus du scope legacy ; `operations.read` porte la lecture, chaque mutation exige son `execution.*` exact, agent_relais reste borné par `relais_id`. **D4 fait (#2093 mergée)** : Hub terrain + Hub Dashboard ne dépendent plus de `require-market-scope` ; `operations.read` borne les lectures pays et `hub.supervise` les gestes incident/escalade/commentaire, tandis que `admin`/`agent_hub` gardent leur frontière Hub centrale. **D5 fait (#2094 mergée)** : Relay Dashboard ne dépend plus du scope legacy ; `operations.read` porte les lectures pays, `hub.supervise` les mutations de supervision, agent_relais reste borné par `relais_id`. **D6 fait (#2097 mergée)** : les Entity 360 ne dépendent plus de `require-market-scope` ; Client Index/360 utilisent `client.read`, Product 360 `catalog.read`, Order 360 `operations.read`, avec `dashboard.global.read` comme alternative centrale explicite. **D7 en cours** : Dashboard Market Canonical retire le scope legacy ; Pilotage/Commerce/Orders utilisent `dashboard.market.read`, Operations `operations.read`, Finance `finance.read`, avec autorité globale explicite inchangée. **Gap D Partners** : aucune capability existante ne couvre honnêtement le registre historique multi-types `partners`; ne pas détourner `provider.manage`.
- Outillage d'agents (pre-push à tampon, `agent:context --handoff`, checkpoint `wip/*`) : voir AGENTS.md §4, §7, §7.1.

### Constats vérifiés

- Le passe-droit des rôles centraux n'est pas une faille : l'accès de `admin` et `agent_hub` aux 24 routes par rôle est documenté (GAP-1/2/3, le Hub est un nœud physique central) ; `agent_relais` est borné par `relais_id`.
- Avant D1, `agent_transitaire` n'était rattaché à aucun marché : `routes/transitaire-api.js` était gardé par rôle seul et le workspace Expéditions & Douane le traitait comme rôle natif. D1 ferme ce trou par membership unique + capabilities ; `customs_shipments.market_id` reste la vérité douane.

### Décisions (validées par l'utilisateur, 2026-10-03)

- **Q4** : sur hub, relay-dashboard, hub-dashboard et partners, `admin` et `agent_hub` sont déclarés « centraux par rôle » dans le registre de C (visibles dans la vue du Control Plane), non supprimés. Les 52 routes à autorité explicite gardent l'autorité explicite.
- **Transitaire** : un transitaire = exactement un marché. Il entre dans le périmètre de D (le plan v2 l'avait classé hors périmètre à tort). Modèle recommandé : membership sur l'affectation du marché + capacités d'exécution (cohérent avec « `users.role` n'accorde jamais de droit »). Alternative : colonne `users.market_id`, comme `relais_id`. **Changement d'autorité : revue humaine avant merge.** Test de refus obligatoire : un transitaire du marché A est refusé sur B (`transitaire-api`, espace Expéditions & Douane).
- **F1** responsable opérationnel désigné : `assignment_memberships.is_operating_lead`, au plus un ACTIVE par affectation (index unique partiel) ; aucun droit implicite.
- **F2** référent central : `market_operating_assignments.central_referent_user_id` ; ne tire aucun droit de la désignation, doit détenir une autorisation centrale active.
- **F3** limites financières par capacité (`limit_amount` sur plafond et membership, jamais global) ; capacités `amount_bearing` en V1 : `execution.cash.confirm`, `settlement.receive`, `finance.act` ; par opération, devise du marché ; limite membership ≤ plafond ; refus `MARKET_CAPABILITY_LIMIT_EXCEEDED` ; NULL au plafond = sans limite (marchés existants), exigé sur un nouveau marché.
- **F4** cycle de vie `markets.lifecycle_status` : PROVISIONING / ACTIVE / SUSPENDED / CLOSED, `is_active = lifecycle IN (ACTIVE, SUSPENDED)` imposé en base ; READ délégué en ACTIVE et SUSPENDED, ACT délégué en ACTIVE seulement (`MARKET_SUSPENDED`) ; chaque capacité déclare `effect` READ ou ACT (jamais déduit du nom) ; seul le service de transitions écrit ; chaque transition tracée.
- Modèle d'autorité unique : `autorisé(X,M,C,A) = central(X,C) OU délégué(X,M,C,A)`. Jamais source de droit : `users.role`, `operator_market_scopes` (projection), `market_cash_control_policies`.
- Hypothèses non renversées : Q1 responsable = une personne ; Q3 un référent central par affectation ; Q5 services et API admin d'abord, écran en PR H.

### Ordre d'exécution

A2 → C → B → D réduite (transitaire inclus) → E → F → G → H. Dépendances : A2 d'abord ; B et C indépendantes ; D dépend de C ; E dépend de B ; F indépendante ; G dépend de E et F ; H dépend de G. Une PR = un seul push après `pr:preflight` vert.

- **A2 Voir (FAIT, #2078)** : `services/market-control-plane.js` (lecture seule), `GET /api/admin/markets`, `GET /api/admin/markets/:code/control-plane`, rapport d'écarts sur KM, YT, CM, CG (référence de non-régression) ; crée la carte `market-control-plane` (la carte `market` est un référentiel pur figé). Sans migration : merge autonome possible.
- **C** : registre `config/market-delegation-capabilities.js` : chaque capacité de groupe pointe vers sa table `*_global_access_grants` ; colonnes `effect` et `amount_bearing` ; fonction unique `central(X,C)` ; rôles centraux par rôle déclarés (Q4).
- **B** : logique de `scripts/provision-market-operator.js` extraite en service, utilisée aussi par `routes/admin/users.js` ; suppression de `grantOrReplaceMarketScope` (M1).
- **D** : les 13 fichiers migrent de `require-market-scope` vers les capacités, par domaine ; liste de contrôle = `npm run market:guard-inventory -- --checklist` entièrement cochée avant merge (garde avant/après, test de refus, comptes à autoriser) ; suppression du middleware en fin de D.
- **E** (M2, M3, M4) : responsable désigné, durée et suppléance, limites, référent central, invitation WhatsApp du premier responsable, journal étendu au marché. **F** (M5) : cycle de vie, refus de commande en SUSPENDED, textes boutique en base. **G** : `provisionMarket` + porte de préparation à deux verdicts (plate-forme, exploitation) + `POST /api/admin/markets`. **H** : écran canonique « Créer un nouveau marché », E2E de la base vierge à la première commande.
- Migrations (numéros au moment de chaque PR, prochain libre via `arch:impact`) : M1 `operator_market_scopes` CHECK `projected_from_membership_id IS NOT NULL` NOT VALID ; M2 `market_delegation_audit.market_id` ; M3 colonnes référent / responsable / `effective_until` / suppléance / `limit_amount` ; M4 `market_team_invitations` (`phone_e164`, `channel`, `invited_by_user_id`, `grants_operating_lead`, email facultatif) ; M5 `markets.lifecycle_status` + `storefront_texts jsonb`. Toute PR avec migration ou changement d'autorité : revue humaine (AGENTS.md §4.1), preuve rouge PostgreSQL pour chaque migration.

### Reprise par l'agent suivant

1. Lire AGENTS.md puis cette section seulement ; partir de `main` à jour.
2. `npm run agent:context -- --pack authz --feature market-delegation` puis `npm run arch:impact -- market-delegation` ; `npm run market:guard-inventory` pour la portée de D.
3. B2 (#2089), D1 (#2090), D2 (#2091), D3 (#2092), D4 (#2093) et D5 (#2094) sont mergées. Séquence active : **D par domaine**, D6 Entity 360, puis le reste de D jusqu'à inventaire legacy zéro ; ensuite E, F, G, H. Annoncer le plan d'attaque, implémenter, `npm run pr:preflight`, un seul push, attendre la CI en une commande ; merger si sans migration ni changement d'autorité, sinon revue humaine.
4. Session interrompue : `npm run agent:restore -- <branche>`.
5. Suivis ouverts : mesurer la parité du preflight mi-octobre 2026 (base : 16,3 % des runs CI rouges sur une étape reproductible localement) ; l'exception d'accolades expire le 2026-11-02 ; supprimer côté GitHub les branches `feat/agent-guardrails` et `fix/ci-migration-baseline-full-history` (les sessions ne peuvent pas supprimer de branche).
