# Chantier — Fonctionnalités client manquantes (V1)

> **Date** : 2026-09-23
> **Origine** : `docs/audits/INTEGRATION_ABSTRACTIONS_AND_ARCHITECTURE_AUDIT_V1.md` + comparaison marché, chaque manque **vérifié dans le code**.
> **Règle** : une doctrine par capacité ; chaque doctrine commence par le constat réel du code ; chaque première tranche est petite, réversible et prouvable sans provider externe.

## Doctrines

| # | Doctrine | Owner proposé | Nouvelle feature ? |
|---|---|---|---|
| 1 | `DOCTRINE_CONSENTEMENT_COMMUNICATION.md` | `notifications` | Non |
| 2 | `DOCTRINE_MESSAGERIE_CLIENT_ENTRANTE.md` | `notifications` | Non |
| 3 | `DOCTRINE_MESURE_AUDIENCE.md` | `audience` | **Oui — à classifier** |
| 4 | `DOCTRINE_PROMESSE_DELAI.md` | `logistics` | Non (prolonge Transport Rails) |
| 5 | `DOCTRINE_AVIS_CLIENTS.md` | `reviews` | **Oui — à classifier** |
| 6 | `DOCTRINE_RETOURS_PRODUIT.md` | `orders` (litiges) | Non |
| 7 | `DOCTRINE_RELANCE_PANIER.md` | `notifications` | Non |
| 8 | `DOCTRINE_RISQUE_PAIEMENT.md` | `payments` | Non |

## Ordre recommandé (par dépendances)

```txt
GAP-2 (logs WhatsApp)
  └─ 2. Messagerie entrante ──┐
1. Consentement ─────────────┼─ 7. Relance panier
                             └─ 5. Avis clients (sollicitation)
3. Mesure d'audience ─────────── 7. Relance panier (mesure d'effet)
4. Promesse de délai            (indépendant)
6. Retours produit              (indépendant)
8. Risque paiement              (indépendant — commencer par mesurer)
```

**Parallélisables immédiatement** : 1, 3, 4, 6, 8 (première tranche de chacun).
**Bloqués** : 2 (attend GAP-2), 7 (attend 1 et un modèle WhatsApp approuvé), sollicitation d'avis (attend 1).

## Ce qui exige une preuve externe réelle

| Capacité | Preuve externe |
|---|---|
| Consentement, relance, messagerie | Politique et modèles Meta WhatsApp Business (P0/P1 `meta-whatsapp`, aujourd'hui `UNQUALIFIED`) |
| Consentement, audience | Qualification juridique par marché (UE pour Mayotte et diaspora ; Comores, Cameroun, Congo à qualifier) |
| Retours | Voies de remboursement réellement supportées par chaque moyen de paiement |

Tout le reste se prouve en unitaire et en PostgreSQL jetable.

## Nouvelles features à classifier

`audience` et `reviews` possèdent chacune une table et un cycle de vie propre : selon `ONTOLOGIE_FEATURE_FIRST.md` / `FEATURE_DOCTRINE.md`, elles relèvent a priori d'une feature dédiée plutôt que d'un ajout à `dashboard` (lecture seule) ou `catalog` (produit). Classification à valider avant la première tranche.
