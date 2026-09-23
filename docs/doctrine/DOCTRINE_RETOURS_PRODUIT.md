# Doctrine — Retours produit via le relais

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire** : `orders` (owner de `disputes` — le retour est une **issue** d'un litige, pas un objet parallèle)
> **Features impliquées** : `logistics` (mouvement physique par scans), `refunds` (décision financière), `local-stock` / `inventory` (remise en stock), `purchasing` (retour fournisseur éventuel)
> **Doctrines existantes à respecter** : `refund_authority_never_delegated`, machine à états des litiges (`open → processing → resolved | closed`)

---

## 1. Phrase de vérité

Le client rapporte l'article là où il l'a retiré. Chaque étape physique est un scan. L'argent ne bouge qu'après inspection, et seulement par l'autorité de remboursement.

## 2. Constat dans le code (2026-09-23)

- **Aucune table de retour** ; aucun type « retour » dans les litiges ni dans le service de remboursement.
- Existant réutilisable : `disputes` (owner `orders`), moteur de scans `services/scan-engine.js`, `payment-service.markRefunded`, crédit wallet, doctrine d'autorité de remboursement jamais déléguée au marché.

## 3. Séparation des responsabilités

| Étape | Owner | Ce qu'il ne fait pas |
|---|---|---|
| Demande et décision d'accepter le retour | `orders` (litige) | Ne rembourse pas |
| Dépôt au relais, arrivée au hub | `logistics` (scans) | Ne décide pas de l'issue |
| Inspection et issue (remboursement, remplacement, refus) | `orders` + `refunds` | Ne remet pas en stock sans résultat d'inspection |
| Remise en stock | `local-stock` / `inventory` | N'est jamais automatique à la demande |
| Retour au fournisseur | `purchasing` | Hors V1 |

## 4. Cycle de vie

```txt
Litige ouvert → RETOUR_DEMANDÉ → RETOUR_ACCEPTÉ | RETOUR_REFUSÉ
→ DÉPOSÉ_AU_RELAIS (scan) → REÇU_AU_HUB (scan) → INSPECTÉ
→ issue : REMBOURSÉ | REMPLACÉ | REFUSÉ_APRÈS_INSPECTION
```

## 5. Invariants

1. **Le retour vit dans le litige.** Aucune table ou machine à états parallèle aux litiges pour décider du retour.
2. **Chaque mouvement physique est un scan** du moteur existant, jamais une mise à jour directe de statut.
3. **Pas de stock fantôme.** La quantité n'est remise en stock qu'après inspection concluant à un article revendable.
4. **Pas d'argent avant inspection**, sauf décision explicite de l'autorité de remboursement (geste commercial tracé).
5. **L'autorité de remboursement n'est jamais déléguée** au responsable pays : il pilote le workflow, jamais le montant.
6. **Mode de remboursement décidé par `refunds`** (wallet, cash au relais, voie de paiement d'origine) selon ce que le moyen de paiement permet réellement.
7. **Délai et articles non retournables explicites.** Fenêtre de retour et exclusions (hygiène, périssable) déclarées par produit ou catégorie, affichées avant achat.

## 6. Hors périmètre / interdits

- Retour à domicile ou collecte chez le client en V1.
- Remise en stock automatique à la création de la demande.
- Remboursement déclenché par un scan.

## 7. Gates à prouver avant exposition

- Preuve en base réelle du cycle complet, y compris refus après inspection sans remise en stock ni remboursement.
- Vérification des voies de remboursement réellement supportées par chaque moyen de paiement (Stripe, PayPal, Mobile Money, cash, wallet) — ne rien supposer.

## 8. Première tranche

Ajouter l'issue « retour » au litige existant (demande, acceptation, refus), sans mouvement physique ni argent. Les scans de retour et l'inspection viennent dans les tranches suivantes.
