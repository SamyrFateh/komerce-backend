# AliExpress Wave 2 — completion vers 500 clean

## Contexte

La première exécution de `wave2-500-v1` a épuisé son plan de discovery à **399 produits clean**. Le résultat de Raffinerie était sain ; le goulot était la discovery, pas le contrat V2 ni le scanner économique.

La completion ne crée donc pas une Wave 3 et ne modifie pas le pool historique. Elle poursuit **la même Wave 2** jusqu'à `WAVE_TARGET=500` avec :

- un vocabulaire AliExpress nouveau ;
- un checkpoint distinct `wave2-completion-v1` ;
- déduplication contre tous les `supplier_product_id` AliExpress déjà connus ;
- la même provenance `discovery.wave=wave2-500-v1` ;
- un marqueur additionnel `discovery.wave_leg=wave2-completion-v1` ;
- ingestion exclusivement via `catalog-import-orchestrator` et la Raffinerie canonique ;
- aucune promotion, activation ou exposition catalogue.

## Pourquoi un leg séparé

Le checkpoint initial encode l'ordre logique des 64 requêtes de la première phase. Ajouter simplement des termes à cette liste aurait changé le calcul `logicalPage → keyword/queryPage` et rendu la reprise ambiguë. Le leg de completion garde donc l'historique intact et possède son propre espace de checkpoint.

## Gate de sortie

Le worker s'arrête dès que `countWaveClean()` atteint **500**. Les produits auto-exclus par la Raffinerie ne sont pas comptés comme `clean`, donc le worker continue à sourcer tant que 500 candidats scannés/importés propres ne sont pas présents.

Le verdict final attendu contient notamment :

- `final_wave_clean=500` ;
- `missing_after=0` ;
- audit V2/Raffinerie complet ;
- `promoted=0` à ce stade.
