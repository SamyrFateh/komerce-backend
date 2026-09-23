# Doctrine — Messagerie client entrante (WhatsApp)

> **Version** : 0.1 — 2026-09-23
> **Statut** : doctrine proposée, non implémentée
> **Feature propriétaire proposée** : `notifications` (réception, corrélation, routage)
> **Features consommatrices** : `orders` (litiges), `incident-management`, consentement
> **Pré-requis** : GAP-2 de `docs/gaps/GAP_INTEGRATION_AUDIT_CORRECTIONS.md` (ne plus journaliser le corps brut)

---

## 1. Phrase de vérité

En Afrique, WhatsApp est le service client. Un message de client qui n'est lu par personne est une vente ou une réputation perdue.

## 2. Constat dans le code (2026-09-23)

- `routes/meta-whatsapp.js` reçoit le webhook Meta, vérifie la signature, **journalise le corps brut** puis ne fait rien : `// Ici plus tard: … messages entrants client -> support`.
- Aucune table de message entrant, aucune boîte de réception agent.
- `users.whatsapp_phone` et `users.phone` existent et permettent une corrélation.

## 3. Séparation des objets

| Objet | Rôle | Ce qu'il ne fait pas |
|---|---|---|
| Message entrant | Trace minimale d'un message reçu | Ne crée ni commande, ni litige, ni remboursement |
| Conversation | Regroupe les messages d'un numéro dans une fenêtre | Ne porte pas la décision métier |
| Litige (`disputes`, owner `orders`) | Décision sur un problème de commande | N'est jamais créé automatiquement depuis un texte libre |

## 4. Cycle de vie

```txt
Message reçu → signature vérifiée → dédupliqué (id Meta) → corrélé (numéro)
→ mot-clé de retrait ? → consentement WITHDRAWN
→ sinon : conversation ouverte → traitée par un agent → close
```

## 5. Invariants

1. **Idempotence.** Un message Meta rejoué n'est enregistré qu'une fois (identifiant fournisseur unique).
2. **Corrélation fail-closed.** Un numéro qui correspond à zéro ou plusieurs comptes n'est rattaché à aucun ; l'agent voit « non identifié ».
3. **Aucune donnée de commande envoyée sans identité vérifiée.** Répondre « votre colis est au relais X » exige que le numéro corresponde au client de la commande.
4. **Le texte libre ne décide rien.** Aucune action métier (annulation, remboursement, litige) n'est déclenchée par l'interprétation automatique d'un message.
5. **Retrait de consentement automatique** sur mot-clé (liste fermée, par langue).
6. **Confidentialité.** Contenu stocké le temps nécessaire au traitement, jamais dans les logs, rétention bornée.
7. **Réponse dans les règles du canal.** Les réponses libres hors fenêtre de service autorisée par le provider passent par des modèles approuvés.

## 6. Hors périmètre / interdits

- Chatbot qui répond seul sur des sujets de commande en V1.
- Création automatique de litige depuis un message.
- Stockage des médias entrants sans politique de rétention.

## 7. Gates à prouver avant exposition

- **P0/P1 provider** : fenêtre de réponse libre, modèles, limites de débit Meta — à lire et archiver dans le registre provider (`meta-whatsapp` est aujourd'hui `UNQUALIFIED`).
- Preuve réelle avec un numéro de test Meta : réception, déduplication, réponse.

## 8. Première tranche

Enregistrement minimal des messages entrants (dédupliqués, corrélés fail-closed) + traitement du mot-clé de retrait. Pas encore de boîte de réception ni de réponse : prouver d'abord la réception fiable.
