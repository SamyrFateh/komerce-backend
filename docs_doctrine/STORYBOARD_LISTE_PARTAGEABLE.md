# Storyboard — La liste comme point d'entrée dans la boutique

**Statut** : v2, trois ajustements intégrés — vocabulaire d'achat, point d'entrée avancé au moment de réception du lien, organisateur traité comme acheteur ordinaire.
**Portée** : remplace le storyboard implicite de `b-group-view.js`.
**Doctrine parente** : DOCTRINE_BOUTIQUE_FIRST.md, principe canonique — un seul composant, des capacités qui varient selon les droits, jamais des écrans qui varient selon les droits.

---

## 0. Principe directeur

Le lien partagé n'ouvre pas une fonctionnalité. Il ouvre la boutique, avec un filtre : *ces articles-là, choisis par cette personne-là*. Tout ce qui suit découle de cette phrase.

Conséquence directe : le composant qui affiche une liste partagée n'est pas un composant séparé de la boutique. C'est **la boutique**, paramétrée par un contexte de liste.

Second principe, ajouté dans cette révision : personne n'est acheteur *ou* organisateur. Tout le monde est acheteur. Certains acheteurs, sur certaines listes, ont en plus le droit de modifier la liste — parce qu'ils l'ont créée. Ce n'est pas un rôle métier avec un badge et un vocabulaire dédié ; c'est une capacité conditionnelle, comme pouvoir modifier sa propre adresse de livraison.

---

## 1. Le moment de réception du lien — avant même l'ouverture

C'est désormais le vrai premier écran, et il ne se passe pas dans Komerce. Il se passe dans WhatsApp, dans un SMS, dans une story Instagram. Si la boutique est découverte par ce canal, ce que le lien affiche *avant d'être cliqué* fait partie du storyboard, pas un détail technique périphérique.

Ce que l'aperçu du lien (métadonnées Open Graph) doit montrer, sans que personne n'ait cliqué :

1. **Une image reconnaissable** — pas le logo Komerce seul, une composition montrant un ou plusieurs articles de la liste. Un lien qui affiche un logo générique se noie dans le flux de messages ; un lien qui montre un produit donne envie de cliquer.
2. **Un titre qui nomme la personne, pas la fonctionnalité.** *« La liste de [Prénom] »*, jamais *« Panier partagé Komerce »* ou une variante technique. Le titre du lien est la première occurrence du vocabulaire du produit — il doit déjà respecter §7.
3. **Une description courte** qui donne une raison de cliquer sans tout dévoiler : nombre d'articles, éventuellement la boutique d'origine, jamais un prix total qui transformerait l'aperçu en facture.

Ce qui en découle pour l'implémentation, sans encore écrire de contrat : la page publique de la liste a besoin de balises `og:image`, `og:title`, `og:description` dynamiques, générées côté serveur au moment du rendu de la page de liste — pas une image statique unique pour toutes les listes. C'est une exigence de contenu, pas encore une exigence de champ API précise.

---

## 2. L'écran d'entrée — les 3 premières secondes après le clic

Ce que l'œil rencontre, dans l'ordre :

1. **Le bandeau de l'inviteur.** Nom, pas d'avatar générique ni d'icône anonyme. Une phrase courte, jamais un formulaire : *« [Prénom] a préparé cette liste pour vous »*.
2. **Un signal de progression, pas un compte à rebours.** *« 4 articles sur 7 déjà achetés »*, avec une barre ou des pastilles, pas un chiffre qui descend.
3. **La grille d'articles**, visible sans scroll sur mobile pour les 2-3 premiers. Vignette produit, prix, statut — *disponible* ou *déjà acheté* (voir §7) — jamais un tableau de lignes texte.

Ce qui est **volontairement absent** de ce premier écran : tout champ de saisie, toute authentification forcée, toute mention du mot « panier », « partagé », ou « collecte ».

---

## 3. Un seul composant, des capacités qui varient — l'organisateur n'est pas un rôle

Pas de branchement `if (isOrganizer) return <AutreComposant/>`. Un seul arbre de rendu, une seule identité fonctionnelle : **acheteur**. Ce qui change n'est jamais l'écran, seulement la présence ou l'absence de quelques contrôles, exactement comme un acheteur voit ou non un bouton « modifier l'adresse » selon qu'il possède ou non la commande.

| Élément | Tout acheteur | En plus, si vous avez créé cette liste |
|---|---|---|
| Chaque article disponible | Peut le sélectionner et l'acheter | — |
| Chaque article | Statut affiché (disponible / déjà acheté) | + un contrôle discret pour le retirer de la liste |
| Titre et message de la liste | Lecture | + un crayon discret, édition inline |
| Bas de grille | (rien) | + « Retourner à la boutique pour ajouter » — pas de picker dédié, la boutique standard reste le seul sélecteur de produits |

**Simplification doctrinale (post-figeage) : suppression du concept de picker.** La boutique est déjà le meilleur sélecteur de produits — un composant dédié à l'ajout d'article aurait dupliqué ce qui existe. Le bouton n'ouvre donc rien de spécifique : il ramène le créateur dans la navigation normale de la boutique, contexte de liste conservé. Chaque fiche produit et chaque carte produit y gagne une action symétrique à « Ajouter au panier » : « Ajouter à cette liste ».
| Bandeau global | (rien) | + « Fermer la liste » |

Conséquence directe et sans exception : la personne qui a créé la liste peut acheter ses propres articles, exactement par le même bouton, le même flux, le même appel au checkout canonique — aucun cas particulier, aucune branche de code dédiée. Ce n'était pas évident au tour précédent ; ça l'est maintenant : elle n'est pas « l'organisateur qui achète en plus », elle est un acheteur comme un autre, qui possède simplement des droits d'édition sur cette liste précise.

---

## 4. Le parcours, pas à pas

### 4.1 Un lien arrive, quelqu'un l'ouvre

Couvert par §1 et §2. Aucune authentification requise pour regarder.

### 4.2 Sélection et achat

1. Peut sélectionner des articles marqués *disponibles* (état purement local, rien n'est envoyé au serveur à ce stade — cohérent avec R1, une projection ne doit jamais engager de décision).
2. Un mini-total apparaît en bas, mis à jour en direct, exactement comme le panier boutique standard.
3. Clique **« Acheter la sélection »** → point de bascule identité :
   - Si déjà connu (session, guest identifié) : passage direct au checkout canonique.
   - Sinon : le parcours guest standard de la boutique s'ouvre — pas un formulaire spécifique à la liste.
4. Un seul appel à `POST /api/orders`, toutes les lignes sélectionnées ensemble, chacune portant son `shared_cart_item_id`.

### 4.3 Deux personnes sélectionnent le même article

Le second à confirmer voit son achat refusé au moment du paiement — jamais un état d'attente. *« Cet article vient d'être acheté, en voici d'autres encore disponibles »*, et la grille se met à jour sur ce qui reste. Le mécanisme technique existe déjà (contrainte unique, migration 123) ; seule la formulation change ici.

### 4.4 La personne qui a créé la liste revient la consulter

Même écran, capacités supplémentaires visibles (§3). Peut voir, article par article, s'il est déjà acheté — sans savoir *par qui* dans cette vue (l'identité de l'acheteur n'est jamais exposée aux autres visiteurs de la liste).

### 4.5 Clôture

Un lien « Fermer la liste » — pas un statut qui expire tout seul. Fermer arrête les nouveaux achats ; les articles déjà achetés restent des commandes normales, inchangées.

Le reliquat (« j'achète le reste », D1) et la délégation de retrait (D3, déjà construite côté back) restent hors de ce tour, comme au précédent.

---

## 5. Catalogue des états de l'écran

| État | Déclencheur | Traitement |
|---|---|---|
| Chargement | Requête en cours | Squelette de grille, jamais un spinner plein écran |
| Partielle | Certains articles encore disponibles | État par défaut, §2 |
| Complète | Tous les articles achetés | Grille visible, chaque article « déjà acheté ✓ », message calme : *« Tout a trouvé preneur »* |
| Fermée | Fermeture manuelle | Lecture seule pour tout le monde, y compris la personne qui a créé la liste ; plus aucun achat possible |
| Annulée | Annulation manuelle | Écran neutre, jamais présenté comme un échec : *« Cette liste n'est plus active »* |
| Lien invalide / expiré | Token inconnu | Redirection vers la boutique standard, pas une page d'erreur isolée |
| Achat refusé (conflit) | 23505 au checkout | §4.3 |

---

## 6. Ce que ce storyboard n'est pas

Il ne dit rien sur la mise en page desktop vs mobile, la palette, la typographie. Il ne tranche pas le reliquat (D1) ni la délégation de retrait (D3) — extensions volontairement laissées pour un tour ultérieur.

---

## 7. Vocabulaire — le champ lexical de l'achat, pas de la réclamation

Changement central de cette révision : tout le vocabulaire qui évoquait une transaction entre participants (« réclamer », « réclamation », « pris par ») disparaît. Il n'y a qu'une action possible sur un article : l'acheter. Il n'y a que deux états : on peut encore l'acheter, ou quelqu'un l'a déjà acheté.

| Terme à faire disparaître | Raison | Remplacé par |
|---|---|---|
| « Panier partagé » / « panier collectif » | Nomme un moteur qui n'existe plus | « Liste » |
| « Contribution », « financement », « collecte » | Concepts supprimés | (rien) |
| « Réclamer », « réclamation », « pris » | Vocabulaire de partage entre participants — évoque une négociation, pas un achat | « Disponible » / « Déjà acheté » |
| « Participant » | Rôle qui n'existe plus conceptuellement | « Vous », à la deuxième personne ; aucun nom de rôle affiché |
| « Organisateur », « créateur » (à l'écran) | Rôle métier — exactement ce que le point 3 de cette révision supprime | « [Prénom] » directement ; en interne, capacité d'édition, jamais un badge de rôle |
| « Règlement », « finaliser » | Vocabulaire de moteur de paiement disparu | « Acheter la sélection » |
| « Estimation » | Concept supprimé | (rien) |

Le bouton d'action principal se nomme **« Acheter la sélection »** — jamais « Je prends ça », « Valider », ou « Commander » seul, pour rester dans le même champ lexical que le reste de la boutique.

---

## 8. Identité du créateur — mise en œuvre validée

`organizer_user_id` reste la source unique. L'API publique dérive l'identité affichable (a minima le prénom) par jointure à la lecture, jamais par snapshot stocké sur `shared_carts`. Aucune colonne à réintroduire en base.

---

## 9. Ce que ce storyboard, une fois validé, fixera pour le contrat API

Sans écrire le contrat ici, ce storyboard implique déjà :

- la lecture publique doit porter l'identité affichable de la personne qui a créé la liste (§8) ;
- la progression globale (nombre total / nombre déjà acheté) ;
- par article, un état binaire disponible/déjà-acheté et de quoi construire l'appel au checkout canonique (`shared_cart_item_id`) — le nom exact du champ API (`claimed`, `available`, `purchased`...) se choisit au moment de l'implémentation, mais doit refléter le vocabulaire d'achat de §7, pas un vocabulaire de réclamation résiduel dans le code ;
- des métadonnées de rendu pour l'aperçu de lien (§1) — image, titre, description — probablement une route ou un fragment serveur séparé de l'API JSON elle-même, puisque les crawlers WhatsApp/SMS ne lisent pas du JSON.

Aucune question ouverte ne reste de ce tour — la question de l'organisateur achetant ses propres articles (posée au tour précédent) est résolue par §3 : ce n'est plus une exception, c'est la règle générale.
