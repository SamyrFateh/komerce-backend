# G4/G5 — Dossier de qualification du scanner indépendant Komerce

Programme : [#3128](https://github.com/SamyrFateh/komerce-backend/issues/3128). Étapes : [G4 #3132](https://github.com/SamyrFateh/komerce-backend/issues/3132), [G5 #3133](https://github.com/SamyrFateh/komerce-backend/issues/3133).

## Deux verdicts indépendants

**G4 :** rejouer un corpus fixe de **douze** témoins physiques déjà connus : neuf parcours conformes et trois violations attendues (deux expériences adversariales finance/logistique, une anomalie d'archive Sourcing [#3127](https://github.com/SamyrFateh/komerce-backend/issues/3127)). Calculer matrice de confusion, précision, rappel et spécificité avec vérité établie **dans un registre distinct du rapport du scanner**. Un corpus rétrospectif n'est pas une étude aveugle.

**G5 :** bloquer la promotion sur `main` si l'un des critères de livraison manque :
1. 12 étalons physiques et SHA cohérents, sur clones supprimés ;
2. mapping sémantique Feature Card → oracle réellement vérifié, ratio d'invariants éligibles calculé ;
3. vrai générateur de fixtures et expérience canonique autonome capable de trouver une mutation inédite cachée au générateur ;
4. benchmark aveugle hors corpus de développement avec fausses alertes et défauts manqués mesurés ;
5. revue intégrale du diff depuis `main`, absence de modifications métier étrangères à la livraison ;
6. smoke test de l'installation, trois modes, sécurité du sandbox, documentation opérateur et versions.

Aucune proposition de fusion, autorisation utilisateur ou CI verte ne supprime ces critères.

## Commandes reproductibles

Une première recette sur PostgreSQL de test *local uniquement* :

```bash
NODE_ENV=test KOMERCE_DISABLE_CRONS=true \
DATABASE_URL=postgres://user:password@localhost/komerce_test \
npm run audit:logic:unified -- --mode full --out /tmp/komerce-audit/v35
```

Une sélection ciblée **sans preuve métier** :

```bash
npm run audit:logic:targeted:plan -- \
  --files services/order-status-machine.js,features/orders.feature.js \
  --budget 2 --out /tmp/komerce-audit/impact
```

Le benchmark et la décision de livraison sans aucune connexion aux bases :

```bash
npm run audit:logic:release:check -- \
  --audit /tmp/komerce-audit/v35/unified-audit.json \
  --impact /tmp/komerce-audit/impact/impact-plan.json \
  --out /tmp/komerce-audit/release
```

Sorties : `g4-calibration.json`, `g4-calibration.md`, `g5-release-readiness.json`, `g5-release-readiness.md`. Si G4 recense bien 3/3 violations et 9/9 témoins sains, la **calibration connue** est verte ; la **livraison V4.0** demeure **NO_GO** si la génération d'expériences et le benchmark aveugle n'ont pas de preuves.

## Blocage actuel d'intégration main

Comparaison faite le 29/10/2026, branche `research/business-auditor-v36-impact-selection-20261029` par rapport à `main` :

- Historique divergeant : **545 commits d'avance, 34 de retard**.
- Diff de **229 fichiers**, dont de nombreux changements de scripts/CI et plusieurs fichiers applicatifs sans rapport avec l'auditeur.
- Le dossier `tools/business-auditor` n'existe pas encore sur `main`; il faut y migrer l'intégralité de ses dépendances de manière **isolée et rebasée**, pas fusionner la pile de PR historiques en bloc.
- Les gates G2/G3/G4 hors corpus ne passent pas encore : **V4.0 non publiable**.

**Procédure GO future :** (i) produire un lot intégration basé sur HEAD `main` et limité à `tools/business-auditor/**`, scripts scanner nécessaires, workflow dédié et package scripts ; (ii) évaluer les sources réellement nécessaires, retirer celles non utilisées, lister les fichiers runtime impactés ; (iii) exécuter unitaires + physical + benchmark aveugle depuis ce **nouveau SHA** et vérifier toutes les actions et protections de branche ; (iv) seulement alors fusionner la PR isolée et vérifier le SHA `main` après merge.

## Gouvernance

Scanner autonome = détecter des *classes* de défauts inconnus du sélecteur, pas garantir 100 % des bugs. Les sorties statiques sont des hypothèses, pas des défauts confirmés. Aucun cas de production, encaissement réel, environnement Railway ou modification métier n'est requis pour certifier le composant. Le NO_GO reste un verdict de maturité du **produit scanner**, pas un échec de la capacité déjà vérifiée de rejouer les 12 étalons.
