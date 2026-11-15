# Classification Sourcing : mesure CJ498 (rapport de synthèse)

Rejeu hors ligne de `tests/fixtures/cj-real-498-20261112.json`, sans appel fournisseur ni écriture. Reproduire : `python3 -I eval.py && python3 -I sim.py` (sortie attendue : `RESULTATS.txt`).

| Mesure | Placés | Précision catégorie | Précision feuille |
|---|---|---|---|
| `main` actuel (vêtements seulement) | 54 (10,8 %) | 100 % | 100 % |
| Objet du titre seul | 483 (97,0 %) | 93,6 % | 91,4 % |
| **Règle retenue : objet + branche fournisseur d'accord** | **312 (62,7 %)** | **98,4 %** | **97,3 %** |
| Objet + Discovery d'accord (écarté, décision 1) | 412 (82,7 %) | 95,6 % | 93,5 % |

Causes des 444 non classés sur `main` : aucune règle hors vêtements 252 ; chemin fournisseur faux 105 ; titre générique CJ 54 ; feuille absente 20 ; aucun rayon actif 13. Racine CJ seule juste à 69,6 %.

Écarts à connaître
- Règle retenue : 5 catégories fausses sur 312, 8 feuilles fausses sur 299.
- Reste en revue : 186 produits, 68 groupes (objet × branche), 21 familles d'objet.
- En désaccord objet / branche (158), l'objet a raison 135 fois : bonne suggestion de revue, pas une preuve.
- Décision 2 appliquée : vêtements enfants = `Mode & Beauté / Enfant`. La racine CJ « Toys, Kids & Babies » pointe vers `Enfant` : ces vêtements partent en revue tant que la table des branches n'est pas affinée.
- Objectif 90 % placés à 95 % de précision : non atteint en automatique avec des preuves fiables (62,7 %).

Limites de la preuve
- `gold.py` = étiquetage Fable, non validé par un humain.
- Le lexique de `sim.py` a été écrit après lecture des 498 titres : mesure non aveugle, optimiste.
- AliExpress : NOT_PROVEN. L'API publique du staging n'expose ni titre fournisseur ni chemin ; aucune archive brute dans le dépôt. Investigation arrêtée (coût > bénéfice sans accès base).

Verdict : **GO conditionnel** pour l'implémentation de la règle « objet + branche concordante ».
1. Livrer derrière un drapeau, en mode suggestion, sans écriture automatique.
2. Validation humaine de 150 étiquettes tirées par strate ; écart toléré ≤ 5 %.
3. Lot brut AliExpress jamais vu (≥ 200 produits, titre et chemin fournisseur) : activer l'automatique seulement si précision catégorie ≥ 95 % ; sinon rester en suggestion.
4. Désaccord ou ambiguïté : revue groupée dans le Catalogue global (décision 4).
