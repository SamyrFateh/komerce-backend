# KOMERCE LAYOUT CANON V1

## Statut

**Canonique pour la composition des surfaces Back Office Komerce.**

Ce contrat complète `KOMERCE_VISUAL_CANON_V1.md` :

- Visual Canon = couleurs, matériaux, typographie, identité ;
- Layout Canon = disposition, densité, ordre, grilles et premier viewport.

## Référence

La composition cible est celle des **derniers mocks Komerce validés dans la revue du 9 octobre 2026** :

- sidebar sombre ;
- Hero en haut de la surface ;
- contrôles contextuels intégrés au Hero ;
- bande compacte de décision/KPI immédiatement sous le Hero ;
- objet métier principal visible sans détour ;
- surfaces secondaires après l'objet principal.

Les mocks servent de référence de composition. Le CSS `komerce-layout-canon-v1.css` est l'implémentation vérifiable.

## Contrat desktop

Pour un viewport de référence proche de **1672×941** :

1. le contenu commence au même niveau sur toutes les rubriques ;
2. le Hero a une hauteur canonique de **150 px** ;
3. le Hero occupe toute la largeur utile ;
4. le marché, la période ou les contrôles essentiels appartiennent visuellement au Hero ;
5. la bande Attention/KPI suit immédiatement, en quatre colonnes lorsque quatre indicateurs sont présents ;
6. l'objet métier principal commence dans le premier viewport ;
7. le dashboard ne crée pas de grand vide décoratif ;
8. une rubrique ne peut pas inventer ses propres marges, hauteurs ou rythme vertical.

## Grille

Variables canoniques desktop :

- padding horizontal page : **24 px** ;
- padding haut : **18 px** ;
- gap vertical principal : **12 px** ;
- gap compact : **10 px** ;
- Hero : **150 px** ;
- carte Attention/KPI : **104 px** ;
- largeur utile maximale : **1680 px**.

## Hiérarchie

Ordre obligatoire :

**Hero → Attention/KPI → Primary → Secondary**

Le DOM peut varier selon la surface, mais la composition visuelle doit respecter cet ordre.

## Différenciation par domaine

Les domaines ne se différencient pas par une grille propre.

Ils se différencient par :

- le titre ;
- le message de pilotage ;
- les contrôles utiles ;
- l'illustration métier ;
- l'objet Primary.

Ils conservent la même structure de page.

## Responsive

Sous 1180 px :

- Hero réduit à 142 px ;
- Attention/KPI passe à 2 colonnes ;
- densité légèrement réduite.

Sous 760 px :

- Hero reprend une hauteur naturelle ;
- contrôles et KPI passent en une colonne ;
- aucune règle de premier viewport desktop n'est imposée.

## Interdit

- carte Périmètre séparée au-dessus du Hero ;
- Hero qui commence plus bas selon le domaine ;
- Hero coupé par la navigation ;
- largeur de contenu différente sans raison métier ;
- grand espace vide entre Hero et décision ;
- padding local concurrent du canon ;
- domaine qui définit sa propre hauteur de Hero ;
- couleur ou décoration utilisée pour compenser une mauvaise hiérarchie.
