# GAP — Réconciliation n° 2 : performance, résilience, responsive résiduel (Boutique)

> **Destinataire : agent d'exécution (Sonnet).** Document autosuffisant. Chaque
> GAP donne : preuve mesurée, cause (fichier + ligne), correctif **exact et déjà
> validé dans un vrai navigateur** (injection CSS, fichiers générés et mesurés,
> ou patch appliqué temporairement puis testé contre une API simulée en panne),
> tests à écrire, critère d'acceptation vérifiable. **N'invente rien, ne
> redemande rien :** applique dans l'ordre, prouve chaque critère, passe au suivant.

- Base auditée : `main` @ `1e52d67` (après #1783). PR #1784 (hero desktop v3) **ouverte** au moment de la rédaction.
- Suite du document `docs/gaps/GAP_BOUTIQUE_NAV_RESPONSIVE_RECONCILIATION.md`
  (réconciliation n° 1). **Ses règles § 0 s'appliquent intégralement ici**
  (une PR par lot, ne jamais committer `public/boutique/check-sourcing.js`,
  ownership CSS, gates, liste des 9 suites en échec préexistantes, merge
  uniquement CI verte + critères prouvés dans la description de PR).
  Environnement local : **Annexe A** de ce même document (40 produits KM).

---

## 0. Vérification de la réconciliation n° 1 (état réel, mesuré)

| GAP n° 1 | Production | Remarque |
|---|---|---|
| G-01 CSS bloqué en preload | ✅ 20/20 en cache chaud | — |
| G-02 bump vertical | ✅ supprimé, 0 erreur JS | — |
| G-03/04 retour Android, rechargement | ✅ 4/4 onglets, rechargement Favoris conservé | — |
| G-06 paysage | ✅ section 94 → 228 px | — |
| G-07 cibles « + » et flèches | ✅ 40 px | — |
| G-05 en-tête 900–1199 px | ✅ | — |
| **G-05 en-tête 1200–1260 px** | ❌ **déborde encore (+43 px à 1200)** | → **P-01** ci-dessous |

**Point de processus important (ne rien « réparer » à tort).** La PR #1783 a
modifié les sources CSS **sans régénérer `css/dist/*`**. La production n'en
souffre pas : Railway recompile au déploiement (`railway.json` →
`buildCommand: node public/boutique/scripts/deploy-css.js`). Mais le `dist`
committé est **en retard** sur les sources : il ne contient pas G-05/G-06/G-07.
Conséquence directe pour toi : au premier `npm run bundle:css` de ce lot, le
diff de `css/dist/base.css` et `css/dist/components.css` contiendra **aussi**
les règles G-05/G-06/G-07 de #1783. **C'est attendu : commit-les.** La règle
§ 0.3 du document n° 1 (« annuler une dérive dont tu n'as pas touché les
sources ») **ne s'applique pas** à ces règles-là. Vérifie leur présence :
`grep -c "orientation: landscape) and (max-height: 500px" public/boutique/css/dist/base.css` ≥ 1 et
`grep -c "k-card-add-trigger::after" public/boutique/css/dist/components.css` ≥ 1.

---

## Tableau de synthèse

| ID | Sévérité | Sujet | Gain mesuré | Lot |
|---|---|---|---|---|
| P-01 | 🟠 P1 | En-tête 1200–1260 px déborde | docW = viewport de 1200 à 1920 | PR-A |
| P-02 | 🟡 P2 | Boutons « Ajouter » des suggestions (fiche) 30 px | zone 40×40, visuel inchangé | PR-A |
| P-03 | 🟠 P1 | 4 PNG surdimensionnés (avatar, paniers) | **972 Ko → 41 Ko** (≈ 570 Ko de moins en 1ʳᵉ visite) | PR-A |
| P-04 | 🟠 P1 | Préchargement du hero : mauvaise image sur mobile | **LCP mobile 4,75 s → 2,93 s (−38 %)**, −79 Ko | PR-A |
| P-05 | 🔴 P0 | Échec du chargement du catalogue = page blanche | état explicite + « Réessayer » + relance auto | PR-B |
| P-06 | ⚪ P3 | Stripe (248 Ko) chargé sur toutes les pages | — | **hors lot** |
| P-07 | ⚪ P3 | 97 modules JS séparés (75 < 5 Ko) | — | **hors lot** |

Référence performance (production, 1ʳᵉ visite mobile, réseau « 3G rapide » :
latence 150 ms, 1,6 Mb/s) : **2 088 Ko, 138 requêtes, FCP 1,36 s, LCP 5,04 s,
load 11,6 s.** Images = 1 363 Ko, scripts = 643 Ko (97 fichiers), CSS = 177 Ko.

---

## P-01 — 🟠 En-tête desktop : débordement résiduel 1200–1260 px

**Preuve.** Production : `document.scrollWidth` 1200 → **1243**, 1240 → 1259,
1260 → 1268 (barre horizontale). Conforme ≤ 1199 (G-05) et ≥ 1280.

**Cause.** `public/boutique/css/layout.css` : `.k-header-actions { flex: 1 1 auto; min-width: 0; }`
(bloc « Header actions bar » ≈ l. 1103) et `#k-search { flex: 0 1 430px }` rétrécissent
**proportionnellement** : le bloc d'actions descend sous la largeur de ses
boutons (520 px pour 624 nécessaires à 1200) et ses boutons débordent. Même à
1280 les boutons dépassent déjà de leur conteneur (57 px), invisible car absorbé
par le padding de l'en-tête. La borne 1279 initialement prévue est interdite :
`scripts/check-breakpoints.js` n'autorise que **900 et 1200**.

**Correctif exact — `public/boutique/css/layout.css`**, à ajouter **à la fin du fichier** :
```css
/* P-01 — ≥ 1200 px : le bloc d'actions garde la largeur de ses boutons ;
   c'est la recherche (flex: 0 1 430px) qui absorbe l'écart. Supprime le
   débordement résiduel 1200–1260 px sans breakpoint supplémentaire. */
@media (min-width: 1200px) {
  .k-header-actions { flex: 0 0 auto; }
}
```
Validé par injection : docW = viewport à **1200, 1220, 1240, 1260, 1280, 1366,
1440, 1920** ; recherche 258 px à 1200, 338 à 1280, 430 (pleine) dès 1440 ;
débordement interne du bloc d'actions 104 → 2 px ; boutons texte inchangés.

**Tests à écrire.** Dans `tests/unit/header-compact-desktop.test.js` (créé par
#1783) ajouter :
```js
  test('P-01 : ≥ 1200 px, le bloc d\'actions ne se comprime pas sous ses boutons', () => {
    expect(css).toMatch(/@media \(min-width: 1200px\) \{\s*\.k-header-actions \{ flex: 0 0 auto; \}/);
  });
```
(adapter le nom de la variable du fichier CSS lu à celui déjà utilisé dans ce test).

**Critère d'acceptation.** Script **Annexe P1** : aucune ligne `❌` de 900 à 1920.

---

## P-02 — 🟡 Boutons « Ajouter » des suggestions (fiche produit mobile) : 30 px

**Preuve.** Fiche produit 390×844 : 7 boutons `#k-modal .k-sug-add` 30×30, zone
effective 30 px (non couverts par G-07).

**Cause / propriétaire.** `public/boutique/css/modal-mobile-suggestion-actions.css`,
bloc `@media (max-width: 899px)`, règle `#k-modal .k-sug-add { width: 30px; height: 30px; … border: 1px solid … }`.

**Correctif exact.** Dans ce même bloc `@media (max-width: 899px)`, juste après
la règle `#k-modal .k-sug-add { … }` :
```css
  /* P-02 — zone tactile 40×40, visuel 30×30 inchangé.
     inset -6px (et non -5px) : le bouton a une bordure de 1 px ;
     -5px ne donnait que 38 px effectifs (mesuré). */
  #k-modal .k-sug-add { position: relative; }
  #k-modal .k-sug-add::after { content: ''; position: absolute; inset: -6px; }
```
Validé par injection : pseudo-élément 40×40 ; `elementFromPoint` à 4 px hors du
bord visible = le bouton sur **les 4 côtés** ; aucun ancêtre ne rogne
(`overflow: visible` jusqu'à `.k-sug-grid`).

**Attention.** `tests/unit/modal-mobile-suggestion-actions.test.js` fait partie
des 9 suites **déjà en échec** sur `main` : ne pas chercher à la réparer ; vérifier
seulement que la liste des suites en échec reste strictement identique.

**Critère d'acceptation.** Script **Annexe P2** : `after 40px x 40px` et
`G4:OK D4:OK H4:OK B4:OK`.

---

## P-03 — 🟠 Images PNG surdimensionnées (≈ 570 Ko de moins en 1ʳᵉ visite)

**Preuve.**

| Fichier | Réel | Affiché au max | Poids | WebP cible | Poids cible |
|---|---|---|---|---|---|
| `images/avatar_seule.png` | 512×942 | 29×52 (desktop) | **401 Ko** | 128×236 | 10,3 Ko |
| `images/avatar_panier.png` | 512×942 | 29×52 | **378 Ko** | 128×236 | 12,3 Ko |
| `images/panier_tresse_vert.png` | 256×256 | 24 | 131 Ko | 128×128 | 10,1 Ko |
| `images/panier_tresse.png` | 239×220 | 20–24 | 62 Ko | 128×118 | 8,1 Ko |

Total **972 Ko → 40,8 Ko**, transparence conservée, contrôle visuel fait.

**Étape 1 — générer (depuis la racine du dépôt, déterministe) :**
```bash
python3 - << 'EOF'
from PIL import Image
jobs = [('avatar_seule', (128, 236)), ('avatar_panier', (128, 236)),
        ('panier_tresse_vert', (128, 128)), ('panier_tresse', (128, 118))]
for name, size in jobs:
    im = Image.open(f'public/images/{name}.png').convert('RGBA')
    im.resize(size, Image.LANCZOS).save(f'public/images/{name}.webp', 'WEBP', quality=88, method=6)
    print(name, size)
EOF
ls -la public/images/avatar_seule.webp public/images/avatar_panier.webp public/images/panier_tresse_vert.webp public/images/panier_tresse.webp
```
Attendu : 4 fichiers de 8 à 13 Ko chacun.

**Étape 2 — remplacer les 7 références (et seulement celles-ci)** :
| Fichier | Ligne ≈ | Remplacer | Par |
|---|---|---|---|
| `public/boutique/index.html` | 157 | `/images/avatar_seule.png` | `/images/avatar_seule.webp` |
| `public/boutique/index.html` | 287 | `/images/panier_tresse_vert.png` | `/images/panier_tresse_vert.webp` |
| `public/boutique/index.html` | 371 | `/images/panier_tresse.png` | `/images/panier_tresse.webp` |
| `public/boutique/index.html` | 574 | `/images/panier_tresse.png` | `/images/panier_tresse.webp` |
| `public/boutique/js/b-cart-core.js` | 79 | `'/images/avatar_panier.png' : '/images/avatar_seule.png'` | `'/images/avatar_panier.webp' : '/images/avatar_seule.webp'` |
| `public/boutique/js/b-mini-cart.js` | 248 | `/images/panier_tresse.png` | `/images/panier_tresse.webp` |
| `public/boutique/js/b-modal-cart.js` | 65 | `'/images/panier_tresse.png'` | `'/images/panier_tresse.webp'` |

Mettre à jour aussi le commentaire `b-cart-core.js` l. 74 (`avatar_seule.png` →
`.webp`, `avatar_panier.png` → `.webp`).

**Ne pas supprimer les PNG.** Ils sont déclarés dans
`features/infrastructure.feature.js` (l. ≈ 280–303) et restent la source haute
définition. **Déclarer les 4 WebP** dans ce même manifeste, chacun juste sous son
PNG (même format de chaîne `'public/images/<nom>.webp',`).

**Étape 3 — tests existants à adapter** :
- `public/boutique/tests/unit/b-cart-core.test.js` l. ≈ 164 et 177 :
  `'/images/avatar_seule.png'` → `'/images/avatar_seule.webp'`,
  `'/images/avatar_panier.png'` → `'/images/avatar_panier.webp'`.
- `public/boutique/tests/unit/b-modal-cart.test.js` l. ≈ 193 :
  `'/images/panier_tresse.png'` → `'/images/panier_tresse.webp'`.
- Les tests qui vérifient `not.toContain('panier_tresse_vert.png')` restent vrais : ne pas y toucher.

**Test à écrire.** `public/boutique/tests/unit/boutique-image-weight.test.js` :
```js
'use strict';
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..', '..', '..');
const html = fs.readFileSync(path.join(root, 'boutique', 'index.html'), 'utf8');
describe('P-03 — images légères du chrome boutique', () => {
  const files = ['avatar_seule', 'avatar_panier', 'panier_tresse_vert', 'panier_tresse'];
  test.each(files)('%s.webp existe, est un WebP complet et pèse < 20 Ko', (name) => {
    const buf = fs.readFileSync(path.join(root, 'images', `${name}.webp`));
    expect(buf.subarray(0, 4).toString('ascii')).toBe('RIFF');
    expect(buf.subarray(8, 12).toString('ascii')).toBe('WEBP');
    expect(buf.length).toBe(buf.readUInt32LE(4) + 8);
    expect(buf.length).toBeLessThan(20 * 1024);
  });
  test("index.html ne référence plus aucun de ces PNG", () => {
    files.forEach((name) => expect(html).not.toContain(`/images/${name}.png`));
  });
});
```

**Critère d'acceptation.** `grep -rn "avatar_seule.png\|avatar_panier.png\|panier_tresse_vert.png\|panier_tresse.png" public/boutique/index.html public/boutique/js`
→ **aucun résultat** (hors commentaires éventuellement signalés ci-dessus).
Script **Annexe P3** : aucune requête vers un de ces 4 PNG ; mesure **Annexe P5**
en baisse d'au moins 500 Ko sur `Image`.

---

## P-04 — 🟠 Préchargement du hero : le mobile précharge l'image desktop

**Preuve (local, 3 chargements à froid « 3G rapide », médiane).** Élément LCP
mobile = `.k-hero-figures` (`komerce-hero-handoff-v3-mobile.webp`, en
`background-image` CSS, donc découvert **après** le CSS). Pendant ce temps
`index.html` l. 28 précharge **en priorité haute** l'image **desktop**
`komerce_hero_catalog_canonical_v4.webp` (79 Ko), inutile sur mobile.
- Avant : **LCP 4 748 ms**, v4 + v3-mobile téléchargées.
- Après (préchargements ciblés par écran) : **LCP 2 932 ms (−38 %)**, seule v3-mobile téléchargée.

**Correctif exact — `public/boutique/index.html`, bloc « Preload hero image » (≈ l. 26–28).**
- **Si #1784 est mergée** (sa ligne devient
  `<link rel="preload" as="image" href="/images/komerce-hero-handoff-v3.webp" type="image/webp" media="(min-width: 900px)" fetchpriority="high">`) :
  **ajouter juste en dessous** :
  ```html
  <link rel="preload" as="image" href="/images/komerce-hero-handoff-v3-mobile.webp" type="image/webp" media="(max-width: 899px)" fetchpriority="high">
  ```
- **Si #1784 n'est pas mergée** : remplacer la ligne existante par :
  ```html
  <link rel="preload" as="image" href="/images/komerce_hero_catalog_canonical_v4.webp" type="image/webp" media="(min-width: 900px)" fetchpriority="high">
  <link rel="preload" as="image" href="/images/komerce-hero-handoff-v3-mobile.webp" type="image/webp" media="(max-width: 899px)" fetchpriority="high">
  ```
  (#1784 devra alors seulement changer le `href` de la première ligne.)
- Dans les deux cas, **l'URL préchargée desktop doit être exactement celle du
  `background-image` de `.k-hero-figures` dans `@media (min-width: 900px)` de
  `css/hero.css`**, et l'URL mobile exactement celle de
  `css/hero-ultra-mobile.css` (`komerce-hero-handoff-v3-mobile.webp`). Sinon le
  navigateur télécharge deux fois.
- Ne pas toucher `og:image` (l. 17) : c'est l'aperçu de partage, pas le rendu.

**Test à écrire.** Dans `tests/unit/hero-ultra-mobile.test.js` :
```js
  test('P-04 : l\'image mobile de la scène est préchargée, uniquement sous 900 px', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    expect(html).toMatch(/<link rel="preload" as="image" href="\/images\/komerce-hero-handoff-v3-mobile\.webp" type="image\/webp" media="\(max-width: 899px\)" fetchpriority="high">/);
    // aucun préchargement d'image sans media (ce serait téléchargé sur tous les écrans)
    const imgPreloads = html.match(/<link rel="preload" as="image"[^>]*>/g) || [];
    imgPreloads.forEach((tag) => expect(tag).toMatch(/media="/));
  });
```
(`fs`/`path` sont déjà importés dans ce fichier de test ; sinon les ajouter.)

**Critère d'acceptation.** Script **Annexe P4** en local : images hero demandées
sur mobile = **uniquement** `komerce-hero-handoff-v3-mobile.webp` ; LCP médiane
≤ 3 100 ms (référence avant : ~4 750 ms dans les mêmes conditions).

---

## P-05 — 🔴 Échec du chargement du catalogue = page blanche (première visite)

**Preuve.** API `/api/products` indisponible (reproduit : limiteur 429 local,
et simulé 503 / 500 / coupure réseau) sur une première visite (pas de cache
`localStorage`) : un toast éphémère « Pas de connexion » puis **grille vide, sans
aucun état ni action**. Message faux pour un 429/500.

**Cause.** `public/boutique/js/b-catalog.js`, `loadProducts()` (≈ l. 208–225) :
branche `catch` sans cache → `showToast('Pas de connexion', 'error'); return;`.
L'API (`js/komerce-api.js` ≈ l. 158–181) réessaie déjà seule les 429/502/503 et
expose `err.status` ; une coupure réseau remonte un `TypeError`.

**Correctif exact — `public/boutique/js/b-catalog.js` (patch validé, à appliquer tel quel).**
```diff
@@ async function loadProducts() {
     if (cached) {
       products = setProducts(JSON.parse(cached).filter(p => p.is_available !== false));
     } else {
-      showToast('Pas de connexion', 'error');
+      _showCatalogLoadError(e);
       return;
     }
   }
@@ juste AVANT la ligne `function renderCatalogEmptyState() {`
+// G-L2 — Échec du chargement du catalogue sans cache (première visite) :
+// état explicite + « Réessayer » au lieu d'un toast éphémère et d'une grille
+// vide. Message juste selon la cause : réseau coupé vs serveur indisponible.
+function renderCatalogLoadErrorState(err) {
+  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false)
+    || (err && err.name === 'TypeError');
+  const busy = !!err && (err.status === 429 || err.status === 503);
+  return _renderEmptyState({
+    icon: offline ? '📶' : '⏳',
+    title: offline ? 'Pas de connexion internet' : 'Le catalogue ne répond pas pour le moment',
+    sub: offline
+      ? 'Vérifiez votre réseau, puis réessayez.'
+      : (busy ? 'Beaucoup de visites en ce moment. Réessayez dans quelques instants.'
+              : 'Réessayez dans quelques instants.'),
+    actionLabel: 'Réessayer',
+    actionId: 'k-catalog-retry-btn',
+  });
+}
+
+function _showCatalogLoadError(err) {
+  if (!dom.grid) return;
+  // Même mise en page que les états vides de renderGrid() : sur mobile,
+  // l'écran se place sous le bloc fixe (header + hero + rail), pager arrêté.
+  dom.grid.classList.remove('k-grid-has-sections', 'k-grid-cat-pager');
+  destroyMobilePager();
+  dom.grid.innerHTML = renderCatalogLoadErrorState(err);
+  if (!isDesktop() && !isVerticalShell() && dom.pageScroll) {
+    dom.pageScroll.classList.add('k-pager-active');
+    _recalcPagerVars();
+  }
+  const retry = () => {
+    window.removeEventListener('online', retry);
+    const btn = document.getElementById('k-catalog-retry-btn');
+    if (btn) { btn.disabled = true; btn.textContent = 'Chargement…'; }
+    loadProducts();
+  };
+  document.getElementById('k-catalog-retry-btn')?.addEventListener('click', retry, { once: true });
+  window.addEventListener('online', retry, { once: true });
+}
+
@@ export {
-  renderCatalogEmptyState, renderCategoryEmptyState, renderSearchEmptyState,
+  renderCatalogEmptyState, renderCategoryEmptyState, renderSearchEmptyState, renderCatalogLoadErrorState,
 };
```
Tous les symboles utilisés sont **déjà importés** dans `b-catalog.js`
(`dom`, `destroyMobilePager`, `_recalcPagerVars`, `isDesktop`, `isVerticalShell`).
`showToast` reste utilisé ailleurs dans le fichier (≈ l. 254) : **ne pas retirer
son import.**

**Piège déjà rencontré et corrigé dans ce patch.** Une première version
injectait l'état dans `#k-grid` sans les 5 lignes de mise en page : sur mobile,
le titre et le texte se retrouvaient **sous le bloc fixe** (seul le bouton
dépassait). Les lignes `classList.remove` / `destroyMobilePager()` /
`k-pager-active` + `_recalcPagerVars()` reprennent exactement le chemin des
états vides de `renderGrid()` et sont **obligatoires**.

**Validation faite (patch appliqué temporairement, API interceptée) :**
| Cas | Message affiché | Après « Réessayer » |
|---|---|---|
| 503 | « Le catalogue ne répond pas pour le moment » + « Beaucoup de visites… » | catalogue chargé |
| 500 | « Le catalogue ne répond pas pour le moment » + « Réessayez dans quelques instants. » | catalogue chargé |
| coupure réseau | « Pas de connexion internet » + « Vérifiez votre réseau… » | catalogue chargé |
| coupure puis événement `online` | idem, relance **automatique** | catalogue chargé |
| desktop 1440, 503 | titre visible (non masqué) | catalogue chargé |
0 erreur JS dans tous les cas.

**Tests à écrire.** Dans `public/boutique/tests/unit/catalog-empty-states.test.js`
(fichier existant des états vides, même montage d'import que ses tests actuels) :
```js
describe('P-05 — renderCatalogLoadErrorState', () => {
  test('coupure réseau (TypeError) → message hors ligne + Réessayer', () => {
    const html = renderCatalogLoadErrorState(Object.assign(new TypeError('Failed to fetch')));
    expect(html).toContain('Pas de connexion internet');
    expect(html).toContain('id="k-catalog-retry-btn"');
    expect(html).toContain('Réessayer');
  });
  test('429 / 503 → catalogue indisponible + forte affluence', () => {
    for (const status of [429, 503]) {
      const html = renderCatalogLoadErrorState(Object.assign(new Error('x'), { status }));
      expect(html).toContain('Le catalogue ne répond pas pour le moment');
      expect(html).toContain('Beaucoup de visites');
    }
  });
  test('500 → catalogue indisponible, sans mention d\'affluence ni de réseau', () => {
    const html = renderCatalogLoadErrorState(Object.assign(new Error('x'), { status: 500 }));
    expect(html).toContain('Le catalogue ne répond pas pour le moment');
    expect(html).not.toContain('Beaucoup de visites');
    expect(html).not.toContain('Pas de connexion');
  });
  test('le bouton Réessayer est un <button>, pas un lien', () => {
    const html = renderCatalogLoadErrorState(new Error('x'));
    expect(html).toMatch(/<button class="k-track-retry-btn" id="k-catalog-retry-btn" type="button">Réessayer<\/button>/);
  });
});
```
(importer `renderCatalogLoadErrorState` depuis `../../js/b-catalog.js` comme les
trois autres `render*EmptyState` déjà testés dans ce fichier.)

**Critère d'acceptation.** Script **Annexe P5-ERR** : les 5 lignes du tableau
ci-dessus reproduites à l'identique, `erreurs JS []`.

---

## P-06 / P-07 — ⚪ Hors lot (documentés, aucune action)

- **P-06 Stripe** : `https://js.stripe.com/v3/` (248 Ko) est chargé en `defer`
  sur toutes les pages (`index.html` ≈ l. 52), pas seulement au paiement. Le
  différer au checkout toucherait la détection de fraude Stripe : **décision
  produit requise, ne rien modifier.**
- **P-07 Modules JS** : 97 fichiers (643 Ko, dont 75 < 5 Ko) chargés en cascade
  d'imports ES ; sur réseau à forte latence c'est le 2ᵉ poste. Un regroupement
  (bundler) est un chantier d'outillage : **ne rien modifier dans ce lot.**

---

## Plan d'exécution (ordre imposé)

| Lot | Contenu | Branche | Dépend de |
|---|---|---|---|
| PR-A | P-01 + P-02 + P-03 + P-04 | `fix/boutique-perf-header-images-preload` | lire l'état de #1784 pour P-04 (§ P-04) |
| PR-B | P-05 | `fix/boutique-catalog-load-error-state` | aucun (peut partir en parallèle de PR-A) |

Pour PR-A : après les modifs CSS, `cd public/boutique && npm run bundle:css`,
puis appliquer le § 0 ci-dessus (les règles G-05/06/07 de #1783 entrent
légitimement dans `dist`). Coller dans la description de PR : sorties des
Annexes P1, P2, P3, P4 et le tableau avant/après de l'Annexe P5 (`Ko par type`).

**Limiteur de requêtes local.** Enchaîner les scripts peut déclencher un 429
local (`middleware/rate-limit.js` : 500 requêtes / 15 min). Symptôme : grille
vide, `api [429]`. Remède : redémarrer le serveur local (compteur en mémoire),
**sans** modifier le limiteur.

---

## Annexes (enregistrer dans `/tmp/`, lancer depuis la racine avec
`NODE_PATH=$(pwd)/public/boutique/node_modules node /tmp/<script>.js`)

### Annexe P1 — balayage en-tête (`hdr-sweep.js`)
```js
const { chromium } = require('@playwright/test');
const URL = process.argv[2] || 'http://localhost:3000/boutique.html';
(async () => { const b = await chromium.launch(); const out = [];
  for (const w of [900, 1024, 1100, 1199, 1200, 1220, 1240, 1260, 1279, 1280, 1366, 1440, 1920]) {
    const p = await (await b.newContext({ viewport: { width: w, height: 800 }, ignoreHTTPSErrors: true })).newPage();
    await p.goto(URL, { waitUntil: 'networkidle' }); await p.waitForTimeout(500);
    const d = await p.evaluate(() => document.documentElement.scrollWidth);
    out.push(`${w}: docW=${d} ${d > w ? '❌ +' + (d - w) : '✅'}`); await p.close(); }
  console.log(out.join('\n')); await b.close(); })();
```
Sortie **avant** sur `main` @1e52d67 **en local** : ❌ de 900 à 1260 — de 900 à 1199 uniquement parce que le `dist` committé est en retard (§ 0) ; après `npm run bundle:css` + P-01 : ✅ partout. En production avant correctif : ✅ jusqu'à 1199, ❌ 1200–1260.

### Annexe P2 — zone tactile suggestions (`sug-add.js`)
```js
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch();
  const p = await (await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 })).newPage();
  await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(1200);
  const card = await p.$('#k-grid .k-card'); const bb = await card.boundingBox(); await p.touchscreen.tap(bb.x + bb.width / 2, bb.y + 60); await p.waitForTimeout(1500);
  await p.evaluate(() => document.querySelector('#k-modal .k-sug-add').scrollIntoView({ block: 'center' })); await p.waitForTimeout(400);
  console.log(JSON.stringify(await p.evaluate(() => { const e = document.querySelector('#k-modal .k-sug-add'); const a = getComputedStyle(e, '::after'); const r = e.getBoundingClientRect();
    const hits = []; for (const [n, x, y] of [['G4', r.left - 4, r.top + 15], ['D4', r.right + 4, r.top + 15], ['H4', r.left + 15, r.top - 4], ['B4', r.left + 15, r.bottom + 4]]) { const t = document.elementFromPoint(x, y); hits.push(n + ':' + (t === e || e.contains(t) ? 'OK' : '--')); }
    return { visuel: Math.round(r.width) + 'x' + Math.round(r.height), after: a.width + ' x ' + a.height, hits: hits.join(' ') }; })));
  await b.close(); })();
```
Sortie **avant** : `{"visuel":"30x30","after":"auto x auto","hits":"G4:-- D4:-- H4:-- B4:--"}`.
Attendu : `visuel 30x30`, `after 40px x 40px`, `G4:OK D4:OK H4:OK B4:OK`.

### Annexe P3 — requêtes d'images (`img-requests.js`)
```js
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch();
  for (const [w, h, mob] of [[390, 844, 1], [1440, 900, 0]]) {
    const p = await (await b.newContext({ viewport: { width: w, height: h }, isMobile: !!mob, hasTouch: !!mob })).newPage(); const got = [];
    p.on('request', r => { if (/\/images\/(avatar_|panier_tresse|komerce[-_]hero)/.test(r.url())) got.push(r.url().split('/images/')[1]); });
    await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'networkidle' }); await p.waitForTimeout(800);
    const add = await p.$('#k-grid .k-card-add-trigger'); if (add) { mob ? await add.tap() : await add.click(); await p.waitForTimeout(1200); }
    console.log(w + 'px', JSON.stringify([...new Set(got)])); await p.close(); }
  await b.close(); })();
```
Sortie **avant** : `390px ["komerce_hero_catalog_canonical_v4.webp","avatar_seule.png","panier_tresse_vert.png","panier_tresse.png","komerce-hero-handoff-v3-mobile.webp","avatar_panier.png"]`.
Attendu : aucun `.png` parmi `avatar_*` / `panier_tresse*` ; à 390 px, aucune image hero desktop.

### Annexe P4 — LCP mobile (`lcp.js`)
```js
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch(); const res = []; let hero = [];
  for (let i = 0; i < 3; i++) {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }); const p = await ctx.newPage();
    const c = await ctx.newCDPSession(p); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
    await c.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8 });
    const imgs = []; c.on('Network.requestWillBeSent', e => { if (/\/images\/.*hero/.test(e.request.url)) imgs.push(e.request.url.split('/images/')[1]); });
    await p.addInitScript(() => { window.__lcp = 0; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true }); });
    await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'load', timeout: 120000 }); await p.waitForTimeout(2500);
    res.push(Math.round(await p.evaluate(() => window.__lcp))); if (i === 0) hero = imgs; await ctx.close(); }
  res.sort((a, b) => a - b); console.log('images hero:', hero.join(', '), '| LCP médiane', res[1], 'ms', JSON.stringify(res)); await b.close(); })();
```
Attendu après correctif : `images hero: komerce-hero-handoff-v3-mobile.webp` seule ; médiane ≤ 3 100 ms.

### Annexe P5 — poids de page (`weight.js`)
```js
const { chromium } = require('@playwright/test');
(async () => { const url = process.argv[2] || 'http://localhost:3000/boutique.html'; const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, ignoreHTTPSErrors: true }); const p = await ctx.newPage();
  const c = await ctx.newCDPSession(p); await c.send('Network.enable'); await c.send('Network.setCacheDisabled', { cacheDisabled: true });
  const meta = {}; c.on('Network.responseReceived', e => { meta[e.requestId] = e.type; }); const byType = {}; let total = 0, n = 0;
  c.on('Network.loadingFinished', e => { const t = meta[e.requestId] || '?'; byType[t] = (byType[t] || 0) + e.encodedDataLength / 1024; total += e.encodedDataLength / 1024; n++; });
  await p.goto(url, { waitUntil: 'load', timeout: 120000 }); await p.waitForTimeout(2500);
  console.log('total', Math.round(total), 'Ko |', n, 'requêtes | Ko par type', JSON.stringify(Object.fromEntries(Object.entries(byType).map(([k, v]) => [k, Math.round(v)])))); await b.close(); })();
```
Sortie **avant** en local (serveur de dev non compressé, d'où des valeurs supérieures à la production) : `total 3630 Ko | 134 requêtes | Image 1094 Ko`. Seule la comparaison avant/après **sur le même serveur** fait foi.
Lancer avant et après PR-A (même serveur local). Attendu : `Image` en baisse
d'au moins 500 Ko.

### Annexe P5-ERR — état d'erreur du catalogue (`load-error.js`)
```js
const { chromium } = require('@playwright/test');
(async () => { const b = await chromium.launch(); const errs = [];
  const run = async (label, vp, mob, mode, recover) => {
    const ctx = await b.newContext({ viewport: vp, isMobile: !!mob, hasTouch: !!mob, deviceScaleFactor: mob ? 2 : 1 }); const p = await ctx.newPage(); p.on('pageerror', e => errs.push(label + ': ' + e.message));
    let fail = true;
    await p.route(/\/api\/products(\?|$)/, r => { if (!fail) return r.continue(); if (mode === 'offline') return r.abort('internetdisconnected'); return r.fulfill({ status: mode, contentType: 'application/json', body: '{"error":"simulé"}' }); });
    await p.goto('http://localhost:3000/boutique.html', { waitUntil: 'domcontentloaded' }); await p.waitForSelector('#k-catalog-retry-btn', { timeout: 45000 }).catch(() => {});
    const r = await p.evaluate(() => { const el = document.querySelector('.k-catalog-empty'); if (!el) return { txt: 'AUCUN ÉTAT' }; const t = el.querySelector('.k-track-error-title'); const tr = t.getBoundingClientRect(); const top = document.elementFromPoint(tr.left + tr.width / 2, tr.top + tr.height / 2);
      return { txt: el.innerText.replace(/\s+/g, ' ').trim(), titreVisible: top === t || t.contains(top) }; });
    fail = false; if (recover === 'online') await p.evaluate(() => window.dispatchEvent(new Event('online'))); else { const btn = await p.$('#k-catalog-retry-btn'); if (btn) { mob ? await btn.tap() : await btn.click(); } }
    await p.waitForTimeout(3500); const cartes = await p.evaluate(() => document.querySelectorAll('#k-grid .k-card').length);
    console.log(label.padEnd(16), JSON.stringify(r), '| après relance, cartes :', cartes); await ctx.close(); };
  const M = { width: 390, height: 844 };
  await run('503', M, 1, 503, 'click'); await run('500', M, 1, 500, 'click'); await run('coupure', M, 1, 'offline', 'click');
  await run('coupure+online', M, 1, 'offline', 'online'); await run('desktop 503', { width: 1440, height: 900 }, 0, 503, 'click');
  console.log('erreurs JS', JSON.stringify(errs)); await b.close(); })();
```
Sortie **avant** (main) : les 5 cas donnent `{"txt":"AUCUN ÉTAT"} | après relance, cartes : 0`.
Attendu : messages du tableau § P-05, `titreVisible: true` partout, cartes > 0
après relance, `erreurs JS []`.
