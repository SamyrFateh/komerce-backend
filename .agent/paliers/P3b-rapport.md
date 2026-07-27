# P3b — projection `gateHealth`

**Statut : PARTIEL — non clos.**

## Livré

- `gateHealth` projeté sur 28/28 features.
- Messages détaillés des gates conservés.
- Agrégation limitée aux verdicts `HEALTHY`, `ATTENTION`, `BLOCKED`.
- Intégrité courante : 13 findings attribués, 0 non attribué, 0 fichier non projetable, 0 double projection.
- Tests négatifs présents pour attribution absente, fichier non projetable et double attribution.

## Écart de clôture

Le contrat d'audit fixe un minimum de 18 gates attribuables sur 24. `scripts/gen-gate-findings.js` n'exécute actuellement que trois sources : les deux registry checks et le classification check.

Le palier ne peut donc pas être fermé par réduction rétroactive de la cible. Il reste à ajouter au moins quinze sources attribuables, ou à faire valider une liste explicite d'exclusions gate par gate.

## Verdict

La mécanique de projection est livrée et saine sur les sources intégrées. La couverture contractuelle de l'écosystème de gates n'est pas atteinte.
