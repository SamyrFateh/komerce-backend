# Classification Sourcing : mesure CJ498 + lot AliExpress jamais vu (synthèse)

Rejeu hors ligne, sans appel fournisseur ni écriture. Reproduire : `python3 -I eval.py && python3 -I sim.py && python3 -I ali_eval.py && python3 -I ali216_eval.py` (sortie attendue : `RESULTATS.txt`).

| Règle « objet identifié + branche fournisseur concordante » | Placés | Précision catégorie | Précision feuille |
|---|---|---|---|
| CJ498 (réglage, non aveugle) | 312 / 498 (62,7 %) | 98,4 % | 97,3 % |
| **AliExpress 216 (jamais vu, lexique gelé)** | **95 / 216 (44,0 %)** | **100 % (95/95)** | **93,3 % (84/90)** |
| AliExpress 19 (staging) | 10 / 19 | 10/10 | 10/10 |
| Référence : `main` actuel sur CJ498 | 54 / 498 (10,8 %) | 100 % | 100 % |

Lecture du lot AliExpress 216 (9 racines fournisseur)
- Aucune catégorie fausse sur 95 placements ; borne basse à 95 % de confiance : 96 %.
- Feuille sous le seuil de 95 % : 6 erreurs sur 90 (4 genres de chaussures, 2 accessoires PC rangés en Phones).
- Couverture faible : objet reconnu 143 / 216 (66 %), dont 103 dans la bonne catégorie ; 73 sans objet reconnu.
- Désaccord objet / branche : 47, où l'objet n'a raison que 7 fois (135 / 158 sur CJ). Hors CJ, l'objet seul n'est pas fiable : c'est la branche qui protège. Auto 2 / 40 et Computer 5 / 40 placés : lexique à étendre.
- Table des racines AliExpress : 8 lignes, écrite depuis les noms de chemins ; 2 produits sans racine connue.

Limites de la preuve
- Étiquettes de référence (498 + 216) posées par Fable, non validées par un humain.
- Le lexique a été réglé sur CJ498 : seul le lot AliExpress 216 est une mesure indépendante.
- Lot AliExpress : 9 racines, 23 branches ; bijoux, beauté, maison, bricolage non couverts.

Verdict : **GO conditionnel**
1. GO pour implémenter la règle au niveau **catégorie**, derrière un drapeau.
2. Feuille automatique : NO GO en l'état (93,3 %) ; la proposer en suggestion, à confirmer en revue.
3. Avant activation : validation humaine de 150 étiquettes tirées par strate (écart toléré ≤ 5 %).
4. Étendre le lexique d'objets (auto, informatique, coques) puis rejouer sur un lot neuf, jamais sur celui-ci.
5. Désaccord, ambiguïté ou racine inconnue : revue groupée dans le Catalogue global. Discovery : aide à la revue seulement.
