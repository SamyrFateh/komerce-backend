'use strict';
/**
 * Génère des fixtures visuelles SVG locales, déterministes, pour le Golden
 * Product — utilisées par Playwright (GPM-6) via media-map.json, jamais en
 * production. Aucune dépendance réseau. Proportions produit standard 4:5
 * (800x1000), cohérentes avec une vignette/galerie modal mobile.
 */
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.join(__dirname, '..', 'public', 'images', 'fixtures', 'golden-elite-pro');

function shoeSvg({ label, bg, accent, sub }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 1000">
  <rect width="800" height="1000" fill="${bg}"/>
  <rect x="40" y="40" width="720" height="920" fill="none" stroke="${accent}" stroke-width="4" stroke-dasharray="12 10"/>
  <ellipse cx="400" cy="560" rx="260" ry="90" fill="${accent}"/>
  <rect x="150" y="470" width="420" height="120" rx="60" fill="${accent}"/>
  <path d="M180 470 Q400 380 560 470 L560 520 Q400 450 180 520 Z" fill="${bg}" stroke="${accent}" stroke-width="6"/>
  <text x="400" y="120" font-family="Arial, sans-serif" font-size="42" font-weight="bold" fill="${accent}" text-anchor="middle">GOLDEN ELITE PRO</text>
  <text x="400" y="720" font-family="Arial, sans-serif" font-size="56" font-weight="bold" fill="${accent}" text-anchor="middle">${label}</text>
  <text x="400" y="770" font-family="Arial, sans-serif" font-size="28" fill="${accent}" text-anchor="middle">${sub}</text>
  <text x="400" y="960" font-family="Arial, sans-serif" font-size="20" fill="${accent}" text-anchor="middle">FIXTURE DE TEST — NON COMMERCIAL</text>
</svg>`;
}

const FILES = [
  { name: 'neutral-main', label: 'NEUTRE', sub: 'Média produit (aucune couleur sélectionnée)', bg: '#f2f2f2', accent: '#555555' },
  { name: 'bleu-main', label: 'BLEU', sub: 'Vue principale', bg: '#e8f0fb', accent: '#1d4ed8' },
  { name: 'bleu-scene', label: 'BLEU', sub: 'Mise en situation', bg: '#dbe7fb', accent: '#1e40af' },
  { name: 'noir-main', label: 'NOIR', sub: 'Vue principale', bg: '#e9e9ec', accent: '#111827' },
  { name: 'noir-scene', label: 'NOIR', sub: 'Mise en situation', bg: '#dcdce0', accent: '#000000' },
];

fs.mkdirSync(OUT_DIR, { recursive: true });

const map = {};
for (const f of FILES) {
  const svg = shoeSvg(f);
  const filePath = path.join(OUT_DIR, `${f.name}.svg`);
  fs.writeFileSync(filePath, svg, 'utf8');
  map[`https://cdn.example.com/golden-elite-pro/${f.name}.jpg`] =
    `/images/fixtures/golden-elite-pro/${f.name}.svg`;
}

fs.writeFileSync(
  path.join(OUT_DIR, 'media-map.json'),
  JSON.stringify({
    _comment: 'Mapping test-only : URL cdn.example.com (contrat) -> asset SVG local '
      + '(rendu Playwright GPM-6). La production continue de servir les URLs du '
      + 'contrat telles quelles ; ce mapping n’est utilisé que par le harness de test.',
    map,
  }, null, 2),
  'utf8'
);

console.log(`Généré ${FILES.length} SVG + media-map.json dans ${OUT_DIR}`);
