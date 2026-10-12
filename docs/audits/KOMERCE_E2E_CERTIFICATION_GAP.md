# KOMERCE — Architecture de certification E2E : état réel et GAP

Base : `main` @ `4e7236ee1` (après #2431). Audit en lecture seule, sans modification de code, sans commit.
Les nombres de tests sont relevés sur `main` (fichiers `*.test.js` / `*.spec.js`, cas `it(`/`test(` approximés par grep). Les durées CI sont mesurées sur les 60 derniers runs verts de `pr-enforcement.yml`.

Niveaux de preuve utilisés dans tout le document :

| Niveau | Nature | Exemple |
|---|---|---|
| L0 | Unitaire / lecture de source | `tests/unit/**` |
| L1 | Service réel + PostgreSQL réel | `tests/integration/*-real-db.test.js` |
| L2 | Route HTTP réelle + PostgreSQL réel, seule la frontière réseau prestataire est simulée | `tests/e2e-api/**` |
| L3 | Navigateur réel, **API simulée** (aucun serveur, aucune base) | gate `test:e2e:dashboards` |
| L4 | Navigateur réel + **serveur réel + PostgreSQL réel**, vraie authentification | `tests/e2e-cash/**` |
| L5 | L4 exécuté contre le **staging déployé** | recette cash (rapportée validée par l'utilisateur) |
| L6 | Prestataire réel (sandbox ou live) | workflows `isolated-cj-p1/p2-*`, Allegro manuels |

Un Golden L2 qui injecte des faits fournisseur n'est **jamais** un L6.

---

## 1. État réel des certifications existantes

### 1.1 Inventaire chiffré

| Suite | Fichiers | Cas (≈) | Niveau | Exécution | Reproduction |
|---|---:|---:|---|---|---|
| Unitaires backend | 1 087 | 10 841 | L0 | PR (complet + couverture) | `npm test` |
| Intégration PostgreSQL | 83 | 654 | L1 | PR, **ciblé par impact** (`integration-impact-scope.js`), sinon fallback complet | `DATABASE_URL=… npm run test:integration` |
| E2E API Feature First | 38 | 168 | L2 | PR, **ciblé par impact** (`e2e-impact-scope.js`) | `DATABASE_URL=… npm run test:e2e:features` |
| Contrats / invariants / notifications | 13 | 98 | L0–L1 | PR | `npx jest tests/contract tests/invariants tests/notifications` |
| Dashboards Playwright (gate officiel) | 17 specs listées dans `playwright.config.js` (23 fichiers dans `tests/e2e`) | 172 | **L3** | PR (job dashboard) | `npm run test:e2e:dashboards` |
| Recette cash multi-utilisateurs | 1 | 10 | **L4 / L5** | **manuelle uniquement** | `npm run test:e2e:cash` (voir en-tête du spec) |
| Boutique (unitaires) | 262 | 2 719 | L0 | PR (job boutique) | `npm --prefix public/boutique run test:unit` |
| Boutique Playwright | ~40 specs | — | L3–L5 | **hors PR** ; audit staging sur issue (`staging-storefront-e2e-audit.yml`) | `npm --prefix public/boutique run test:e2e` |
| Prestataires | ~25 workflows `isolated-*` / `staging-*` | — | L6 partiel | `workflow_dispatch` / issues | GitHub Actions |

Durées CI observées (moyenne / max) : Backend gates 91 s / 186 s ; From-scratch DB + intégration + E2E API 171 s / 242 s ; Dashboard 82 s / 98 s ; Governance 17 s. **Aucun workflow planifié (nightly)** n'exécute de suite fonctionnelle : les seuls `schedule` sont `pr-sweep-behind` et `wip-branch-cleanup`.

### 1.2 Ce que les preuves existantes établissent réellement

- **Chaîne commande (L2)** : `customer-to-customer.golden` (1 cas) prouve que chaque frontière ne devient verte qu'avec **son propre** fait canonique (fulfillment ≠ réception Hub ; parcel `available` ≠ remise ; handoff non prouvé ⇒ pas de clôture). Il **injecte** les faits de chaque frontière puis appelle les vrais réconciliateurs : il ne prouve pas l'enchaînement API → API.
- **Paiement (L2)** : `orders.checkout-payment-cycle` (vrai webhook Stripe signé, rejeu sans double effet), `payments.paypal-*`, `payments.stripe-pipeline-p3`. **Mobile Money : 0 suite L1/L2** (9 fichiers unitaires seulement).
- **Achats / fournisseurs (L1–L2)** : `purchasing.grouped-flow`, `purchasing.no-duplicate-po`, `supplier-execution-*-postgres`, `purchase-lines-*`. La réception physique Hub est en L1 (`hub-physical-*`).
- **Pilotage (L2)** : `dashboard.control-chain-golden` (chaîne ORDER→RELAY, GREEN→RED→GREEN, agrégation structurelle, Order 360 relit la même position).
- **Autonomie Market (L2)** : 10 suites `market-delegation.*`, `market-control-plane.provision-to-first-order`, `settlement.state-machine` (15 cas, refus SQL directs), isolation `dashboard-*-isolation`, `market-scope-isolation`, `market-open-{cameroon,congo,mayotte}`.
- **Garde cash** : L1 (4 suites real-db, dont 24 cas transferts/réception finale/pertes) + **L4/L5** (10 cas multi-acteurs en navigateurs réels). La L4 a trouvé **2 défauts de production** invisibles aux 10 841 unitaires et aux 17 specs L3 : `runAction` supprimée, tableaux de garde écrasés par `DataTable.render`.
- **Dashboards (L3)** : 17 specs couvrent navigation, matrice de rôles, retours contextuels, cockpits Live, Order 360, conformité de mise en page. Elles tournent **sans serveur ni base** : elles prouvent l'interface face à une réponse supposée, jamais la donnée affichée face à la vérité backend. **Finance/Comptabilité n'a pas de spec dédiée dans le gate officiel.**

**Conclusion §1** : la vérité backend est bien prouvée frontière par frontière (L1/L2), et l'interface est bien prouvée en isolation (L3). **La jonction « donnée affichée = vérité backend » n'est prouvée que pour la garde cash (L4).** C'est le trou principal, démontré par les deux défauts trouvés.

---

## 2. Graphe des parcours et transitions critiques

Autorités : statuts commande `services/order-status-machine.js` (`pending → confirmed → ordered → preparation → shipped → in_transit → available → collected`, `cancelled → refunded`) ; paiements, achats, Hub, logistique, garde cash, règlement Market : services propriétaires.

```
CLIENT ─ panier / liste partagée ─▶ COMMANDE (pending)
   │                                   │ webhook PSP / wallet / cash
   ▼                                   ▼
 [T1] paiement client ───────────▶ confirmed ──▶ [T2] achat fournisseur (PO) ──▶ ordered
                                                     │
                                [T3] paiement fournisseur ─ preuve
                                                     │
                                [T4] fulfillment + tracking (≠ réception)
                                                     ▼
                                [T5] réception physique Hub ──▶ preparation
                                                     ▼
                                [T6] expédition / transit / douane ──▶ shipped → in_transit
                                                     ▼
                                [T7] arrivée relais ──▶ available (≠ remise)
                                                     ▼
                                [T8] remise prouvée (QR / nom autorisé) ──▶ collected
                                                     ▼
                         ┌──────────── [T9] encaissement cash relais
                         ▼
     [T10] garde : détention → transfert accepté → réception finale prouvée → contrôle indépendant
                         ▼
     [T11] rapprochement / clôture financière commande ── [T12] règlement Market (READY→REQUESTED→PAID→RECEIVED)
Exceptions transverses : [X1] annulation/remboursement (wallet, carte, cash) · [X2] manquant / écart / incident
                         · [X3] invendus · [X4] rejeu / désordre d'événements · [X5] signal → action → résolution
```

Chaque transition suit la même propagation, qui sert de grille d'assertion :
**commande/API → écriture canonique → événement/outbox → projection → signal → dashboard → action → preuve → réconciliation.**

| Transition | Écriture canonique | Consommateurs (projection / signal / écran) | Permission |
|---|---|---|---|
| T1 | `orders`, `payments`, `order_status_history`, events PSP | Pilotage, Commerce, Order 360 | système (webhook), admin |
| T2–T4 | `purchase_orders`, `purchase_lines`, `supplier_*` | Achats, Control Tower | admin, `agent_hub` |
| T5 | allocations + placements Hub | Hub Live, Control Tower | `agent_hub` |
| T6 | parcels, customs shipments | Opérations, Expéditions & Douane | `agent_hub`, `agent_transitaire` |
| T7–T8 | parcel + `orders.status`, pickup authorization | Relais Live, Order 360 | `agent_relais` |
| T9–T10 | `cash_collections`, `cash_deposits`, `cash_custody_receipts/losses`, vue `cash_custody_movements` | Finance, radar cash, Action Center | Market (`cash.custody.receive`, `finance.act`), central (pertes) |
| T11–T12 | `market_settlements(_events)` | Finance, Règlements | `settlement.*`, central |
| X1 | `refunds`, wallet ledger | Finance, Client 360 | admin, central |
| X5 | `signals` | Action Center, radar | rôle + Market |

---

## 3. Matrice de couverture et niveaux de preuve

Lecture : niveau maximal **réellement atteint** aujourd'hui. « — » = aucune preuve.

| Scénario (classe d'équivalence) | Domaine | Acteurs | Dashboard | API/DB | Écran = vérité | Staging | Prestataire |
|---|---|---|---|:-:|:-:|:-:|:-:|
| Commande payée carte, rejeu webhook | orders/payments | client, système | Pilotage, Order 360 | L2 | — | — | — (Stripe simulé) |
| Commande wallet / cash relais | orders/wallet | client, relais | Commerce | L2 | — | L5 partiel (boutique, hors CI) | n/a |
| Mobile Money | payments | client | Finance | **L0** | — | — | — |
| Achat groupé, reliquat, pas de PO double | purchasing | hub, admin | Achats | L2 | L3 | — | CJ P1/P2 sandbox (manuel) |
| Fulfillment ≠ réception, Hub physique | purchasing/logistics | fournisseur, hub | Hub Live | L1–L2 | L3 | — | — |
| Transit, douane, invendus | logistics/customs | transitaire | Expéditions & Douane | L2 | L3 | — | — |
| Disponible ≠ remise, nom autorisé | orders/auth | relais, client | Relais Live | L2 | L3 | — | n/a |
| Chaîne complète client → clôture | toutes | tous | Control Tower | L2 (faits injectés) | — | — | — |
| Garde cash nominale + refus | payments/cash | agent, collecteur, receveur, contrôleur | Finance | L1 | **L4** | **L5** (rapporté) | n/a |
| Pertes / contre-écritures cash | payments/cash | central | Finance | L1 | — | — | n/a |
| Remboursement / annulation | refunds/wallet | admin, client | Finance, Client 360 | L2 | — | — | — |
| Règlement Market | settlement | Market, central | Finance | L2 | — | — | — |
| Provisioning Market → 1re commande | market-control-plane | central | Administration | L2 | L3 | — | — |
| Isolation Market (KM / CM) | market-delegation | opérateurs | tous | L1–L2 | **L4 (cash, API seulement)** | — | n/a |
| Signal : apparition → action → résolution | decision-signals | rôles Market | Action Center | L1–L2 | — | — | n/a |
| Navigation, rôles, retours contextuels | dashboard | tous | tous | n/a | L3 | — | n/a |

---

## 4. GAP prioritaires

Chaque GAP distingue : **C** = code absent, **T** = test absent, **P** = preuve réelle (L4+/L6) absente.

| # | Type | Source | Risque | Scénario | Assertion | Prio | Suite |
|---|---|---|---|---|---|---|---|
| G1 | T/P | L3 sans serveur ; seul Finance-cash en L4 ; 2 défauts trouvés par la L4 | Écran faux ou action morte en production malgré CI verte | Monde fixture unique, 5 surfaces P0 (Pilotage, Action Center, Opérations, Hub/Relais Live, Finance) ouvertes par l'acteur Market concerné | Total affiché = oracle SQL indépendant ; chaque action visible aboutit (2xx) puis l'écran se rafraîchit | **P0** | Nightly + Release |
| G2 | T | Intégration et E2E API ciblées par impact ; aucun nightly | Régression croisée invisible jusqu'au prochain diff qui touche la zone | Exécution complète planifiée de `test:integration` + `test:e2e:features` + L4 locale | 0 échec, durée bornée, rapport archivé | **P0** | Nightly |
| G3 | T | Golden c2c injecte chaque frontière | Une frontière ne produit pas l'entrée de la suivante via l'API réelle | Un fil unique : `POST /api/orders` → webhook signé → PO → réception Hub → … → remise QR → collecte cash (`POST /api/cash/collect/:orderId`) → garde → clôture | Chaque statut avance **uniquement** par l'appel de sa frontière ; la position Control Tower et Order 360 suivent ; rejeu = 0 effet | **P1** | Nightly / Release |
| G4 | P | Recette cash amorcée par SQL (agent↔relais, encaissement) | La preuve L5 ne couvre pas l'origine réelle du cash | Brancher la recette cash sur la sortie de G3 (encaissement réel) | Détenu agent = encaissement réel ; 100 000 → 60 000 clos + 40 000 en garde | **P1** | Release |
| G5 | T | Isolation prouvée en L1–L2, pas à l'écran | Fuite de donnée inter-Market à l'affichage | Deux Markets (KM, CM) dans le monde G1 | L'opérateur KM ne voit aucune ligne, total ni lien CM, sur chaque surface P0 | **P1** | Nightly |
| G6 | T | Résolution de signal : prouvée par contrat, pas en boucle complète ; second cycle `cash_expiring` non prouvé | Faux vert (résolu sans disparition de la cause) | Cause présente → signal ; action partielle → signal maintenu ; cause disparue → résolu au cycle suivant | Résolution ⇔ cause absente ; aucune résolution sur simple acquittement | **P1** | PR Functional |
| G7 | T | Mobile Money : 0 suite L1/L2 | Double crédit / statut incohérent sur callback | Callback dupliqué, désordonné, en retard, échec puis succès | 1 seul effet financier ; un événement ancien n'écrase jamais un état plus récent | **P1** | PR Functional |
| G8 | T | Injections de fautes dispersées en L0 | Comportement inconnu sur timeout/doublon en chaîne | Table de fautes rejouée sur le fil G3 : doublon webhook, désordre, timeout prestataire, perte de session | Aucun doublon financier ; échec explicite, jamais de succès silencieux | **P2** | Nightly |
| G9 | C | Aucune route officielle de rattachement agent↔relais ; `PUT /api/admin/users/:id/password` répond 500 si aucun hash | Provisioning de certification hors routes officielles | Décision produit, puis correctif ciblé | Provisioning L5 100 % par routes officielles | **P2** | — (décision) |
| G10 | T | Pas de spec Finance/Comptabilité dans le gate L3 | Régression d'interface Finance détectée seulement en L4 manuelle | Spec L3 Finance (rôles, états vides, erreurs serveur) | Rendu conforme pour 3 rôles × états vide / erreur / nominal | **P2** | PR Smoke |
| G11 | P | Stripe, PayPal, Mobile Money jamais en sandbox réelle automatisée ; CJ seulement à la demande | Golden simulé pris pour une preuve Live | Sandbox PSP en Release, sans fonds réels | Paiement sandbox → webhook réel → statut `paid` ; aucun mouvement réel | **P2** | Release (autorisation requise) |

### Redondances à mutualiser (gain CI sans perte de vérité)

- **8 suites « numeric KMF »** (`*-numeric` / `*.kmf-numeric`, 41 cas) prouvent le même invariant de sérialisation sur 8 routes → **une** suite tabulaire (route × champ attendu), même pouvoir de détection.
- `market-open-{cameroon,congo,mayotte}` : même scénario, Market différent → **un** test paramétré.
- Garde cash : `cash-coverage-no-false-green` et la partie « couverture » de `cash-custody-ledger` assertent désormais la même règle (l'historique ne couvre jamais) → fusion.
- Ne pas mutualiser les specs L3 graphiques (`layout-canon-conformance`, `legacy-theme-audit`, `control-tower-visual`) : la conformité graphique reste une preuve distincte.

---

## 5. Architecture minimale : fixtures, oracles, orchestrateurs

Aucun nouveau framework. Trois briques existantes suffisent.

1. **Fixture « monde Market » unique** : extraire de `tests/e2e-cash/cash-custody-multiuser.spec.js` la fonction de seed (déjà bâtie sur `createMarketDelegationFixture`) et la réutiliser pour G1/G3/G5. Deux Markets synthétiques préfixés `E2E-CASH`/`E2E-CERT`, acteurs par rôle, mots de passe et rôles via les routes admin officielles, prévalidation sans écriture (`preflight()`), contrôle des effets externes (`externalEffects()`). Les journaux financiers append-only ne sont **jamais** purgés.
2. **Oracles indépendants** : requêtes SQL écrites dans le test, **jamais** importées du service testé. Contre-exemple présent dans les suites cash : importer `UNCOVERED_COLLECTIONS_CTE` du service n'est pas un oracle ; une somme directe sur les tables de faits (`cash_collections`, `cash_custody_receipts`, `cash_custody_losses`) en est un. Règle : un oracle ne réutilise ni la requête, ni la fonction, ni la vue que l'écran consomme.
3. **Orchestrateurs** : `run-integration-tests.js` et `run-e2e-feature-tests.js` (déjà par processus) ; `playwright.cash-e2e.config.js` (serveur réel) généralisé en un second projet de config, pas en un nouveau runner.

Isolation et parallélisation : un Market synthétique par worker (codes tirés par `randomMarketCode`), `workers: 1` par monde partagé, mondes indépendants en parallèle. Le limiteur de connexion (20 / 15 min) impose de réutiliser les contextes navigateur par acteur dans un même run.
Traces : `report.json` + captures (déjà produits par la L4), artefact CI conservé 14 jours.
Reprise : chaque lot est idempotent par tag de run ; un échec n'efface rien et laisse les faits identifiables.

---

## 6. Plan Sonnet en lots minimaux

Ordonné par réduction du risque et par réutilisation. Durées CI estimées à partir des mesures du §1.

| Lot | Contenu | Réutilise | Modification minimale | Tests attendus | CI | Terminé quand |
|---|---|---|---|---|---|---|
| **S1** | Nightly | `pr-enforcement.yml` (job from-scratch), runners existants | 1 workflow `schedule` qui reconstruit PG puis lance `test:integration` + `test:e2e:features` complets + `test:e2e:cash` contre un serveur local | 0 nouveau test | ~8–12 min/nuit | 3 nuits vertes consécutives, rapports archivés |
| **S2** | Vérité écran P0 (G1 + G5) | seed et oracles de la L4 cash, `preflight`, `externalEffects` | 1 spec L4 « surfaces P0 » : 5 surfaces × (total = oracle, action → rafraîchissement) × 2 Markets | ~12 cas | +2 min (nightly) | Chaque total P0 égal à son oracle ; 0 fuite KM↔CM |
| **S3** | Fil réel de bout en bout (G3 + G4) | `orders.checkout-payment-cycle` (webhook signé), `purchasing.grouped-flow`, `customer-to-customer.golden` (assertions), seed L4 | 1 suite L2 qui enchaîne les routes réelles, puis branche la recette cash sur l'encaissement produit | 1 suite, ~8 cas | +1,5 min (nightly) | Chaque statut avance par sa seule frontière ; détenu agent = encaissement réel |
| **S4** | Signaux en boucle (G6) | `alerts-contract-real-db`, `signal-service` | Cas « cause → signal → action partielle → résolution au cycle suivant » pour cash et logistique | ~4 cas | +20 s (PR ciblée) | Aucune résolution sans disparition de la cause |
| **S5** | Mobile Money + fautes (G7 + G8) | helpers `e2eDbKit`, pattern du rejeu Stripe | 1 suite L2 Mobile Money (doublon, désordre, retard) ; table de fautes appliquée au fil S3 | ~8 cas | +40 s (PR ciblée) | 1 seul effet financier par paiement ; aucun écrasement par événement ancien |
| **S6** | Mutualisation | suites `*-numeric`, `market-open-*`, cash couverture | Fusion tabulaire / paramétrée, suppression des doublons | −11 fichiers, même invariants | −30 à −60 s | Mêmes invariants détectés (mutation contrôlée d'un champ ⇒ échec) |
| **S7** | Spec L3 Finance (G10) | gate dashboard | 1 spec ajoutée à `DASHBOARD_SPECS` | ~6 cas | +10 s (PR) | Rôles × vide / erreur / nominal verts |

S1 à S3 seuls ferment le trou principal. S4–S7 sont incrémentaux. G9 et G11 attendent une décision (§7).

---

## 7. Critères objectifs de certification

Un parcours est **certifié** seulement si toutes les conditions sont vraies, mesurées par une commande reproductible :

1. **Niveau** : la frontière atteint au moins L2 ; chaque surface P0 atteint au moins L4 ; chaque prestataire revendiqué « Live » atteint L6.
2. **Oracle indépendant** : chaque total affiché est égal à une requête SQL du test qui ne partage ni code ni vue avec l'écran.
3. **Propagation** : écriture → projection → écran observée dans le même run, avec un fait daté de ce run (aucun vert sans fait récent).
4. **Négatif** : pour chaque action autorisée, au moins un refus prouvé (rôle, Market, auto-validation, plafond), avec son code métier.
5. **Idempotence** : rejeu de l'événement déclencheur ⇒ 0 effet financier supplémentaire.
6. **Monotonie** : un événement plus ancien ne modifie jamais un état plus récent.
7. **Conservation** : encaissé = clôturé + détenu + perdu, identique pour chaque acteur et chaque écran.
8. **Aucun effet externe** non autorisé (`externalEffects() = 0`), aucune donnée métier existante modifiée, journaux append-only conservés.
9. **Stabilité** : 0 retry ; 3 exécutions vertes consécutives.

---

## Verdict

**Avec notre infrastructure actuelle, pouvons-nous certifier automatiquement toute la chaîne Komerce, y compris les dashboards et l'exploitation autonome des Markets ?**

**Non, pas encore — mais l'écart est petit et ne demande aucun framework nouveau.** Les vérités backend sont prouvées frontière par frontière ; ce qui manque, c'est leur enchaînement réel et la preuve que chaque écran affiche cette vérité.

- **Déjà prouvé** : chaque frontière de la chaîne en L1/L2 (paiement carte avec rejeu, achats groupés, Hub, transit/douane, remise, règlement, provisioning Market, isolation API) ; la garde cash complète en L4, et en L5 selon l'exécution rapportée sur staging ; la navigation et les rôles des dashboards en L3.
- **Certifiable immédiatement avec l'existant** : nightly complet (S1) ; vérité écran des 5 surfaces P0 et isolation KM/CM à l'écran (S2) ; fil API réel de bout en bout et recette cash branchée sur un encaissement réel (S3) ; boucle des signaux (S4) ; Mobile Money et injections de fautes en L2 (S5).
- **Nécessite un staging intégré ou une preuve prestataire** : Stripe, PayPal et Mobile Money en sandbox réelle ; CJ automatisé hors déclenchement manuel ; exécution L5 régulière contre le staging (accès base et compte admin de test dédiés).
- **Nécessite une décision métier ou une autorisation explicite** : route officielle de rattachement agent↔relais (sinon le provisioning reste SQL) ; correction du 500 sur `PUT /api/admin/users/:id/password` ; autorisation d'appels sandbox prestataires en CI ; politique de conservation des faits de recette sur staging (append-only, jamais purgés).
- **Plus petit plan à confier à Sonnet** : **S1 → S2 → S3**, dans cet ordre (environ 3 lots, +4 min de nightly, aucune hausse du temps de PR). S6 peut être mené en parallèle pour **réduire** le coût CI.

---

## 9. Avancement

- **S1 — livré** (#2432, #2433) : `nightly-e2e-certification.yml`, éphémère, niveau L4 local intégré. Critère de sortie : 3 nuits vertes consécutives (à observer).
- **S2 — livré** : `tests/e2e-cash/dashboard-truth.spec.js` (Pilotage, Action Center, Opérations, Hub Live, Relais Live, Finance, Comptabilité ; 2 Markets, 6 rôles ; oracle SQL = API = écran ; 2 actions ; refus, états vides, erreur de lecture). Rapport `test-results/dashboard-truth/report.md`, archivé par le nightly. Défauts corrigés par PR ciblées : #2434 (actions d'Action Center offertes sans droit), #2435 (scans du workspace Opérations en 500 pour tout acteur non-admin). Observations ouvertes : voir le rapport (boutons d'Opérations offerts sans droit ; définitions de « en transit »).
- **S3 — livré** : `tests/e2e-cash/order-to-cash-thread.spec.js` (client → relais → hub → relais → comptabilité → garde, 8 cas, routes réelles ; le cash de la chaîne de garde est celui ENCAISSÉ par le fil, plus injecté). Niveau L4 local intégré : paiement cash relais, logistique portée par les scans applicatifs, aucun fournisseur réel. Défauts corrigés : `received_at` inexistant (500 à toute réception relais), colis hub créés sans destination. Observations à arbitrer : `confirm-cash` du workspace marque payé sans ligne `cash_collections` ; `POST /api/hub-dash/parcels/:id/ship` répond 200 quand la synchronisation échoue ; ship du workspace sans étape « emballé » bloqué par l'incident qu'il crée. Rapport `test-results/order-to-cash-thread/report.md`.
