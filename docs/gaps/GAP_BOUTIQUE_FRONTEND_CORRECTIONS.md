# GAP — Boutique : vérité affichée, exposition publique, poids et identité

> **Destinataire** : agent d'exécution (Sonnet / Codex)
> **Auteur** : architecte (Opus) — aucune ligne de code de production
> **Base** : `origin/main` après #1701 ; production `komerce-backend-production.up.railway.app/boutique.html` observée le 2026-09-23 (navigation publique, lecture seule)
> **Règle** : la boutique n'affiche que ce que le serveur sait. Une promesse, un compteur ou une disponibilité écrite en dur dans le HTML ou le CSS est une donnée inventée.

---

## État d'exécution

| GAP | Sujet | Priorité | Statut | PR |
|-----|-------|----------|--------|-----|
| **GAP-F1** | Retirer les promesses écrites en dur | **Haute** (confiance, doctrine) | ✅ Fait | — |
| **GAP-F2** | Fermer l'exposition publique des fichiers internes | **Haute** (exposition) | ✅ Fait — périmètre élargi en cours de route | — |
| **GAP-F3** | Écran « catalogue vide » qui oriente | Haute | ⏳ À faire | — |
| **GAP-F4** | Budget de poids et cache | Moyenne | 🔶 3/4 étapes faites (2 : risque identifié, reportée) | — |
| **GAP-F5** | Hero : raconter relais + cash + WhatsApp | Moyenne | 🎨 Maquette proposée | — |

F1, F2 et F3 sont indépendants et petits. F4 demande une mesure avant/après. F5 attend la validation de la maquette par le propriétaire.

---

## GAP-F1 — Retirer les promesses écrites en dur

### Problème
La page d'accueil affirme des faits que le serveur ne porte pas.

### Preuve
- `public/boutique/index.html:187` : `<span>450+ produits</span>` écrit en dur ; le catalogue de production affichait **0** produit le 2026-09-23.
- `public/boutique/css/hero.css:783` et `css/dist/base.css:2671` : `content: '● Livraison express disponible'` — promesse injectée par CSS, affichée à tous, en permanence.
- `docs/doctrine/DOCTRINE_TRANSPORT_RAILS.md` : `AIR_EXPRESS` est `INTERNAL`, pricing `PENDING`, exposition `DISABLED` ; invariants 3 (« pas d'exposition sans valorisation ») et 7 (« le frontend ne décide jamais du rail »).

### Contrat cible
Le compteur de produits et toute mention de mode de livraison viennent du serveur (contexte marché ou API catalogue). Absents ou `UNKNOWN` → rien n'est affiché.

### Delta minimal
1. Supprimer la règle CSS `content: '● Livraison express disponible'` (les deux fichiers : source et `dist`).
2. Remplacer `450+ produits` par une valeur hydratée côté serveur (compte des produits visibles du marché) ; masquer l'élément si le compte est absent ou nul.
3. Ne réintroduire un badge express qu'une fois `AIR_EXPRESS` `ACTIVE` pour le marché, via l'API, jamais via CSS.

### Livré (2026-09-23)
- CSS : la règle `.k-hero-media::after { content: '● Livraison express disponible' }` supprimée de `css/hero.css` ; `dist/` régénéré (`npm run bundle:css`) — seul `base.css` en portait la trace, `components.css`/`discovery-desktop-v2.css` avaient une dérive `dist` préexistante et sans rapport, volontairement non touchée pour rester scopé.
- HTML : `<span>450+ produits</span>` remplacé par `<span id="k-hero-count" hidden>` + son séparateur, tous deux masqués par défaut.
- JS : `updateHeroProductCount()` dans `js/b-catalog.js`, appelée juste après que `loadProducts()` rende `state.products` autoritaire (aucun nouvel appel réseau — la liste complète était déjà chargée à chaque visite). Absent/zéro/`NaN` → masqué ; valeur réelle → « N produit(s) », jamais arrondi ni « + ».
- Test : `tests/unit/hero-product-count.test.js`, 5 cas (zéro, absent, valeur réelle, singulier, élément DOM absent).

### Critères d'acceptation
- [x] Aucun texte de promesse commerciale dans `content:` CSS.
- [x] Catalogue vide → aucun compteur affiché (vérifié en conditions réelles, navigateur, catalogue à 0 produit : seul « Paiement cash · Retrait relais » reste visible).
- [x] `dist` régénéré et cohérent avec la source.

---

## GAP-F2 — Fermer l'exposition publique des fichiers internes

### Problème
Des documents de travail sont servis publiquement en production.

### Preuve (HTTP 200 en production, 2026-09-23)
`/boutique/AUDIT_2026-07_CORRECTIONS.md`, `/boutique/HANDOFF_MODALE_PROPRIETE_UNIQUE.md`, `/boutique/README.md`, `/boutique/audit-raw.json`, `/boutique/audit-err.txt`.

**Périmètre réel, découvert en creusant, plus large que ce que cette ligne supposait au départ** : `express.static` (`server.js`) sert `public/` en entier, sans aucune exclusion. Confirmé en production, HTTP 200 sur chacun de ces chemins avant correctif :
- `public/boutique/tests/` (246 fichiers, y compris le code source des tests) et `public/boutique/docs/` (64 fichiers) ;
- `public/dashboards/tests/` et `public/dashboards/docs/` — même exposition, autre domaine ;
- `public/docs/`, `public/tests/`, et des `.md` à la racine de `public/` (ex. `CHANGELOG-lot1.md`) ;
- `public/boutique/package.json`, `package-lock.json`, `.cache-buster-state.json`, `.stylelintrc.json`, `governance/*.json` (contrats internes), `scripts/*` (tooling de build) — tous accessibles.

### Delta réellement livré (2026-09-23)
Correction au niveau serveur plutôt que déplacement physique des fichiers : la protection réelle (rien n'est atteignable) ne dépend pas de l'emplacement des fichiers sur disque, et déplacer ~310 fichiers pour un gain de sécurité nul (une fois le serveur corrigé) aurait cassé des chemins relatifs (tooling, `jest.config.js`) pour rien — non conforme au principe « delta minimal » de ce GAP.

- Nouveau `middleware/internal-static-guard.js` : fonction pure `isInternalStaticPath(reqPath)` + middleware `internalStaticGuard`, monté dans `server.js` **avant** `express.static`. Bloque (404, GET et HEAD) :
  - toute extension `.md` / `.txt` ;
  - tout segment de chemin `tests`, `docs`, `scripts`, `governance`, `coverage`, `test-results` ;
  - tout dotfile (segment commençant par `.`) ;
  - `package.json` / `package-lock.json` par nom exact ;
  - `audit-*.json`.
  - Exception explicite : `manifest.json` (PWA) reste servi.
- `server.js` simplifié pour consommer ce module plutôt que porter la logique en ligne.

⚠️ `public/boutique/check-sourcing.js` est un fichier non suivi appartenant à une autre session : ne pas le déplacer ni le supprimer — non concerné par ce correctif (extension `.js`, hors des règles ci-dessus).

### Tests requis — livrés
`tests/unit/internal-static-guard.test.js` : 30 cas — 19 chemins internes réels (issus de la preuve ci-dessus) confirmés bloqués, 7 chemins applicatifs légitimes confirmés servis, `manifest.json` explicitement épargné, et deux tests HTTP réels (supertest) confirmant qu'un document interne renvoie 404 sans jamais exposer son contenu, sur GET et sur HEAD (trouvé en écrivant le test : le guard initial ne couvrait que GET, HEAD contournait le filtre et remontait un 200 — corrigé avant de committer).

### Critères d'acceptation
- [x] Aucun document interne accessible sous `/boutique/`, `/dashboards/`, ni à la racine de `public/` (vérifié en conditions réelles, serveur local, 17 chemins testés).
- [x] Boutique et service worker inchangés côté client — vérifié que `sw.js` ne précache aucun des chemins désormais bloqués.
- [x] `manifest.json` reste servi (PWA non cassée).

---

## GAP-F3 — Écran « catalogue vide » qui oriente

### Problème
Catalogue vide → page blanche sous la barre de catégories, sans message (mobile et ordinateur).

### Contrat cible
Un écran vide dit ce qui se passe et propose une action : le catalogue du marché arrive ; être prévenu sur WhatsApp (avec consentement explicite, cf. `DOCTRINE_CONSENTEMENT_COMMUNICATION.md`) ; suivre une commande existante. Même traitement pour une catégorie vide et une recherche sans résultat, avec des textes distincts.

### Delta minimal
Composant d'état vide unique, trois variantes (catalogue, catégorie, recherche). L'inscription « être prévenu » reste désactivée tant que le consentement n'est pas implémenté ; à défaut, lien vers la conversation WhatsApp existante.

### Tests requis
Unitaire boutique sur les trois variantes ; capture mobile 390 px.

---

## GAP-F4 — Budget de poids et cache

### Constat (production, 2026-09-23, ordres de grandeur)
Accueil mobile ≈ 3,4 Mo et 142 requêtes, dont ≈ 1,4 Mo de JavaScript et ≈ 735 Ko de CSS. `css/dist/components.css` = 531 Ko non compressé. Compression gzip active. `cache-control: public, max-age=0` sur CSS et JS : chaque visite revalide chaque fichier.

### Contrat cible
Premier chargement mobile < 1 Mo transféré ; fichiers versionnés servis avec un cache long et immuable ; HTML toujours revalidé.

### État des 4 étapes (mis à jour au fil de l'exécution)

**1. Cache long sur les fichiers versionnés — ✅ Fait (PR #1710).** `max-age=31536000, immutable` sur tout fichier requêté avec `?v=`, `no-cache` inchangé sur le HTML. Détour d'investigation qui a révélé un vrai bug distinct : `/boutique.html` ne correspond à aucun fichier réel sur disque — c'est le catch-all SPA (`bootstrap/html-routes.js`) qui répond, et il contournait le helper `sendHtml()` déjà utilisé par toutes les autres routes HTML. Corrigé dans le même commit.

**2. Découper `components.css` par écran — ⏸️ Non fait, risque réel identifié.** Sur les 439 Ko du bundle, environ 341 Ko (78 %) ne servent qu'à des interactions différées (modale produit, panier, checkout, wallet, listes partagées) — un découpage aurait un vrai intérêt. Mais en vérifiant le contenu réel plutôt que les seuls noms de fichiers, `interactions.css` (30 Ko) s'est révélé mélanger du contenu critique (navigation du bas, points du carrousel photo sur chaque carte produit — visibles dès le premier écran) et du contenu différable (panier, modale de paiement). Un découpage par nom de fichier seul risquerait de faire disparaître des éléments visibles au premier affichage. Un découpage sûr demande un audit sélecteur par sélecteur des 33 fichiers du bundle, pas seulement une réorganisation des inclusions — hors périmètre de cette passe, à reprendre en tâche dédiée si le gain (~60-80 Ko gzippés estimés) justifie l'effort.

**3. Charger au défilement les images hors du premier écran — ✅ Déjà fait, aucune action requise.** Vérifié fichier par fichier : `loading="lazy"` est déjà appliqué sur la quasi-totalité des images significatives — cartes produit (`render-product-card.js`), articles du panier (`b-cart.js`, deux occurrences), images de modale (`b-modal-discovery-detail.js`), puces catégories (`render-categories.js`), rail de découverte (`render-discovery-rail.js`), widget de suivi de commande (`b-tracking.js`). Le hero utilise correctement `fetchpriority="high"` + `preload`, sans lazy — le bon traitement pour l'élément LCP. Les icônes de catégorie (`category-shelf-visuals.js`) utilisent `loading="eager"` intentionnellement (visibles immédiatement). Seule exception mineure trouvée : une icône de quelques Ko dans le mini-panier flottant (`b-mini-cart.js:248`) sans attribut — gain négligeable, non traité.

**4. Différer les scripts non nécessaires au premier affichage — ✅ Fait.** `market-context.js`, `market-hydration.js` et `komerce-api.js` (déjà positionnés dans les 3 derniers % du document, aucune dépendance `document.currentScript`, aucun script inline entre eux) passés en `defer`, aux côtés de `hero-bootstrap.js` déjà différé — ordre d'exécution relatif préservé. Testé en conditions réelles (mobile + desktop) : 0 erreur JS, contexte marché correctement hydraté (`KM`), compteur hero correct, 401 attendus uniquement. Un test verrouillait la balise exacte sans `defer` au nom d'un contrat CSP (`runtime-csp-contract.test.js`) — corrigé pour vérifier la propriété réellement protégée (script externe, same-origin, jamais inline), qui n'a rien à voir avec la présence de `defer`.

### Tests requis
Script de mesure reproductible tenté puis écarté comme non probant : `content-length` reste identique pour une réponse servie depuis le cache navigateur, ne permet donc pas de distinguer cache-hit et network-fetch. La preuve retenue pour l'étape 1 est celle des en-têtes HTTP eux-mêmes (vérifiables par `curl`, objectifs). Pas de mesure de poids total tant que l'étape 2 n'est pas faite : les étapes 1, 3 et 4 n'allègent pas le premier chargement (cache = bénéfice sur les visites suivantes ; lazy-load déjà en place ; defer = non-bloquant mais ne change pas le poids transféré), donc le budget < 1 Mo reste hors d'atteinte tant que l'étape 2 n'est pas traitée.

---

## GAP-F5 — Hero : raconter relais + cash + WhatsApp

### Problème
Le hero actuel (« Vos envies, à portée de main », illustrations génériques) pourrait être celui de n'importe quelle boutique ; il ne dit ni comment on paie, ni où on retire, ni à qui parler.

### Contrat cible
Le premier écran explique en une ligne le modèle Komerce (commander, payer en cash ou Mobile Money, retirer au relais), montre le relais réel du client quand il est connu, et remplace les illustrations par de vraies photos (relais, agents, colis). Toute donnée affichée (relais, horaires, délais, modes de paiement) vient du serveur, par marché.

### Référence
Maquette proposée dans un canevas Design (lien dans la PR de ce GAP). À valider avant tout développement.
