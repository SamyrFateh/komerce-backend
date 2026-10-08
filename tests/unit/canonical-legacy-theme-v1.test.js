'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Garde de dette CSS (B2b) : dans les six couches de thème, une déclaration ne doit
 * pas être entièrement surchargée par une règle de même sélecteur chargée plus tard
 * dans tous les shells. Les propriétés personnalisées (--*) sont traitées à part.
 */

const fs = require('fs');
const path = require('path');

const CSS_DIR = path.join(__dirname, '..', '..', 'public', 'dashboards', 'canonical', 'css');
const LAYERS = ['visual-freeze-v1', 'canonical-theme-v2', 'canonical-shell-v4', 'canonical-finish-polish-v1', 'canonical-legacy-theme-v1', 'cockpit-legacy-v1'];
const COMMON = 5; // les 5 premières couches sont chargées par les 4 shells ; cockpit-legacy seulement par index

function topLevelRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const rules = [];
  let depth = 0;
  let start = 0;
  let selector = '';
  let bodyStart = 0;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '{') {
      if (depth === 0) { selector = text.slice(start, i).trim(); bodyStart = i + 1; }
      depth += 1;
    } else if (ch === '}') {
      depth -= 1;
      if (depth === 0) {
        if (selector && !selector.startsWith('@')) rules.push({ key: selector.replace(/\s+/g, ' '), body: text.slice(bodyStart, i) });
        start = i + 1;
      }
    }
  }
  return rules;
}

function declarations(body) {
  return body.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const idx = part.indexOf(':');
    if (idx < 0) return null;
    const prop = part.slice(0, idx).trim().toLowerCase();
    const value = part.slice(idx + 1);
    return { prop, important: /!important\s*$/.test(value) };
  }).filter(Boolean);
}

function neverWinning() {
  const entries = [];
  LAYERS.forEach((layer, layerIndex) => {
    topLevelRules(fs.readFileSync(path.join(CSS_DIR, `${layer}.css`), 'utf8')).forEach((rule, ruleIndex) => {
      entries.push({ layer, layerIndex, ruleIndex, key: rule.key, decls: declarations(rule.body) });
    });
  });
  const dead = [];
  entries.forEach((entry, i) => {
    entry.decls.forEach(decl => {
      if (decl.prop.startsWith('--')) return;
      for (let j = i + 1; j < entries.length; j += 1) {
        const later = entries[j];
        if (later.key !== entry.key) continue;
        if (entry.layerIndex < COMMON && later.layerIndex >= COMMON) continue;
        if (later.decls.some(d => d.prop === decl.prop && (d.important || !decl.important))) {
          dead.push(`${entry.layer} | ${entry.key} | ${decl.prop} ← ${later.layer}`);
          break;
        }
      }
    });
  });
  return dead;
}

describe('couches de thème canoniques — aucune déclaration morte', () => {
  test('aucune déclaration jamais gagnante dans les six couches', () => {
    expect(neverWinning()).toEqual([]);
  });

  test('la couche Legacy porte l’apparence effective de la sidebar (blanche, 220px)', () => {
    const css = fs.readFileSync(path.join(CSS_DIR, 'canonical-legacy-theme-v1.css'), 'utf8');
    expect(css).toMatch(/body\.kmc-shell-v4 > \.kmc-admin-navigation\{[^}]*width:220px/);
    expect(css).toMatch(/body\.kmc-shell-v4 > \.kmc-admin-navigation\{[^}]*background:#fff/);
  });

  test('les groupes de navigation restent visibles sur la sidebar claire', () => {
    const css = fs.readFileSync(path.join(CSS_DIR, 'canonical-legacy-theme-v1.css'), 'utf8');
    expect(css).toMatch(/\.kmc-admin-sidebar-group-label\{[^}]*color:#94A3B8/);
    expect(css).toMatch(/\.kmc-admin-sidebar-group \+ \.kmc-admin-sidebar-group\{[^}]*border-top:1px solid #F1F5F9/);
  });
});
