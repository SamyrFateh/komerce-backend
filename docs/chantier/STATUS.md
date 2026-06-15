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

### D-03 — Webhook Authkey : modèle de sécurité à enrichir

Statut : **ouvert documentaire mineur**.

État vérifié :

- Le code protège `/webhook/authkey-whatsapp` avec `verifyAuthkeyWebhook`.
- En production, l'absence de `AUTHKEY_WEBHOOK_SECRET` fait rejeter le webhook.
- `docs/CARTOGRAPHY_360.md` est maintenant aligné sur ce comportement.
- `docs/backend/SECURITY-MODEL.md` reste un document de doctrine ancien, centré pickup/retrait, et ne décrit pas encore ce webhook.

Action : ajouter une courte section Authkey dans `docs/backend/SECURITY-MODEL.md` ou décider que ce niveau de détail reste uniquement dans la cartographie.

### D-04 — Versionning applicatif incohérent mais non bloquant

Statut : **ouvert documentaire / hygiène release**.

État vérifié :

- `package.json` : `10.6.1`.
- En-tête `server.js` : `v10.6.1` avec changelogs v10/v11.
- `/api/health` retourne `require('./package.json').version`, donc la valeur runtime suit `package.json`.

Action : ne pas considérer les anciens audits mentionnant v12.3/v12.4 comme état actuel sans vérification. Décider une convention release unique avant prochain tag prod.

### D-05 — FRESH-003 : fichiers historiques `routes_orders_*`

Statut : **clôturé — 2026-06-15**.

Les trois orphelins ont été supprimés après vérification :

- `routes/routes_orders_cancel.js` ;
- `routes/routes_orders_status.js` ;
- `routes/routes_orders_parcels.js`.

État vérifié :

- les routes actives sont dans `routes/orders/` et montées par `routes/orders.js` ;
- `routes_orders_cancel.js` et `routes_orders_status.js` étaient des doublons du contenu actif ;
- `routes_orders_parcels.js` était une version inline pré-refacto R4 ; la logique active vit dans `services/parcel-operations.js` et `routes/orders/parcels.js` délègue correctement.

Voir [`routes/ORPHELINS_FRESH003.md`](../../routes/ORPHELINS_FRESH003.md).

### D-06 — `docs/SCHEMA.md` contient une dette N4 JWT probablement obsolète ou à revalider

Statut : **à revalider contre DB live**.

Le schéma daté du 26 mai 2026 indique que `revoked_tokens` n'était pas appliquée sur Railway et que le câblage applicatif restait à faire. Le code actuel démarre `startJwtRevocationCleanupCron()` et tente de purger `revoked_tokens`.

Action : vérifier DB live Railway. Si la table existe, corriger `docs/SCHEMA.md`. Si elle n'existe pas, c'est une dette technique réelle car le cron loguera une erreur périodique.

### D-07 — Docs Boutique historiques subordonnées

Statut : **surveillance documentaire**.

`docs/README.md` déclare `public/boutique/docs/**` historique ou généré. Les documents Boutique actifs sont :

- `docs/boutique/README.md` ;
- `public/boutique/README.md` ;
- `docs/boutique/BOUTIQUE_CSS_PIPELINE.md` ;
- `docs/boutique/BOUTIQUE_COMPONENT_OWNERSHIP.md` ;
- `docs/boutique/BOUTIQUE_MODAL_ARCHITECTURE.md`.

Action : si un audit local Boutique contredit ces documents ou le code, le classer explicitement comme historique et ne pas le recopier dans une tâche.

### D-08 — R6 shared-cart : dette de lisibilité confirmée

Statut : **ouvert faible priorité — pas de traitement sans tests**.

`routes/shared-cart.js` reste volumineux et conserve le vocabulaire V4.1 dans son en-tête/commentaires (`OPEN`, `CLOSED`, `AWAITING_CHOICE`, etc.). Ce n'est pas un bug produit tant que l'UI Boutique First projette les bons statuts humains.

Règle : ne pas renommer les statuts DB mécaniquement. Toute découpe ou renommage exige des tests couvrant les statuts visibles et techniques (`open`, `closed`, `awaiting_choice`, `ordered`, `cancelled`, `expired`, `archived`).

Action ouverte : si le fichier devient un point de friction, proposer une découpe prudente en sous-routes `public` / `creator` / `admin` dans une branche dédiée avec tests.

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

### FP-08 — “Les routes collective-workspaces / collective-payments sont montées”

Écarté.

`docs/CARTOGRAPHY_360.md` est maintenant aligné avec `server.js` et `bootstrap/api-routes.js` : les routes collectives ne sont pas montées, les tables `collective_*` restent historiques.

### FP-09 — “`/api/admin/pilotage` et `/api/admin/stats` sont des alias API actifs”

Écarté.

La cartographie indique désormais que le chemin API canonique est `/api/dashboard`. Les chemins HTML admin, comme `/admin/pilotage`, restent servis par le dashboard moderne.

### FP-10 — “R8B products-admin est encore à refactorer”

Écarté — vérifié 2026-06-15.

`routes/products.js` délègue déjà les mutations admin à `services/product-admin-service.js` : create, update, delete, image principale, galerie images, remplacement de variantes et suppression de variante.

Dette résiduelle : ajouter des tests ciblés pour `product-admin-service.js`, sans refaire le refacto.

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

### Tests manquants : `product-admin-service.js`

À créer dans `tests/unit/product-admin-service.test.js` :

1. `createProduct` — payload valide, insert produit, audit prix/stock si applicable.
2. `createProduct` — catégorie ou sous-catégorie invalide, réponse 422.
3. `updateProduct` — produit inexistant, réponse 404.
4. `deleteProduct` — désactive `is_active` sans supprimer la ligne.
5. `setMainImage` — met à jour `image_url` et gère produit introuvable.
6. `appendImages` — ajoute dans `images` et initialise `image_url` au premier ajout.
7. `replaceVariants` — remplace atomiquement les variantes et bloque une suppression totale si commandes en cours.
8. `deleteVariant` — bloque si commandes en cours, supprime sinon.

### Docs/code

1. Vérifier DB live pour `revoked_tokens`.
2. Décider si `docs/backend/SECURITY-MODEL.md` doit porter une section Authkey ou rester centré doctrine retrait/paiement.

---

## 8. Règle de mise à jour

Ce fichier doit rester court mais explicite sur les dettes ouvertes.

Quand une dette est traitée :

1. citer le fichier/code qui la ferme ;
2. déplacer l'ancien point en faux positif ou le supprimer ;
3. corriger le document actif concerné dans la même PR ;
4. ne jamais réactiver un audit historique sans preuve code/DB.

Aucun nouveau document ne doit devenir opératoire sans être ajouté à `docs/README.md`.
