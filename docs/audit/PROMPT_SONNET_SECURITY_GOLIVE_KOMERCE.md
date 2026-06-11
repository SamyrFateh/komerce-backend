# Prompt opérationnel — Sonnet : lot L0-C « Sécurité go-live » (Komerce)

> Copier-coller à Sonnet (Claude Code / agent repo).
> Objectif : fermer les points de sécurité qui ne doivent pas survivre à une exposition publique. Lot **ciblé et non destructif** : on durcit, on ne réécrit pas.

---

## RÔLE

Tu es ingénieur sécurité applicative senior sur Komerce. Tu corriges des points précis sans affaiblir le socle existant (déjà solide : `helmet`+CSP, CORS contrôlé, rate-limiting, bcrypt, JWT 2h, webhooks Stripe signés). Conservateur : correctif minimal + test, jamais d'affaiblissement « pour aller plus vite ».

## CONTEXTE À LIRE D'ABORD

- `docs/audit/SECURITY_CHECKLIST.md`, `docs/audit/AUDIT_BUGS.md`.
- Les audits de chantier déjà faits : `docs/chantier/ADMIN_AUTH_AUDIT_D1.md`, `AUTH_GUEST_AUDIT_D3.md`, `CORS_AUDIT_D7.md`, `HELMET_AUDIT_D8.md`, `ENV_AUDIT_D5.md` — **vérifie que leurs findings sont bien clos** avant d'en ouvrir d'autres.
- `docs/CARTOGRAPHY_360.md` §5 (`REQUIRED_ENV`).

## CONSTATS DÉJÀ VÉRIFIÉS PAR L'ARCHITECTE (point de départ factuel)

1. **Mot de passe admin par défaut.** `server.js` appelle `fixAdminHash` (depuis `scripts/fix-schema.js`) au boot ; un défaut (`Komerce2026!`) est documenté, rotation via `ADMIN_PASSWORD`. Un outil CLI propre existe déjà : `scripts/reset-admin.js` (pas de surface réseau, pas de secret hardcodé). ⇒ Il faut **garantir qu'aucun environnement de prod ne tourne sur le défaut**.
2. **Webhook entrant Authkey NON authentifié.** `server.js:43` : `app.get('/webhook/authkey-whatsapp', async (req,res) => {…})` — GET, paramètres en query, **aucun middleware d'auth**. À comparer au webhook **Meta** (`routes/meta-whatsapp.js`) qui, lui, vérifie une signature (`verifyMetaSignature`) et un verify-token. ⇒ Le webhook Authkey est le maillon faible : il enregistre des statuts de livraison sans preuve d'origine.
3. **Socle sain par ailleurs** (cf. `AUDIT_BUGS.md` « ce qui est bien fait ») : bcrypt 10 rounds, JWT 2h, auth middleware sur les routes sensibles, webhooks Stripe en body brut signés. Ne **pas** régresser ça.

## GARDE-FOUS ABSOLUS

1. **`REQUIRED_ENV` reste fail-fast** — pas de fallback silencieux.
2. **Ne pas désactiver** la signature Stripe (I-07) ni affaiblir `helmet`/CSP/CORS pour contourner un problème.
3. **Aucun secret en clair** introduit dans le code ou les logs. Pas de secret dans un message d'erreur.
4. **Non destructif** : pas de suppression de tables, pas de changement de comportement métier.
5. **Authentifier sans casser le flux** : durcir le webhook Authkey ne doit pas faire rater les accusés de livraison légitimes (sinon les statuts SMS/WhatsApp deviennent faux).

## MISSION — sous-lots, dans l'ordre

### C1 — Éliminer la dépendance au mot de passe admin par défaut
- Lis `fixAdminHash` (`scripts/fix-schema.js`) : comprends exactement quand le défaut est appliqué.
- Rends le défaut **impossible en prod** : si `NODE_ENV=production` et `ADMIN_PASSWORD` absent/égal au défaut → **refus de boot** (cohérent avec le fail-fast `REQUIRED_ENV`), ou au minimum bascule forcée vers `reset-admin.js`.
- Vérifie qu'aucune **route web** de reset admin n'est exposée (la doctrine privilégie le CLI `reset-admin.js`).

### C2 — Authentifier/whitelister le webhook entrant Authkey
- Choisis le mécanisme adapté à ce que Authkey permet réellement (vérifie leurs docs/headers) : **token secret partagé en query/header** vérifié côté serveur, et/ou **IP-allowlist**, et/ou HMAC si disponible.
- Implémente le minimum efficace, **post-vérif avant tout effet** (un appel non prouvé est ignoré, pas enregistré).
- Aligne le niveau de preuve sur celui du webhook Meta voisin.

### C3 — Hygiène des secrets (revue ciblée)
- Vérifie qu'aucun secret n'est hardcodé (hors `.env.example` qui ne doit contenir que des placeholders).
- Vérifie que les logs ne fuitent ni token, ni mot de passe, ni clé.
- Confirme la couverture `REQUIRED_ENV` vs secrets réellement nécessaires.

## MÉTHODE

1. **Vérifie d'abord que les audits D1/D3/D5/D7/D8 sont clos** — ne ré-ouvre pas un sujet déjà traité.
2. **Plan court** par sous-lot (fichier, correctif, test).
3. **Test pour chaque correctif** : C1 → boot refusé si défaut en prod ; C2 → appel non signé/non whitelisté rejeté, appel légitime accepté.
4. **Doc-sync** : mets à jour `SECURITY_CHECKLIST.md` (items cochés) et `CARTOGRAPHY_360.md` (webhook Authkey désormais authentifié).

## CRITÈRES D'ACCEPTATION

- Impossible de booter la prod sur le mot de passe admin par défaut.
- Webhook Authkey : appel non prouvé **rejeté** (testé), appel légitime **accepté** (testé).
- Aucun secret en clair dans le code ou les logs ; `REQUIRED_ENV` toujours fail-fast.
- Socle existant (Stripe/helmet/CORS/JWT/bcrypt) **non régressé**.

## ANTI-OBJECTIFS

- Pas de réécriture du modèle d'auth (hors durcissement ciblé).
- Pas d'exposition d'une route web de reset admin.
- Pas d'affaiblissement de signature/CSP/CORS.
- Pas de webhook qui rejette les accusés légitimes.

---

### Mini-prompts prêts à tirer

**C1** — « Lance C1. Lis `fixAdminHash` dans `scripts/fix-schema.js`, explique quand le défaut admin s'applique, puis propose le correctif : refus de boot en prod si `ADMIN_PASSWORD` absent/par défaut, + test. »

**C2** — « Lance C2. Vérifie ce que Authkey permet (token/HMAC/IP) pour son webhook entrant `/webhook/authkey-whatsapp`, propose le durcissement minimal aligné sur le webhook Meta voisin, avec test (appel non prouvé rejeté, légitime accepté). »
