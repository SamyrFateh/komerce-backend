# Contrat API — Liste partagée

**Version** : 2026-08 — modèle post-migrations 123/124/125.
**Source de vérité** : ce document. `PANIER_PARTAGE_BOUTIQUE_FIRST.md` est la doctrine de direction.

---

## Vocabulaire

| Terme | Définition |
|---|---|
| **snapshot** | Ensemble figé d'articles au moment de la publication. Jamais modifié après création. |
| **OPEN** | Liste publiée, figée, acceptant encore les achats. |
| **CLOSED** | Liste terminée. Consultable dans l'historique, jamais dans le side-cart. |
| **CANCELLED** | Même interdiction que CLOSED. |
| **displayedSharedList** | État frontend local : null ou une liste OPEN. Pas un statut métier. |
| **claim** | Achat d'une ligne de liste : une commande standard créée avec `shared_cart_item_id`. |

---

## Invariants

1. **Immutabilité du snapshot.** Les articles, variantes et quantités d'une liste sont figés à la publication. Aucune route ne les modifie après création.
2. **1 OPEN par créateur.** Un utilisateur ne peut posséder qu'une seule liste en état OPEN simultanément. Garanti par contrainte DB (index unique partiel). Réversible quand les listes deviendront nommables.
3. **Claim atomique.** Une ligne ne peut être achetée qu'une fois. Garanti par `UNIQUE INDEX order_items_shared_cart_item_id_unique` (migration 123). Pas un guard frontend.
4. **Pas de mélange des intentions.** Un checkout liste n'absorbe jamais le panier personnel.
5. **CLOSED jamais dans le side-cart.** Une liste CLOSED/CANCELLED ne prend jamais le slot partagé, quels que soient l'entrée utilisée (lien direct, Mes listes, reload).
6. **Confirmation avant création.** L'utilisateur confirme l'immutabilité avant tout POST de création. Annuler = zéro appel.
7. **Panier vidé après succès, pas avant.** Si la création échoue, le panier personnel est intact.
8. **Séquence post-création.** Succès → snapshot créé → panier vidé → slot sélectionné → lien proposé. Dans cet ordre.
9. **`Partager` ne crée jamais.** Il repartage le lien d'une liste existante. `Créer une liste` et `Partager` sont deux intentions distinctes.
10. **Feuille de partage abandonnée ≠ rollback.** Une liste déjà créée reste valide si l'utilisateur abandonne la feuille de partage.

---

## États

```
                  ┌──────────┐
      publication │          │
   ──────────────>│   OPEN   │
                  │          │
                  └──────────┘
                       │
            close()    │    cancel()
               ┌───────┴───────┐
               ▼               ▼
          ┌────────┐      ┌──────────┐
          │ CLOSED │      │CANCELLED │
          └────────┘      └──────────┘
```

`CLOSED` et `CANCELLED` sont terminaux. Aucune transition retour.

---

## Matrice de rôles

| Action | Organisateur | Participant |
|---|---|---|
| Acheter (une ligne) | ✅ | ✅ |
| Acheter le reste (toutes lignes dispo) | ✅ | ✅ |
| Partager le lien | ✅ | ✅ |
| Fermer la liste | ✅ | ✗ |
| Sauvegarder dans Mes listes | — | ✅ |
| Voir l'identité de l'acheteur | ✅ | ✗ |
| Créer une nouvelle liste pendant qu'une OPEN existe | ✗ (refusé) | ✅ (liste distincte) |

---

## Comportement side-cart

```
[ Mon panier ]                          → toujours disponible
[ Liste partagée ]                      → uniquement si displayedSharedList ≠ null et OPEN
```

Changer d'onglet = **aucun appel de lifecycle**. Ce n'est pas une fermeture.

Fermer une liste OPEN → retirer immédiatement du slot → masquer l'onglet → sélectionner Mon panier.

Ouvrir un lien B quand A est affichée → remplace displayedSharedList par B. A reste OPEN, intacte côté backend.

---

## Contrat checkout

Le checkout ne connaît jamais la liste. Il reçoit un panier canonique éphémère construit par `group-checkout-adapter.js`.

```
PERSONAL_CART    → checkout standard, panier personnel
SHARED_LIST      → checkout standard, panier éphémère (lignes de liste)
                   + contextualisation discrète « Achat pour la liste de X »
```

Restauration du panier personnel à la fermeture du modal de commande (tout chemin de sortie : succès, annulation, Escape, clic overlay).

---

## API autorisées

```
GET    /api/shared-carts/public/:token          lecture publique (softAuthenticate)
POST   /api/shared-carts/from-cart-items        création (authenticateOrCreateGuest)
GET    /api/shared-carts/mine                   mes listes OPEN (authenticate)
GET    /api/shared-carts/library                {created[], saved[]} (authenticate)
POST   /api/shared-carts/save                   sauvegarder une liste reçue (authenticate)
GET    /api/shared-carts/:id                    détail (authenticate)
POST   /api/shared-carts/:id/close              OPEN → CLOSED (authenticate, organisateur)
POST   /api/shared-carts/:id/cancel             OPEN → CANCELLED (authenticate, organisateur)
```

---

## API interdites — ne jamais restaurer

```
GET    /:id/as-cart-items
PUT    /:id/items
POST   /:id/items
PATCH  /:id/items/:itemId
DELETE /:id/items/:itemId
POST   /:id/stripe/webhook
POST   /:id/contributions/*
POST   /:id/finalize
POST   /:id/awaiting-choice/*
```

---

## Erreurs structurantes

| Situation | Code | Message |
|---|---|---|
| Création quand une OPEN existe | 409 | `open_list_exists` + `{ existing_token }` |
| Claim sur ligne déjà achetée | 409 | `already_claimed` (contrainte DB) |
| Activation d'une liste non-OPEN | — | guard frontend, jamais placée dans le slot |
| Panier vide à la publication | 400 | `cart_empty` |
| Fermeture par non-organisateur | 403 | `forbidden` |

Le code `open_list_exists` doit exposer `existing_token` pour que le frontend propose `[ Ouvrir ma liste ]` (arbitrage A2).

---

## Payload GET /public/:token

```json
{
  "id": "uuid",
  "token": "string",
  "title": "string|null",
  "message": "string|null",
  "status": "open|closed|cancelled",
  "organizer_name": "string|null",
  "is_organizer": true,
  "items": [
    {
      "id": "uuid",
      "product_id": "uuid|null",
      "name": "string",
      "image": "https://... (URL absolue http/https)",
      "unit_price_kmf": 10000,
      "quantity": 2,
      "variant_combo": { "couleur": "Noir" } | null,
      "claimed": false,
      "buyer_first_name": "Ali" | null  // null pour les participants
    }
  ]
}
```

**`image` doit être une URL absolue http/https** ou une chaîne vide. Jamais un chemin relatif. Normalisée côté serveur à la lecture (`shared-cart-reads.js`). Le frontend rejette tout ce qui n'est pas http(s) — comportement intentionnel, ne pas l'affaiblir.

---

## Critères d'acceptation

- [ ] Deux créations concurrentes → une seule liste OPEN (constraint DB, pas un if frontend).
- [ ] Refus de création expose `existing_token` utilisable par le frontend.
- [ ] Une liste CLOSED ouverte par lien direct → message informatif, side-cart inchangé.
- [ ] `Acheter` → une seule ligne dans la commande.
- [ ] `Acheter le reste` → toutes les lignes disponibles au moment du clic, aucune ligne du panier personnel. Le bouton n'affiche aucun montant.
- [ ] Le montant "Reste disponible" affiché en surface liste est purement informatif — jamais présenté comme une somme due.
- [ ] Ligne déjà achetée → refus DB atomique sous concurrence.
- [ ] Image : chemin relatif en base → URL absolue en sortie d'API.
- [ ] Sauvegarder → idempotent (POST /save deux fois = même résultat).
- [ ] Fermeture → liste disparaît immédiatement du slot, onglet masqué.
- [ ] Abandon de la feuille de partage post-création → liste reste valide.
