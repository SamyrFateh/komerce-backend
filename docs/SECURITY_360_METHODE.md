# Security 360 — méthode, lecture, limites

4ᵉ carte de la cartographie vivante. Elle répond à une question : **quel endpoint est protégé par quoi ?** — et bloque toute régression via le cliquet, comme les trois autres cartes.

## Pourquoi une approche hybride

La détection naïve (lire le **nom** des middlewares montés au runtime) **ne marche pas** sur ce codebase, et c'est un enseignement en soi :

- la garde dominante est une *factory* : `requireRole(['admin'])` (42 fichiers, contre 19 pour le `requireAdmin` nommé) ;
- `requireRole(roles)` retourne une **arrow anonyme**, et l'autorisation est dans l'**argument** `['admin']`, fermé dans la closure ;
- au runtime, on ne voit qu'une fonction sans nom : impossible de distinguer `requireRole(['admin'])` de `requireRole(['agent_relais'])`.

Une première version 100 % runtime sur-signalait donc 130 fausses « routes admin sans garde ». D'où l'hybride :

- **inventaire COMPLET** des routes → introspection runtime (on monte les vrais routeurs, on parcourt la pile). C'est la seule méthode prouvée exhaustive (re-exports, sous-routeurs, routes directes).
- **gardes + rôles** → analyse **statique** des chaînes de gardes dans les fichiers de routes.
- **jointure** par fichier + suffixe de chemin.
- tout ce que le statique n'atteint pas → **UNKNOWN** (jamais « OK » silencieux).

## Ce que l'analyse statique sait résoudre (validé)

Chaque classe ci-dessous a été un faux positif détecté **puis corrigé**, vérifié sur le vrai code :

| Motif | Exemple | Traitement |
|---|---|---|
| Factory à argument | `requireRole(['admin','agent_hub'])` | rôles extraits de l'argument |
| Alias de garde | `const guard = [authenticate, requireRole(['admin'])]` | alias résolu |
| Spread | `router.get('/x', ...guard, h)` | spread résolu |
| Argument tableau nu | `router.get('/x', adminOnly, h)` | alias nu résolu |
| Garde au niveau routeur | `router.use(authenticate, requireAdmin)` en tête de fichier | hérité par toutes les routes du fichier + sous-routeurs |
| Re-export | `module.exports = require('./admin/index')` | suivi |
| Sous-routeur | `router.use('/', require('./system'))` | suivi (préfixe propagé) |

## Lecture des niveaux

- 🟢 **PROTECTED** — authentification présente (et garde admin si chemin `/api/admin`).
- ⚪ **PUBLIC** — sans auth mais légitime (santé, `public/*`, login/register, webhooks signés, verify-qr).
- 🟠 **UNPROTECTED** — sans auth et hors liste publique. La plupart sont des pré-flux légitimes (guest-checkout, OTP, magic-link, lectures boutique, factures à token public) ; quelques-uns méritent une revue (ex. `auth/otp/test-reset`).
- 🔴 **ADMIN_NO_GUARD** — chemin `/api/admin` **sans** garde admin. Sévérité haute. Les 2 cas actuels (`GET /api/admin/pricing-components` et `/{id}`) sont réels : leurs lectures sont en `authenticate` seul alors que leurs écritures utilisent `...guard` admin — à confirmer comme voulu ou à corriger.
- ❔ **UNKNOWN** — le statique n'a pas atteint la chaîne (ex. `admin/sourcing/*`). **À auditer manuellement** ; ce n'est pas un feu vert.

## Cliquet

```
npm run security:360          # régénère le rapport
npm run security:360:check    # exit 1 si une NOUVELLE anomalie hors baseline
npm run security:360:save     # fige l'état revu (après revue humaine)
```

L'état actuel est figé comme baseline. Désormais toute **nouvelle** route admin sans garde, ou non protégée, ou non classable, est bloquée tant qu'elle n'est pas corrigée — ou explicitement acceptée via `:save`.

## Limites assumées

- L'analyse statique suppose les motifs ci-dessus ; un motif de garde exotique non listé tomberait en UNKNOWN (signalé), jamais en faux PROTECTED.
- Le niveau **autorise/présent** est lu dans le code, pas **exécuté**. Pour une preuve empirique (le gold standard), compléter par un test boîte-noire : requête avec un utilisateur non-admin → attendre 403. C'est l'audit indépendant recommandé.
- Ce script boote l'app (introspection runtime), comme le générateur de contrat. Il relève donc d'une **étape CI**, pas du pre-commit (trop lourd). À câbler à côté de la porte contrat.
