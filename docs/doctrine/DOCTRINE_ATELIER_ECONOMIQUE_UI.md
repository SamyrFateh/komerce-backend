# Doctrine — Atelier économique Komerce

> **Statut : FIGÉ — contrat UI de pilotage économique**  
> **Date : 2026-09-08**  
> **Surface : Pricing Workspace / Atelier économique**

## 1. Règle de surface

L’Atelier économique est un **Workspace de décision**. Il ne doit pas devenir un dashboard rempli d’indicateurs.

La page principale n’affiche que :

- les quelques valeurs nécessaires pour comprendre l’équilibre ;
- les leviers sur lesquels un opérateur peut réellement agir ;
- les conséquences recalculées automatiquement par le moteur.

Les valeurs dérivées sont visuellement plus discrètes / grisées et ne sont jamais éditables.

## 2. Classification canonique des charges

Chaque charge porte deux axes indépendants :

```text
nature       = VARIABLE | FIXED
périmètre    = DIRECT | MUTUALIZED
allocation   = article | commande | colis | usage | poids | valeur | GMV | période | autre clé gouvernée
```

`MUTUALIZED` n’est jamais une nature de charge.

Une charge mutualisée peut donc être :

- `VARIABLE + MUTUALIZED` ;
- `FIXED + MUTUALIZED`.

Toute charge mutualisée est rattachée à une **quote-part Market ID** selon sa clé d’allocation. La quote-part est une vérité moteur / serveur, pas un calcul navigateur.

## 3. Les trois blocs visibles de charges

La page principale expose exactement :

1. **Coûts variables** — directs et mutualisés ; ils déterminent le coût variable complet et l’espace de contribution.
2. **Charges fixes directes** — structure propre au marché.
3. **Charges fixes mutualisées** — structure partagée, avec coût global, clé d’allocation et quote-part du Market ID.

L’exceptionnel et le détail des lignes restent accessibles dans la porte **Affiner les catégories de charges, hypothèses et preuves**.

## 4. Chaîne produit

La lecture produit est :

```text
coût d’achat
→ coûts variables hors achat
→ coût variable complet
→ borne marché basse / cible / haute
→ prix final marché retenu
→ contribution unitaire
```

`Coûts variables hors achat` et `coût variable complet` sont calculés par le moteur. Ils sont grisés et non éditables dans le tableau produit.

## 5. Levier de décision produit

Sur la page principale, **le seul levier produit directement manipulable est le prix final marché retenu**.

Le responsable marché peut le monter ou le descendre dans le cadre de la preuve marché. Toute modification déclenche un recalcul serveur de :

- contribution unitaire ;
- contribution portefeuille ;
- couverture ;
- reste à couvrir ;
- résultat / équilibre.

Les coûts d’achat, charges, clés d’allocation et mutualisations restent modifiables dans leurs panneaux de gestion dédiés, jamais comme sliders concurrents dans la ligne SKU.

## 6. Indicateurs de tête

La surface principale reste volontairement courte :

- charges structurelles à couvrir ;
- contribution générée ;
- couverture ;
- reste à couvrir ;
- contribution moyenne / article.

Les détails articles / commandes / colis et les équivalents restent secondaires et repliables.

## 7. Invariants visuels

- **Gris léger** : calculé par le moteur, non éditable.
- **Blanc / contour actif** : décision ou paramètre réellement manipulable.
- **Prix final marché retenu** : levier produit clairement mis en évidence.
- La référence globale reste informative et ne devient jamais silencieusement une vérité locale.
- Aucune valeur économique n’est recalculée dans le navigateur.
- Aucun N1/N2/N3 n’est utilisé comme catégorie métier.

## 8. Phrase de contrôle

> **Le marché borne le prix. Les coûts variables déterminent l’espace de contribution. Les articles génèrent la contribution. Le portefeuille couvre les charges fixes directes et mutualisées. Toute mutualisation est allouée par Market ID.**
