# P1 — contradiction prouvée : prix global du Catalogue et prix local du marché

## Signal concret du staging (2026-10-26)

La cohorte KIR-000009 contient 20 références fournisseur, 13 décisions source certifiées, 9 liens produits globaux, 2 produits globaux actifs, 9 expositions KM ENABLED et **zéro LOCAL_ACTIVE**. API publique `/api/products?market=KM&limit=1000` HTTP 200 / total 0. Preuve : [run 40308856603](https://github.com/SamyrFateh/komerce-backend/actions/runs/40308856603).

La suite Chromium a traversé les cinq écrans Sourcing/Import Runtime/Catalogue global/Catalogue pays/Pricing en desktop/mobile, mais **ces 10 assertions vertes n'attestaient que le chargement des pages**. Les deux assertions boutique ont correctement échoué. Le rapport ne prouve aucune transition métier complète.

## Deadlock code, indépendamment du staging

1. `services/sourcing-candidate-actions.js` et `services/catalog-candidate-product-service.js` créent volontairement le brouillon fournisseur avec `products.price_kmf=NULL`, `is_active=false` et sans exposition, la décision du prix relevant du marché.
2. `services/product-publication-guard.js` rejetait `price_kmf=NULL` systématiquement avec `invalid_price` avant première publication. `services/catalog-certification.js` répète ce même garde, `services/catalog-market-exposure-service.js` le réutilise pour afficher la file marché et `public/dashboards/canonical/js/catalog-workspace.js` désactivait la validation en renvoyant vers la tarification.
3. `services/market-commercial-price-service.js` refuse de décider le prix local d'un produit dont `is_active !== true`. **Le Catalogue exigeait donc le prix avant d'être actif et le Pricing exigeait l'activation Catalogue avant d'accepter le prix.**
4. Par ailleurs, `services/catalog-public-view.js` exige `product_market_exposure.ENABLED` **et** `product_market_price_drafts.LOCAL_ACTIVE` pour afficher le produit au client. Ce gate final est conservé : globalement approuvé ne veut jamais dire vendu ou achetable.

## Correction minimale / frontière d'autorité

- Le garde de première publication accepte `price_kmf=NULL` **seulement** quand le service propriétaire lui fournit `context.allowDeferredLocalPrice=true`. Un `price_kmf=0`, négatif ou NaN explicite reste refusé. Aucune API ou client ne peut fournir cette option.
- L'owner de certification Catalogue ne transmet l'option que si une filiation `sourcing_candidates.imported_to_catalog` existe (`has_sourcing_candidate=true`). Les autres contrôles (décision Sourcing TEST/PRIORITY, identité fournisseur et SOI, taxonomie boutique active, FR éditorial validé, média, cap, absence d'exposition avant première publication, approbation humaine) restent intacts.
- Le read-model du Responsable pays utilise le même contrat pour rendre le candidat sourcé éligible sans inventer de prix global.
- La curation Catalogue distingue explicitement **prix de référence global** et **prix acheteur local** : l'absence du premier n'empêche plus une approbation si la source est certifiée ; l'absence du second interdit toujours la visibilité acheteur.

## Test attendu de bout en bout

1. Candidat fournisseur certifié, source et SKU exacts, qualité FR attestée, taxonomie complète : approbation globale avec prix NULL.
2. Le même produit reste absent de l'API boutique `market=KM` et tout checkout (pas encore d'offre achetable).
3. Market Operator avec capabilities décide un montant local positif, le moteur fait le preview économique et active `LOCAL_ACTIVE` si ses règles l'autorisent ; `product_market_exposure` est ensuite ENABLED.
4. Ce même produit (même UUID, même supplier unit) est alors visible dans l'API et le vrai DOM boutique desktop/mobile, et peut être acheté aux conditions requises.
5. Négatifs : produit non sourcé avec NULL, prix explicite 0, source WATCH/EXCLUDED, taxonomie inactive, SKU non commandable, FR non approuvé, pays sans exposition ou prix non actif restent bloqués.

## Deux autres blocages à ne pas maquiller

- Le preview de promotion du KIR-000009 est réellement bloqué pour les quatre candidats restants par une taxonomie commerciale inactive ou non résolue : [run 40309838816](https://github.com/SamyrFateh/komerce-backend/actions/runs/40309838816). Il faut gérer l'autorité de classement avec des catégories réelles avant de promouvoir, pas leur attribuer une catégorie par défaut.
- Les **9 lignes ENABLED pour seulement 2 produits globaux actifs** ne signifient pas qu'il existe 9 produits publiés : `setExposure` autorise techniquement une décision sur un produit inactif. Cela crée des états contradictoires avec `catalog-certification.enabled_markets === 0`. Prévoir un audit de provenance et une réconciliation sélective par service propriétaire ; ne pas supprimer ni désactiver à l'aveugle.

Cette correction répare le cycle de **publication globale**. Elle n'est **pas** une autorisation d'auto-publier, d'auto-tarifer, de contourner le price floor ou de déclarer 20 produits GO.
