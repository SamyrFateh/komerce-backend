/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * GAP-F4 étape 2 — le découpage de components.css est purement additif :
 * critical-home.css (mesuré par couverture CSS réelle du navigateur) charge
 * de façon bloquante un sous-ensemble minimal, components.css charge en
 * preload non bloquant et bascule vers "stylesheet" une fois téléchargé.
 * Un onload= inline aurait été bloqué par la CSP du site
 * (scriptSrcAttr: 'none', bootstrap/security.js) — d'où un script externe.
 * Cf. docs/gaps/GAP_BOUTIQUE_FRONTEND_CORRECTIONS.md.
 */
'use strict';

const fs = require('fs');
const path = require('path');

describe('preload-css-swap.js — bascule le <link> preload en stylesheet', () => {
  function loadScript() {
    const src = fs.readFileSync(
      path.join(__dirname, '../../js/preload-css-swap.js'),
      'utf8'
    );
    // eslint-disable-next-line no-eval
    eval(src);
  }

  beforeEach(() => {
    document.body.innerHTML = '';
    document.querySelectorAll('link#k-components-preload').forEach((el) => el.remove());
  });

  test('sans le lien #k-components-preload dans le DOM, ne jette jamais', () => {
    expect(() => loadScript()).not.toThrow();
  });

  test("écoute l'événement load et bascule rel vers 'stylesheet'", () => {
    const link = document.createElement('link');
    link.id = 'k-components-preload';
    link.rel = 'preload';
    document.head.appendChild(link);

    loadScript();
    expect(link.rel).toBe('preload');
    link.dispatchEvent(new Event('load'));
    expect(link.rel).toBe('stylesheet');
  });

  test("fail-open : une erreur de chargement bascule aussi vers 'stylesheet' plutôt que de bloquer le style pour toujours", () => {
    const link = document.createElement('link');
    link.id = 'k-components-preload';
    link.rel = 'preload';
    document.head.appendChild(link);

    loadScript();
    link.dispatchEvent(new Event('error'));
    expect(link.rel).toBe('stylesheet');
  });

  test('un lien déjà chargé (link.sheet présent) au moment du script bascule immédiatement', () => {
    const link = document.createElement('link');
    link.id = 'k-components-preload';
    link.rel = 'preload';
    Object.defineProperty(link, 'sheet', { value: {}, configurable: true });
    document.head.appendChild(link);

    loadScript();
    expect(link.rel).toBe('stylesheet');
  });
});

describe('index.html — structure du chargement CSS critique', () => {
  const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');

  test('critical-home.css est chargé en stylesheet bloquant, avant components.css', () => {
    const criticalIdx = html.indexOf('critical-home.css');
    const componentsIdx = html.indexOf('k-components-preload');
    expect(criticalIdx).toBeGreaterThan(-1);
    expect(componentsIdx).toBeGreaterThan(-1);
    expect(criticalIdx).toBeLessThan(componentsIdx);
    expect(html).toMatch(/<link\s+rel="stylesheet"\s+href="[^"]*critical-home\.css[^"]*">/);
  });

  test("components.css est en rel=\"preload\" as=\"style\", jamais bloquant directement", () => {
    expect(html).toMatch(
      /<link\s+id="k-components-preload"\s+rel="preload"\s+href="[^"]*components\.css[^"]*"\s+as="style">/
    );
  });

  test('aucun onload= inline sur le lien preload — la CSP du site interdit scriptSrcAttr', () => {
    const linkTag = html.match(/<link[^>]*k-components-preload[^>]*>/)[0];
    expect(linkTag).not.toMatch(/onload=/);
    expect(linkTag).not.toMatch(/onerror=/);
  });

  test('un <noscript> sert components.css normalement si JS est désactivé', () => {
    expect(html).toMatch(/<noscript><link rel="stylesheet" href="[^"]*components\.css[^"]*"><\/noscript>/);
  });

  test('le script de bascule est chargé en tant que script externe same-origin, jamais inline', () => {
    expect(html).toMatch(/<script src="\/boutique\/js\/preload-css-swap\.js"><\/script>/);
  });

  test('desktop.css reste après components.css dans le DOM — ordre de cascade préservé malgré le chargement asynchrone', () => {
    const componentsIdx = html.indexOf('k-components-preload');
    const desktopIdx = html.lastIndexOf('desktop.css');
    expect(desktopIdx).toBeGreaterThan(componentsIdx);
  });
});

describe('css/critical-home.css — intégrité structurelle', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../css/critical-home.css'), 'utf8');

  test('accolades équilibrées — un déséquilibre casserait tout le CSS qui suit dans la cascade', () => {
    const open = (css.match(/{/g) || []).length;
    const close = (css.match(/}/g) || []).length;
    expect(open).toBe(close);
  });

  test('ne dépasse pas une taille raisonnable — un fichier "critique" qui grossit sans contrôle perd son intérêt', () => {
    // Repère si une régénération future explose accidentellement en taille
    // (ex. mesure de couverture faite sur une page qui ouvre une modale).
    expect(css.length).toBeLessThan(150 * 1024);
  });

  test("porte sa provenance en en-tête — jamais un fichier généré sans traçabilité", () => {
    expect(css).toMatch(/@provenance/);
    expect(css).toMatch(/@regenerate/);
  });

  test("l'état catalogue vide est critique dès le premier rendu", () => {
    expect(css).toContain('.k-grid > .k-catalog-empty');
    expect(css).toContain('.k-track-error {');
    expect(css).toContain('.k-track-error-title {');
    expect(css).toContain('.k-track-error-sub {');
    expect(css).toContain('.k-track-retry-btn {');
  });
});
