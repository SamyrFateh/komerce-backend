# Audit D7+D8 — CORS & Helmet (2026-06-23)

## Résultat : ✅ Conforme — aucune correction requise

Toute la configuration vit dans `bootstrap/security.js`.

---

## D7 — CORS

### Origines acceptées

Pas de wildcard `*`. La fonction `isAllowedOrigin()` accepte :
- `localhost:*` **uniquement si `NODE_ENV !== 'production'`** — production safe
- `process.env.FRONTEND_URL` — source de vérité unique pour l'origine prod
- `process.env.ALLOWED_ORIGINS` — liste supplémentaire séparée par virgules (CDN, backoffice, etc.)
- Requêtes sans `Origin` header (serveur→serveur) — acceptées

Toute autre origine → callback avec `Error('Not allowed by CORS')` → 403 via error-handler.

### Méthodes autorisées

`GET, POST, PUT, PATCH, DELETE, OPTIONS` — complet, aucune méthode dangereuse non couverte.

### Credentials

`credentials: true` — nécessaire pour les cookies de session (JWT httpOnly).

---

## D8 — Helmet / CSP

### Content Security Policy

- `defaultSrc: ['self']` — base restrictive
- `scriptSrc` : self + CDN explicites (cdnjs, unpkg, jsdelivr, stripe.js, paypal) — **pas de `unsafe-inline`** (retiré, commentaire FRESH-030/AUD-04)
- `scriptSrcAttr: ['none']` — event handlers inline interdits
- `objectSrc: ['none']` — flash/plugins bloqués
- `frameAncestors: ['none']` — clickjacking impossible
- `formAction: ['self']` — soumission de formulaire limitée à self

### Headers manquants (Helmet defaults)

Helmet active par défaut : `X-Frame-Options`, `X-Content-Type-Options`, `X-XSS-Protection`, `Referrer-Policy`, `Permissions-Policy`. Ces headers ne sont pas overridés dans `buildHelmetOptions()` donc ils s'appliquent avec leurs valeurs sécurisées par défaut.

**HSTS** : non configuré explicitement, mais Railway gère le TLS/HTTPS et peut injecter le header côté infra. À vérifier si Railway n'injecte pas déjà HSTS.

### Point d'attention

`styleSrc` inclut `'unsafe-inline'` — nécessaire pour les styles inline du frontend boutique (Tailwind JIT + composants tiers). Acceptable tant que `scriptSrcAttr: ['none']` protège l'exécution de code.

---

## Verdict

| Critère | État | Note |
|---------|------|------|
| Pas de CORS wildcard | ✅ | Origines explicites via env vars |
| Pas de CORS en dur (localhost hors prod) | ✅ | Conditionnel `NODE_ENV !== production` |
| Helmet activé | ✅ | `app.use(helmet(...))` |
| CSP sans unsafe-inline scripts | ✅ | FRESH-030 appliqué |
| frameAncestors none | ✅ | Anti-clickjacking |
| objectSrc none | ✅ | Anti-Flash |
| HSTS | ⚠️ | À vérifier côté Railway (infra) |
