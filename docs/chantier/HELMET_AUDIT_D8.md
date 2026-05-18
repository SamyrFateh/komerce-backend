# D8 — Audit Helmet / CSP production

> Date : 2026-05-17
> Scope : audit/documentation uniquement

## Résumé

Audit de la configuration Helmet et Content-Security-Policy dans `server.js`.

Aucune modification de code n'a été appliquée afin de ne pas casser Stripe, les CDN utilisés par les pages statiques ou la boutique.

## Configuration constatée

`server.js` active Helmet avec une CSP explicite :

- `defaultSrc: 'self'`
- `scriptSrc: 'self'`, `unsafe-inline`, cdnjs, unpkg, jsdelivr, Stripe JS
- `styleSrc: 'self'`, `unsafe-inline`, Google Fonts
- `fontSrc: 'self'`, Google Fonts, cdnjs, `data:`
- `imgSrc: 'self'`, `data:`, `https:`, `http:`
- `connectSrc: 'self'`, Google Fonts, cdnjs, unpkg, jsdelivr, Stripe API
- `frameSrc: 'self'`, Stripe JS, Stripe hooks
- `mediaSrc: 'self'`
- `objectSrc: 'none'`
- `frameAncestors: 'none'`
- `baseUri: 'self'`
- `formAction: 'self'`
- `scriptSrcAttr: 'unsafe-inline'`

## Garanties constatées

- `objectSrc: 'none'` bloque les plugins/objets embarqués.
- `frameAncestors: 'none'` empêche le clickjacking par framing externe.
- `baseUri: 'self'` limite les injections de balise base.
- Stripe est explicitement autorisé pour scripts et frames.
- Les CDN actuellement utilisés par les pages statiques sont explicitement autorisés.
- La politique est centralisée dans `server.js`, donc facile à auditer.

## Risques et limites

### 1. `unsafe-inline` très permissif

`scriptSrc`, `styleSrc` et `scriptSrcAttr` autorisent l'inline. C'est probablement nécessaire aujourd'hui pour les pages legacy et scripts injectés, mais ce n'est pas idéal en production.

Action recommandée : ne pas retirer brutalement. Prévoir un lot CSP dédié avec nonce/hash après inventaire des scripts inline.

### 2. `imgSrc` autorise `http:`

Les images peuvent être chargées en HTTP. Cela peut créer du mixed content si la page est servie en HTTPS.

Action recommandée : migrer progressivement les images externes vers HTTPS et retirer `http:` dans un lot dédié.

### 3. CDN larges

`cdnjs`, `unpkg` et `jsdelivr` sont autorisés. C'est pratique, mais augmente la surface de dépendance externe.

Action recommandée : figer ou self-hoster les assets critiques avant Go Live si nécessaire.

### 4. `connectSrc` ne liste pas explicitement tous les endpoints externes potentiels

Stripe est autorisé, mais certains futurs providers analytics, WhatsApp, ou API tierces côté front nécessiteraient une mise à jour CSP.

Action recommandée : toute nouvelle intégration front doit passer par une mise à jour CSP explicite.

### 5. CSP non séparée par environnement

La même politique s'applique en dev et prod. C'est simple, mais une politique prod plus stricte pourrait être souhaitable plus tard.

## Conclusion D8

D8 est validé côté audit.

Aucun correctif immédiat n'est appliqué, car un durcissement CSP sans inventaire peut casser la boutique, les pages admin, Stripe ou les CDN.

## Recommandations de suite

1. Créer un inventaire des scripts inline avant toute suppression de `unsafe-inline`.
2. Retirer `http:` de `imgSrc` seulement après migration des images.
3. Réduire les CDN ou self-hoster les assets critiques si l'objectif Go Live l'exige.
4. Garder Stripe explicitement autorisé tant que le checkout est utilisé.
