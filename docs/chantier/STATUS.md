# Komerce — État opératoire du chantier

> Mis à jour : **2026-06-15**  
> Repo : `SamyrFateh/komerce-backend` — branche de référence : `main`  
> Rôle : état courant vérifié contre les documents actifs, audits historiques accessibles et code actuel.  
> Principe : une dette ancienne n'est ouverte ici que si elle est encore confirmée ou non tranchée après confrontation au code.

---

## 1. Point d'entrée obligatoire

Lire dans cet ordre :

1. [`AGENTS.md`](../../AGENTS.md) — règles obligatoires pour agent/dev ;
2. [`docs/README.md`](../README.md) — index documentaire actif ;
3. ce fichier `docs/chantier/STATUS.md` ;
4. [`docs/doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../doctrine/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
5. [`docs/implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md`](../implementation/PANIER_PARTAGE_BOUTIQUE_FIRST.md) ;
6. les docs techniques listées dans `docs/README.md` seulement si la zone touchée l'exige.

Ne pas reprendre le chantier depuis un ancien audit, un ancien prompt, une ancienne PR fermée, un changelog ou un document non listé dans `docs/README.md`.

---

## 2. Doctrine produit active — panier partagé

Le panier partagé est **Boutique First**.

```txt
Tout commence dans la boutique.
Tout se comprend dans la boutique.
Tout revient dans la boutique.
```

Règle : Komerce ne construit pas une cagnotte ni un workspace financier. Komerce matérialise un achat réel, visible, plafonné au reste dû.

Les documents V4.1, collective workspace, cagnotte, engagement ou financement collectif sont historiques sauf s'ils sont explicitement repris dans les deux documents actifs Boutique First.

---

## 3. État actuel vérifié — panier partagé

État de référence après réalignement documentaire et vérification code :

- Entrée participant : `/boutique/?p=TOKEN`.
- Anciennes URLs `/c/:token`, `/cart/shared*`, `/account/shared-carts` redirigent vers la boutique avec `p=TOKEN` et `tab=group`.
- Deux natures produit : `ready_to_pay` et `needs_validation`.
- `ready_to_pay` crée un panier immédiatement payable (`status = closed`) avec `payment_window_ends_at`.
- `needs_validation` reste consultable (`status = open`) jusqu'à ouverture paiement par le créateur.
- Bouton argent visible attendu : `Régler ma part`.
- Participant : lecture seule, snapshot produit, aucun ajout/modification/suppression.
- Paiement public : accepté seulement si le panier est payable côté moteur.
- Montant : plafonné au `remaining_kmf` réel côté serveur.
- Retour Stripe : `/boutique/?p=TOKEN&shared_payment=success|cancel`.
- Statuts humains attendus : `En préparation`, `Ouvert au paiement`, `Fermé`, `Finalisé`, `Annulé`.

---

## 4. Dettes ouvertes confirmées ou non tranchées

### D-01 — Tests manuels Boutique First à exécuter en réel

Statut : **ouvert**.

À vérifier sur environnement réel :

1. **Cas A — Prêt à payer** : création, lien, bouton `Régler ma part`, paiement, retour boutique, reste mis à jour.
2. **Cas B — À valider ensemble** : consultation sans paiement, ouverture plus tard, apparition du bouton.
3. **Cas C — Lecture seule** : fiche article snapshot, aucun bouton d'action.
4. **Cas D — Statuts** : aucun statut technique visible côté participant.
5. **Cas E — Dépassement du reste** : maximum annoncé et borné avant paiement.

### D-02 — Vocabulaire V4.1 encore présent dans le code interne

Statut : **dette de lisibilité, pas bug produit confirmé**.

Le code backend conserve des noms/commentaires V4.1 (`shared-cart-engine`, cron state machine, `awaiting_choice`, `closed`, etc.). C'est acceptable tant que la projection humaine Boutique First masque ces termes. Ne pas renommer mécaniquement sans tests, car ces statuts sont liés au schéma DB, aux migrations et aux transitions.

À surveiller : aucune UI participant ne doit exposer `open`, `closed`, `awaiting_choice`, `ordered`, `expired`, `archived`, “financé”, “cagnotte”, “engagement”, “workspace collectif”.

### D-03 — Cartographie 360 partiellement divergente du code actuel

Statut : **ouvert documentaire**.

Points confirmés :

- `docs/CARTOGRAPHY_360.md` liste encore `/api/collective-workspaces`, `/api/collective-payments` et `/api/collective-payments/stripe/webhook` comme domaines montés.
- Le code actuel indique au contraire que le bloc collective-workspaces est démonté et que le webhook collective-payments est supprimé.
- `bootstrap/api-routes.js` ne monte pas `/api/collective-workspaces` ni `/api/collective-payments`.

Action : mettre à jour `docs/CARTOGRAPHY_360.md` pour classer `collective_*` comme historique DB / non monté, sauf preuve inverse.

### D-04 — Cartographie 360 contient des alias admin devenus 404

Statut : **ouvert documentaire**.

Point confirmé :

- La cartographie liste `/api/admin/pilotage` et `/api/admin/stats` avec `/api/dashboard`.
- Le manifest actuel indique que `/api/admin/pilotage` et `/api/admin/stats` ont été supprimés comme alias historiques ; le chemin canonique est `/api/dashboard`.

Action : corriger `docs/CARTOGRAPHY_360.md` pour éviter qu'un agent réintroduise ces alias.

### D-05 — Webhook Authkey : dette doc corrigée côté code, cartographie à affiner

Statut : **ouvert documentaire mineur**.

Le code protège `/webhook/authkey-whatsapp` avec `verifyAuthkeyWebhook`. En production, l'absence de `AUTHKEY_WEBHOOK_SECRET` fait rejeter le webhook. Les anciennes formulations “non authentifié / IP whitelist recommandée” ne reflètent plus exactement le code.

Action : aligner `CARTOGRAPHY_360.md` et `SECURITY-MODEL.md` sur le secret partagé `AUTHKEY_WEBHOOK_SECRET`.

### D-06 — Versionning applicatif incohérent mais non bloquant

Statut : **ouvert documentaire / hygiène release**.

État vérifié :

- `package.json` : `10.6.1`.
- En-tête `server.js` : `v10.6.1` avec changelogs v10/v11.
- `/api/health` retourne `require('./package.json').version`, donc la valeur runtime suit `package.json`.

Action : ne pas considérer les anciens audits mentionnant v12.3/v12.4 comme état actuel sans vérification. Décider une convention release unique avant prochain tag prod.

### D-07 — Refacto routes : fichiers historiques doublons non tranchés

Statut : **ouvert technique faible priorité**.

État vérifié :

- `routes/orders.js` monte les sous-routes actuelles depuis `routes/orders/*`.
- `routes/orders/status.js` et `routes/routes_orders_status.js` ont le même contenu apparent.
- `routes/orders/cancel.js` et `routes/routes_orders_cancel.js` ont le même contenu apparent.
- Le `STATUS` précédent mentionnait déjà `routes_orders_status.js` / `routes_orders_cancel.js` comme orphelins à arbitrer.

Action : confirmer par recherche d'imports complète avant suppression. Si aucun import, supprimer ou archiver pour éviter les faux positifs futurs.

### D-08 — `docs/SCHEMA.md` contient une dette N4 JWT probablement obsolète ou à revalider

Statut : **à revalider contre DB live**.

Le schéma daté du 26 mai 2026 indique que `revoked_tokens` n'était pas appliquée sur Railway et que le câblage applicatif restait à faire. Le code actuel démarre `startJwtRevocationCleanupCron()` et tente de purger `revoked_tokens`.

Action : vérifier DB live Railway. Si la table existe, corriger `docs/SCHEMA.md`. Si elle n'existe pas, c'est une dette technique réelle car le cron loguera une erreur périodique.

### D-09 — Docs Boutique historiques subordonnées

Statut : **surveillance documentaire**.

`docs/README.md` déclare `public/boutique/docs/**` historique ou généré. Les documents Boutique actifs sont :

- `docs/boutique/README.md` ;
- `public/boutique/README.md` ;
- `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` ;
- `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` ;
- `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`.

Action : si un audit local Boutique contredit ces documents ou le code, le classer explicitement comme historique et ne pas le recopier dans une tâche.

---

## 5. Faux positifs / dettes écartées après vérification

### FP-01 — “Le lien partagé ouvre un checkout direct”

Écarté.

Le code actuel génère les liens publics en `/boutique/?p=TOKEN`. Les anciens chemins `/c/:token` et `/cart/shared*` redirigent aussi vers la boutique.

### FP-02 — “Le paiement peut dépasser le reste dû”

Écarté côté serveur.

La route publique contribution recharge `remaining_kmf`, calcule `payableAmount = min(requestedAmount, remainingNow)`, puis retourne `capped: true` si le montant demandé dépasse le reste. L'UI doit quand même afficher clairement le maximum avant paiement.

### FP-03 — “Le participant peut modifier le panier partagé”

Écarté côté API publique.

Les routes de modification `PUT /api/shared-carts/:id/items` sont authentifiées créateur et passent par les services dédiés. La lecture publique retourne des items snapshot et n'expose pas l'UUID interne du panier.

### FP-04 — “Le retour Stripe mène à une page morte”

Écarté côté backend.

Les URLs Stripe success/cancel renvoient vers `/boutique/?p=TOKEN&shared_payment=success|cancel`.

### FP-05 — “Les anciennes PR fermées non mergées sont des dettes ouvertes par défaut”

Écarté.

Les PR fermées non mergées (#3, #4, #6, #7, #8, #9, #14 observées dans l'historique accessible) sont historiques par défaut. Leur contenu ne devient dette ouverte que si le code actuel ou une doc active confirme encore le problème.

### FP-06 — “BUG-014 JWT localStorage est encore ouvert par défaut”

Écarté comme dette par défaut.

L'historique PR indique une migration httpOnly cookie mergée. Toute réouverture doit être basée sur vérification code actuelle et tests frontend, pas sur l'ancien audit.

### FP-07 — “`cart_shares` / `cart_contributions` absents de la cartographie”

Écarté.

`docs/CARTOGRAPHY_360.md` mentionne maintenant `/api/shares` et distingue `cart_shares` / `cart_contributions` de `/api/shared-carts`. L'ancienne dette `SCHEMA.md` sur ce point est donc probablement périmée.

---

## 6. Audits et historiques : règle de traitement

Les audits passés servent à rechercher des risques, pas à décider l'état courant.

Classement opératoire :

| Source | Statut par défaut | Règle |
|---|---|---|
| `docs/README.md` | actif | point d'entrée documentaire |
| `AGENTS.md` | actif | règle supérieure agent/dev |
| `docs/chantier/STATUS.md` | actif | état courant |
| Docs listées dans `docs/README.md` | actives selon zone | vérifier contre code/DB |
| `docs/audit/**` | historique/contextuel | ne devient actif qu'après recoupement code |
| `docs/chantier/*_AUDIT_*.md` | historique/contextuel | ne pas recopier sans vérification |
| `docs/_archive/**` | historique | subordonné |
| `public/boutique/docs/**` | local/historique/généré | subordonné à `docs/boutique/*` |
| PR fermées non mergées | historique | non opératoire sauf recoupement |
| PR mergées anciennes | contexte | vérifier si les fichiers existent encore |

---

## 7. Tests prioritaires

### Panier partagé Boutique First

1. **Cas A — Prêt à payer** : création, lien, bouton `Régler ma part`, paiement, retour boutique, reste mis à jour.
2. **Cas B — À valider ensemble** : consultation sans paiement, ouverture plus tard, apparition du bouton.
3. **Cas C — Lecture seule** : fiche article snapshot, aucun bouton d'action.
4. **Cas D — Statuts** : aucun statut technique visible.
5. **Cas E — Dépassement du reste** : maximum annoncé et borné avant paiement.

### Docs/code

1. Vérifier que `docs/CARTOGRAPHY_360.md` ne déclare plus de routes collectives démontées comme montées.
2. Vérifier que `docs/CARTOGRAPHY_360.md` ne déclare plus `/api/admin/pilotage` et `/api/admin/stats` comme actifs.
3. Vérifier DB live pour `revoked_tokens`.
4. Vérifier les imports avant suppression éventuelle des doublons `routes_routes_*`.

---

## 8. Règle de mise à jour

Ce fichier doit rester court mais explicite sur les dettes ouvertes.

Quand une dette est traitée :

1. citer le fichier/code qui la ferme ;
2. déplacer l'ancien point en faux positif ou le supprimer ;
3. corriger le document actif concerné dans la même PR ;
4. ne jamais réactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne doit devenir opératoire sans être ajouté à `docs/README.md`.
