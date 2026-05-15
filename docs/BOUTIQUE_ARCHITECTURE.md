# Boutique Komerce - Architecture de reference

Ce document est le point d'entree obligatoire avant toute modification de la Boutique.

Regle principale : un composant = une verite.

Toute PR qui touche la Boutique doit identifier le fichier proprietaire du composant modifie et expliquer pourquoi ce fichier est le bon endroit.

Zones sensibles :

- schema categories
- rendu rail categories
- orchestration accueil
- catalogue
- pager mobile
- modal produit
- panier
- styles categories
- hero mobile
- grille et cartes produit
- desktop premium

Interdictions :

- creer une seconde source de verite
- dupliquer le rendu d'un composant
- compenser une erreur JS par du CSS au mauvais endroit
- compenser une erreur CSS par du JS au mauvais endroit
- casser le pager mobile
- appliquer un hack mobile au desktop

Ce document doit etre enrichi avec le diagramme visuel, la sequence de chargement et la table d'ownership complete.
