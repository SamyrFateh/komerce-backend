# Doctrine panier collectif Komerce

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> **Statut** : document métier canonique  
> **Dernière consolidation** : 27 mai 2026  
> **Source de vérité** : boutique-first, sans workspace parallèle.  
> **Règle de divergence** : en cas de contradiction, ce document fait foi sur les anciens documents “panier partagé”, “collective workspace” ou “panier événement”.

---

## 1. Phrase de vérité

Tout commence dans la boutique.  
Tout se comprend dans la boutique.  
Tout revient dans la boutique.

Le panier collectif n’est pas un espace parallèle. C’est une capacité naturelle du panier boutique : composer un panier, inviter des proches à s’engager, ouvrir le règlement, puis finaliser une commande.

---

## 2. Séparation des objets

| Objet | Rôle | Ce qu’il ne fait pas |
|---|---|---|
| Panier boutique | Composition active des articles | Ne porte pas les engagements collectifs |
| Panier sauvegardé | Brouillon / liste de souhaits réutilisable | Ne porte pas de participants, paiements, commande |
| Panier collectif | Concertation, engagements, règlement collectif | Ne remplace pas la boutique pour composer les articles |
| Commande | Engagement ferme après finalisation | Ne redevient jamais un panier collectif |

Règle produit :

```txt
La boutique compose les articles.
L’onglet Groupe gère les personnes.
Le règlement gère les paiements.
La commande commence uniquement après finalisation.
```

---

## 3. Cycle de vie canonique

```txt
Panier boutique
→ Créer / partager un panier collectif
→ Panier collectif ouvert
→ Engagements indicatifs
→ Passer au règlement
→ Engagements verrouillés
→ Paiements réels Stripe ou cash agent
→ Finalisation créateur
→ Commande créée
```

La commande ferme ne naît qu’à `POST /:id/finalize`.

Aucune contribution participant ne doit être acceptée tant que `settlement_open !== true`.

---

## 4. Modification des articles — règle boutique-first

La modification des articles d’un panier collectif ouvert ne se fait pas dans l’onglet Groupe.

L’onglet Groupe sert à gérer le collectif : participants, engagements, ouverture du règlement, suivi des paiements, finalisation et annulation.

La composition des articles reste une fonction de la boutique.

Lorsqu’un créateur clique sur “Modifier les articles”, le système doit :

1. charger le snapshot `shared_cart_items` dans le panier boutique ;
2. activer un contexte temporaire `edit_shared_cart` ;
3. envoyer l’utilisateur dans la boutique ;
4. masquer le checkout classique ;
5. masquer “Créer un panier collectif” ou “Payer en groupe” ;
6. afficher uniquement le CTA principal “Mettre à jour le panier collectif” ;
7. afficher éventuellement un CTA secondaire “Annuler les modifications”.

Le mode `edit_shared_cart` prend fin uniquement lorsque le panier collectif est sauvegardé à nouveau, ou lorsque le créateur annule explicitement les modifications.

Après sauvegarde :

- `PUT /api/shared-carts/:id/items` remplace le snapshot ;
- le total est recalculé ;
- le panier boutique est vidé ;
- le contexte `edit_shared_cart` est supprimé ;
- l’utilisateur revient dans l’onglet Groupe ;
- un événement d’audit `shared_cart_items_updated` est créé ;
- les notifications participants sont envoyées en best-effort, jamais bloquantes.

---

## 5. Effet sur les engagements

Si les articles changent pendant la phase ouverte, les engagements existants ne doivent pas être supprimés automatiquement.

Ils restent visibles comme engagements indicatifs, mais l’interface doit signaler que le panier a été modifié depuis certains engagements.

Implémentation recommandée :

```txt
shared_cart.items_version
shared_cart_commitments.items_version
```

Chaque modification des articles incrémente `shared_cart.items_version`.

Chaque engagement stocke la version du panier au moment de l’engagement.

L’UI peut alors distinguer :

- “engagement confirmé sur la version actuelle” ;
- “à revoir depuis la dernière modification du panier”.

Cette mécanique est recommandée pour V4.2 mais peut être différée si le P0 se limite au mode édition boutique.

---

## 6. Passage au règlement

Quand le créateur clique sur “Passer au règlement” :

- le panier collectif passe en phase règlement ;
- les engagements sont verrouillés ;
- les participants peuvent payer réellement ;
- les modifications d’articles sont interdites ;
- `PUT /:id/items` doit retourner 409 ;
- la fenêtre de règlement est stockée dans les métadonnées ou dans un statut dédié si migration ultérieure.

---

## 7. Finalisation

La finalisation est une décision du créateur.

Elle transforme le panier collectif en commande.

Après finalisation :

- le statut devient `converted_to_order` ou équivalent ;
- le panier collectif devient non modifiable ;
- la commande suit le cycle de vie normal commande/colis ;
- il n’y a aucun retour possible vers le panier collectif.

---

## 8. Panier sauvegardé / liste de souhaits

Le panier sauvegardé est une fonctionnalité distincte du panier collectif.

Il permet à un utilisateur de conserver une sélection d’articles sans créer immédiatement une commande ni ouvrir une concertation collective.

Un panier sauvegardé peut ensuite être :

- repris dans le panier boutique ;
- transformé en commande individuelle ;
- transformé en panier collectif.

Le panier sauvegardé n’a pas : participants, engagements, règlement, statut de commande.

---

## 9. Interdits

- Ne pas réintroduire `collective_workspace` comme parcours actif.
- Ne pas créer une mini-boutique dans l’onglet Groupe.
- Ne pas permettre un paiement participant avant `settlement_open`.
- Ne pas transformer automatiquement un panier collectif en commande.
- Ne pas mélanger `saved_cart`, `shared_cart` et `order`.
- Ne pas laisser les CTAs checkout classiques actifs en mode `edit_shared_cart`.

---

## 10. Tâches V4.2 confiées à Sonnet

Voir aussi : `docs/chantier/STATUS_SONNET_PANIER_V42.md`.

### P0 — Mode édition boutique du panier collectif

- `SC-EDIT-01` — Ajouter un contexte frontend `edit_shared_cart` avec `shared_cart_id`, `token`, `return_tab = group`, `started_at`.
- `SC-EDIT-02` — Modifier le CTA “Modifier les articles” dans l’onglet Groupe : charger les items du panier collectif puis basculer vers la boutique.
- `SC-EDIT-03` — Reconstruire le panier boutique depuis `shared_cart_items`, sans utiliser l’ancien contenu de `state.cart`.
- `SC-EDIT-04` — En mode `edit_shared_cart`, masquer les CTAs de checkout classique et de création collective.
- `SC-EDIT-05` — Ajouter le CTA unique “Mettre à jour le panier collectif”.
- `SC-EDIT-06` — Au clic, appeler `PUT /api/shared-carts/:id/items` avec le panier boutique courant.
- `SC-EDIT-07` — Après succès, vider le panier boutique, supprimer le contexte d’édition et revenir à l’onglet Groupe.
- `SC-EDIT-08` — Ajouter “Annuler les modifications” : clear contexte + clear panier temporaire + retour Groupe sans PUT.
- `SC-EDIT-09` — Garder le guard backend : modification interdite si règlement ouvert ou statut fermé.
- `SC-EDIT-10` — Ajouter tests manuels et unitaires ciblés.

### P1 — Versioning des engagements

- `SC-VERSION-01` — Ajouter `items_version` au panier collectif.
- `SC-VERSION-02` — Stocker `items_version` sur chaque engagement.
- `SC-VERSION-03` — Incrémenter `items_version` à chaque `PUT /:id/items`.
- `SC-VERSION-04` — Afficher “à revoir” si engagement pris sur une ancienne version.

### P2 — Panier sauvegardé / wishlist

- `SAVED-CART-01` — Créer le modèle `saved_carts` + `saved_cart_items`.
- `SAVED-CART-02` — Ajouter “Sauvegarder ce panier”.
- `SAVED-CART-03` — Ajouter “Reprendre ce panier”.
- `SAVED-CART-04` — Ajouter “Transformer en panier collectif”.
- `SAVED-CART-05` — Ne pas connecter cette brique aux paiements ni aux engagements.
