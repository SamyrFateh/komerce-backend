# Prompt opérationnel — Sonnet : lot L0-D « Provider notifications unique » (Komerce)

> Copier-coller à Sonnet (Claude Code / agent repo).
> Objectif : lever l'ambiguïté sur le provider de notifications réellement actif, retirer le legacy mort, et ajouter une **sonde de santé de livraison**. Critique : **l'OTP et le panier partagé dépendent de ce canal** — une panne silencieuse = des paniers jamais payés.

---

## RÔLE

Tu es ingénieur backend senior sur Komerce. Tu fais le ménage dans les providers de notifications **sans casser** la livraison ni la traçabilité. Conservateur : tu confirmes dans le code avant de supprimer quoi que ce soit.

## CONTEXTE À LIRE D'ABORD

- `docs/CARTOGRAPHY_360.md` §8bis (notifications, `notification_log`, `sms_log`) et §9 (dette doc : « vérifier le code avant d'affirmer un provider actif »).
- `services/notification-service.js`, `services/authkey-client.js`, `services/whatsapp-meta.js`, `routes/meta-whatsapp.js`, `routes/otp.js`, `services/otp-test-mode.js`, `utils/email.js`.

## CONSTATS DÉJÀ VÉRIFIÉS PAR L'ARCHITECTE (point de départ factuel)

1. **Le provider WhatsApp/OTP réellement câblé = Authkey.** `notification-service.js` require `./authkey-client` et log `authkey_rejected`. `authkey-client.js` appelle `https://authkey.io/restapi/requestjson.php` avec `AUTHKEY_API_KEY`, une allowlist `AUTHKEY_ALLOWED_PHONES`, et un gating `NODE_ENV==='production'`.
2. **Meta WhatsApp coexiste** (`whatsapp-meta.js` : `META_WA_TOKEN`, `graph.facebook.com`, `routes/meta-whatsapp.js` avec webhook signé). ⇒ **Deux chemins WhatsApp** en parallèle — statuer : Meta est-il une cible de migration, un fallback, ou du mort ?
3. **Twilio et Africa's Talking = legacy probablement mort.** Présents dans `.env.example` (`TWILIO_*`, `AT_*`) mais **non câblés** dans `notification-service.js`. À confirmer puis retirer.
4. **Divergence doc/code** : `CARTOGRAPHY_360.md` §8bis affirme que `sms_log` est « consommée par `utils/sms.js` », mais **`utils/sms.js` n'existe pas**. À corriger dans la doc.
5. Email via `utils/email.js` (nodemailer) — canal distinct, à inventorier aussi.

## GARDE-FOUS ABSOLUS

1. **Ne jamais bloquer la route principale sur une erreur de notification.** Invariant produit (panier partagé) : les notifications sont **post-commit, best-effort**. Toute refactorisation préserve ce comportement.
2. **Conserver la traçabilité** : chaque envoi reste tracé dans `notification_log`/`sms_log`.
3. **Ne pas supprimer de tables.** Le legacy se retire au niveau code/env, pas DB.
4. **Confirmer avant de couper** : un provider n'est « mort » que si **aucun chemin de code runtime** ne l'appelle. Prouve-le avant de retirer.
5. **OTP intouchable en surface** : le durcissement ne doit pas casser `routes/otp.js` ni `otp-test-mode.js`.

## MISSION — sous-lots, dans l'ordre

### D1 — Cartographie des canaux (lecture seule, je valide)
- Pour chaque **canal** (WhatsApp, SMS, email), trace le **provider réellement appelé en runtime** : point d'entrée → service → client → variable d'env. Distingue prod (`NODE_ENV==='production'`) et test (`otp-test-mode.js`).
- Statue sur **Meta vs Authkey** (parallèle ? fallback ? migration ? mort ?) — preuve à l'appui.
- Liste les providers **non câblés** (Twilio, Africa's Talking, autres).
- Rends une **matrice canal → provider actif → provider mort**. **Stop avant tout retrait.**

### D2 — Nettoyage du legacy mort (après validation D1)
- Retire des `.env.example` / docs les providers confirmés morts (sans toucher aux tables).
- Corrige la divergence `utils/sms.js` dans `CARTOGRAPHY_360.md` §8bis (refléter le vrai consommateur de `sms_log`).
- Si Meta est décidé « mort » ou « migration future non active », marque-le clairement (commentaire + doc), ne le laisse pas ambigu.

### D3 — Sonde de santé de livraison
- Ajoute une **sonde** (endpoint `/api/health/notifications` ou check interne) qui vérifie que le provider actif est joignable/configuré (clé présente, ping léger si l'API le permet) et expose un statut.
- Optionnel : alerte si le **taux de rejet** (`authkey_rejected` etc.) dépasse un seuil sur une fenêtre — branche sur `notification_log`/`sms_log`.

## MÉTHODE

1. **Cartographie/preuve d'abord**, retrait ensuite. Attends mon OK sur la matrice D1.
2. **Un canal à la fois** si besoin (WhatsApp d'abord — c'est l'OTP + le panier partagé).
3. **Test** : la sonde renvoie « ok » avec config valide, « ko » si la clé du provider actif manque ; un envoi best-effort qui échoue **ne casse jamais** la route appelante.
4. **Doc-sync** : matrice canal→provider dans `CARTOGRAPHY_360.md`, correction §8bis, mention claire du statut de Meta.

## CRITÈRES D'ACCEPTATION

- Une **matrice canal → provider actif** documentée et prouvée par le code.
- Legacy mort retiré des env/docs (zéro suppression DB) ; divergence `utils/sms.js` corrigée.
- Sonde de santé en place (config valide → ok ; clé manquante → ko), testée.
- Comportement best-effort post-commit **préservé** ; `notification_log`/`sms_log` toujours alimentés.

## ANTI-OBJECTIFS

- Pas de suppression de tables `*_log`.
- Pas de retrait d'un provider sans preuve qu'aucun chemin runtime ne l'appelle.
- Pas de notification qui devient bloquante pour la route principale.
- Pas de refonte du système OTP.

---

### Mini-prompts prêts à tirer

**D1** — « Lance D1. Pour chaque canal (WhatsApp/SMS/email), trace le provider réellement appelé en runtime (point d'entrée → service → client → env), statue Meta vs Authkey avec preuve, et liste les providers morts. Rends la matrice canal→provider. Stop avant tout retrait. »

**D3** — « Lance D3. Ajoute une sonde de santé du provider de notifications actif (clé présente/joignable → statut), avec test : ok si config valide, ko si clé manquante, et un envoi best-effort qui échoue ne casse pas la route appelante. »
