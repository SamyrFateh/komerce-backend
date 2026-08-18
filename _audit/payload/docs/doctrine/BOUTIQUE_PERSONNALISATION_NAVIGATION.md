# Doctrine Boutique — personnalisation de navigation et suggestions

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

> Komerce ne personnalise pas la verite du catalogue. Komerce personnalise l'ordre de decouverte.

Ce document est la doctrine active pour tout ce qui touche aux suggestions boutique, a la personnalisation de l'accueil, au re-ranking des produits, aux rails de navigation, et aux suggestions affichees dans la modal produit.

Il complete les documents Boutique actifs. Il ne remplace pas la doctrine Boutique First : le lien partage ouvre toujours la boutique, et la boutique reste le mecanisme de confiance.

---

## 1. Principe directeur

Le moteur de suggestion n'est pas un bloc UI.

C'est un moteur de personnalisation de navigation.

Son role :

```text
prendre le meme catalogue,
et adapter l'ordre de presentation selon le contexte du visiteur.
```

Il ne change pas :

- les prix ;
- la disponibilite ;
- la verite des produits ;
- les invariants panier / paiement ;
- les droits du participant en panier partage.

Il change uniquement :

- l'ordre des categories ;
- l'ordre des sous-categories ;
- les rails produits mis en avant ;
- les produits remontes dans une grille ;
- les suggestions dans la modal produit ;
- les produits de reprise de navigation.

Phrase de controle :

```text
La boutique reste la meme. Le chemin propose au visiteur devient plus intelligent.
```

---

## 2. Les quatre accueils

Le moteur doit distinguer au moins quatre contextes.

| Contexte | Objectif | Exemple de presentation |
|---|---|---|
| Nouveau visiteur | rassurer et donner une vue large | categories stables, produits populaires, nouveautes |
| Visiteur connu localement | reprendre ses centres d'interet | rails deja vus, categories preferees, produits proches |
| Visiteur avec panier | aider a completer l'intention | complements, alternatives, articles compatibles |
| Visiteur via panier partage | comprendre le panier d'abord | panier partage en priorite, suggestions secondaires et non intrusives |

Regle : un visiteur ne doit jamais etre enferme dans son historique. Le catalogue complet reste accessible.

---

## 3. Signaux utilisables

Le moteur peut utiliser des signaux faibles, mais explicables.

Signaux de navigation :

- produit consulte ;
- categorie consultee ;
- sous-categorie consultee ;
- recherche saisie ;
- rail scrolle ;
- produit ouvert plusieurs fois ;
- temps ou interaction forte sur une fiche ;
- retour arriere vers une categorie.

Signaux panier :

- produit ajoute ;
- quantite augmentee ;
- produit retire ;
- panier actif ;
- categories presentes dans le panier.

Signaux catalogue :

- meme categorie ;
- meme sous-categorie ;
- tags / usage ;
- prix proche ;
- popularite ;
- nouveaute ;
- disponibilite ;
- marge / priorite commerciale si exposee par le backoffice.

Signaux interdits ou a encadrer :

- donnees personnelles sensibles ;
- historique lourd sans consentement ;
- profilage opaque ;
- suggestion non explicable.

---

## 4. Reference produit interne obligatoire

Le moteur ne doit pas dependre du nom produit.

Identifiants :

```text
products.id   = UUID technique DB
products.sku  = SKU fournisseur / stock / variante, parfois externe ou changeant
product_ref   = reference interne Komerce stable, lisible et durable
```

Doctrine cible : chaque produit catalogue doit disposer d'une reference interne Komerce stable.

Exemple :

```text
KPR-TECH-PHONE-000123
KPR-MODE-HIJAB-000231
```

Usage de `product_ref` :

- suggestions manuelles ;
- imports catalogue ;
- audit humain ;
- logs de navigation ;
- tables de relations produit a produit ;
- diagnostic admin.

Tant que `product_ref` n'existe pas, le moteur peut utiliser `products.id`, mais la dette doit rester visible.

---

## 5. Types de suggestions

Les suggestions sont des sorties du moteur, pas le moteur lui-meme.

| Type | Sens | Exemple |
|---|---|---|
| `similar` | proche du produit courant | autre telephone meme gamme |
| `alternative` | autre choix comparable | moins cher, plus premium, autre marque |
| `complement` | complete l'intention | coque, chargeur, ecouteurs |
| `continue` | reprendre la navigation | produits vus recemment |
| `popular_in_context` | populaire dans le contexte | best-sellers Tech apres visite Tech |
| `cart_compatible` | coherent avec le panier | protection ecran si telephone au panier |
| `discovery` | ouvrir sans casser le contexte | produit voisin dans categorie proche |

Chaque suggestion doit pouvoir exposer une raison simple :

```text
meme sous-categorie
complement du panier
vu recemment
populaire dans cette categorie
alternative moins chere
```

---

## 6. Personnalisation de l'accueil

L'accueil peut etre rebattu selon les visiteurs.

Il peut personnaliser :

1. l'ordre des categories ;
2. les sous-categories mises en avant ;
3. les rails visibles en premier ;
4. l'ordre des produits dans un rail ;
5. les produits repris depuis la navigation recente ;
6. les complements de panier.

Il ne doit jamais :

- cacher definitivement une categorie ;
- masquer les produits non personnalises ;
- rendre l'ordre incomprehensible ;
- changer les prix ;
- pousser un produit indisponible sans indication ;
- remplacer la recherche explicite de l'utilisateur.

Regle UX :

```text
Personnaliser l'ordre, pas confisquer le choix.
```

---

## 7. Suggestions actuelles dans la modal produit

Etat actuel observe :

- `b-modal.js` est une facade ;
- `renderSuggestions` est extrait dans `public/boutique/js/b-modal-suggestions.js` ;
- les suggestions affichent deux blocs : meme categorie et cela peut vous plaire ;
- la selection est encore surtout locale/front : `sameCat`, `otherCat`, `categoryName` ;
- les actions `+ / -` relancent encore un re-render complet des suggestions ;
- les cartes suggestions ouvrent les produits via bus `modal:open`.

Doctrine : cet etat est acceptable comme transition, mais pas comme moteur cible.

Cible :

```text
b-modal-suggestions.js ne choisit pas les suggestions.
Il affiche une liste deja classee par un moteur de personnalisation.
```

Le module cible doit recevoir :

```text
current_product_ref ou product_id
context
suggestions[]
reason
score
section
```

Et ne doit plus recalculer seul :

```text
sameCat = products.filter(...)
otherCat = products.filter(...)
```

Ces calculs peuvent exister en fallback offline, mais pas comme source de verite cible.

---

## 8. Architecture cible

Modules front cibles :

```text
b-navigation-signals.js       -> collecte les signaux locaux de navigation
b-personalization-store.js    -> stocke un historique local minimal
b-suggestion-engine.js        -> score/rank les produits en fallback client
b-modal-suggestions.js        -> rend les suggestions dans la modal
b-home-personalization.js     -> rebattage accueil / rails / categories
```

Backend cible possible :

```text
GET /api/boutique/personalization
POST /api/boutique/navigation-events
GET /api/products/:id/suggestions
```

Phase 1 recommandee : moteur local first.

- session/localStorage leger ;
- pas de compte requis ;
- pas de profil personnel lourd ;
- effacable ;
- fallback catalogue stable.

Phase 2 : backend si volume et besoin de consolidation.

---

## 9. Regles de ranking

Score indicatif :

```text
score = contexte produit
      + proximite categorie
      + proximite sous-categorie
      + compatibilite panier
      + navigation recente
      + disponibilite
      + popularite
      + fraicheur
      - repetition excessive
      - rupture / indisponibilite
```

Un score ne doit pas etre opaque. Le moteur doit garder au moins une raison principale.

Exemple :

```json
{
  "product_ref": "KPR-TECH-AUDIO-000045",
  "score": 82,
  "section": "complement",
  "reason": "Complement logique du telephone consulte"
}
```

---

## 10. Performance et UX

Interdits :

- re-render complet de 20 cartes a chaque clic `+ / -` ;
- recabler tous les listeners pour une simple quantite ;
- bloquer le scroll mobile ;
- faire sauter la modal ;
- charger des suggestions apres coup avec layout shift important.

Attendu :

- mise a jour ciblee de la carte concernee ;
- rendu initial rapide ;
- skeleton ou fallback stable si moteur indisponible ;
- rails scrollables fluides ;
- aucune suggestion intrusive dans le parcours panier partage.

---

## 11. Privacy et confiance

Le moteur local peut retenir :

- produits vus recemment ;
- categories frequentees ;
- recherches recentes ;
- ajouts panier ;
- score local par categorie.

Il ne doit pas retenir sans vraie raison :

- donnees personnelles sensibles ;
- informations paiement ;
- comportement intime ;
- identifiants externes non necessaires.

Phrase doctrine :

```text
La personnalisation doit rassurer le visiteur, pas lui donner l'impression d'etre piste.
```

---

## 12. Tests d'acceptation

Un changement est acceptable si :

1. un nouveau visiteur voit encore un accueil clair et stable ;
2. un visiteur qui consulte surtout Tech voit Tech remonter sans perdre les autres categories ;
3. un visiteur avec un telephone au panier voit des complements pertinents ;
4. une modal produit affiche des suggestions expliquees ;
5. les boutons `+ / -` ne re-renderent pas tout le rail ;
6. le moteur fonctionne sans compte utilisateur ;
7. le panier partage reste centre sur le panier, pas sur la vente additionnelle ;
8. les suggestions restent sanitisees et ne peuvent pas injecter HTML via categorie ou nom produit ;
9. les produits indisponibles ne sont pas pousses sans signal visible ;
10. l'utilisateur peut toujours retrouver le catalogue complet.

---

## 13. Consigne pour Opus / agent dev

1. Ne pas traiter `b-modal-suggestions.js` comme le moteur cible.
2. Creer un moteur de personnalisation de navigation separable du rendu.
3. Introduire une reference interne produit stable (`product_ref`) ou documenter la dette si l'etape DB est reportee.
4. Garder un fallback local base sur `products.id`, categorie et sous-categorie.
5. Remplacer les re-renders complets des steppers par une mise a jour DOM ciblee.
6. Ajouter les raisons de suggestion dans le modele.
7. Reordonner l'accueil uniquement par priorites de presentation, jamais par disparition du catalogue.

Phrase de controle :

```text
Le moteur personnalise l'ordre de decouverte. Les suggestions ne sont qu'une des surfaces ou ce moteur s'exprime.
```
