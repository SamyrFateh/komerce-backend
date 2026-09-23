# Doctrine — Relance de panier abandonné

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire proposée** : `notifications` (politique de relance et envoi)
> **Source de données** : `shared-cart` (owner de `baskets`, `basket_items`) — lue **par son contrat public**, jamais par SQL direct
> **Dépend de** : `DOCTRINE_CONSENTEMENT_COMMUNICATION.md` (bloquant), `DOCTRINE_MESURE_AUDIENCE.md` (pour mesurer l'effet)

---

## 1. Phrase de vérité

Rappeler une fois, au bon moment, à un client qui l'a accepté, qu'un panier l'attend. Jamais plus, jamais sans accord, jamais avec une promesse qu'on ne pourra pas tenir.

## 2. Constat dans le code (2026-09-23)

- Des paniers sont **persistés côté serveur** (`baskets` : `owner_id`, `type`, `expires_at`, `is_locked`), owner `shared-cart`.
- **Aucune relance n'existe.** Le seul « abandon » du code est l'annulation automatique des commandes cash impayées — l'inverse d'une relance.
- **Aucun consentement n'existe** : la relance est donc bloquée tant que la doctrine de consentement n'est pas implémentée.

## 3. Conditions d'éligibilité (toutes requises)

1. Consentement `RELANCE_PANIER` = `GRANTED` sur le canal, **vérifié au moment de l'envoi**.
2. Panier rattaché à un client identifié, non vide, non expiré.
3. Aucune commande passée par ce client depuis la dernière modification du panier.
4. Délai minimal écoulé depuis la dernière activité.
5. Aucune relance déjà envoyée pour ce panier.

## 4. Invariants

1. **Une seule relance par panier en V1.**
2. **Aucune promesse de prix ni de stock.** Le message invite à revenir ; prix et disponibilité sont recalculés au checkout, comme toujours.
3. **Arrêt immédiat** si le client commande ou retire son consentement, même si l'envoi est déjà planifié.
4. **Lecture par contrat.** `notifications` ne lit pas les tables de `shared-cart` directement ; il consomme une fonction exposée par `shared-cart`.
5. **Mesurable.** Chaque relance est tracée pour mesurer son effet (commandes issues de relances vs paniers comparables non relancés).
6. **Pas de relance sur un panier collectif** (liste partagée) en V1 : son propriétaire et ses acheteurs ne sont pas la même personne.

## 5. Hors périmètre / interdits

- Remise automatique incluse dans la relance.
- Relances multiples ou escalade de canal.
- Relance d'un visiteur anonyme.

## 6. Gates à prouver avant exposition

- **P0 provider** : modèle WhatsApp de catégorie marketing approuvé par Meta ; règles d'envoi hors fenêtre de service.
- Preuve en base réelle des cinq conditions et de l'arrêt en cas de commande ou de retrait.

## 7. Première tranche

Fonction de sélection des paniers éligibles exposée par `shared-cart` + politique de relance dans `notifications`, exécutée en **mode simulation** (journal des relances qui auraient été envoyées, aucun envoi réel). L'envoi réel attend le consentement et le modèle approuvé.
