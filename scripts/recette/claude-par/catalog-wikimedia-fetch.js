'use strict';
// CLAUDE-PAR-20261113 : recherche d'images Wikimedia Commons CC0 d'objets generiques + telechargement (apercu 800px) en artefact.
// Licence lue dans extmetadata de l'API Commons ; seules les images CC0 sont retenues.
const fs = require('fs');
const UA = 'CatalogueRecetteBot/1.0 (staging recette; mailto:noreply@example.org)';
const TERMS = ['wooden cutting board', 'coffee mug', 'teapot', 'cooking pot', 'wicker basket', 'water bottle', 'glass jar', 'kitchen towel'];
const api = async (params) => {
  const u = 'https://commons.wikimedia.org/w/api.php?' + new URLSearchParams({ format: 'json', ...params });
  const r = await fetch(u, { headers: { 'user-agent': UA } });
  if (!r.ok) throw new Error('API ' + r.status);
  return r.json();
};
(async () => {
  fs.mkdirSync('out', { recursive: true });
  const found = [];
  for (const t of TERMS) {
    let d;
    try {
      d = await api({ action: 'query', generator: 'search', gsrsearch: `${t} filetype:bitmap`, gsrnamespace: '6', gsrlimit: '20', prop: 'imageinfo', iiprop: 'url|extmetadata|size|mime', iiurlwidth: '800' });
    } catch (e) { console.error('SKIP', t, e.message); continue; }
    for (const p of Object.values(d.query?.pages || {})) {
      const ii = p.imageinfo?.[0]; const lic = ii?.extmetadata?.LicenseShortName?.value;
      if (lic !== 'CC0' || /MET |Museo|museum/i.test(p.title) || !/jpeg/.test(ii.mime)) continue;
      found.push({ term: t, title: p.title, license: lic, original_url: ii.url, thumb_url: ii.thumburl, w: ii.width, h: ii.height, page: ii.descriptionurl, artist: ii.extmetadata?.Artist?.value?.replace(/<[^>]+>/g, '') });
    }
  }
  const uniq = [...new Map(found.map(f => [f.title, f])).values()].slice(0, 14);
  for (const [i, f] of uniq.entries()) {
    const r = await fetch(f.thumb_url, { headers: { 'user-agent': UA } });
    f.http = r.status; f.file = `img${i + 1}.jpg`;
    if (r.ok) fs.writeFileSync(`out/${f.file}`, Buffer.from(await r.arrayBuffer()));
  }
  fs.writeFileSync('out/index.json', JSON.stringify(uniq, null, 1));
  console.log('WIKI_COUNT', uniq.length, uniq.filter(f => f.http === 200).length);
})().catch(e => { console.error('REFUS', e.message); process.exit(1); });
