# Protocole de test humain — device réel (Phase 2)

> Ce test tranche UNIQUEMENT la grammaire UX du swipe. Il ne mesure pas le code
> (déjà fait par le scénario Playwright). Il doit être exécuté par un humain sur
> un vrai téléphone.

## Setup

Servir la branche spike sur un device réel :

```bash
# Sur une machine accessible depuis le téléphone (même réseau)
node spike/mobile-vertical-native/preview-server.js 4599
# Puis sur le téléphone, ouvrir :
#   A (pager)    : http://<ip-machine>:4599/boutique/
#   B (vertical) : http://<ip-machine>:4599/boutique/?shell=vertical
```

Ou, mieux : déployer la branche spike sur un environnement de preview et tester
sur le vrai staging avec de vrais produits.

**Important** : ne pas dire au testeur lequel est A ou B. Les nommer « écran 1 »
et « écran 2 », et alterner l'ordre entre testeurs pour éviter le biais d'ordre.

## Méthode

Ne PAS demander « lequel préfères-tu ? » d'abord. Faire accomplir les **mêmes
tâches** sur les deux, chronométrer et observer, puis seulement demander le ressenti.

## Tâches (identiques A et B)

Pour chaque écran, demander au testeur d'accomplir, dans l'ordre :

| # | Tâche | Ce qu'on observe |
|---|---|---|
| T1 | « Parcours rapidement 4 catégories différentes » | temps, hésitation, gestes |
| T2 | « À tout moment, dis-moi dans quelle catégorie tu es » | compréhension catégorie active |
| T3 | « Reviens à la 2e catégorie que tu as vue » | facilité de retour à une catégorie précise |
| T4 | « Fais défiler jusqu'à voir les offres locales (Près de vous) » | découverte du bloc transversal |
| T5 | « Ouvre un produit, regarde-le, puis reviens » | continuité, désorientation au retour |
| T6 | « Continue à explorer autant de produits que tu veux pendant 60s » | quantité réellement parcourue |

## Grille d'observation (remplir pour A et pour B)

| Critère | A (écran __) | B (écran __) |
|---|---|---|
| Temps pour parcourir 4 catégories (T1) | ___ s | ___ s |
| Catégorie active toujours comprise ? (T2) | oui/partiel/non | oui/partiel/non |
| Retour à une catégorie précise facile ? (T3) | facile/moyen/difficile | facile/moyen/difficile |
| Bloc « Près de vous » remarqué spontanément ? (T4) | oui/non | oui/non |
| Désorientation au retour PDP ? (T5) | aucune/légère/forte | aucune/légère/forte |
| Nb de produits parcourus en 60s (T6) | ___ | ___ |
| Sensation « longue page infinie » ? | oui/non | oui/non |
| Perte ressentie du swipe pleine page ? | — | oui/non/indifférent |

## Questions finales (après les deux)

1. Sur quel écran t'es-tu senti le plus en contrôle pour changer de catégorie ?
2. Sur quel écran as-tu vu le plus de produits sans effort ?
3. Le bloc « Près de vous » : sur quel écran l'as-tu mieux remarqué / compris ?
4. Un écran t'a-t-il donné une sensation de « site qui rame » ou « geste bizarre » ?
5. Si tu ne devais garder qu'un seul écran, lequel — et pourquoi en une phrase ?

## Interprétation

**B (vertical) gagne** si :
- T1 (parcours 4 catégories) : B ≤ A + 20% en temps
- T3 (retour catégorie précise) : B pas « difficile »
- T6 (produits parcourus) : B ≥ A
- « Longue page infinie » : pas majoritaire sur B
- Perte du swipe pleine page : pas ressentie comme forte

**A (pager) garde un avantage à préserver** si :
- Le swipe pleine page est massivement préféré ET B dégrade sensiblement T1/T3
- Dans ce cas → KEEP BUT SIMPLIFY + frontière discovery-mount-point

## Nombre de testeurs

Minimum 3, idéalement 5-6, profils variés (habitués Temu/Shein vs non).
Un seul testeur ne tranche pas une grammaire UX.
