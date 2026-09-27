# Doctrine — Consentement de communication client

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire proposée** : `notifications` (finalités et preuves de consentement)
> **Features consommatrices** : relance panier, sollicitation d'avis, messagerie entrante, futures campagnes
> **Pré-requis de** : `DOCTRINE_RELANCE_PANIER.md`, `DOCTRINE_AVIS_CLIENTS.md`, `DOCTRINE_MESSAGERIE_CLIENT_ENTRANTE.md`

---

## 1. Phrase de vérité

Komerce ne contacte jamais un client pour autre chose que sa commande sans une preuve qu'il l'a accepté.
L'absence de preuve vaut refus.

## 2. Constat dans le code (2026-09-23)

- `users` porte `phone` et `whatsapp_phone`, mais **aucune colonne ni table de consentement** n'existe dans le schéma.
- Toutes les notifications actuelles (`services/notifications/*`) sont transactionnelles : commande, colis, OTP, fidélité.
- Aucune relance marketing n'existe aujourd'hui : l'absence de consentement n'est donc pas encore une faille, mais elle bloque toute fonctionnalité de relance.

## 3. Séparation des finalités

| Finalité | Exemple | Consentement requis |
|---|---|---|
| `TRANSACTIONNEL` | commande confirmée, colis disponible, OTP, code de retrait | Non : exécution du contrat. Ne peut **jamais** porter de contenu promotionnel. |
| `RELANCE_PANIER` | « votre panier vous attend » | **Oui** |
| `SOLLICITATION_AVIS` | « donnez votre avis sur votre achat » | **Oui** |
| `PROMOTIONNEL` | offres, nouveautés | **Oui** |

Un consentement est donné **par finalité et par canal** (`whatsapp`, `sms`, `email`, `in_app`). Accepter la relance panier sur WhatsApp n'autorise ni le promotionnel, ni un autre canal.

## 4. Cycle de vie

```txt
UNKNOWN (défaut) → GRANTED → WITHDRAWN → GRANTED …
```

- Chaque changement est un **événement append-only** : finalité, canal, état, date, source (écran, message entrant, agent), preuve (version du texte présenté).
- L'état courant se dérive du dernier événement. On ne réécrit jamais l'historique.

## 5. Invariants

1. **UNKNOWN n'est jamais GRANTED.** Aucune valeur par défaut ne vaut consentement, aucune case pré-cochée.
2. **Le retrait est immédiat et sans friction.** Un mot-clé de retrait reçu par WhatsApp (cf. messagerie entrante) produit `WITHDRAWN` sans intervention humaine.
3. **Le transactionnel reste pur.** Aucun message transactionnel ne transporte de promotion : sinon il devient promotionnel et exige un consentement.
4. **Vérification à l'envoi, pas à la planification.** Un message programmé est recontrôlé au moment de l'envoi ; un retrait intervenu entre-temps l'annule.
5. **Pas d'écriture dans `users`.** Le consentement vit dans ses propres tables, possédées par `notifications` ; `auth-identity` reste seul owner de `users`.
6. **Minimisation.** On stocke la preuve du consentement, pas le contenu des échanges.

## 6. Hors périmètre / interdits

- Déduire un consentement d'un achat, d'une inscription ou d'un message entrant.
- Un consentement global « tous canaux, toutes finalités ».
- Réactiver un consentement retiré sans nouvelle action du client.

## 7. Gates à prouver avant exposition

- **P0 juridique, par marché** : Mayotte relève du droit européen (RGPD, ePrivacy) ; les clients diaspora en France aussi. Les règles des Comores, du Cameroun et du Congo sont **à qualifier** avant ouverture, sans les supposer identiques.
- **P0 provider** : politique Meta WhatsApp Business sur l'opt-in et les catégories de modèles (utilitaire vs marketing) — à relire et archiver, pas à supposer.
- Preuve que le retrait par mot-clé fonctionne de bout en bout.

## 8. Première tranche

Tables `communication_consent_events` (append-only) + projection de l'état courant, service `getConsent(userId, purpose, channel)` retournant `GRANTED | WITHDRAWN | UNKNOWN`, écran de préférences client. Aucun envoi marketing dans cette tranche.
