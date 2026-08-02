# Contrat UX — Liste partageable (Étape 1 du mandat d'implémentation)

**Statut** : figé, en attente de validation avant Étape 2 (Contrat API).
**Source unique** : STORYBOARD_LISTE_PARTAGEABLE.md v2. Aucun élément de ce document n'est ajouté, déduit par confort, ou emprunté à l'ancien `b-group-view.js`.
**Méthode** : chaque ligne cite son paragraphe source (§). Ce qui n'a pas de citation possible est listé en section 5, jamais inventé en silence.

---

## 1. Composants

Un seul composant racine : **la boutique, en contexte de liste**. Ce qui suit n'est pas une arborescence de composants séparés au sens applicatif — c'est l'inventaire des blocs visuels que le storyboard distingue.

| Composant | Contenu | Source |
|---|---|---|
| Aperçu de lien (hors application) | Image, titre (« La liste de [Prénom] »), description courte, sans prix total | §1 |
| Bandeau inviteur | Nom de la personne, phrase fixe : « [Prénom] a préparé cette liste pour vous » | §2.1 |
| Indicateur de progression | Compte « X articles sur Y déjà achetés », forme barre ou pastilles | §2.2 |
| Grille d'articles | Vignette produit, prix, statut (Disponible / Déjà acheté) par article | §2.3, §7 |
| Contrôle de sélection par article | Présent sur tout article au statut Disponible | §4.2.1 (implicite : « peut sélectionner des articles marqués disponibles ») |
| Contrôle de retrait par article | Discret, visible seulement pour la personne ayant créé la liste | §3 (tableau) |
| Bloc titre / message de la liste | Lecture pour tous ; crayon d'édition inline pour le créateur | §3 (tableau) |
| Bouton « Ajouter un article » | Retourne à la navigation boutique normale, contexte de liste conservé — aucun picker dédié | §3 (tableau), simplification doctrinale post-figeage |
| Lien « Fermer la liste » | Visible seulement pour le créateur | §3 (tableau), §4.5 |
| Barre de mini-total | Apparaît en bas de l'écran une fois une sélection non vide | §4.2.2 |
| Bouton d'action principal | Libellé exact et unique : « Acheter la sélection » | §4.2.3, §7 |

**Réutilisation explicite** : le parcours guest/checkout est un composant standard de la boutique, non redéfini ici (§4.2). L'ajout d'article ne réutilise pas un composant dédié — il n'en existe plus : la navigation boutique elle-même, avec une action « Ajouter à cette liste » sur chaque produit, joue ce rôle (§1, simplification doctrinale post-figeage).

---

## 2. États d'écran

Table reprise du storyboard sans modification (§5) :

| État | Déclencheur | Rendu |
|---|---|---|
| Chargement | Requête en cours | Squelette de grille — jamais un spinner plein écran |
| Partielle | Au moins un article disponible | État par défaut : bandeau + progression + grille |
| Complète | Tous les articles achetés | Grille visible, chaque article « déjà acheté ✓ », message calme « Tout a trouvé preneur » |
| Fermée | Fermeture manuelle par le créateur | Lecture seule pour tous y compris le créateur, aucun achat possible |
| Annulée | Annulation manuelle | Écran neutre : « Cette liste n'est plus active », jamais présenté comme un échec |
| Lien invalide / expiré | Token inconnu | Redirection vers la boutique standard, pas de page d'erreur isolée |
| Achat refusé (conflit) | Violation de contrainte au checkout | Message : « Cet article vient d'être acheté, en voici d'autres encore disponibles », grille rafraîchie sur les articles restants |

**Capacités superposées, jamais des états distincts** (§3) : « lecture seule » et « édition » ne sont pas deux états d'écran — ce sont deux ensembles de contrôles visibles sur les mêmes états ci-dessus, selon que le visiteur a créé la liste ou non.

---

## 3. Événements utilisateur

| Événement | Déclenché par | Effet | Appel réseau | Source |
|---|---|---|---|---|
| Ouverture du lien | Clic sur le lien reçu (WhatsApp/SMS/autre) | Affiche l'écran d'entrée, aucune authentification requise | Lecture de la liste (GET) | §4.1 |
| Sélection d'un article disponible | Interaction sur un article au statut Disponible | Ajout à une sélection locale ; mini-total mis à jour | **Aucun** — état purement local | §4.2.1 |
| Désélection d'un article | Interaction répétée sur un article déjà sélectionné | Retrait de la sélection locale ; mini-total mis à jour | **Aucun** | §4.2.1 (symétrique) |
| Clic « Acheter la sélection » | Bouton d'action principal | Si identité connue : passage direct au checkout canonique. Sinon : parcours guest standard de la boutique | Un seul `POST /api/orders`, toutes les lignes sélectionnées, chacune avec son identifiant d'article de liste | §4.2.3 |
| Achat refusé (conflit) | Réponse du serveur au moment du paiement | Message non blâmant, rafraîchissement de la grille sur les articles restants | Résultat de l'appel précédent | §4.3 |
| Édition du titre/message (créateur) | Clic sur le crayon, saisie | Édition inline, pas de changement d'écran | Écriture immédiate, pas de bouton « Enregistrer » (tranché §5) | §3 (tableau) |
| Retrait d'un article (créateur) | Contrôle discret par article | Confirmation explicite requise, puis retrait | Écriture immédiate après confirmation (tranché §5) | §3 (tableau) |
| Ajout d'un article (créateur) | Bouton « Ajouter un article » | Retour à la navigation boutique, contexte de liste conservé ; « Ajouter à cette liste » sur chaque produit | Écriture immédiate au clic sur « Ajouter à cette liste » (tranché §5) | §3 (tableau), simplification doctrinale post-figeage |
| Fermeture de la liste (créateur) | Lien « Fermer la liste » | Confirmation explicite requise, puis passage à l'état Fermée, lecture seule pour tous | Écriture immédiate après confirmation (tranché §5) | §4.5 |

**Invariant transversal** (R1, cité par le storyboard en §4.2.1) : aucune sélection locale n'engage de décision serveur avant le clic explicite sur « Acheter la sélection ». La sélection est une projection, jamais une écriture.

---

## 4. Vocabulaire imposé à l'implémentation

Repris intégralement de §7, sans reformulation — ce tableau est normatif pour les libellés visibles, pas une suggestion :

| Ce qui doit apparaître à l'écran | Ce qui ne doit jamais apparaître |
|---|---|
| « Liste » | « Panier partagé », « panier collectif », « collecte », « financement » |
| « Disponible » / « Déjà acheté » | « Réclamer », « réclamation », « pris » |
| « [Prénom] » | « Organisateur », « créateur », « participant » (comme mot affiché) |
| « Acheter la sélection » (bouton) | « Je prends ça », « Valider », « Commander » seul |
| « Vous » (deuxième personne) | Tout nom de rôle affiché |

---

## 5. Décisions tranchées après l'Étape 1

### Écriture immédiate vs différée, et confirmation des actions destructives

Tranché : toute modification éditoriale (titre, message de la liste) s'écrit immédiatement, sans bouton « Enregistrer ». Seules les actions destructrices — retrait d'un article, fermeture de la liste — demandent une confirmation explicite avant exécution.

Par extension directe du même principe (une action qui n'est ni éditoriale au sens strict ni destructrice se range du côté « immédiat », faute de risque de perte) : l'ajout d'un article via l'action « Ajouter à cette liste » sur une fiche produit s'écrit également sans confirmation ni bouton de validation supplémentaire — l'ajout ne détruit rien.

Conséquence pour l'Étape 2 : chaque capacité du créateur (édition titre/message, ajout, retrait, fermeture) correspond à un appel serveur immédiat et unitaire, jamais à un brouillon local en attente de validation groupée. Ceci lève le point bloquant identifié à l'Étape 1.

---

## 6. Non couvert par le storyboard — signalé, non inventé

Le mandat interdit d'inventer. Ce qui reste ouvert après résolution de la section 5, classé par nature de décision.

### Décisions UX (n'affectent pas les données nécessaires, seulement l'interaction — Étape 3)

1. **Mécanique exacte de sélection d'un article.** Case à cocher visible, tap sur la vignette entière, ou autre geste — non précisé. Ne bloque pas l'Étape 2 : quels articles sont sélectionnés localement ne dépend pas du geste qui produit cette sélection.
2. **Écran ou état après un achat réussi.** Retour à la grille de liste mise à jour, ou écran de confirmation de commande standard ? Le principe « checkout canonique » suggère la réutilisation de la confirmation existante, mais ce n'est pas écrit noir sur blanc dans le storyboard.

### Comportements transversaux (ne sont pas spécifiques à cet écran — s'appliquent partout dans la boutique)

3. **Rafraîchissement ambiant.** Le storyboard ne spécifie un rafraîchissement de la grille qu'au moment d'un conflit d'achat (§4.3). Rien sur le cas où un visiteur reste sur l'écran pendant que d'autres achètent en arrière-plan. Question de politique générale, pas propre à la liste partageable.
4. **Comportement en cas d'échec réseau générique** (hors conflit d'achat). Relève de la gestion d'erreur transversale de la boutique, pas d'une règle propre à cet écran.

Plus aucun de ces quatre points ne bloque l'Étape 2 — le contrat API peut être produit intégralement à partir de ce qui précède.

---

## 7. Invariant ajouté — une liste n'a pas besoin d'être nommée pour exister

Le titre de la liste est optionnel (déjà vrai côté données : `title` nullable). Ce n'est pas seulement une tolérance technique — c'est cohérent avec le storyboard lui-même : le bandeau d'accueil (§2.1) et le titre de l'aperçu de lien (§1) s'appuient tous les deux sur le **prénom du créateur**, jamais sur le titre de la liste, pour identifier ce qu'on regarde. L'identification repose sur la personne, pas sur un intitulé.

Conséquence pour le composant **Bloc titre / message** (section 1, tableau) : son absence est un état normal, pas un état d'erreur ou un état vide à combler — la grille et le bandeau restent pleinement fonctionnels sans lui. Aucun placeholder du type « Liste sans titre » ne doit apparaître ; le bloc s'efface simplement quand il n'y a rien à afficher.
