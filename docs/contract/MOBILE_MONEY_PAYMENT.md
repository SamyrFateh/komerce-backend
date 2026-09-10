# Mobile Money Payment — contrat canonique Komerce

Statut : **Phase 1 — socle provider multi-marché + checkout boutique câblé**  
Marchés initiaux : `CM` (Cameroun), `CG` (Congo-Brazzaville)

## Doctrine

`mobile_money` est un **mode de paiement Komerce**. Orange Money, MTN MoMo et les autres opérateurs sont des **providers**.

Le provider n'est jamais encodé dans `payment_mode` :

- `payment_mode = mobile_money`
- `payment_provider = orange_money | mtn_momo | ...`
- l'autorisation du provider dépend du `market_id` / `market.code`

Cette séparation évite les valeurs pays/opérateur du type `orange_money_cm` et permet d'ajouter un opérateur ou un marché sans réécrire le coeur de commande.

## Matrice initiale

| Marché | Devise | Provider | État |
|---|---|---|---|
| `CM` Cameroun | XAF | `orange_money` | activable dès credentials marchand Orange |
| `CG` Congo-Brazzaville | XAF | `mtn_momo` | activable dès credentials Collections MTN |

Les providers restent **fail-closed** : absence de credentials/configuration = moyen de paiement indisponible, jamais fallback silencieux vers cash/Stripe.

## Checkout boutique

Le checkout ne déduit jamais le provider depuis `?market=` ni depuis un contexte de prévisualisation frontend.

1. Le client choisit un point relais actif.
2. Le backend résout le `market_id` depuis ce `relais_id` : le relais est l'ancre marché autoritative.
3. `GET /api/payments/mobile-money/availability?relais_id=...` expose uniquement le provider réellement activé et configuré pour ce marché.
4. La puce Mobile Money reste masquée ou désactivée si le provider n'est pas disponible.
5. Au Cameroun, le flow Orange Money utilise la redirection provider.
6. Au Congo-Brazzaville, le flow MTN MoMo collecte le MSISDN puis attend l'approbation sur téléphone en production ; en staging Sandbox, MTN simule le résultat et aucune validation réelle sur un wallet n'est attendue.
7. L'écran **Commande confirmée** n'est affiché qu'après `succeeded` confirmé par la réconciliation serveur. Un état `pending` laisse la commande ouverte et ne devient jamais un faux succès.

Toute modification du relais invalide une tentative Mobile Money en cours côté checkout afin qu'une tentative créée pour un marché ne puisse pas être réutilisée après changement de périmètre.

## Cycle canonique

1. Le checkout crée une commande `payment_mode=mobile_money`, `payment_status=pending`.
2. `POST /api/payments/mobile-money/initiate` crée une transaction Komerce et appelle l'adapter du provider autorisé pour le marché.
3. Le provider répond de façon synchrone ou asynchrone ; Komerce conserve l'identifiant externe.
4. Un callback/webhook provider — ou un polling de réconciliation — fait évoluer la transaction.
5. **Seul `services/order-payment-confirmation.js`** confirme le paiement et déclenche le cycle paiement → stock/purchasing.
6. Les callbacks sont idempotents : un même événement / identifiant externe ne peut confirmer deux fois la commande.

## Réconciliation asynchrone

Le callback opérateur est une optimisation de latence, **pas une dépendance de disponibilité**.

- `services/mobile-money-reconciliation.js` sélectionne un lot borné de transactions `initiated | pending` suffisamment anciennes ;
- `bootstrap/crons.js` exécute cette reprise toutes les 2 minutes, par lots de 25 ;
- les appels HTTP provider sont exécutés hors transaction PostgreSQL ;
- les transactions sont reprises séquentiellement pour éviter une rafale vers les APIs Orange/MTN au redémarrage ;
- une erreur provider sur une transaction n'empêche jamais la reprise des suivantes ;
- plusieurs instances peuvent exécuter le mécanisme : la finalisation reste protégée par l'idempotence de `payment-mobile-money` et par le cycle canonique de confirmation.

Ainsi, un callback perdu, un redémarrage du runtime ou une indisponibilité temporaire de l'opérateur ne transforme pas silencieusement un paiement réellement effectué en transaction abandonnée.

## États transaction

`initiated | pending | succeeded | failed | expired`

Le statut provider brut peut être conservé séparément pour l'observabilité, mais il ne devient jamais un statut métier Komerce.

## Données minimales

- `order_id`
- `market_id`
- `provider`
- `msisdn`
- `amount_minor` / devise
- `external_transaction_id`
- `status`
- `provider_status`
- `provider_payload` (sanitisé, sans secret)
- `created_at`, `updated_at`, `completed_at`

## Sécurité / invariants

- aucun secret provider en base ou dans le frontend ;
- secrets uniquement via variables d'environnement Railway ;
- validation stricte du marché, de la devise et du montant serveur ;
- le montant envoyé au provider vient de la commande persistée, jamais du frontend ;
- `display_total_amount` n'est jamais une source d'encaissement ;
- un callback entrant n'est jamais considéré comme preuve de paiement : Komerce relit l'état auprès du provider ;
- idempotence forte par `(provider, external_transaction_id)` ;
- journalisation sans token, API key, secret ou PIN/OTP ;
- aucune mutation directe de stock depuis un adapter provider.

### Exception de transport MTN Sandbox — staging uniquement

Le Sandbox développeur MTN impose `EUR`, alors que le marché Congo Komerce reste canoniquement `XAF`. Il est interdit de modifier le marché, le prix local, la transaction Komerce ou la facture pour satisfaire cette contrainte de test.

Quand `MTN_MOMO_CG_TARGET_ENVIRONMENT=sandbox` **et** que le runtime métier n'est pas `production` :

- la transaction Komerce reste figée dans sa devise métier `XAF` ;
- l'adapter MTN envoie au Sandbox un montant synthétique fixe `1000 EUR` uniquement comme contrat de transport de test ;
- lors de la réconciliation, l'adapter relit le statut chez MTN et exige que le Sandbox reflète bien `1000 EUR` avant d'accepter le statut ;
- le `1000 EUR` n'est jamais promu en montant économique Komerce : il reste uniquement dans le payload provider d'audit ;
- un runtime métier `production` avec une cible MTN `sandbox` est considéré non configuré, donc le moyen de paiement reste fail-closed.

Cette exception n'existe pas sur le rail MTN réel : en production opérateur, montant et devise envoyés et relus sont ceux de la transaction Komerce dans la devise configurée du marché.

## Providers initiaux

### Orange Money — Cameroun

Orange Money Web Payment est disponible au Cameroun. L'accès production nécessite le statut marchand et les credentials délivrés par Orange. L'adapter doit rester désactivé tant que ces éléments ne sont pas présents.

### MTN MoMo — Congo-Brazzaville

MTN Congo expose l'Open API MoMo. `RequestToPay` est asynchrone : acceptation HTTP 202, callback final et interrogation de statut en secours. L'URL de callback doit respecter les contraintes de domaine MTN.

## Hors phase 1

- Airtel Money Congo ;
- remboursements opérateur automatisés ;
- dashboard de rapprochement financier avancé ;
- sélection automatique d'un second provider si le premier échoue.

Aucun fallback automatique entre providers : un échec d'encaissement doit rester visible et explicite.
