# Komerce Backend — Plan de sessions d'audit profond

> **Document de planification.** Chaque audit = une session chat dédiée.
> Aucun code modifié pendant ces sessions, seulement analyse + livrable.
>
> **Comment utiliser** :
> 1. Choisir un lot non fait (priorité par ordre du tableau)
> 2. Ouvrir une nouvelle conversation Claude
> 3. Y zipper les fichiers listés dans le lot
> 4. Coller le prompt prêt-à-l'emploi du lot
> 5. Récupérer le livrable produit, le placer dans `docs/_work/`
> 6. Cocher le lot dans ce document
>
> **Pourquoi une session par audit** : sur une session > 3-4 heures, la qualité
> d'analyse décline (contexte saturé). Mieux vaut 9 sessions courtes et nettes.

---

## §0 — Tableau de planification

| # | Lot | Zone | Charge session | Blast radius | Statut |
|---|---|---|---|---|---|
| 1 | **AUDIT-D2** | Webhook Stripe | 2-3 h | 🔴 critique (argent) | ☐ |
| 2 | **AUDIT-G3** | Flow paiement collectif | 3-4 h | 🔴 critique (argent + concurrence) | ☐ |
| 3 | **AUDIT-G2** | Flow paiement Stripe E2E | 2-3 h | 🔴 critique | ☐ |
| 4 | **AUDIT-G1** | Flow cash → retrait relais | 2-3 h | 🟠 élevé (logistique) | ☐ |
| 5 | **AUDIT-G4** | Annulation + refund | 2-3 h | 🟠 élevé | ☐ |
| 6 | **AUDIT-D1** | Routes admin (auth coverage) | 2 h | 🟠 élevé (surface attaque) | ☐ |
| 7 | **AUDIT-D3** | Auth guest UUID | 2 h | 🟠 élevé (historique buggé) | ☐ |
| 8 | **AUDIT-D4** | Tokens QR / pickup secret | 2 h | 🟠 élevé (client) | ☐ |
| 9 | **AUDIT-G5** | Flow sourcing → ajout produit | 2-3 h | 🟡 moyen (cible future) | ☐ |

**Total** : ~20-25 h de travail analytique, répartissable sur 2-4 semaines selon ton rythme.

**Suggestion de cadence** :
- Semaine 1 : audits 1 + 6 (les plus rapides, gros impact)
- Semaine 2 : audits 2 + 3 (flows paiement, le plus douloureux si bug)
- Semaine 3 : audits 4 + 5 (logistique + annulation)
- Semaine 4 : audits 7 + 8 + 9 (sécurité résiduelle + sourcing)

---

## §1 — Conventions communes à toutes les sessions

### Format du livrable attendu

Chaque audit produit **un fichier markdown** à placer dans `docs/_work/AUDIT_{nom}.md`, structuré comme suit :

```markdown
# AUDIT — {Nom du flow ou de la zone}
> Date : YYYY-MM-DD
> Auteur : Claude (session {N})
> Fichiers analysés : ...

## 1. Périmètre
   (Ce qui est dans le scope, ce qui est out-of-scope)

## 2. État des lieux
   (Lecture du code, points d'entrée, modules impliqués, flow réel observé)

## 3. Invariants attendus
   (Ce qui DOIT être vrai pour que le flow soit correct.
    Format : "INV-X : description testable")

## 4. Risques détectés
   (Bugs probables, edge cases non gérés, race conditions possibles.
    Format : "RISK-X : description + criticité + scénario reproducteur")

## 5. Tests existants vs manquants
   (Couverture actuelle, ce qui mérite tests, priorité)

## 6. Recommandations
   (À transformer en lots de la roadmap. Priorisées.)

## 7. Verdict
   (Bloquant go-live ? À surveiller ? OK ?)
```

### Règles méthodologiques pour Claude (à coller au début de chaque session)

```
RÈGLES NON-NÉGOCIABLES POUR CET AUDIT :

1. Tu n'écris AUCUN code dans cette session. Pas de patch, pas de fix.
   Seulement de l'analyse et de la documentation.

2. Tu ne suggères pas de "petites améliorations" hors scope.
   Si tu détectes quelque chose hors du périmètre, tu le notes dans
   "Hors scope - à creuser" et tu n'en fais pas plus.

3. Tu lis vraiment les fichiers. Pas de "probablement", "il semble que".
   Si tu n'as pas accès au fichier, tu le demandes explicitement.

4. Pour chaque risque détecté, tu fournis le chemin fichier:ligne précis.

5. Tu distingues clairement :
   - Ce que le code FAIT (observable dans le source)
   - Ce que tu SUPPOSES (déduit du contexte)
   - Ce que tu RECOMMANDES (ton avis professionnel)

6. Tu produis UN livrable unique en markdown à la fin, suivant le format
   imposé. Pas plusieurs documents éparpillés.

7. Tu ne contournes pas un risque pour "rendre le verdict positif".
   Si une zone est risquée, tu le dis.
```

### Comment évaluer la qualité du livrable

Une fois reçu, vérifier :
- [ ] Les invariants sont **testables** (pas des vœux pieux)
- [ ] Les risques ont un **chemin fichier:ligne** précis
- [ ] Les recommandations sont **actionnables** (pas "améliorer la robustesse")
- [ ] Le verdict est **net** (bloquant / surveiller / OK)
- [ ] Pas de scope creep (Claude n'a pas inventé d'audits supplémentaires)

---

## §2 — Lot 1 : AUDIT-D2 — Webhook Stripe (PRIORITÉ ABSOLUE)

**Pourquoi en premier** : Le webhook Stripe est **le seul endroit où une erreur silencieuse peut faire perdre de l'argent à grande échelle** (paiement encaissé, commande non créée, ou inverse). C'est l'endroit le plus douloureux possible si bug.

### Fichiers à uploader (zip prêt)

```
routes/payments.js                    ← contient probablement le webhook
routes/payment-cash.js                ← si webhook cash distinct
routes/payment-cash-confirm.js
services/payment-service.js           ← si existe
services/order-status-machine.js      ← appelé par le webhook
middleware/stripe-webhook.js          ← s'il existe
.env.example                          ← pour voir les vars Stripe utilisées
migrations/0*payment*.sql             ← les colonnes payment_status, stripe_*
package.json                          ← version Stripe SDK
```

**Commande PowerShell pour préparer le zip** :

```powershell
$files = @(
  "routes\payments.js",
  "routes\payment-cash.js",
  "routes\payment-cash-confirm.js",
  "services\order-status-machine.js",
  "middleware\stripe-webhook.js",
  ".env.example",
  "package.json"
) | Where-Object { Test-Path $_ }

$migrations = Get-ChildItem migrations\*payment*.sql -ErrorAction SilentlyContinue
$migrations2 = Get-ChildItem migrations\*stripe*.sql -ErrorAction SilentlyContinue

Compress-Archive -Path ($files + $migrations + $migrations2) `
  -DestinationPath D:\Users\fsamy\Downloads\audit-d2-stripe-webhook.zip -Force
```

### Prompt prêt à coller

```
Je veux que tu fasses un audit profond du webhook Stripe et du flow paiement Stripe
de mon backend Komerce. Tu trouveras les fichiers nécessaires dans le zip uploadé.

CONTEXTE :
- Komerce est un e-commerce diaspora comorienne
- Le backend utilise stripe SDK ^15.11.0
- Les commandes passent par un order-status-machine strict
- Il y a des paiements Stripe ET des paiements cash (deux flows distincts)

QUESTIONS À RÉPONDRE :

1. SIGNATURE & SÉCURITÉ
   - Le webhook vérifie-t-il la signature Stripe avec stripe.webhooks.constructEvent ?
   - Le secret du webhook est-il dans .env (pas en dur) ?
   - Que se passe-t-il si la signature est invalide ?

2. IDEMPOTENCY
   - Si Stripe rejoue le même webhook 2 fois (réseau lent), que se passe-t-il ?
   - Y a-t-il une protection contre la double-confirmation de commande ?
   - Comment l'idempotency est-elle gérée côté DB ?

3. ORDRE DES OPÉRATIONS
   - Quel est l'ordre exact : reçoit webhook → vérif signature → quoi → quoi → réponse 200 ?
   - Y a-t-il un risque de "commande payée mais pas marquée comme telle" ?
   - Y a-t-il un risque de "marquée payée mais paiement échoué côté Stripe" ?

4. ERREUR HANDLING
   - Que se passe-t-il si la DB est down quand le webhook arrive ?
   - Que se passe-t-il si order-status-machine refuse la transition ?
   - Stripe re-tente combien de fois ? Le code est-il prêt pour ?

5. ÉVÉNEMENTS HANDLED
   - Quels event types Stripe sont traités ? (checkout.session.completed,
     payment_intent.succeeded, charge.refunded, etc.)
   - Y a-t-il des events ignorés qui devraient être traités ?

6. RACE CONDITIONS
   - Si le user clique 2x sur "Payer", peut-il créer 2 payment intents ?
   - Le webhook et l'API client (POST /payment-success) peuvent-ils se contredire ?

7. LOGGING & OBSERVABILITÉ
   - Les webhooks sont-ils tous loggés (success ET error) ?
   - Y a-t-il un request_id Stripe propagé ?

RÈGLES DE LA SESSION : [coller les 7 règles méthodologiques du §1]

LIVRABLE ATTENDU : un seul fichier docs/_work/AUDIT_D2_STRIPE_WEBHOOK.md suivant
le format imposé du §1.
```

### Critères de validation du livrable

- [ ] Les 7 questions sont traitées
- [ ] Chaque risque a un chemin fichier:ligne précis
- [ ] Le verdict final dit "bloquant go-live" si la signature n'est pas vérifiée
- [ ] Le verdict final dit "bloquant go-live" si pas d'idempotency

### Suite après ce lot

Si l'audit révèle des bugs critiques → créer immédiatement un lot de fix prioritaire dans la roadmap principale.
Sinon → passer au lot 2.

---

## §3 — Lot 2 : AUDIT-G3 — Flow paiement collectif

**Pourquoi prioritaire** : les branches Git `fix/collective-cash-*`, `fix/collective-order-*`, `fix/secure-collective-contribution-delete` indiquent une zone qui a beaucoup buggé. Risque de **race conditions** sur les contributions.

### Fichiers à uploader

```
services/collective-workspace-engine.js
services/collective-payment-orchestrator.js
services/shared-cart-engine.js              ← lié
routes/collective-orders.js                  ← si existe
routes/cash.js                               ← contient probablement les confirmations
routes/cash-confirm.js                       ← si existe
routes/cash-pin.js                           ← si existe
services/order-status-machine.js
migrations/*collective*.sql
migrations/*contribution*.sql
migrations/*shared*.sql
migrations/*group*.sql
```

### Prompt prêt à coller

```
Audit profond du flow de paiement collectif (panier groupé / contributions
multiples sur une commande). Les fichiers sont dans le zip.

CONTEXTE :
- Plusieurs personnes (diaspora à l'étranger) contribuent au paiement
  d'une commande livrée aux Comores
- Les contributions peuvent être en cash (relais) ou Stripe
- Une fois la somme atteinte, la commande passe à confirmed
- Branches Git de bugs récents : fix/collective-cash-confirmation,
  fix/collective-cash-notification-phone, fix/collective-order-tracking-phone,
  fix/secure-collective-contribution-delete

QUESTIONS À RÉPONDRE :

1. INVARIANT MONÉTAIRE
   - L'invariant "sum(contributions) <= total" est-il garanti ?
   - Où dans le code ? Par contrainte DB, par check applicatif, par transaction ?
   - Que se passe-t-il si 2 contributions simultanées font dépasser le total ?

2. RACE CONDITIONS
   - 2 utilisateurs cliquent en même temps "contribuer 50€" sur une commande
     à laquelle il manque 80€. Que se passe-t-il ?
   - Les UPDATE sont-ils protégés par FOR UPDATE ou advisory locks ?

3. CONFIRMATION FINALE
   - Quand la somme atteint le total, qui déclenche la transition de statut ?
   - Le déclencheur est-il atomique avec la dernière contribution ?
   - Que se passe-t-il si la dernière contribution Stripe webhook arrive
     PENDANT qu'une annulation est en cours ?

4. ANNULATION & REFUND
   - Si un contributeur veut annuler après avoir payé, que se passe-t-il ?
   - Si l'organisateur annule la commande, les contributions sont-elles
     toutes refundées atomiquement ?

5. NOTIFICATIONS
   - Qui reçoit quoi à chaque contribution ?
   - Les notifications peuvent-elles être envoyées 2x ?
   - Les téléphones (variables fix/*phone) sont-ils correctement récupérés ?

6. SUPPRESSION D'UNE CONTRIBUTION
   - La branche fix/secure-collective-contribution-delete suggère qu'on a eu
     un trou de sécurité. Quelle vérification est faite ?
   - Un contributeur peut-il supprimer la contribution d'un autre ?

7. CAS DÉGÉNÉRÉS
   - 0 contribution : peut-on quand même confirmer la commande ?
   - 1 contribution > total : remboursement automatique ?
   - Commande modifiée (item ajouté) après contributions : que se passe-t-il
     avec les contributions existantes ?

RÈGLES DE LA SESSION : [coller les 7 règles]

LIVRABLE ATTENDU : docs/_work/AUDIT_G3_COLLECTIVE_PAYMENT.md
```

### Suite après ce lot

Les race conditions sont quasi-certaines vu la nature du flow. Le livrable identifiera précisément lesquelles. Probable lot prioritaire de fix après.

---

## §4 — Lot 3 : AUDIT-G2 — Flow paiement Stripe E2E

**Périmètre** : du `POST /api/orders` initial jusqu'au `status=confirmed` après webhook Stripe. Complémentaire à D2 (qui focuse sur le webhook lui-même).

### Fichiers à uploader

```
routes/orders/create.js
routes/orders/detail.js
routes/orders/status.js
routes/payments.js
services/payment-service.js (si existe)
services/order-status-machine.js
services/pricing-engine.js (lecture, pas d'analyse approfondie)
middleware/authenticate.js
middleware/auth-guest.js
validators/order-schema.js (si existe)
```

### Prompt prêt à coller

```
Audit du flow complet de paiement Stripe : depuis la création de la commande
côté client jusqu'à sa confirmation finale.

ÉTAPES À TRACER :
1. Client POST /api/orders (panier validé)
2. Backend crée l'order (status=pending), calcule le pricing
3. Backend crée le payment intent Stripe (ou checkout session)
4. Client paie via Stripe (côté frontend)
5. Stripe envoie webhook checkout.session.completed
6. Backend met à jour status=paid
7. Hub admin confirme avec mark-ordered → status=ordered

POUR CHAQUE ÉTAPE, AUDITER :
- L'authentification (qui peut faire quoi ?)
- La validation (Joi schema appliqué ?)
- La transition de statut (passe par order-status-machine ?)
- Les écritures DB (atomicité ? rollback en cas d'erreur ?)
- Les notifications envoyées
- Les logs structurés

RISQUES À CHASSER :
- Une commande créée mais pricing recalculé à un autre moment (incohérence prix)
- Un payment intent créé sans order côté DB
- Une commande marquée paid sans event Stripe correspondant
- Un guest qui peut voir la commande d'un autre (failure auth)

LIVRABLE : docs/_work/AUDIT_G2_STRIPE_FLOW.md
RÈGLES : [coller]
```

---

## §5 — Lot 4 : AUDIT-G1 — Flow cash → retrait relais

**Périmètre** : le flow le plus utilisé probablement. Client commande, paie cash chez un relais, livraison, retrait avec QR/PIN.

### Fichiers à uploader

```
routes/orders/create.js
routes/cash.js
routes/cash-confirm.js
routes/cash-pin.js
routes/cash-relay.js (si existe)
routes/parcels.js (le bon, pas le fantôme)
routes/pickup-secret.js
routes/orders/qr.js
services/order-status-machine.js
services/parcelOptimizationService.js
migrations/*cash*.sql
migrations/*parcel*.sql
migrations/*pickup*.sql
migrations/*relais*.sql
```

### Prompt prêt à coller

```
Audit complet du flow paiement cash + retrait relais.

ÉTAPES À TRACER :
1. Client POST /api/orders avec mode=cash
2. Order créée (status=pending_cash ou similaire)
3. Client se présente chez un relais avec une référence
4. Relais saisit la référence (route routes/cash.js)
5. Confirmation cash → status=confirmed
6. Préparation hub → status=ordered
7. Expédition vers Comores → status=shipped → in_transit
8. Arrivée → status=available
9. Client se présente avec QR ou PIN → status=collected

QUESTIONS :

1. Qui peut confirmer cash ? Comment l'authent relais est-elle gérée ?
2. La référence cash est-elle unique et non-devinable ?
3. Que se passe-t-il si 2 relais confirment la même commande simultanément ?
4. Le PIN/QR de retrait : durée de vie, usage unique, rotation ?
5. La logistique (parcel) : comment est-elle créée ? Quand ?
6. Annulation après confirmation cash : refund cash possible ? Manuel ou automatique ?

LIVRABLE : docs/_work/AUDIT_G1_CASH_FLOW.md
RÈGLES : [coller]
```

---

## §6 — Lot 5 : AUDIT-G4 — Annulation + Refund

**Périmètre** : tous les chemins qui annulent une commande (par client, admin, ou système). Stripe refund + cash refund.

### Fichiers à uploader

```
routes/orders/cancel.js
routes/orders/status.js (si refund passé par là)
services/order-status-machine.js
services/payment-service.js (si existe)
routes/payments.js (parties refund)
```

### Prompt prêt à coller

```
Audit des chemins d'annulation + refund.

QUESTIONS :

1. Qui peut annuler une commande ? À quels statuts ?
2. La transition vers cancelled passe-t-elle bien par order-status-machine ?
3. Refund Stripe :
   - Quand est-il déclenché (auto/manuel) ?
   - Que se passe-t-il si Stripe API échoue ?
   - L'idempotency key est-elle utilisée ?
4. Refund cash :
   - Comment est-il opéré (process manuel ?) ?
   - Y a-t-il une trace en DB ?
5. Annulation d'une commande collective :
   - Tous les contributeurs sont-ils refundés ?
   - Cas où 1 refund échoue : rollback complet ou laisse passer ?
6. Annulation après expédition (shipped) :
   - Possible ? À quel coût pour le client ?

LIVRABLE : docs/_work/AUDIT_G4_CANCEL_REFUND.md
RÈGLES : [coller]
```

---

## §7 — Lot 6 : AUDIT-D1 — Routes admin (auth coverage)

**Périmètre** : vérifier exhaustivement que chaque route admin a `authenticate + requireAdmin`.

### Fichiers à uploader

```
server.js
routes/admin.js
routes/admin-*.js (tous)
middleware/authenticate.js
middleware/require-admin.js (ou équivalent)
middleware/permissions.js (si existe)
```

### Prompt prêt à coller

```
Audit de couverture authent/autorisation sur toutes les routes admin.

MÉTHODE :
1. Lister TOUTES les routes commençant par /admin ou /api/admin
2. Pour chaque route, identifier :
   - La méthode HTTP
   - Le path complet
   - Les middlewares appliqués (dans l'ordre)
   - Le handler

3. Pour chaque route, vérifier :
   - Présence de authenticate ?
   - Présence de requireAdmin (ou équivalent) ?
   - Si exemption : pourquoi ? (lecture publique ? webhook ?)

4. Produire un TABLEAU exhaustif :
   | Méthode | Path | authenticate | requireAdmin | Exception justifiée ? |

5. Lister les TROUS (route admin sans authent/autz adéquat)

LIVRABLE : docs/_work/AUDIT_D1_ADMIN_AUTH.md (avec le tableau)
RÈGLES : [coller]
```

---

## §8 — Lot 7 : AUDIT-D3 — Auth guest UUID

**Périmètre** : `middleware/auth-guest.js` et son usage. Les hotfixes `hotfix/fix-auth-guest-uuid-*` indiquent une zone instable.

### Fichiers à uploader

```
middleware/auth-guest.js
middleware/authenticate.js
routes/auth.js (toutes les variantes : authkey, magic-link, otp...)
routes/auth-*.js
migrations/*guest*.sql
migrations/*uuid*.sql
```

### Prompt prêt à coller

```
Audit du système d'authentification guest. Les branches hotfix/fix-auth-guest-uuid-*
suggèrent une zone instable.

QUESTIONS :

1. Comment un guest est-il identifié ?
   - Cookie ? Token ? UUID local + serveur ?
   - Quelle durée de vie ?
2. Quel est l'historique des bugs récents (lire les hotfixes Git si possible) ?
3. Le UUID guest est-il :
   - Cryptographiquement sûr (UUIDv4 ou similaire) ?
   - Non-devinable ?
   - Non-réutilisable après expiration ?
4. Un guest peut-il :
   - Devenir user authentifié (claim) ?
   - Récupérer ses commandes pré-claim ?
   - Voir les commandes d'un autre guest ?
5. Le mélange guest/auth dans les routes : claire et explicite ?

LIVRABLE : docs/_work/AUDIT_D3_AUTH_GUEST.md
RÈGLES : [coller]
```

---

## §9 — Lot 8 : AUDIT-D4 — Tokens QR / pickup secret

**Périmètre** : le secret de retrait au relais, la génération de QR.

### Fichiers à uploader

```
routes/pickup-secret.js
routes/orders/qr.js
services/pickup-secret-service.js (si existe)
migrations/*pickup*.sql
migrations/*qr*.sql
```

### Prompt prêt à coller

```
Audit du système de tokens de retrait (QR + PIN/secret).

QUESTIONS :

1. Comment le secret/QR est-il généré ?
   - Algorithme (random sûr ?)
   - Longueur / entropie
   - Quand : à la création ? à l'expédition ? à la disponibilité ?
2. Quelle durée de vie ?
3. Le secret est-il :
   - Single-use (invalidé après utilisation) ?
   - Lié à une commande spécifique uniquement ?
   - Renouvelable en cas de perte ?
4. Quel est le rate limiting sur la vérification (anti-brute-force) ?
5. Que se passe-t-il après N tentatives échouées ?
6. Les logs des tentatives échouées sont-ils suffisants pour détecter une attaque ?
7. Le QR contient quoi exactement (juste un token, ou des infos client) ?

LIVRABLE : docs/_work/AUDIT_D4_PICKUP_TOKENS.md
RÈGLES : [coller]
```

---

## §10 — Lot 9 : AUDIT-G5 — Flow sourcing → ajout produit (cible business future)

**Pourquoi en dernier** : le moins urgent du point de vue go-live (pas sur le chemin critique paiement), mais **fondamental pour les évolutions futures** côté sourcing.

### Fichiers à uploader

```
routes/sourcing-engine.js
routes/sourcing-scanner.js
routes/admin.js (parties produits)
services/supplier-catalog-scanner.js
services/suppliers/ (tout le dossier)
services/pricing-engine.js (utilisation)
services/cost-allocation.js
migrations/*supplier*.sql
migrations/*sourcing*.sql
migrations/*catalog*.sql
migrations/*cost*.sql
migrations/*pricing*.sql
migrations/*partner*.sql
```

### Prompt prêt à coller

```
Audit du flow sourcing complet — depuis l'identification d'un produit candidat
chez un fournisseur jusqu'à sa mise en vente sur la boutique.

CONTEXTE :
- Le sourcing est la CIBLE BUSINESS prioritaire des évolutions futures
- Komerce sélectionne des produits chez des fournisseurs (Noon, CSV import,
  saisie manuelle, et futurs connecteurs)
- Le moteur sourcing analyse le portefeuille et éclaire les décisions

QUESTIONS :

1. CONNECTEURS
   - Comment les 3 connecteurs (manual, csv, noon) sont-ils utilisés ?
   - Quelle est l'interface commune (api-connector.base.js) ?
   - Les données sont-elles normalisées avant entrée en DB ?

2. SCAN & ANALYSE
   - Comment supplier-catalog-scanner identifie les candidats ?
   - L'analyse (analyzeProduct) utilise quelles métriques ?
   - Les seuils sont-ils variabilisés (finance_config) ?

3. ENRICHISSEMENT
   - Une fois identifié, comment un produit passe de candidat à produit vivant ?
   - Qui décide (admin ?), avec quels critères ?
   - Le pricing et le cost_allocation sont-ils déclenchés automatiquement ?

4. DOUBLONS COLONNES
   - cost_kmf vs cost_price_kmf : laquelle est la source de vérité ?
   - weight_kg vs weight_g : idem ?
   - Quel est le plan de normalisation ?

5. ÉVOLUTIONS PRÉVUES
   - Lire les commentaires "Vague 3", "LOT I" etc.
   - Comprendre la philosophie globale du moteur
   - Identifier ce qui est PRÊT pour les évolutions et ce qui est BLOQUANT

LIVRABLE : docs/_work/AUDIT_G5_SOURCING_FLOW.md
RÈGLES : [coller]
```

---

## §11 — Que faire après les 9 audits ?

Une fois les 9 audits réalisés, tu auras une **photo exhaustive** de ce qui doit être protégé / corrigé / blindé.

### Synthèse à produire (lot 10, mais petit)

Un dernier document `docs/_work/AUDIT_SYNTHESIS.md` qui :
- Liste les 5-10 risques **bloquants go-live** identifiés par les 9 audits
- Liste les 10-20 risques **à surveiller** mais non-bloquants
- Renvoie pour chaque risque vers le lot correspondant dans `BACKEND_GOLIVE_ROADMAP.md`
- Donne un verdict global : "go-live possible si X, Y, Z sont faits"

### Insertion dans la roadmap

Chaque risque bloquant doit avoir un lot correspondant dans `BACKEND_GOLIVE_ROADMAP.md`. Si le lot n'existe pas, le créer.

Exemple : si AUDIT-D2 révèle "le webhook ne vérifie pas la signature dans le cas X", créer le lot `FIX-WEBHOOK-SIGNATURE` dans le bloc D.

### Décision go-live

Une fois les bloquants traités (lots de fix créés et exécutés), le go-live peut être planifié.

---

## §12 — Pour chaque session : checklist d'ouverture

Quand tu ouvres une nouvelle session pour un audit :

- [ ] Identifier le lot ciblé dans ce document
- [ ] Préparer le zip avec les fichiers listés
- [ ] Coller le prompt prêt-à-l'emploi
- [ ] Ajouter en début de session les 7 règles méthodologiques
- [ ] Préciser le format de livrable attendu
- [ ] À la fin : récupérer le markdown, le placer dans `docs/_work/`
- [ ] Cocher le lot dans ce document

---

## §13 — Suivi global des sessions

| Date | Lot | Durée | Verdict | Bloquant go-live ? |
|---|---|---|---|---|
| | AUDIT-D2 | | | |
| | AUDIT-G3 | | | |
| | AUDIT-G2 | | | |
| | AUDIT-G1 | | | |
| | AUDIT-G4 | | | |
| | AUDIT-D1 | | | |
| | AUDIT-D3 | | | |
| | AUDIT-D4 | | | |
| | AUDIT-G5 | | | |

À remplir au fur et à mesure.

---

*Document généré le 2026-05-16 pour planifier l'audit profond pré-go-live.*
*À placer dans `docs/BACKEND_AUDIT_SESSIONS_PLAN.md` du repo.*
