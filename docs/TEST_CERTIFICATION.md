# Certification des tests et de la gouvernance

État certifié le 28 juillet 2026.

- Unités racine : toutes les suites de `tests/unit` sont vertes avec couverture, via `npm run test:unit:coverage`.
- Intégration : 31/31 suites vertes avec PostgreSQL 16 et le bootstrap CI canonique, via `npm run test:integration`.
- Boutique : audit, gates rapides et couverture verts.
- Dashboards : audit et `check:all` verts.
- Gouvernance : registre, classification, invariants, projections 360, dispositions O6 et `map:check` verts.
- Preuve de la campagne complète : GitHub Actions run `30349485657`.
- Preuve du nettoyage racine, de la régénération des cartes et du `map:check` final : GitHub Actions run `30353246191`.

L'ancien chiffre « 13 suites en échec » provenait d'un ancien harnais et de fixtures périmées. Il ne décrit plus l'état du dépôt.

## Commandes canoniques

```bash
npm run test:unit:coverage
npm run test:integration
npm --prefix public/boutique run check:fast
npm --prefix public/boutique run test:coverage
npm --prefix public/dashboards run check:all
npm run feature:360:check
npm run map:check
```
