# Contrat API — Liste partageable (Étape 2 du mandat d'implémentation)

**Statut** : proposition, à valider avant Étape 3 (implémentation front).
**Source unique** : CONTRAT_UX_LISTE_PARTAGEABLE.md, INVARIANTS_UX_LISTE_PARTAGEABLE.md. Aucun champ n'est ajouté « au cas où » — chaque champ cite l'invariant ou l'événement qui le rend nécessaire.
**Méthode** : un tableau par écran/action, puis la liste des écarts entre ce contrat et le backend existant (Lot 4), classés par gravité.

---

## 1. Lecture publique — écran d'entrée

**Événement source** : Ouverture du lien (Contrat UX §3, ligne 1).

### Données affichées et leur justification

| Donnée | Nécessaire pour | Invariant / ligne source |
|---|---|---|
| Prénom du créateur | Bandeau inviteur | Contrat UX §1 ; Invariant 2 (jamais un rôle, jamais l'identité complète non plus — voir §5 de ce document) |
| Titre de la liste (nullable) | Bloc titre/message | Contrat UX §1 ; Invariant 5 (absence = état normal) |
| Message de la liste (nullable) | Bloc titre/message | Contrat UX §1 |
| Nombre total d'articles | Indicateur de progression | Contrat UX §1, §2 |
| Nombre d'articles déjà achetés | Indicateur de progression | Contrat UX §1, §2 ; Invariant 12 |
| Statut de la liste (`open` / `closed` / `cancelled`) | Détermine l'état d'écran (Partielle/Complète vs Fermée vs Annulée) | Contrat UX §2 |
| Par article : identifiant, nom, image, prix | Grille d'articles | Contrat UX §1 |
| Par article : statut disponible/déjà acheté | Grille d'articles, contrôle de sélection | Contrat UX §1 ; Invariant 7 |
| Par article : identifiant de l'article de liste (`shared_cart_item_id`) | Construire l'appel d'achat (§3 de ce document) | Contrat UX §3, ligne « Clic Acheter la sélection » |
| `is_creator` (booléen dérivé, jamais l'identifiant brut) | Affichage conditionnel des contrôles créateur | Contrat UX §1, colonne « En plus, si vous avez créé cette liste » ; Invariant 1 — **proposé, dépend du point 2 (§5)** |

### Explicitement exclu — retiré, résolu au point 1 (§5)

- **`total_kmf`** (montant total de la liste). Aucune ligne du storyboard ni du contrat UX n'affiche un total monétaire de la liste entière — seul le prix par article (dans la grille) et un mini-total de *la sélection de l'acheteur* (calculable côté client à partir des prix déjà transmis) sont prévus. **Retiré de la réponse.**
- **`category` par article.** Aucune ligne du contrat UX ne mentionne l'affichage d'une catégorie sur cette grille. **Retiré.**

---

## 2. Capacités du créateur (mêmes écrans, contrôles supplémentaires)

**Événements source** : Contrat UX §3, quatre dernières lignes ; tranché immédiat/confirmation dans CONTRAT_UX §5.

| Action | Endpoint (retenu — option A, §5 point 4) | Payload nécessaire | Confirmation cliente requise | Invariant |
|---|---|---|---|---|
| Ajouter un article | `POST /:id/items` | Identifiant du produit choisi dans le picker | Non | Invariant 20 (extension actée avec toi) |
| Retirer un article | `DELETE /:id/items/:itemId` | Identifiant de l'article de liste à retirer (dans l'URL) | **Oui** | Invariant 21 |
| Fermer la liste | Écriture unitaire (déjà existant : `POST /:id/close`) | — | **Oui** | Invariant 21 |

Édition du titre et du message : **hors périmètre de cette version** (point 3, §5) — le bloc reste en lecture seule pour tout le monde, y compris le créateur.

Chaque ligne correspond à **un appel, une action** — jamais un remplacement global de la liste d'articles. C'est la traduction directe de l'invariant 20 (immédiat, pas de brouillon groupé).

---

## 3. Achat

**Événement source** : Contrat UX §3, « Clic Acheter la sélection » ; Invariant 16, 17.

| Donnée envoyée | Justification |
|---|---|
| Liste des `shared_cart_item_id` sélectionnés | Un seul appel pour toute la sélection (Invariant 17) |
| — | Aucune autre donnée liste-spécifique : le reste du payload est celui du checkout canonique déjà existant, inchangé |

**Réponse attendue en cas de conflit** : un signal exploitable pour reconstruire le message *« cet article vient d'être acheté »* (Contrat UX §2, ligne Achat refusé) et permettre à l'écran de rafraîchir la grille sur les articles réellement restants (Invariant 18) — déjà fourni par le mécanisme existant (violation de contrainte traduite en réponse explicite).

---

## 4. Aperçu de lien (hors API JSON)

**Événement source** : Contrat UX §1 (implicitement, via le composant « Aperçu de lien »).

Ce n'est pas un endpoint JSON — ce sont des balises générées côté serveur au moment du rendu HTML de la page publique. Nécessite, par liste : une image représentative des articles, un titre au format *« La liste de [Prénom] »*, une description courte (nombre d'articles). Mêmes données que la lecture publique (§1 de ce document), simplement rendues en HTML plutôt qu'en JSON. Aucun champ supplémentaire à exposer par ailleurs.

---

## 5. Écarts entre ce contrat et le backend existant — arbitrages

### Point 1 — corrigé

`shared_cart_item_id` (`items[].id`) est désormais présent dans la réponse de `getSharedCartForPublic`. C'était un bug — le champ était déjà calculé en SQL, simplement perdu au moment de construire la réponse. Corrigé directement dans `services/shared-cart-reads.js`, testé (`tests/unit/shared-cart-reads.test.js`), suite complète validée (321/321).

Dans le même geste : `total_kmf` et `category` par article, retirés de la même réponse (§1 de ce document, « explicitement exclu ») — aucune ligne du contrat UX ne les justifie.

### Point 2 — corrigé

**Invariant** : une seule URL, un seul écran, atteint par le même lien pour tout le monde y compris la personne qui a créé la liste.

**Implémentation retenue.** Le mécanisme proposé a été appliqué tel quel : `middleware/soft-auth.js` (`softAuthenticate`), qui peuple `req.user` si un token valide est présent, sans jamais bloquer la requête si absent — précédent d'usage réel sur `routes/orders/detail.js`.

Réalisé :

1. `softAuthenticate` monté sur `GET /public/:token`.
2. `getSharedCartForPublic(token, viewerUserId)` reçoit ce second paramètre optionnel.
3. La requête SQL de lecture inclut `organizer_user_id` en interne pour la comparaison — **ce champ n'est jamais renvoyé tel quel dans la réponse JSON**, conformément à l'invariant de confidentialité existant.
4. La réponse porte un champ dérivé unique, booléen : `is_creator`. Le front s'appuie uniquement sur ce booléen — jamais sur l'identifiant brut.
5. `GET /:id` (route authentifiée séparée, `getSharedCartForOwner`) reste en place pour l'instant — retrait non fait, pour ne pas mélanger cette correction avec une suppression (point non révisé par ce tour).

Testé (`tests/unit/shared-cart-reads.test.js`, `tests/unit/shared-cart-public-route.test.js`, `tests/unit/shared-cart-creator-route.test.js`), suite complète validée (321/321 au moment de ce lot).

### Point 3 — explicitement hors périmètre

Édition du titre et du message après création : retiré du périmètre de cette première version, sauf besoin démontré ultérieurement. Le bloc titre/message (Contrat UX §1) reste donc **en lecture seule pour tout le monde, y compris le créateur**, dans cette version. Le crayon d'édition inline mentionné au storyboard n'est pas construit maintenant — à traiter comme une extension future, pas comme un manque de cette livraison.

### Point 4 — supersédé : liste publiée structurellement immuable

La doctrine produit a été simplifiée : la publication crée le snapshot définitif de la liste. `OPEN` signifie **achetable**, jamais **éditable**.

Les capacités historiques de réédition post-publication sont donc supprimées, et non désactivées dans l'interface :

- `GET /:id/as-cart-items` — supprimé ;
- `PUT /:id/items` — supprimé ;
- `POST /:id/items` — supprimé ;
- `DELETE /:id/items/:itemId` — supprimé ;
- `PATCH /:id/items/:itemId` — supprimé ;
- `services/shared-cart-items-service.js` — supprimé.

Une correction par l'organisateur suit désormais un seul parcours : **fermer la liste erronée puis publier une nouvelle liste**. L'ancien lien reste associé à son snapshot fermé.

Les changements transactionnels restent autorisés : achat d'une ligne, claim dérivé de la commande, paiement des lignes disponibles et fermeture de la liste.
---

## 6. Statut

Ce contrat conserve l’historique des décisions ayant conduit à l’implémentation actuelle. La doctrine active est désormais celle du **snapshot immuable dès publication** : aucune API de réédition de ligne n’est exposée après création. Les tests de route garantissent explicitement que ces anciens endpoints répondent `404`.
