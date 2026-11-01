# Contrat du journal financier (Lot 5) — 2026-11-01

Décision propriétaire : journal d'abord ; pivot EUR immédiatement après la définition du contrat ; Finance et Comptabilité lisent ensuite des projections cohérentes du même journal.

## Ce que c'est / n'est pas
Un **journal de mouvements** (un fait métier projeté = une ligne), pas une comptabilité en partie double : aucun compte débit/crédit. Les tables métier restent l'autorité ; le journal ne les corrige jamais.

## Modèle (`financial_movements`, migration 359)
| Champ | Règle |
|---|---|
| `movement_key` | `source_kind:source_id:facet`, unique → projection **idempotente** |
| `direction` | `inflow` (encaissement) · `outflow` (décaissement) · `cost` (coût économique, pas de flux de trésorerie) |
| `category` | sale, refund, supplier_purchase, supplier_refund, payment_fee, market_settlement, `cost:<type>` |
| `state` | planned → committed → observed → settled → reversed (**sans recul**, trigger SQL) |
| natif | `amount_native` + `currency` : **immuables** |
| EUR | `amount_eur`, `fx_status` (snapshot · converted · native_eur · unavailable), `fx_legs` (taux historiques figés), `fx_as_of` : posés une fois, **figés** |
| liens | market, order, purchase_order, shipment, parcel, supplier, relais |
| `provenance` | table source, référence, `origin_kmf` : obligatoire |
| pièces | `financial_movement_documents` (type + référence, sans doublon) |

## Sources branchées (projecteurs)
| Source | Mouvement | État |
|---|---|---|
| `orders` payées (hors simulation) | inflow `sale` | settled ; natif = montant marché du `fx_snapshot` sinon KMF ; EUR = snapshot sinon `total_eur` capturé sinon autorité |
| `refunds` | outflow `refund` | completed → settled, pending → committed ; EUR = `amount_eur` calculé au prorata du capturé |
| `supplier_execution_payments` | outflow `supplier_purchase` facet `commitment` | prepared → planned, requested/ambiguous → committed, succeeded → observed |
| `supplier_payment_settlements` | outflow `supplier_purchase` / inflow `supplier_refund` + facet `fees` | settled ; pièce = `proof_ref` ; EUR par l'autorité à la date du règlement |
| `order_item_real_cost_allocations` | cost `cost:<type>` | observed |
| `market_settlements` | outflow `market_settlement` | REQUESTED → committed, PAID/RECEIVED → settled |

Hors périmètre volontaire : la **garde des espèces** (`cash_*`, registre dédié `287/289/304`) — mouvement de custody, pas économique ; son rapprochement avec les encaissements cash est un contrôle de la Comptabilité, pas un doublon dans le journal.

## Conversion EUR
Unique autorité `services/fx-authority.js` (EUR pivot, rationnel exact, un arrondi half-even). Priorité : snapshot de transaction (jamais reconverti) → EUR capturé → conversion à `occurred_at`. Taux absent/périmé → `fx_status = unavailable`, **EUR NULL, jamais estimé** ; rattrapable une seule fois (`recordMovement` rejoué avec preuve). Aucune addition directe de devises natives : les agrégats EUR n'additionnent que les EUR connus et déclarent `eur_unavailable_movements`.

## Réconciliation (preuve avant validation)
`reconcileWithSources` : encaissements journal = Σ `orders.total_kmf` payées ; remboursements, coûts alloués, règlements fournisseur = leurs tables ; aucun mouvement sans provenance. Test PG16 : `tests/integration/financial-journal-postgres.test.js` (idempotence, immuabilité, conflit, EUR rattrapable, égalité avec l'agrégat dashboard `getCAEncaisse`).

## Suite
1. Vue Finance : lecture `summarize` (états planned/committed/observed/settled/remaining, EUR par marché, native conservé).
2. Comptabilité : onglets Synthèse / Journal / Rapprochements / Pièces sur ce journal.
3. Planification de la projection (job) et alerte sur `conflicts` / `eur_unavailable`.
