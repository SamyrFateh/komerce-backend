# O7.1 — Ownership Analysis (avant remédiation)

> Rédigé intégralement AVANT toute modification de code métier, conformément à la règle §6 du prompt O7.1. Les quatre verdicts ci-dessous sont la seule autorité pour la remédiation qui suit.

Baseline O6 (post-merge `main`, commit `b7cf561a`) : 94 `OBSERVED_UNDECLARED`, 18 `CROSS_FEATURE_DIRECT_IMPORT`, 22 exceptions, **4 `ownership-review`**, 4 cycles runtime.

---

## CAS A — `auth-identity -> orders`

| Champ | Valeur |
|---|---|
| pair | `auth-identity -> orders` |
| consumer file | `services/authkey-client.js` |
| provider file | `services/invoice-public-token.js` |
| consumer service réel | Client bas niveau pour l'API WhatsApp Business du fournisseur tiers **authkey.io** — envoi de notifications WhatsApp (commande créée, paiement confirmé, expédiée, livrée, annulée, panier abandonné, facture prête, OTP). Aucune logique d'authentification ou d'identité. |
| provider service réel | Signature d'URL publique de facture (token non-devinable pour lien public), doctrine `lien_facture_public_non_devinable` |
| callers principaux de `authkey-client.js` | `services/notifications/internals.js` (`require('../authkey-client')`, ligne 31), et déclaré `@depends` par `notifications/parcel.js`, `notifications/order.js`, `notifications/misc.js`, `notifications/otp-auth.js`, `notifications/loyalty.js` — **100% des callers vivent dans `services/notifications/`** |
| db reads | aucune (le fichier ne fait que des appels HTTP sortants vers authkey.io) |
| db writes | aucune |
| lifecycle touché | aucun — pur adaptateur de transport sortant |
| current consumer owner | `auth-identity` (`features/auth-identity.feature.js`, `files.services`, ligne 44 ; test associé ligne 61) |
| current provider owner | `orders` (`features/orders.feature.js`, `files.services`, ligne 63) — confirmé correct, non contesté |
| evidence supporting current ownership | Le nom du fichier contient « authkey » |
| evidence contradicting current ownership | **(1)** « AuthKey » est le nom du fournisseur tiers d'API WhatsApp (authkey.io) — collision de vocabulaire avec « auth » (authentification), pas une relation de domaine. **(2)** Le header `@komerce-arch` du fichier lui-même déclare `@domain auth-identity` mais **le contenu entier du fichier est un client de notification WhatsApp** (WID de templates order/payment/invoice/OTP, whitelist de staging, parsing de numéros internationaux) — aucune ligne ne touche à l'authentification. **(3)** Le manifest `auth-identity` déclare lui-même dans `perimeter.out` : *« logique métier propre à chaque feature consommatrice — auth-identity ne sait rien des commandes, paniers ou paiements »* — contredit directement par le contenu du fichier (WID `ordercreated`, `paymentconfirmed`, `ordershipped`, `invoiceready`…). **(4)** 100% des callers réels sont dans `services/notifications/*`. **(5)** Le manifest `notifications` déclare explicitement « envoi WhatsApp via Meta » dans son périmètre et possède déjà un fichier structurellement identique (`services/whatsapp-meta.js`, adaptateur externe WhatsApp analogue, `@domain notification`, `@layer external-adapter`). |
| **verdict** | **`REHOME_CONSUMER`** |
| rationale | `services/authkey-client.js` n'a jamais eu de raison métier d'appartenir à `auth-identity` — le rattachement vient d'une collision de nom entre « AuthKey.io » (fournisseur WhatsApp tiers) et « auth » (authentification). Le fichier est un adaptateur de notification sortante, structurellement et fonctionnellement identique à `services/whatsapp-meta.js` déjà possédé par `notifications`. Le provider `orders` (via `invoice-public-token.js`) est correct et n'est pas en cause. |
| exact remediation | Déplacer l'ownership (Feature Card, pas le fichier physique) de `services/authkey-client.js` + `tests/unit/authkey-client.test.js` : `auth-identity` → `notifications`. Corriger le header `@komerce-arch` (`@domain auth-identity` → `@domain notification`, `@layer service` → `external-adapter` pour cohérence avec `whatsapp-meta.js`, `@impact-areas auth` → refléter l'usage réel). Après rehome, la paire `auth-identity -> orders` disparaît des `OBSERVED_UNDECLARED` (plus de fichier auth-identity qui importe `invoice-public-token.js`) ; une nouvelle relation `notifications -> orders` apparaît à la place — à observer et classifier par O6 au prochain run (pas de modification de l'observer). |

---

## CAS B — `platform-ops -> economic-engine`

| Champ | Valeur |
|---|---|
| pair | `platform-ops -> economic-engine` |
| consumer file | `routes/modules.js` |
| provider file | `services/pricing-engine.js` |
| consumer service réel | Route exposant une ligne de produits sur-mesure distincte du catalogue standard : couture (tissu + confection selon mensurations), lunettes (ordonnance → montage), construction (matériaux finition), cosmétiques. CRUD actif sur `fabrics`/`garment_models`, calcul de prix propre pour la plupart des sous-cas (tissu × mètres + accessoires). |
| provider service réel | `pricing-engine.recommend()` — moteur de recommandation de prix générique (catégorie, quantité, canal) |
| callers principaux | `routes/modules.js` uniquement, pour **un seul sous-cas** (`module_type='couture'`, `module_order_type='custom_from_fabric'`) sur ~4 modules × 3 sous-types |
| db reads | `fabrics`, `garment_models`, `products` (déclaré header) |
| db writes | `fabrics`, `garment_models` |
| lifecycle touché | aucun lifecycle métier engageant — configuration/CRUD |
| current consumer owner | `platform-ops` (`features/platform-ops.feature.js`, `files.routes`, ligne 47) |
| current provider owner | `economic-engine` — confirmé correct, non contesté |
| evidence supporting current ownership | `routes/modules.js` fait du CRUD et de la logique métier propre (registre de modules, calcul tissu/accessoires, sous-types) totalement étrangère à `pricing-engine.js` — ce n'est structurellement pas un fichier `economic-engine` mal étiqueté. |
| evidence contradicting current ownership | **Aucune contre `economic-engine` spécifiquement.** En revanche, `platform-ops.feature.js` documente lui-même, depuis le Lot O2 (`debt.knownGaps`, gap « CONSERVÉ (2026-07-12, Lot O2) »), une ambiguïté **déjà connue et délibérément non tranchée** entre `platform-ops` et **`catalog`** sur `routes/modules.js` : *« Le service réel doit être rechallengé contre catalog / product configuration. […] Aucun split, retag de routes/modules.js, déplacement de table ou nouvelle feature décidé ce lot »*. Cette dette est **hors du périmètre de la question O7.1** posée ici (qui porte sur `economic-engine`, pas `catalog`) et une décision antérieure a explicitement refusé de la trancher. |
| **verdict** | **`OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`** |
| rationale | Sur la question précise posée par O7.1 (le fichier appartient-il en réalité à `economic-engine` ?) : non. `routes/modules.js` ne fait que déléguer à `pricingEngine.recommend()` pour un calcul de prix ponctuel dans un sous-cas parmi plusieurs — une consommation métier réelle et légitime d'un service transversal, pas un fichier mal rattaché à `economic-engine`. La question distincte et déjà documentée « platform-ops vs catalog » est une dette préexistante, délibérément différée par une décision antérieure (Lot O2) — O7.1 ne la rouvre pas (elle ne concerne pas le provider `economic-engine` mis en cause ici, et la trancher serait sortir du périmètre étroit de cette mission, voire empiéter sur un O7.2/O7.3 non commencé). |
| exact remediation | Aucune. La paire reste dans le ledger O6, décision mise à jour de `ownership-review` vers une décision de boundary (`internal-api-required`) — la prochaine action sera une internal API entre `platform-ops`/`modules` et `economic-engine`, traitée en O7.2+. La dette `platform-ops` vs `catalog` reste explicitement hors scope, déjà trackée dans `features/platform-ops.feature.js`. |

---

## CAS C — `platform-ops -> logistics`

| Champ | Valeur |
|---|---|
| pair | `platform-ops -> logistics` |
| consumer file | `services/simulator/state-advancer.js` |
| provider file | `services/parcel-operations.js` |
| consumer service réel | Moteur d'exécution des transitions du simulateur d'exploitation (`/api/simulator/start|status|stop|cleanup|journal`, surface admin) — orchestre un scénario chronométré (paiement → colis → expédition → transit → arrivée → collecte / annulation / remboursement / incidents chaos) en pilotant les **vraies fonctions backend**, jamais d'écriture directe sur les colonnes de lifecycle. |
| provider service réel | `transitionParcelStatus()` — fonction canonique de transition d'état d'un colis, SSOT logistics |
| callers principaux | `services/simulator/engine.js` → `routes/simulator.js` → surface admin `/api/simulator/*` |
| db reads | `order_items`, `orders`, `parcels` (header `@db-read`) |
| db writes | `notification_log`, `orders`, `parcel_items`, `parcels`, `scans`, `store_credits` (header `@db-write`) — **mais** vérifié ligne par ligne : aucune ligne `UPDATE parcels SET status …` directe dans le fichier ; tout passage par le statut colis passe exclusivement par `require('../parcel-operations').transitionParcelStatus(db, parcel.id, targetStep, { skipValidation: true })` |
| lifecycle touché | `parcels.status` — jamais écrit directement, toujours via `transitionParcelStatus()` |
| current consumer owner | `platform-ops` (`features/platform-ops.feature.js`, `files.services`, ligne 45) |
| current provider owner | `logistics` — confirmé correct, non contesté |
| evidence supporting current ownership | Le fichier est exposé exclusivement via une surface d'API opérateur dédiée (`/api/simulator/*`, `routes/simulator.js`, lui-même possédé par `platform-ops`) — un outil d'exploitation/démo, pas une fonctionnalité client. `platform-ops.feature.js` documente déjà et **accepte explicitement** ce pattern comme invariant : *« le simulator écrit dans les tables d'autres features par design de simulation »*. Le fichier ne revendique jamais l'autorité du lifecycle : chaque transition de statut colis passe par la fonction canonique `logistics` avec un flag `skipValidation` explicite (pas un contournement silencieux). |
| evidence contradicting current ownership | Aucune trouvée. Le fichier insère directement dans `scans` (table journalière, pas un lifecycle à SSOT unique) — cohérent avec un rôle d'orchestrateur, pas de propriétaire. |
| **verdict** | **`OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`** |
| rationale | Doctrine « WRITER != LIFECYCLE OWNER » strictement respectée : `state-advancer.js` déclenche des transitions colis mais ne les valide/possède jamais lui-même — il délègue systématiquement à `transitionParcelStatus()`, la fonction SSOT de `logistics`. Le fichier appartient légitimement à `platform-ops` (surface simulateur/exploitation, déjà documentée et acceptée), et sa consommation de `logistics` est réelle et légitime, pas un mauvais rattachement. |
| exact remediation | Aucune. Décision ledger mise à jour vers `boundary-to-break`/`internal-api-required` selon la convention O6 — reste ouvert pour O7.2+. |

---

## CAS D — `platform-ops -> orders`

| Champ | Valeur |
|---|---|
| pair | `platform-ops -> orders` |
| consumer file | `services/simulator/state-advancer.js` (même fichier que CAS C, relation analysée séparément vers `orders`) |
| provider file | `services/order-status-machine.js` |
| consumer service réel | Identique au CAS C — orchestrateur de simulation, surface admin `/api/simulator/*` |
| provider service réel | `transitionOrderStatus()` — state machine SSOT du statut de commande (`orders.status`) |
| callers principaux | Identique au CAS C |
| db reads | `orders` (statut, mode paiement, `payment_status`, `total_kmf`, `user_id`) |
| db writes | `orders` — **deux écritures directes identifiées** : `UPDATE orders SET payment_status = $1 …` (action chaos `desync_payment`, ligne ~110, désynchronisation intentionnelle pour test de résilience) et `UPDATE orders SET payment_status = 'paid' …` (dans `confirmPayment`, avant l'appel à `transitionOrderStatus`). **Aucune** écriture directe sur `orders.status` (le vrai lifecycle) — toujours via `transitionOrderStatus()`. |
| lifecycle touché | `orders.status` — jamais écrit directement. `orders.payment_status` est écrit directement, mais cette colonne est déjà écrite par de nombreux autres services cross-feature dans le code existant (`services/admin-order-refund.js`, `services/cash-operations.js`, `services/create-stripe-order-intent.js`, `services/confirm-pickup-cash-payment.js`, etc.) — ce n'est pas une colonne à propriétaire unique/lifecycle SSOT comme `status`, donc l'écriture directe ici est cohérente avec l'usage établi ailleurs dans le code, pas une violation d'ownership propre à ce fichier. |
| current consumer owner | `platform-ops` — même fichier, même surface simulateur |
| current provider owner | `orders` — confirmé correct, non contesté |
| evidence supporting current ownership | Identique au CAS C : surface simulateur admin dédiée, doctrine WRITER != LIFECYCLE OWNER respectée pour le champ `status`, invariant déjà documenté et accepté dans `platform-ops.feature.js`. |
| evidence contradicting current ownership | Aucune. L'écriture directe de `payment_status` (chaos + confirmation) ne constitue pas une prise d'autorité lifecycle : c'est une colonne à écriture partagée établie dans tout le code, et le cas `desync_payment` est *intentionnellement* un test de résilience qui ne peut pas passer par la state machine canonique par construction (il simule un état invalide). |
| **verdict** | **`OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED`** |
| rationale | Même raisonnement que CAS C, transposé à `orders` : `state-advancer.js` ne revendique jamais l'autorité sur `orders.status`, toujours délégué à `transitionOrderStatus()`. Les écritures directes de `payment_status` sont cohérentes avec le reste du code (colonne à écriture partagée, pas un lifecycle SSOT) et ne remettent pas en cause l'ownership du fichier ni celui du provider. |
| exact remediation | Aucune. Décision ledger mise à jour vers `boundary-to-break`/`internal-api-required` — reste ouvert pour O7.2+. |

---

## Synthèse des quatre verdicts

| Pair | Verdict | Action O7.1 |
|---|---|---|
| `auth-identity -> orders` | `REHOME_CONSUMER` | Déplacer l'ownership de `services/authkey-client.js` + son test vers `notifications` |
| `platform-ops -> economic-engine` | `OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED` | Aucune (ledger mis à jour) |
| `platform-ops -> logistics` | `OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED` | Aucune (ledger mis à jour) |
| `platform-ops -> orders` | `OWNERSHIP_CONFIRMED_BOUNDARY_REQUIRED` | Aucune (ledger mis à jour) |

Un seul rehome (CAS A) est justifié par les preuves. Les trois autres cas confirment une ownership déjà correcte des deux côtés — la doctrine WRITER != LIFECYCLE OWNER est vérifiée ligne par ligne, pas supposée. `ownership-review = 0` sera atteint sans sur-corriger : 3 cas deviennent des dépendances réelles reclassées, 1 cas est corrigé à la source.
