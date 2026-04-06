# Delta — Phase 2 : Migration constantes → getRuleNumber()

## Contexte

PR #106 — Migration de 10 constantes hardcodées pricing vers `business_rules` + correction 2 injections SQL.
Branche : `feat/phase2-migration-constantes`

## ROADMAP

- Section "Gouvernance Opérationnelle" : progression 3/5 → 3/5 (Phase 2 déjà comptée mergée, mais les fichiers sont maintenant complets)
- Ajouter note : Phase 2 complétée avec PR #106 incluant 9 fixes (2 security + 7 governance)

## CARTOGRAPHY

- `utils/rules.js` : SHA à mettre à jour — ajout `getRuleNumber()` et `getRuleString()` (2 nouvelles fonctions exportées)
- `utils/rates.js` : SHA à mettre à jour — fallback via `getRuleNumber('RATE_EUR_KMF_DEFAULT')`
- `utils/pricing.js` : SHA à mettre à jour — moteur v6.5 100% async, 10 paramètres configurables via `getRuleNumber()`
- `utils/sms.js` : SHA à mettre à jour — délais cash dynamiques via `getRuleNumber()`
- `routes/orders.js` : SHA à mettre à jour — 2 injections SQL corrigées (requêtes paramétrées)
- `server.js` : SHA à mettre à jour — cron dynamique + seed 10 règles pricing + loyalty info-only
- Ajout fichier : `db/migrations/008_pricing_rules.sql` — migration insert 10 règles pricing dans `business_rules`
- Ajout fichier : `docs/CHANGES_PHASE2_MIGRATION.md` — changelog détaillé Phase 2
- Section utilitaires : `utils/rules.js` — ajouter mention `getRuleNumber()`, `getRuleString()` dans le rôle
- Section utilitaires : `utils/pricing.js` — ajouter mention "moteur v6.5 async, 10 params configurables"
- Compteur migrations : 4 → 5 (ajout 008)

## AUDIT

- Issue #71 (Injection SQL potentielle) : 2 injections corrigées dans `routes/orders.js` (endpoint `/problems` et `pickup_code`)
- Note : toutes les interpolations `business_rules` passent par `getRuleNumber()` qui force le cast Number (anti-injection)
