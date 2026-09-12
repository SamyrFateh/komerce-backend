# AliExpress Business Readiness — exécution

Branche active : `feat/aliexpress-business-readiness`.

Première correction appliquée : `KOMERCE_ENV` devient l'autorité pour le garde-fou runtime du worker AliExpress. Ainsi un déploiement Node optimisé avec `NODE_ENV=production` reste autorisé lorsqu'il s'agit explicitement de `KOMERCE_ENV=staging`, tandis que `KOMERCE_ENV=production` reste bloquant.

Prochaine preuve : exécution live du pool borné sur le runtime staging, après merge et vérification des gates.
