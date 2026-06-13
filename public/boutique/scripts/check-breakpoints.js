'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT     = path.resolve(__dirname, '..');
const CSS_DIR  = path.join(ROOT, 'css');
const BASELINE = path.join(__dirname, '.breakpoints-baseline.json');
const ALLOWED  = new Set(['900', '1200']);

const args   = process.argv.slice(2);
const strict = args.includes('--strict');
const save   = args.includes('--save');

function cssFiles() {
  return fs.readdirSync(CSS_DIR)
    .filter(function(f) { return f.endsWith('.css'); })
    .map(function(f) { return path.join(CSS_DIR, f); });
}

function scan() {
  var perFile = {};
  var total = 0;
  var files = cssFiles();
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var raw = fs.readFileSync(f, 'utf8');
    var src = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    // Ne scanner QUE l'intérieur des @media (pas les propriétés min/max-width
    // sur des éléments normaux). On capture la condition média complète, puis
    // on en extrait type + valeur. Un max-width:(N-1) est le complément mobile
    // légitime d'un min-width:N canonique (mobile ≤899 / desktop ≥900).
    var mediaRe = /@media([^{]*?)\{/g;
    var mm;
    var found = [];
    function isAllowed(type, val) {
      if (ALLOWED.has(val)) return true;
      if (type === 'max' && ALLOWED.has(String(parseInt(val, 10) + 1))) return true;
      return false;
    }
    while ((mm = mediaRe.exec(src)) !== null) {
      var cond = mm[1];
      var bpRe = /(min|max)-width:\s*(\d{2,4})px/g;
      var b;
      while ((b = bpRe.exec(cond)) !== null) {
        var key = b[1] + ':' + b[2];
        if (!isAllowed(b[1], b[2]) && found.indexOf(key) === -1) found.push(key);
      }
    }
    var violations = found.sort();
    if (violations.length) {
      perFile[path.basename(f)] = violations;
      total += violations.length;
    }
  }
  return { perFile: perFile, total: total };
}

var result = scan();
var perFile = result.perFile;
var total = result.total;

if (save) {
  fs.writeFileSync(BASELINE, JSON.stringify({ total: total, perFile: perFile, savedAt: new Date().toISOString() }, null, 2));
  console.log('Baseline breakpoints figee a ' + total + ' violations.');
  process.exit(0);
}

console.log('\nBreakpoints garde-fou V1 - Autorises : 900px, 1200px\n');

if (total === 0) {
  console.log('OK - Aucune violation.\n');
  process.exit(0);
}

var fileNames = Object.keys(perFile);
for (var j = 0; j < fileNames.length; j++) {
  var fname = fileNames[j];
  var pad = fname;
  while (pad.length < 34) pad += ' ';
  console.log('   >> ' + pad + ' ' + perFile[fname].map(function(v) { return v + 'px'; }).join(', '));
}
console.log('\n   Total : ' + total + ' violations dans ' + fileNames.length + ' fichiers.');

if (strict) {
  var baseData = { total: Infinity, perFile: {} };
  if (fs.existsSync(BASELINE)) {
    baseData = JSON.parse(fs.readFileSync(BASELINE, 'utf8'));
  }
  var baseTotal = baseData.total !== undefined ? baseData.total : Infinity;
  var basePerFile = baseData.perFile || {};

  // Détecte les nouvelles violations par fichier (cliquet par fichier+valeur)
  var newViolations = [];
  var fileNamesNow = Object.keys(perFile);
  for (var fi = 0; fi < fileNamesNow.length; fi++) {
    var fname = fileNamesNow[fi];
    var current = perFile[fname];
    var baseline = basePerFile[fname] || [];
    for (var vi = 0; vi < current.length; vi++) {
      if (baseline.indexOf(current[vi]) === -1) {
        newViolations.push(fname + ' ' + current[vi] + 'px (absent de la baseline)');
      }
    }
  }

  if (newViolations.length > 0) {
    console.error('\nREGRESSION breakpoints — nouvelles violations hors baseline :');
    for (var ni = 0; ni < newViolations.length; ni++) {
      console.error('  >> ' + newViolations[ni]);
    }
    console.error('Commit bloqué. Corrigez ou figez avec npm run check:breakpoints:save\n');
    process.exit(1);
  }

  if (total < baseTotal) {
    console.log('\nProgrès : ' + total + ' < baseline ' + baseTotal + '. Figez avec npm run check:breakpoints:save\n');
  } else {
    console.log('\nStable vs baseline (' + baseTotal + '). Pas de régression.\n');
  }
}
process.exit(0);
