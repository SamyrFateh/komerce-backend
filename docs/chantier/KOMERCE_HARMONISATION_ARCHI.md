# KOMERCE — HARMONISATION ARCHITECTURALE (revue senior)
**Date** : 2026-06-01 · **Base** : dépôt complet `Komerce.zip` (376 .js, 193 .md) — pris comme **vérité courante**
**Objet** : non plus corriger des bugs, mais **mettre tout le monde au même diapason**. On vérifie que
les fondations tiennent, que les canoniques disent vrai, et on liste les **dérives de langage** restantes
— les endroits où deux parties du code expriment le *même concept* de deux façons.

> Note de méthode : tout ci-dessous est **vérifié sur le dépôt fourni** (grep/diff/lecture), pas hérité des audits.
> Quand un audit antérieur disait autre chose, la réalité du dépôt l'emporte.

---

## 1. État de santé — ce qui est déjà solide ✅

Le travail des sessions précédentes a tenu. Vérifié dans ce dépôt :

| Fondation | État | Preuve |
|---|---|---|
| **Un seul middleware d'auth** | ✅ | `require middleware/auth` dans **72** fichiers ; `auth-middleware.js` supprimé |
| **Zéro `jwt.verify` inline** hors `middleware/` | ✅ | 0 occurrence dans `routes/` et `services/` |
| **Révocation `revoked_tokens`** sur les 3 chemins | ✅ | `auth.js`, `auth-guest.js`, `require-verified-identity.js` = 1 chacun (S1/S2 faits) |
| **Rôles `founder`/`super_admin` purgés** | ⚠️ quasi | 1 résiduel fonctionnel → §3 H1 |
| **Zombies Bloc 0 supprimés** | ✅ | `dashboard.js`, `client-account.js`, `sms.js`, `parcelSync-v2.js`, `event-create.js`, mock, `ct-*`×30, `syncParcelToOrders` : tous absents |
| **Cookie canonique unique** posé backend | ✅ | `kmrc_jwt` (22 réfs) ; `kmrc_client` retiré de `otp.js` (commentaire de consolidation présent) |
| **Format de réponse d'erreur** | ✅ dominant | `{error}` = 532 occ. vs `{message}` = 15 (résiduel) |
| **`auth-guard.js` réécrit** | ✅ | appelle `/api/auth/me`, **plus aucune** clé localStorage (S15 fait) |
| **Contrat scan `event_type`** | ✅ | `ct-api.js:114-115` envoie `{event_type}` (CT3 fait) |
| **`db/schema.sql` présent** | ✅ | 263 Ko, réel (plus fantôme) |
| **Instruction racine agents** | ✅ | `AGENTS.md` pointe vers `STATUS.md` + 4 docs socle |

**Verdict** : les fondations sont saines. Il ne reste **aucune faille structurelle ouverte** sur l'auth backend.
Le travail restant est de la **cohérence**, pas du colmatage.

---

## 2. Les 5 dérives de langage (le vrai sujet « parler pareil »)

> Une dérive = deux endroits expriment le même concept différemment. Aucune n'est un bug bloquant ;
> ensemble elles font que « le système ne parle pas d'une seule voix ». C'est ce qu'on harmonise.

### D-1 — 🟡 « Es-tu connecté ? » se dit en deux langues
Deux drapeaux UI distincts pour **le même concept** :
- Boutique : `localStorage.komerce_session = '1'` (`komerce-api.js`)
- Control Tower : `localStorage.kmrc_logged_in = '1'` (`ct-app-v7.js`)

Aucun n'est un secret (valeur `'1'`, simple hint UI) — donc **pas un risque de sécurité**. Mais c'est deux
vocabulaires pour « l'utilisateur semble connecté ». Pire : `komerce-api.js:163` fait encore
`isConnected() { return !!_state.user || !!localStorage.getItem('komerce_session'); }` — le hint sert
de **demi-guard**, alors que la vérité d'authentification est le cookie `kmrc_jwt` (httpOnly, invisible au JS).

**Harmonisation** : un seul nom de hint (`kmrc_logged_in`) partout, et `isConnected()` documenté comme
**hint UI uniquement** — la seule vérité de session est `/api/auth/me`. Retirer le fallback localStorage du `||`.

### D-2 — 🟡 Le client API a 33 dialectes
`komerce-api.js` est le client canonique (`credentials:'include'`), mais **33 `fetch()` bruts** subsistent,
concentrés : 14 dans `admin-legacy/js`, 11 dans `boutique/js`, 5 dans `admin/js`. Chacun redécide s'il envoie
le cookie, comment il parse l'erreur, comment il gère un 401. C'est la porte ouverte aux régressions type
« fetch sans `credentials` » (déjà vu en L3).

**Harmonisation** : un client par zone (boutique → `K.request` ; CT → `CT.api` ; admin → `api-client.js`),
et règle d'ingénierie « aucun `fetch()` brut hors du client de zone ». Migration progressive, pas en bloc.

### D-3 — 🟡 Deux dashboards admin servis **en parallèle** (migration en cours)
*Corrigé après forensique `html-routes.js` :* ce n'est **pas** un zombie, mais une **bascule inachevée**, deux portes servies :
- `dashboards/admin/index.html` (moderne, SPA, 12 JS) — servi sur `/admin/pilotage`, `/admin/control-tower`, `/admin/costing`… **(cible)**
- `admin-legacy/control-tower.html` (37 JS) — servi sur l'URL héritée `/control-tower.html` **(encore vivant)**

Le nom « legacy » est donc honnête sur l'intention, mais trompeur tant que `/control-tower.html` répond encore.
Le risque réel n'est pas un mort à supprimer, c'est **deux UI admin actives** : un fix appliqué à l'une et pas
à l'autre crée une divergence (ex. le `founder` résiduel vivait dans `admin-legacy`, pas dans `admin/`).

**Harmonisation** : terminer la bascule — rediriger `/control-tower.html` → `/admin/control-tower`, puis renommer
`admin-legacy`→`admin-v1` (mort daté) et le retirer. **Ne pas supprimer `admin-legacy/` avant la redirection.**

### D-4 — 🟡 Trois cartos, deux divergentes
`docs/CARTOGRAPHY_360.md` (376 l.) et `docs/chantier/CARTOGRAPHY_360.md` (15 l.) **diffèrent** : deux fichiers
même nom, contenus différents = deux vérités. (+ `CARTOGRAPHY_360_BOUTIQUE.md`, lui légitime car périmètre distinct.)

**Harmonisation** : une seule carto 360 canonique (la version 376 l. dans `docs/`), la stub de 15 l. supprimée
ou transformée en simple lien. `AGENTS.md` doit pointer la canonique.

### D-5 — 🟢 `schema_railway.sql` encore cité dans 4 docs alors qu'il n'existe pas
`db/schema.sql` est désormais le schéma réel, mais 4 docs (`SCHEMA.md`, `PROMPTS_KIT*`, le consolidé)
référencent encore `schema_railway.sql` (absent). Vestige documentaire — les docs mentent sur un fichier mort.

**Harmonisation** : remplacer toute mention `schema_railway.sql` → `db/schema.sql`.

---

## 3. Reliquats ponctuels (corrections sèches) — ☑ FAITES 2026-06-01

| ID | Fichier | Constat vérifié | Action | État |
|---|---|---|---|---|
| H1 | `admin-legacy/js/ct-views-pricing.js:102` | `return role === 'admin' || role === 'founder'` — **dernier `founder` fonctionnel** | → `role === 'admin'` | ☑ |
| H2 | `komerce-api.js:163` | `isConnected()` gardait le fallback `localStorage.komerce_session` | Fallback retiré + commentaire « hint UI » | ☑ |
| H3 | `routes/` (15 occ.) | Réponses `{message:}` au lieu de `{error:}` | Normaliser au fil des PR | ☐ continu |

> ☑ Vérifié : **zéro `founder` dans tout le code JS**, `node --check` OK sur les 2 fichiers édités.

---

## 4. La doctrine d'harmonie — à inscrire dans `AGENTS.md`

> `AGENTS.md` existe déjà et désigne un socle de 4 documents : c'est le bon réceptacle. On y ajoute le
> **langage commun**, pour que toute PR future parle d'une seule voix.

**Vocabulaire canonique (une chose = un mot)**
| Concept | Mot canonique | Bannir |
|---|---|---|
| Session (vérité) | cookie `kmrc_jwt` (httpOnly) | tout token en localStorage |
| Hint « connecté » (UI) | `kmrc_logged_in` | `komerce_session` |
| Client API boutique | `K.request` / `komerce-api.js` | `fetch()` brut |
| Client API CT | `CT.api` | `fetch()` brut |
| Schéma DB | `db/schema.sql` | `schema_railway.sql` |
| Rôles (enum DB) | `client, admin, agent_relais, agent_hub` | `founder, super_admin` |
| Erreur HTTP | `res.status(n).json({ error })` | `{message}`, `{err}` |
| Événement scan colis | `{ event_type }` | `{ step }` |

**Règles permanentes (déjà esquissées, à figer)**
1. Un fichier servi par chemin ; aucune copie non chargée ne reste dans `public/`.
2. Aucun nom de dossier ne ment : un dossier « legacy » est mort ou daté, pas le vivant.
3. Le dépôt ne référence que des fichiers présents.
4. Un rôle n'existe que dans l'enum DB ; pas de fallback de rôle vers un privilège.
5. Une seule carto 360 canonique ; les autres sont des liens ou des périmètres distincts nommés comme tels.
6. Aucun `fetch()` brut hors du client API de la zone.

---

## 5. Plan d'harmonisation — ordre conseillé

**Immédiat (sèche, sans risque)** — ☑ FAIT 2026-06-01
- ☑ H1 (`ct-views-pricing.js` → `admin` seul), ☑ H2 (`isConnected` = hint UI), ☑ D-5 (`SCHEMA.md` : `schema_railway`→`db/schema`), ☑ D-4 (stub carto corrigée — n'affirme plus que legacy est mort).
- Reste documentaire mineur : refs `schema_railway.sql` dans `docs/_archive/PROMPTS_KIT.md` et `docs/chantier/PROMPTS_KIT_POST_CRITIQUE.md` — laissées (prompts historiques, non canoniques).

**Court terme (décision + petit travail)**
- D-1 : unifier le hint sur `kmrc_logged_in`, documenter `isConnected` comme hint UI.
- D-3 : **trancher `admin/` vs `admin-legacy/`** (décision produit — comme `founder` l'était). Tant que non tranché, ajouter un en-tête dans chaque `index.html` disant lequel est servi.

**Continu (règle d'ingénierie)**
- D-2 : interdire les `fetch()` bruts (lint), migrer les 33 vers le client de zone au fil des PR touchant ces fichiers.
- H3 : normaliser `{message}`→`{error}` à chaque passage sur un fichier concerné.

**Verrou final** : inscrire le §4 (vocabulaire + règles) dans `AGENTS.md`. C'est lui qui maintient l'harmonie
dans le temps — sans ça, les dérives reviennent à la PR suivante.

---

## 6. Décision en attente (humaine)

| ID | Sujet | Options |
|---|---|---|
| DEC-2 | Bascule `admin-legacy/` → `admin/` (les **deux** sont servis) | **A)** finir maintenant : rediriger `/control-tower.html` → `/admin/control-tower`, puis renommer/retirer `admin-legacy` · **B)** garder les deux portes encore N semaines (planifier la bascule). *Ce n'est pas « supprimer » : legacy répond encore sur `/control-tower.html`.* |

> Même logique que la décision `founder` (D1) : personne d'autre que vous ne peut dire quelle est la cible produit.
> Une fois tranché, l'exécution est mécanique.

---

*Revue d'harmonisation · Komerce Backend ⨯ Frontend · base dépôt réel · 2026-06-01*
