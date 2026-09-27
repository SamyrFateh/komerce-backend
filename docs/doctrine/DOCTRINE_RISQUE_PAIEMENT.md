# Doctrine — Signaux de risque sur les paiements et commandes

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire** : `payments` (signaux et décision de moyen de paiement autorisé)
> **Features consommatrices** : `orders`, `business-rules`, `dashboard`
> **Existant à préserver** : limitation des tentatives de code de retrait (`pickup-collection-service.js`), `cash_confirmation_controls`

---

## 1. Phrase de vérité

Le risque se signale, s'explique et se décide par un humain. Il ne supprime jamais une commande en silence et ne punit jamais un client sur un critère qu'il ne peut pas comprendre.

## 2. Constat dans le code (2026-09-23)

- **Déjà protégé** : le point de retrait (tentatives de code limitées, blocage temporaire), et un contrôle des confirmations cash.
- **Absent** : aucun score ni signal de risque sur les commandes ou les comptes. Les tables `economic_risk_*` et `risk_provisions` concernent le risque **économique** (prix, marge), pas la fraude.
- Le risque principal du modèle Komerce n'est pas la carte volée mais **la commande cash jamais retirée** : stock bloqué, achat fournisseur engagé, relais encombré.

## 3. Signaux retenus (V1)

| Signal | Pourquoi |
|---|---|
| Commandes cash non retirées par un même numéro | Coût réel direct pour Komerce |
| Nombre de commandes par numéro sur une courte période | Abus ou erreur |
| Plusieurs comptes sur un même numéro | Contournement |
| Première commande de montant élevé en cash | Exposition stock et achat |
| Anomalies de rappel Mobile Money (montant, référence, doublon) | Cohérence du paiement |

## 4. Invariants

1. **Signal ≠ décision.** Un signal produit une alerte ou une mise en revue, jamais une annulation automatique d'une commande payée.
2. **Explicable.** Chaque signal liste ses raisons en clair ; aucun score opaque.
3. **Action graduée et réversible.** Action la plus forte en V1 : exiger un prépaiement (retirer le cash pour ce client), décision tracée et levée possible.
4. **Aucun critère sensible.** Jamais de signal fondé sur un attribut personnel protégé ; seulement des comportements de commande et de paiement.
5. **Les signaux propres à un provider restent dans son adapter** ; le cœur métier ne reçoit que des signaux normalisés.
6. **Pas de faux positifs silencieux.** Toute action de restriction est visible pour l'agent et contestable par le client.

## 5. Hors périmètre / interdits

- Service de scoring tiers en V1.
- Blocage définitif automatique d'un compte.
- Stocker des données de carte (déjà hors périmètre Komerce : Stripe et PayPal les portent).

## 6. Gates à prouver avant exposition

- Mesure préalable, sur données réelles, du taux de commandes cash non retirées par marché : sans ce chiffre, on ne calibre aucun seuil.
- Preuve en base réelle qu'un signal ne modifie ni la commande ni le paiement.

## 7. Première tranche

Calcul en lecture seule des signaux « cash non retiré » et « fréquence par numéro », affichés dans le dashboard Finance ou Commandes. Aucune restriction appliquée dans cette tranche.
