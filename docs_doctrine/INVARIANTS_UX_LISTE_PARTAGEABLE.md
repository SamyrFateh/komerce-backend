# Invariants UX — Liste partageable

**Rôle de ce document** : checklist de conformité. À consulter à chaque écran construit, chaque composant modifié, chaque revue de code touchant à la liste partageable. Un invariant violé est un bug de conformité, pas un détail d'implémentation à discuter.
**Source** : STORYBOARD_LISTE_PARTAGEABLE.md v2 et CONTRAT_UX_LISTE_PARTAGEABLE.md.
**Portée** : ces invariants ne se rediscutent pas pendant l'implémentation. Une violation démontrée renvoie à l'Étape 1 (contrat UX), pas à un correctif local.

---

## Comment utiliser cette page

Pour chaque écran ou composant livré : parcourir la liste, cocher mentalement chaque ligne. Si une ligne ne peut pas être cochée honnêtement, l'écran n'est pas conforme — indépendamment de son état visuel ou de ses tests unitaires.

---

## I. Identité et rôle

| # | Invariant | Vérification |
|---|---|---|
| 1 | Un seul arbre de composant, jamais un composant séparé selon le visiteur | Aucun `if (isOrganizer) return <Autre/>` ou équivalent dans le code |
| 2 | Le créateur de la liste n'a pas de badge de rôle affiché | Chercher « Organisateur », « Créateur », « Participant » comme texte visible — absence stricte |
| 3 | Le créateur peut acheter ses propres articles, sans branche de code dédiée | Le bouton « Acheter la sélection » fonctionne identiquement pour le créateur sur ses propres articles |
| 4 | L'identité de l'acheteur n'est jamais exposée aux autres visiteurs de la liste | Un article « déjà acheté » n'affiche jamais qui l'a acheté, pour personne d'autre que l'API interne |
| 5 | La liste n'a pas besoin d'être nommée pour exister | Une liste sans titre s'affiche normalement — pas de placeholder « Liste sans titre », le bandeau créateur suffit à l'identifier |

## II. Vocabulaire

| # | Invariant | Vérification |
|---|---|---|
| 6 | Le bouton d'action principal se nomme exactement « Acheter la sélection » | Recherche texte exacte dans le code |
| 7 | Les statuts d'article sont « Disponible » et « Déjà acheté », rien d'autre | Aucune variante (« libre », « pris », « réservé »...) |
| 8 | Aucune occurrence de « panier partagé », « panier collectif », « collecte », « financement », « réclamer », « réclamation », « estimation », « règlement », « finaliser » dans le texte visible | Recherche texte sur ces termes, résultat vide |
| 9 | L'objet se nomme « Liste », sans qualificatif ajouté (pas « liste de courses partagée collaborative ») | Lecture des libellés |
| 10 | Le visiteur est désigné par « Vous », jamais par un nom de rôle | Lecture des libellés |

## III. Rythme et ton

| # | Invariant | Vérification |
|---|---|---|
| 11 | Aucun compte à rebours nulle part sur cet écran | Recherche de toute logique de décompte temporel affiché |
| 12 | La progression s'exprime en « X sur Y », jamais en urgence | Lecture du libellé de progression |
| 13 | Une liste complète est présentée calmement (« Tout a trouvé preneur »), jamais avec un ton commercial ou une célébration excessive | Lecture du message d'état Complète |
| 14 | Une liste annulée est présentée neutre, jamais comme un échec | Lecture du message d'état Annulée |
| 15 | Un conflit d'achat produit un message qui ne blâme personne, jamais un ton d'erreur système brute | Lecture du message de conflit |

## IV. Comportement de données

| # | Invariant | Vérification |
|---|---|---|
| 16 | Une sélection locale d'articles n'engage aucune écriture serveur avant le clic explicite sur « Acheter la sélection » | Aucun appel réseau déclenché par la sélection/désélection elle-même |
| 17 | Un seul appel `POST /api/orders` par achat, portant toutes les lignes sélectionnées | Pas d'appel par article |
| 18 | Un conflit d'achat rafraîchit la grille sur les articles réellement restants, ne laisse jamais un état incohérent affiché | Test manuel : deux sessions, même article, la seconde voit le refus et la grille à jour |
| 19 | La fermeture d'une liste est toujours une action manuelle du créateur, jamais une expiration automatique | Aucune logique de cron ou de délai déclenchant la fermeture |
| 20 | Toute modification éditoriale (titre, message, ajout d'article) s'écrit immédiatement — aucun bouton « Enregistrer » nulle part sur cet écran | Recherche de tout bouton de validation groupée ; chaque champ éditorial déclenche son propre appel serveur à la saisie/sélection |
| 21 | Le retrait d'un article et la fermeture de la liste demandent une confirmation explicite avant exécution — ce sont les deux seules actions de cet écran à en demander une | Test manuel : aucune autre action (édition, ajout, sélection, achat) ne doit afficher de confirmation |

## V. Points d'entrée

| # | Invariant | Vérification |
|---|---|---|
| 22 | L'aperçu du lien (WhatsApp/SMS) affiche une image des articles de la liste, jamais un logo générique unique pour toutes les listes | Vérifier les balises `og:image` générées dynamiquement par liste |
| 23 | Le titre de l'aperçu de lien nomme la personne (« La liste de [Prénom] »), jamais la fonctionnalité | Vérifier la balise `og:title` |
| 24 | Un lien invalide ou expiré redirige vers la boutique standard, jamais vers une page d'erreur isolée | Test manuel avec un token inexistant |

---

## Statut des points non couverts par le storyboard (rappel, voir CONTRAT_UX §6)

Le point bloquant (mode d'écriture des actions du créateur) est tranché — voir invariants 20 et 21 ci-dessus. Plus rien ne bloque l'Étape 2. Restent ouverts, sans impact sur le contrat API, à ajouter à cette page dès qu'ils seront tranchés :

- Mécanique exacte de sélection d'un article
- Écran après achat réussi
- Politique de rafraîchissement ambiant
- Comportement générique en cas d'échec réseau
