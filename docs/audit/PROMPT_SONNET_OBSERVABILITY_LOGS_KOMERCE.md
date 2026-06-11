# Prompt opérationnel — Sonnet : lot OBS « Logs vers dashboard + masquage PII » (Komerce)

> Copier-coller à Sonnet (Claude Code / agent repo).
> Objectif : rendre les logs Pino **exploitables dans un dashboard** (rétention, requêtes, alertes) **sans fuiter de PII**. Lot ciblé, non destructif, centré sur `utils/logger.js`.

---

## RÔLE

Tu es ingénieur backend/observabilité senior sur Komerce (Express/Pino sur **Railway**). Tu enrichis le logging existant sans casser le comportement actuel ni alourdir le hot path. Conservateur : un transport propre + un masquage PII, pas une refonte.

## CONTEXTE À LIRE D'ABORD

- `utils/logger.js` — **le seul fichier** autorisé à logger (les autres passent par lui).
- `utils/phone.js` — normalisation E.164 (`normalizePhone`) ; réutilise un masque s'il existe, sinon ajoute-en un.
- La reco observabilité de l'audit (#11) et la sonde de santé du lot L0-D (cohérence à viser).

## CONSTATS DÉJÀ VÉRIFIÉS PAR L'ARCHITECTE (point de départ factuel)

`utils/logger.js` est déjà propre :
1. **`pino-pretty` est déjà gated dev-only** (`isDev && !isTest`) → en prod, JSON minifié (compatible Railway, qui plafonne à 500 lignes/s/réplica et recommande le minifié). ✅ ne pas casser ça.
2. **`redact` existe** pour `authorization`, `cookie`, `password`, `token`, `secret`, `creditCard` (+ wildcards `*.password`…), censor `[REDACTED]`. ✅
3. **Fallback console** si Pino absent, `forModule`/`child`, `httpLogger` (avec `request_id`) déjà en place. ✅ ne pas régresser.
4. **TROU 1 — aucun transport externe** : seuls `pino-pretty` (dev) ou stdout (prod). Rien ne part vers un agrégateur.
5. **TROU 2 — `phone` n'est PAS masqué** et est loggé partout (`log.warn({ phone, error })`, `{ err, phone }`…), de même `email`/`mobile`. ⇒ **dès qu'on expédie vers un tiers, c'est une fuite PII** (public diaspora, enjeu RGPD).

> Rappel : Railway **n'a pas de log drain**. On expédie soit via un **transport applicatif Pino** (ce qu'on fait ici, car le logger est centralisé), soit via un forwarder sidecar (Vector/Fluent Bit) — hors périmètre.

## GARDE-FOUS ABSOLUS

1. **Ne jamais logger un secret.** La `redact` existante reste, on ne la réduit pas.
2. **Masquer, pas supprimer, la PII de corrélation.** `phone`/`mobile`/`email` doivent rester **exploitables en ops** : masque partiel (ex. `+269•••67`), pas `[REDACTED]` total — sinon on ne peut plus suivre un numéro à travers ses logs.
3. **Conserver** le fallback console, `pino-pretty` dev-only, `forModule`/`child`, `httpLogger` et le `request_id`.
4. **Prod = JSON minifié.** Ne réintroduis pas de pretty en prod (rate limit Railway).
5. **Le transport ne doit jamais bloquer ni crasher l'app** : envoi asynchrone, best-effort, et l'app démarre/tourne même si l'agrégateur est down (fail-open côté logs, fail-safe côté app).
6. **Tout par env** : URL/clé de l'agrégateur via variables, jamais en dur. Boot sans ces variables = on log en local seulement, pas de crash.

## MISSION — sous-lots, dans l'ordre

### O1 — Masquage PII (fais-le EN PREMIER : c'est une fuite active)
- Ajoute un masquage cohérent de `phone`, `mobile`, `whatsapp_phone`, `email` **à toute profondeur**, via un `formatters.log` Pino (transforme chaque objet loggé) plutôt qu'au cas par cas.
- Réutilise/ajoute un `maskPhone()` dans `utils/phone.js` (garde indicatif + 2-3 derniers chiffres). Pour l'email, masque le local-part (`a***@domaine`).
- Vérifie que la `redact` secrets continue de s'appliquer **en plus** du masquage PII.

### O2 — Transport vers un agrégateur (après O1)
- Ajoute un **transport Pino prod**, gated `production` + activé seulement si la variable d'agrégateur est présente. Cible recommandée : `pino-loki` (Grafana Cloud) **ou** Axiom/Better Stack — propose, je tranche.
- Utilise un **multi-target** : garder **stdout** (pour le dashboard natif Railway) **et** l'agrégateur. Inclure les variables système Railway (`RAILWAY_SERVICE_NAME`, `RAILWAY_DEPLOYMENT_ID`, `RAILWAY_ENVIRONMENT_NAME`, `RAILWAY_REPLICA_ID`) comme labels/base.
- Envoi asynchrone, file bornée, drop si l'agrégateur est lent (jamais de backpressure sur l'app).

### O3 — Dashboard & alertes (no-code, à documenter)
- Documente les widgets Railway Observability utiles tout de suite (zéro déploiement) : logs filtrés `event=otp_sent`, `reason=authkey_rejected`, erreurs 5xx via `httpLogger`, + un **monitor** (e-mail/in-app) sur l'apparition de `authkey_rejected`.
- Si O2 retient Grafana/Axiom : esquisse 2-3 panels (taux succès OTP, motifs de rejet, latence `duration_ms` p95 depuis `httpLogger`).

### O4 — (optionnel) Corrélation bout-en-bout
- Propager le `request_id` (déjà présent backend via `httpLogger`) depuis les frontends (en-tête sur les appels `K.request`/`fetch`) pour suivre une action boutique → backend dans le dashboard.

## IMPLÉMENTATION DE RÉFÉRENCE (à adapter, ne pas copier aveuglément)

```js
// utils/phone.js — ajouter
function maskPhone(raw) {
  const s = String(raw || '');
  const digits = s.replace(/\D/g, '');
  if (digits.length < 4) return '•••';
  return `${s.startsWith('+') ? '+' : ''}${digits.slice(0, 3)}•••${digits.slice(-2)}`;
}
module.exports.maskPhone = maskPhone;

// utils/logger.js — dans l'appel pino({ ... }), AJOUTER (sans retirer redact) :
const { maskPhone } = require('./phone');
function maskEmail(v) {
  const [u, d] = String(v || '').split('@');
  return d ? `${u.slice(0, 1)}***@${d}` : '[email]';
}
// formatters.log s'applique à chaque objet loggé, à toute profondeur via un walk léger
function maskPII(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  for (const k of Object.keys(obj)) {
    const v = obj[k];
    if (v && typeof v === 'object') { maskPII(v); continue; }
    if (/^(phone|mobile|whatsapp_phone)$/i.test(k)) obj[k] = maskPhone(v);
    else if (/^email$/i.test(k)) obj[k] = maskEmail(v);
  }
  return obj;
}

// pino({ ... , formatters: { log: maskPII }, redact: { ...inchangé... } })

// Transport prod multi-target (exemple pino-loki, gated + env-driven) :
let transport;
if (isDev && !isTest) {
  transport = { target: 'pino-pretty', options: { /* inchangé */ } };
} else if (!isTest && process.env.LOKI_URL) {
  transport = {
    targets: [
      { target: 'pino/file', options: { destination: 1 } }, // stdout → Railway natif
      { target: 'pino-loki', options: {
          host: process.env.LOKI_URL,
          basicAuth: process.env.LOKI_USER ? { username: process.env.LOKI_USER, password: process.env.LOKI_PASSWORD } : undefined,
          labels: { service: 'komerce-backend', env: process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV },
          batching: true, interval: 5,
        } },
    ],
  };
}
```

## MÉTHODE

1. **O1 d'abord** (la fuite), test à l'appui, puis O2.
2. **Test du masquage** : un log `{ phone: '+2693312345' }` ressort masqué (`+269•••45`) ; un `{ password: 'x' }` reste `[REDACTED]`.
3. **Test fail-open** : agrégateur injoignable → l'app tourne, les logs stdout passent toujours.
4. **Doc-sync** : note la conf observabilité (variables, widgets, monitor) dans `docs/ops/` ou `CARTOGRAPHY_360.md` §5.

## CRITÈRES D'ACCEPTATION

- `phone`/`mobile`/`email` **masqués** dans tous les logs (à toute profondeur), secrets toujours `[REDACTED]`.
- Transport prod **optionnel et env-driven** ; stdout conservé (dashboard Railway intact) ; app résiliente si l'agrégateur tombe.
- `pino-pretty` toujours dev-only ; fallback console, `httpLogger`, `request_id` non régressés.
- Au moins un monitor `authkey_rejected` documenté.

## ANTI-OBJECTIFS

- Pas de `[REDACTED]` total sur les téléphones (on perd la corrélation ops).
- Pas de pretty-print en prod.
- Pas de transport synchrone/bloquant.
- Pas de secret ni d'URL d'agrégateur en dur.
- Pas de forwarder sidecar dans ce lot (hors périmètre).

---

### Mini-prompts prêts à tirer

**O1** — « Lance O1. Ajoute `maskPhone()` à `utils/phone.js` et un `formatters.log` dans `utils/logger.js` qui masque `phone`/`mobile`/`whatsapp_phone`/`email` à toute profondeur, sans retirer la `redact` secrets. Test : `{ phone }` masqué, `{ password }` toujours `[REDACTED]`. »

**O2** — « Lance O2. Propose la cible d'agrégateur (pino-loki/Grafana vs Axiom vs Better Stack) avec tradeoffs, puis ajoute le transport prod multi-target (stdout + agrégateur), gated et env-driven, asynchrone et fail-open. Montre le test : agrégateur down → app OK, stdout OK. »
