# Mobile Money Payment — contrat canonique Komerce

Statut : **Phase 1 — socle provider multi-marché**  
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