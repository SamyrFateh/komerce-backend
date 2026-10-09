# CANONICAL DASHBOARD VISUAL HIERARCHY V1

## Objet

Ce contrat fixe la hiérarchie visuelle des dashboards Canonical Komerce.\nIl ne définit aucune vérité métier et ne remplace aucun contrat de données.\n\nLe langage de marque, les matériaux et la palette sont définis par **KOMERCE_VISUAL_CANON_V1.md**. La hiérarchie et le canon de marque sont complémentaires et obligatoires.

## Ordre obligatoire

1. **Hero** — identité de la surface, contexte, titre et promesse opérationnelle.
2. **Attention** — ce qui demande une décision ou une surveillance immédiate.
3. **Primary object** — l'objet métier principal de la page (chaîne, portefeuille, trésorerie, catalogue, etc.).
4. **Secondary surfaces** — détail, historique, files, approfondissements et contexte.

Le DOM et le rendu doivent respecter cet ordre.

## Règles

- Le hero donne du caractère à la rubrique sans masquer l'information.
- La bande Attention doit être lisible en moins de deux secondes.
- Rouge = action requise, ambre = à risque / à surveiller, vert = normal, ardoise = non observé. Ces couleurs sont sémantiques et ne constituent jamais l'identité visuelle d'une rubrique.
- La couleur seule ne porte jamais l'importance : position, taille et contraste doivent également guider l'œil.
- Les listes compactes restent compactes. Les descriptions longues sont révélées par drill/encapsulation.
- L'objet métier principal doit avoir plus de masse visuelle que les surfaces secondaires.
- Les surfaces secondaires ne doivent pas concurrencer les alertes.
- Aucun composant visuel ne recalcule un statut métier.

## Contrat DOM

Une surface conforme porte :

`data-dashboard-hierarchy="hero-attention-primary-secondary"`

et ses blocs structurants portent :

- `data-dashboard-role="hero"`
- `data-dashboard-role="attention"`
- `data-dashboard-role="primary"`
- `data-dashboard-role="secondary"`

## Preuve Playwright

Chaque dashboard migré vers ce contrat doit prouver au minimum :

- l'ordre Hero → Attention → Primary → Secondary ;
- la visibilité de la bande Attention dans le premier viewport desktop de référence ;
- la présence d'un contraste visuel mesurable entre Attention et Secondary ;
- la dominance géométrique de l'objet Primary ;
- l'absence de descriptions longues dans les cartes compactes fermées ;
- une capture de revue déterministe.

Operations et Pilotage sont les premières surfaces couvertes.


## Principe de sobriété

Un dashboard doit porter un message opérationnel essentiel, pas exposer toutes les données disponibles.

- Les surfaces secondaires sont **optionnelles**.
- Une information déjà accessible par drill ne doit pas être répétée en permanence dans la vue d'ensemble.
- Une liste, un panneau ou un KPI sans décision associée doit être retiré de la vue principale.
- Les agrégats narratifs ne doivent pas remplacer les objets métier en mouvement.
- Le résumé global peut être porté par quelques indicateurs sémantiques compacts (par exemple santé GREEN / ORANGE / RED / UNKNOWN).
- Le détail explicatif appartient à l'encapsulation, au drill ou à la vue 360.

La question de contrôle est : **« Si je retire ce bloc, le message principal du dashboard devient-il moins clair ? »**
Si la réponse est non, le bloc n'appartient probablement pas à la vue d'ensemble.
