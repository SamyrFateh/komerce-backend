# STATUS — Sonnet Panier collectif V4.2

> **Date** : 2026-05-27  
> **Statut** : tâches à coder par Sonnet  
> **Doctrine source** : `docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md`  
> **Objectif** : remettre en cohérence le flux panier collectif boutique-first, sans réintroduire un workspace parallèle.

---

## 1. Lecture obligatoire avant code

Lire dans cet ordre :

1. `docs/chantier/STATUS.md`
2. `docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md`
3. `docs/CARTOGRAPHY_360.md`
4. `docs/ZONE_IMPACT.md`
5. `docs/SCHEMA.md`
6. `docs/CONTRACTS.md`
7. `boutique/docs/BOUTIQUE_DOCS_INDEX.md`
8. `boutique/docs/BOUTIQUE_SOURCE_OF_TRUTH.md`

---

## 2. Principe UX validé

La modification des articles d’un panier collectif doit ramener le créateur dans la boutique, pas dans l’onglet Groupe.

L’onglet Groupe sert à gérer le collectif : participants, engagements, règlement, finalisation, annulation.

La boutique sert à composer les articles.

En mode édition d’un panier collectif, le checkout classique doit être masqué. Le seul CTA principal autorisé est :

```txt
Mettre à jour le panier collectif
```

Le processus prend fin uniquement quand le panier collectif a été re-sauvegardé ou quand le créateur annule explicitement les modifications.

---

## 3. P0 — Mode édition boutique du panier collectif

| ID | Tâche | Fichiers probables | Statut |
|---|---|---|---|
| SC-EDIT-01 | Ajouter un contexte frontend `edit_shared_cart` (`shared_cart_id`, `token`, `return_tab`, `started_at`) | `b-group-view.js`, `b-share-cart.js`, store panier | ☐ |
| SC-EDIT-02 | Le bouton “Modifier les articles” dans l’onglet Groupe doit charger les items du panier collectif puis basculer vers la boutique | `b-group-view.js` | ☐ |
| SC-EDIT-03 | Reconstruire le panier boutique depuis `shared_cart_items`, pas depuis l’ancien `state.cart` | `b-group-view.js`, cart store | ☐ |
| SC-EDIT-04 | En mode `edit_shared_cart`, masquer checkout classique, paiement, validation commande et création collective | `b-cart.js`, `b-checkout.js`, `b-share-cart.js`, templates cart | ☐ |
| SC-EDIT-05 | Ajouter le CTA unique “Mettre à jour le panier collectif” | cart / side cart / mini cart owner réel | ☐ |
| SC-EDIT-06 | Au clic, appeler `PUT /api/shared-carts/:id/items` avec le panier boutique courant | frontend + route existante | ☐ |
| SC-EDIT-07 | Après succès : vider panier boutique, supprimer contexte édition, revenir onglet Groupe, refresh | `b-group-view.js`, cart store | ☐ |
| SC-EDIT-08 | Ajouter “Annuler les modifications” : clear contexte + clear panier temporaire + retour Groupe sans PUT | frontend | ☐ |
| SC-EDIT-09 | Conserver guard backend 409 si `settlement_open = true` ou statut fermé | `routes/shared-cart.js`, `shared-cart-items-service.js` | ☐ |
| SC-EDIT-10 | Ajouter tests ciblés et notes manuelles | tests + STATUS | ☐ |

---

## 4. Critères d’acceptation P0

- Depuis l’onglet Groupe, le créateur voit “Modifier les articles” uniquement en phase ouverte.
- Le clic charge le snapshot du panier collectif dans le panier boutique.
- L’utilisateur arrive dans la boutique, pas dans une page groupe ou workspace.
- Les boutons de checkout classique sont invisibles ou désactivés.
- “Créer un panier collectif” / “Payer en groupe” ne doit pas être proposé pendant l’édition.
- Le CTA principal est “Mettre à jour le panier collectif”.
- Après mise à jour, `PUT /api/shared-carts/:id/items` est appelé.
- Après succès : panier boutique vidé, contexte supprimé, retour onglet Groupe.
- Si le règlement est ouvert, la modification est impossible.
- Les notifications participants restent best-effort et ne bloquent jamais la route.

---

## 5. P1 — Versioning des engagements

| ID | Tâche | Statut |
|---|---|---|
| SC-VERSION-01 | Ajouter `items_version` au panier collectif | ☐ |
| SC-VERSION-02 | Stocker `items_version` sur chaque engagement | ☐ |
| SC-VERSION-03 | Incrémenter la version à chaque mise à jour d’articles | ☐ |
| SC-VERSION-04 | Afficher “à revoir” pour les engagements pris sur une ancienne version | ☐ |
| SC-VERSION-05 | Ne pas supprimer automatiquement les engagements existants | ☐ |

---

## 6. P2 — Panier sauvegardé / liste de souhaits

| ID | Tâche | Statut |
|---|---|---|
| SAVED-CART-01 | Créer le modèle `saved_carts` + `saved_cart_items` | ☐ |
| SAVED-CART-02 | Ajouter “Sauvegarder ce panier” | ☐ |
| SAVED-CART-03 | Ajouter “Reprendre ce panier” | ☐ |
| SAVED-CART-04 | Ajouter “Transformer en panier collectif” | ☐ |
| SAVED-CART-05 | Ne pas connecter cette brique aux paiements ni aux engagements | ☐ |

---

## 7. Interdits pour Sonnet

- Ne pas réintroduire `/event/*` ou `/workspace/*` comme parcours actif.
- Ne pas créer une mini-boutique dans l’onglet Groupe.
- Ne pas appeler `PUT /:id/items` en phase règlement.
- Ne pas permettre un paiement participant avant `settlement_open`.
- Ne pas créer automatiquement une commande avant `POST /:id/finalize`.
- Ne pas mélanger panier sauvegardé, panier collectif et commande.
- Ne pas casser le mobile en corrigeant le desktop.

---

## 8. Prompt court pour Sonnet

```txt
Tu dois implémenter PANIER V4.2.
Lis d’abord docs/doctrine/DOCTRINE_PANIER_COLLECTIF.md puis docs/chantier/STATUS_SONNET_PANIER_V42.md.
Objectif P0 : quand le créateur modifie les articles d’un panier collectif ouvert, il revient dans la boutique en mode edit_shared_cart. Le checkout classique est masqué. Le seul CTA principal est “Mettre à jour le panier collectif”. Après sauvegarde, appeler PUT /api/shared-carts/:id/items, vider le panier boutique, supprimer le contexte et revenir dans l’onglet Groupe.
Ne réintroduis aucun workspace parallèle.
Respecte les invariants STATUS.md et ZONE_IMPACT.md.
```
