# Verdict terminal — expérience Opus A→B sur CJ498 (sans IA)

**Décision : NO GO pour la méthode de validation automatique par clé « deux derniers noms » avec les familles prioritaires du lot A.**
Cette décision ne retire pas la certification technique V1 et n'affirme pas que les types d'objets sont inutiles.

## Contrat expérimental gelé

- Source CJ authentique : 498 identités, SHA256 `9ff18f6f902f2e72fc893a90da96b61058c77028d55e941381631fc9fb8116de`.
- Lot A : 248 produits, 208 clés proposées, 11 familles de priorité ≥ 3 (34 produits).
- Lot B : 250 produits, dont 91 `REVIEW_REQUIRED` en V1.
- La sélection des clés est calculée exclusivement sur A avec `scripts/cj-headnoun-ab-experiment.js` ; le groupe B n'entraîne aucune modification des règles.
- Aucun reviewer n'a validé ces familles. On mesure uniquement le **maximum théorique** de réutilisation avec approbation hypothétique de toutes les familles A.

## Résultat décisif

| Scénario fixé sur A | Familles A | Réutilisations B en revue | Taux maximal B |
|---|---:|---:|---:|
| Priorité ≥ 3 (protocole Opus) | 11 | **4 / 91** | **4,40 %** |
| Priorité ≥ 2 (sensibilité) | 26 | **6 / 91** | **6,59 %** |

Seuil préspécifié NO GO : réutilisation < 25 %. Même la borne volontairement
optimiste reste très en dessous du seuil. La précision sur les 4 correspondances
n'a pas été mesurée : certaines familles mélangent objets, accessoires et attributs.

Une revue humaine des 11 groupes ne pourrait pas augmenter le nombre de matches
pour ces clés figées ; elle ne pourrait que confirmer, scinder, exclure ou différer.
Il n'est donc pas utile de demander une approbation humaine pour cette expérience.

## Limites à ne pas masquer

- Le lot B appartient au même corpus CJ déjà exploré lexicalement auparavant.
  Ce n'est **pas** une validation indépendante de généralisation chez Allegro/AliExpress.
- Les 4,40 % sont une borne de couverture potentielle, **pas** une précision.
- Ce verdict ne juge pas le gain possible d'un véritable analyseur d'identité
  d'objet ni les technologies IA locales. Aucun LLM, Ollama, API ou clé n'a été utilisé.
- Le seuil de priorité et les clés A sont gelés ; ne pas réoptimiser en regardant B.
- Ne pas prétendre que les 195 V1 en revue sont 195 interventions humaines
  effectivement nécessaires.

## Clôture et transfert

1. **Conserver V1** : 63 feuilles, 240 parents, 195 en revue (précision indépendante encore inconnue).
2. Conserver la PR #3092 comme archive R&D **draft, non fusionnée** ; ne pas
   intégrer ce nouveau regroupement dans le moteur canonique.
3. Ne pas demander à l'utilisateur de classer les 11 familles pour sauver
   une expérience déjà NO GO sur sa borne supérieure.
4. Passer aux E2E métiers : sourcing → raffinerie → atelier prix → catalogue
   → expositions marchés → commande → paiement → achat fournisseur → HUB
   → relais → remise → clôture ; validations nommées par marché et rôle.
5. Ouvrir une future optimisation de classification seulement lorsqu'une
   anomalie métier réelle est reproduite dans la matrice E2E.

Source reproductible : `scripts/cj-headnoun-bound.js` et
`.github/workflows/catalog-object-shadow-v2.yml`.
Les résultats JSON sont conservés en artefact CI et les tests vérifient
qu'aucune classification n'a été écrite.
