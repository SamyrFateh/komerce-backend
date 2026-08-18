# Komerce — Déclaration douanière

> **Version** : pré-2026 — non datée. Revue de conformité requise (audit 2026-07-01).

## Doctrine intemporelle · La déclaration est le pivot

> **On ne minimise pas un droit qu'on ne contrôle pas. On maîtrise ce qu'on déclare, et on mesure ce qu'on subit.**

Ce document n'est pas une spécification. Les routes changent, les formules d'agent changent, les taux changent d'un jour à l'autre. Ceci est la direction. Quand un choix logistique, fiscal ou de pricing se présente et qu'on hésite, on revient ici.

---

## 1. La phrase

**La déclaration par colis est la pièce maîtresse. Komerce la possède.**

Le transitaire embarque et scanne. Il ne déclare pas, il ne dédouane pas, il ne fixe pas le droit. Il transporte le colis et il pose un jalon de suivi dessus. La déclaration — la facture par colis, sa valeur CIF, sa composition — appartient à Komerce, et à personne d'autre.

C'est la seule décision en amont de presque tout le reste. On la traite comme telle.

---

## 2. Pourquoi elle pilote tout

Une seule décision, cinq conséquences :

```txt
Déclaration par colis (CIF + composition)
        │
        ├─→ coût douane            (la formule de l'agent, sur cette facture)
        │        └─→ coût débarqué
        │                 └─→ pricing & marge (CDR)
        │
        └─→ découpage en colis déclarés
                 ├─→ unité de colisage
                 └─→ unité de traçage   (le colis que le client suit)
```

Le colis que le client trace, c'est l'unité qu'on a découpée pour déclarer. Le prix qu'on affiche dépend du coût débarqué, qui dépend du droit, qui s'applique à la facture qu'on a écrite. Tout descend de là. Rien en amont.

---

## 3. La vérité dure : une grille partagée, une discrétion totale

Les catégories existent — Komerce a les siennes (`customs_categories.sh_code` → `douane_pct`), la douane a les siennes. Mais c'est une **grille de référence partagée, pas une fonction qui lie l'agent.** L'agent du jour décide, à l'humeur :

- **de la méthode** — au forfait, au doigt mouillé, ou pièce par pièce ;
- **de la classification elle-même** — il peut déplacer un bien d'une catégorie à l'autre, pour t'arranger ou te pénaliser.

Il n'y a donc pas de socle déterministe, pas même au niveau « ce bien → cette catégorie → ce taux ». La catégorie est un vocabulaire que les deux côtés invoquent ; elle ne contraint pas la décision. Le **0 à 80 %** réalisé n'est pas une bande de bruit autour d'une règle : c'est une **issue discrétionnaire**, fonction de la méthode choisie, de la classification retenue par l'agent, de la relation et de l'humeur.

Trois interdictions, qui en sortent renforcées :

1. **Komerce déclare vrai.** On classe chaque bien sous sa catégorie honnête, on n'invente pas pour alléger. Que l'agent, lui, reclasse à sa guise ne nous autorise rien : notre déclaration est une proposition honnête, pas un terrain de jeu.
2. **On n'optimise pas.** Rien de stable à minimiser — ni la méthode, ni la classification, ni l'humeur ne se calculent. Tout « moteur » douanier ou de colisage est un fantasme, d'autant plus que l'agent défait d'un trait ce qu'un algorithme aurait « rangé ».
3. **Le seul levier est humain.** Présentation, relation, constance de la déclaration : ce qui incline un agent à « faire mieux » plutôt que « moins bien ». Appris expédition après expédition, jamais encodé.

---

## 4. Ce qu'on fait à la place

On ne lutte pas contre l'incontrôlable. On l'encadre des deux côtés.

**Côté maîtrise — ce qu'on possède.**
Une facture / packing list par colis qui est **propre, cohérente, et vraie**, avec un CIF enregistré au colis, et une **politique de regroupement** des commandes en colis qui ne varie pas à l'humeur. Le bénéfice légitime d'une déclaration nette n'est pas de payer moins : c'est de **réduire l'arbitraire** — laisser à l'agent moins de prise pour improviser vers le haut. On gagne en prévisibilité, pas en évasion.

**Côté mesure — ce qu'on subit.**
À chaque expédition, on enregistre le réel : `customs_shipments.customs_paid_kmf`, et le `effective_rate_pct` qui en découle. Expédition après expédition, ça dessine la **distribution réelle des taux** — par période, par contexte. C'est la seule connaissance qui serve vraiment.

**Côté pricing — comment on encaisse l'imprévisible.**
On ne price pas sur un taux douane fixe et optimiste. On price avec un **tampon douane** calibré sur la distribution réelle observée. La réponse économique honnête à une douane négociée n'est pas de la prédire, c'est de l'**absorber** dans la marge de sécurité, puis d'affiner le tampon avec le réel.

---

## 5. La frontière du transitaire

Le transitaire **embarque** le colis et le **scanne**. C'est tout. Son scan est un jalon de traçage sur l'unité que Komerce a déclarée. Il ne produit pas la déclaration, ne négocie pas le droit à la place de Komerce, ne devient jamais la source de vérité documentaire. La déclaration ne se délègue pas.

---

## 6. Ce que c'est — et ce que ce n'est pas

C'est une **discipline de déclaration** : posséder le document, fixer une politique de découpage, enregistrer le CIF, mesurer l'issue, protéger la marge.

Ce n'est pas un moteur d'optimisation. Pas un calcul de colisage. Pas une minimisation du droit. Pas une délégation au transitaire. Pas un pari sur un taux fixe.

---

## 7. Conséquences architecturales

1. **Komerce doit produire une facture / packing list par colis _classifiée_** — chaque ligne déclarée porte sa nomenclature (code SH / `customs_categories`), parce que c'est la classification qui détermine le taux, pas la valeur seule. Le document est aujourd'hui absent de `services/documents/` : c'est le gap réel, à traiter en priorité quand le sujet douane revient au plan.
2. **Le socle existe déjà ; c'est l'entrée qui manque.** `customs_categories` (taux par nomenclature + SH), `products.customs_risk_coeff` (charge douane estimée par produit, qui alimente le pricing) et `customs_shipments` (taux réalisé) sont en place. Manquent : la **déclaration classifiée par colis** en entrée, et le **gel de la classification** sur la ligne déclarée — aujourd'hui `order_items` ne fige que le prix, pas la catégorie douane.
3. **On capture l'écart déclaré → appliqué → payé.** L'agent peut changer de méthode et de catégorie : la vérité du coût n'est pas ce que Komerce a déclaré, c'est ce que l'agent a appliqué. Cet écart par expédition (catégorie déclarée vs retenue, taux estimé vs `effective_rate_pct` réel) nourrit à la fois le réel de la marge **et** la trace honnête du colis, et caractérise dans le temps le comportement par agent / par période. C'est la seule connaissance exploitable.
4. **Le découpage commande → colis est une décision de déclaration**, gouvernée par une politique stable, jamais par un algorithme d'optimisation.
5. **L'unité de traçage est le colis déclaré.** Le scan du transitaire est un jalon sur cette unité.
6. **Pas de moteur d'optimisation de colisage.** `services/parcelOptimizationService.js` est démantelé : il optimisait le calage physique (poids/volume), c'est-à-dire l'axe que ni le transporteur ni l'agent ne regardent. Le fret mer se facture au volume ; la douane est discrétionnaire sur la déclaration ; le packing physique n'est ni l'un ni l'autre.
7. **Le pricing porte un tampon douane large**, pas un taux fixe, calibré sur la distribution réalisée des `effective_rate_pct` — variance discrétionnaire, queues épaisses assumées.

---

## 8. Interdictions opératoires

- Ne pas recréer un moteur d'optimisation de colisage ou de « minimisation douanière ».
- Ne pas dériver un prix sur un taux de douane fixe ou optimiste.
- Ne pas déléguer la déclaration ou le CIF au transitaire.
- Ne pas minorer ni maquiller une déclaration pour alléger un droit.
- Ne pas traiter le colis comme un problème de remplissage : c'est d'abord une unité de déclaration.

---

## 9. Phase Avion — pour mémoire, hors sujet douane

Si un jour le fret **aérien** entre en jeu, le besoin sera un **calcul de poids volumique** — une formule déterministe, à écrire alors comme une petite fonction dédiée. C'est un sujet de **coût de transport**, déterministe et prévisible, sans aucun rapport avec la douane (négociée) ni avec le moteur de bin-packing démantelé. Ne pas confondre les trois, ne pas ressusciter l'ancien outil pour ce besoin neuf.

---

> Quand on hésite : la déclaration est-elle vraie, possédée par Komerce, et enregistrée au colis ? Le droit, on le mesure et on l'absorbe — on ne le calcule pas.
