# LEDGER — état de clôture Komerce

Mis à jour : 2026-09-15

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
