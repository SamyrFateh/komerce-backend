# AliExpress AE-1 — constats live

## Statut

La connexion AliExpress live est démontrée. La découverte produit reste le dernier verrou avant le pool 500.

## Preuves

- la signature live a d'abord échoué à cause d'un caractère parasite dans le secret applicatif ; la normalisation des credentials est désormais mergée et l'erreur a disparu ;
- `aliexpress.ds.recommend.feed.get` répond correctement mais retourne zéro produit pour KM, AE et US, avec et sans catégorie de test ;
- le parseur reflète bien la réponse fournisseur vide ;
- le modèle Komerce confirme que le fournisseur livre au Hub Dubai et que Dubai → Market relève du rail logistique Komerce ;
- l'ancien endpoint TOP historique répond `Invalid app Key` et n'est donc pas le realm de l'AppKey moderne actuelle.

## Prochaine preuve

Tester `aliexpress.affiliate.product.query` sur le gateway moderne `/sync` avec l'AppKey actuelle. Si cette API renvoie des IDs réels, elle devient uniquement la couche de découverte, puis `aliexpress.ds.product.get` reste l'autorité détail/SKU/stock avant passage dans la Raffinerie.

AE-1 sera clos lorsque des IDs réels seront découverts, que plusieurs détails produit live auront été chargés et qu'un lot réel aura traversé la Raffinerie.
