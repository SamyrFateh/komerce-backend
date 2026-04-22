# 🔐 Komerce — Modèle de sécurité

> **Document de doctrine** — v1.0 — 22 avril 2026
>
> Ce document fige la philosophie et les règles de sécurité de Komerce.
> Toute évolution du modèle d'identité, de paiement ou de retrait doit passer par une mise à jour explicite de ce document.

---

## 📖 Philosophie

### Komerce n'est pas Amazon

Komerce est un **Western Union du colis** pour la diaspora comorienne.
Un commerce physique augmenté d'une vitrine digitale, pas un pure-player e-commerce.

- La vitrine digitale sert à **commander facilement** depuis n'importe où
- La transaction réelle a lieu **au relais, en face à face**
- Les relais font guichet de paiement **et** guichet de retrait
- L'agent relais est le gardien de la confiance, pas un simple livreur

Cette architecture n'est pas un défaut à corriger, c'est **l'atout différenciant** que ni Amazon ni Shein ne peuvent répliquer.

### Le principe fondamental

> **Le code secret de retrait naît avec la preuve de paiement, jamais avant.**

Un colis est remis à **quiconque** possède le code secret valide correspondant.
Le code est généré **uniquement au moment où le paiement est confirmé**.
Charge au payeur de transmettre ce code à la personne de son choix.

Comme Western Union et son MTCN.

---

## 🎯 Les 3 principes de conception

### Principe 1 — Le code est lié au paiement, pas à l'identité

Tant qu'il n'y a pas de paiement confirmé, il n'y a pas de code.
Tant qu'il n'y a pas de code, il n'y a pas de retrait possible.
Le paiement est la seule porte d'entrée dans le système sécurisé.

### Principe 2 — Le payeur est le garant de la chaîne

Komerce ne se substitue pas au payeur dans la gestion de la confiance.
Le payeur reçoit le code par un canal **authentifié par son paiement** (reçu papier pour le cash, email pour Stripe, SMS opérateur pour Mobile Money).
Il le transmet ensuite à qui il veut, par le canal de son choix.

Komerce n'a pas à arbitrer « qui est le vrai propriétaire ».
**Celui qui a le code est légitime.**

### Principe 3 — Le canal de livraison des notifications est séparé du canal de sécurité

Le numéro bénéficiaire saisi au checkout sert **uniquement aux notifications** (« votre colis arrive »).
Une erreur de saisie n'impacte **pas** la sécurité du retrait, puisque le code ne transite jamais par ce canal.

---

## 🔄 Cycle de vie d'une commande

### Phase 1 — Commande en ligne

```
Client remplit le panier → saisit nom, tel payeur, tel bénéficiaire → valide
                                     ↓
                Commande créée en DB avec statut "pending_payment"
                                     ↓
                ⚠ AUCUN code secret n'est généré à ce stade
                Confirmation à l'écran :
                "Votre commande est enregistrée. Rendez-vous au relais
                 pour payer et recevoir votre code de retrait."
```

**Données capturées :**
- Nom du commanditaire
- Téléphone du payeur (pour le rappeler si besoin)
- Téléphone du bénéficiaire (pour les notifs de tracking)
- Détail du panier + montant total KMF

**Données NON capturées à ce stade :**
- Pas de code secret
- Pas de hash de code en DB
- Pas d'affichage d'information sensible à l'écran

---

### Phase 2 — Visite 1 au relais : paiement

```
Client se présente au relais avec la référence de sa commande
                         ↓
Agent recherche la commande (ref, nom, tel)
                         ↓
Agent vérifie l'identité du payeur présent
(pièce obligatoire au-delà de certains seuils — voir §Seuils)
                         ↓
Agent saisit :
  • Nom du payeur tel qu'il se présente
  • Type + numéro de pièce présentée (si requis)
  • Note libre optionnelle ("c'est la tante d'Ahmed")
                         ↓
Agent encaisse le cash
                         ↓
↓ À ce moment exact, le backend GÉNÈRE le code secret ↓
                         ↓
L'écran de l'agent affiche :
  ┌──────────────────────────────┐
  │  ✅ Paiement encaissé        │
  │                              │
  │  Code secret pour ce client :│
  │      A7K-3M9-P2              │
  │                              │
  │  [ 🖨 Imprimer le reçu ]     │
  └──────────────────────────────┘
                         ↓
Le reçu est imprimé (thermique ou A4 réduit)
Le reçu porte le code en clair
Le reçu est remis au payeur
                         ↓
Après clic "J'ai remis le reçu" :
  • Le code n'est plus jamais affiché à personne
  • En DB : seul le hash salé du code est stocké
  • Statut commande : "paid" → la commande part en traitement
                         ↓
Client repart avec son reçu physique
Komerce lance l'achat fournisseur Dubaï
```

**Point crucial :** Entre l'encaissement et l'impression, il y a une fenêtre de 5 à 10 secondes où le code est présent en mémoire serveur et affiché à l'agent. Après impression et clic de confirmation, **le code en clair est effacé de tout endroit consultable**.

---

### Phase 3 — Transit (3 à 4 semaines)

Le colis voyage de Dubaï vers le relais de destination aux Comores.
Les notifications automatiques sont envoyées sur le numéro bénéficiaire :
- Paiement confirmé
- Commande expédiée
- Arrivée au relais

**Aucune de ces notifications ne contient le code secret.**
Elles contiennent uniquement la référence de commande et le nom du relais.

Pendant cette phase, le payeur a le reçu imprimé chez lui.
Il peut :
- Le garder pour lui-même (si c'est lui qui retirera)
- Le remettre en main propre à la personne qui retirera
- Photographier le reçu et envoyer la photo par WhatsApp/SMS/email
- Lire le code au téléphone à la personne concernée

Komerce n'intervient plus dans cette chaîne de transmission.

---

### Phase 4 — Visite 2 au relais : retrait

```
Le colis est arrivé au relais, notif envoyée sur numéro bénéficiaire
                                     ↓
Personne X se présente au relais
                                     ↓
Agent recherche la commande (ref visible sur colis ou demandée à X)
                                     ↓
Agent affiche : "Quel est votre code secret ?"
                                     ↓
X donne le code : A7K-3M9-P2
                                     ↓
Agent le saisit → backend hash et compare au hash stocké
  • Match    → remise du colis, signature optionnelle
  • Pas match → 2 autres essais possibles, puis blocage 15 min
                                     ↓
Statut commande : "collected"
```

**Qui est X ?** Peu importe. C'est :
- Le payeur lui-même (cas le plus courant)
- Son bénéficiaire déclaré à la commande
- Un cousin que le payeur a mandaté
- Un voisin à qui le payeur a confié le code

Tant que X a le code, X est légitime selon la doctrine Komerce.

---

## 🛡 Règles opérationnelles

### Format du code secret

**Spécification technique :**
- Longueur : 8 caractères alphanumériques
- Alphabet : `ABCDEFGHJKLMNPQRSTUVWXYZ23456789` (26 + 8 = 32 chars)
- Exclus : `0 O I 1 l` (confusions visuelles)
- Présentation : groupé par 3 (`A7K-3M9-P2`)
- Génération : `crypto.randomBytes(8)` côté serveur, mapping sur l'alphabet

**Espace de code :** 32^8 ≈ 1.1 × 10^12 (1100 milliards de combinaisons)
Brute force sans rate limit : impossible même à 1000 tentatives/seconde (~35 ans)
Brute force avec rate limit 3 essais/15min : statistiquement impossible en pratique.

### Stockage en DB

```sql
ALTER TABLE orders
  ADD COLUMN pickup_secret_hash TEXT,     -- sha256(code + salt)
  ADD COLUMN pickup_secret_salt TEXT,     -- uuid v4 par commande
  ADD COLUMN pickup_secret_created_at TIMESTAMPTZ,
  ADD COLUMN pickup_secret_expires_at TIMESTAMPTZ;  -- +60 jours par défaut
```

**Règles de stockage :**
- Le code en clair n'est **JAMAIS** stocké en DB
- Le hash est lié à un salt unique par commande
- Un code ne peut être généré qu'une fois (pas de régénération automatique)
- Expiration 60 jours après génération → après, retrait impossible sans escalade admin

### Seuils de vérification d'identité

Au moment du paiement (visite 1), l'agent demande une pièce d'identité selon le montant :

| Montant encaissé | Pièce requise |
|---|---|
| < 10 000 KMF | Aucune (micro-commande, risque négligeable) |
| 10 000 - 99 999 KMF | CNI ou pièce équivalente (numéro noté) |
| ≥ 100 000 KMF | CNI obligatoire + photo scannée + validation admin |

Au moment du retrait (visite 2), par défaut **seul le code compte**.
Cas d'exception :
- Si le code est invalide 3 fois de suite → blocage 15 min + proposition "avez-vous perdu votre reçu ?"
- Si commande > 100 000 KMF → agent peut demander une pièce en complément à sa discrétion
- Si le payeur a coché l'option "question secrète" au moment du paiement → la question est demandée en plus

### Rate limiting

**À la saisie du code au retrait :**
- 3 tentatives par commande
- Blocage 15 min après 3 échecs
- Reset du compteur après 24h
- Après 6 échecs cumulés → escalade admin (fraude potentielle)

**À l'admin console (régénération de code) :**
- Uniquement admin Komerce (pas agent relais)
- Log obligatoire avec motif
- Notification automatique au payeur sur son numéro enregistré

### Que faire si le client perd son reçu ?

**Procédure standard :**
1. Agent relais identifie le client par pièce d'identité
2. Agent vérifie que le nom de la pièce correspond au nom du payeur enregistré en DB
3. Si match et montant < 100 000 KMF :
   - Agent escalade à l'admin Komerce (WhatsApp ou téléphone)
   - Admin régénère un nouveau code (invalide l'ancien)
   - Admin fournit le nouveau code à l'agent par canal sécurisé (pas WhatsApp bénéficiaire)
   - Nouveau reçu imprimé, ancien reçu annulé
4. Si montant ≥ 100 000 KMF :
   - Admin appelle directement le payeur sur son numéro enregistré
   - Validation orale, questions de contrôle (détail de la commande, date d'achat...)
   - Si OK → régénération et transmission

**Audit log obligatoire** pour toute régénération.

### Question secrète optionnelle

Au moment du paiement visite 1, l'agent peut proposer au payeur :

> « Voulez-vous ajouter une question secrète pour plus de sécurité ?
> Ex : "Prénom de ma grand-mère ?" → Réponse : "Zainaba" »

Si oui :
- Question stockée en clair en DB
- Réponse stockée hashée + salt
- Au retrait, la réponse est demandée **en plus** du code
- Utile pour les grosses sommes ou les clients paranos

---

## 🧩 Moyens de paiement et canaux de transmission

| Moyen de paiement | Canal d'émission du code | Preuve du payeur |
|---|---|---|
| **Cash relais** | Reçu imprimé en main propre | Agent visuel + pièce d'identité (selon seuil) |
| **Stripe CB/Apple Pay** | Email Stripe (vérifié au paiement) + page confirmation | `email` + `payment_method_id` + `charge_id` |
| **Mobile Money (Orange Huri, Halal Pay)** | SMS sur le numéro Mobile Money (vérifié par l'opérateur) | `msisdn` + `transaction_id` opérateur |
| **Wallet Komerce** | Historique du wallet + email si configuré | Compte utilisateur authentifié (JWT valide) |
| **PayPal** | Email PayPal (vérifié) | `payer_id` PayPal |

**Règle universelle :** le code est transmis sur un canal **garanti par le moyen de paiement lui-même**, jamais sur le numéro bénéficiaire déclaré à la commande.

---

## 📜 Audit trail

Chaque action critique laisse une trace immuable dans `audit_log` :

| Action | Champs loggés |
|---|---|
| Commande créée | `order_id`, `user_ip`, `user_agent`, `full_payload` |
| Paiement confirmé | `order_id`, `agent_id`, `payer_name`, `payer_id_type`, `amount_kmf`, `payment_method` |
| Code généré | `order_id`, `agent_id`, `timestamp` (pas le code en clair, évidemment) |
| Code testé au retrait | `order_id`, `agent_id`, `success`, `attempt_number` |
| Code régénéré | `order_id`, `admin_id`, `reason`, `old_hash_invalidated` |
| Colis remis | `order_id`, `agent_id`, `collected_by_name` (optionnel), `signature_data` (optionnel) |

Les logs sont **immuables** (pas de UPDATE, pas de DELETE) et conservés 5 ans minimum.

---

## 🗝 Canaux d'authentification pour "Mes commandes" côté client

Pour permettre au payeur de consulter ses commandes en cours via la boutique :

**Authentification principale (non critique) :**
- OTP par SMS/WhatsApp sur le numéro enregistré
- Magic link par email si configuré
- JWT cookie httpOnly de 90 jours une fois authentifié

**Données accessibles :**
- Liste des commandes passées
- Statut de transit (en cours, arrivée, récupérée)
- Montants, détails des articles

**Données NON accessibles (même authentifié) :**
- Le code secret en clair (il est hashé, et de toute façon on n'en affiche jamais)
- L'historique détaillé des vérifications au retrait
- Les notes internes des agents

La vue "Mes commandes" sert uniquement au **suivi**, jamais à la **sécurité**.

---

## 🧪 Matrice des cas limites

| Cas | Comportement attendu |
|---|---|
| Client tape le mauvais numéro bénéficiaire au checkout | Pas grave — il recevra les notifs sur un mauvais numéro mais le code est remis en main propre au relais |
| Client perd son reçu papier | Procédure de régénération avec pièce d'identité + validation admin |
| Client donne son code à un ami qui le perd | Mêmes conditions que perte directe |
| Agent relais compromis (donne un faux code) | Audit log détecte l'anomalie, admin peut retracer |
| Tentative de brute force sur le code | Rate limit 3 essais / 15 min bloque |
| Deux personnes connaissent le code | La première qui arrive retire. Komerce ne peut rien faire, c'est la responsabilité du payeur |
| Commande non payée après 30 jours | Expiration automatique, panier annulé |
| Colis pas retiré après 60 jours | Expiration du code, escalade admin, remboursement ou renvoi |
| Tel du payeur perdu/volé | Pas d'impact si le code a déjà été transmis. Si pas encore → admin peut régénérer |
| Tel du bénéficiaire perdu/volé | Aucun impact sur la sécurité (pas de code sur ce canal) |
| Litige entre bénéficiaires (ex: deux membres d'une famille) | Komerce se réfère au payeur. Celui qui a le reçu/code légitime selon le payeur gagne |

---

## 🚀 Plan d'implémentation progressif

### Phase MVP (POC partenaires)

- [x] Commande en ligne sans affichage de code
- [ ] Migration DB : champs `pickup_secret_hash`, etc.
- [ ] Backend : endpoint `POST /api/orders/:id/pay-cash` qui génère le code et retourne le reçu HTML
- [ ] Frontend hub relais : écran "Encaisser un paiement" avec impression du reçu
- [ ] Backend : endpoint `POST /api/orders/:id/collect` qui valide le code et marque collected
- [ ] Frontend hub relais : écran "Remettre un colis" avec saisie du code + rate limit
- [ ] Template HTML imprimable (A4 ou thermique)
- [ ] Admin console : consultation des preuves de retrait (sans code clair)

### Phase 2 (post-POC)

- [ ] Paiement Stripe avec génération de code à la confirmation webhook
- [ ] Paiement Mobile Money (Orange Huri) avec génération au callback opérateur
- [ ] Question secrète optionnelle
- [ ] Régénération de code admin avec log
- [ ] Photo pièce d'identité au paiement (au-delà du seuil)
- [ ] Expiration auto des codes à 60 jours
- [ ] Alertes admin en cas de brute force

### Phase 3 (industrialisation)

- [ ] Imprimantes thermiques USB dans chaque relais
- [ ] Tablette dédiée par agent relais
- [ ] Signature manuscrite sur tablette au retrait
- [ ] Photo du client + colis au retrait (preuve visuelle)
- [ ] SMS automatique au payeur "votre colis vient d'être retiré" (rassurance post-retrait)

---

## 📚 Références et inspirations

- **Western Union MTCN** — Modèle historique du transfert d'argent cash avec code
- **Ria Money Transfer** — Variante avec pièce d'identité obligatoire
- **MoneyGram Reference Number** — Même modèle que WU
- **Click & Collect e-commerce** — Systèmes de codes de retrait type Mondial Relay
- **Chronopost signature** — Preuve de remise physique avec signature

Komerce combine :
- Le **modèle MTCN** de Western Union pour l'identité lâche (pas de compte requis)
- Le **modèle Click & Collect** pour le flux commande/retrait séparé dans le temps
- Le **modèle physique retail** pour le paiement cash au guichet

---

## ✍ Signature du document

**Auteur :** Komerce Team
**Date :** 22 avril 2026
**Version :** 1.0
**Prochaine revue :** après POC partenaires (prévue mi-2026)

**Toute modification de cette doctrine doit faire l'objet :**
1. D'une discussion documentée
2. D'un changelog explicite en fin de document
3. D'une validation par le responsable produit

---

## 📝 Changelog

### v1.0 — 22 avril 2026
- Version initiale
- Principe fondamental : code lié au paiement, jamais avant
- Comparaison Western Union MTCN
- Matrice des cas limites
- Plan d'implémentation en 3 phases
