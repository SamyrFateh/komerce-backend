'use strict';

/**
 * @komerce-arch
 * @role         governance-currency-truncation-check
 * @domain       governance
 * @layer        tooling
 * @criticality  high
 * @purpose      Cliquet anti-troncature monétaire. Détecte le code qui
 *               ARRONDIT À L'UNITÉ un montant affecté à un champ `*_kmf`
 *               (Math.round / Math.trunc / Math.floor / Math.ceil / parseInt).
 *
 *               Motivation : le chantier currency debt (LOT 1 à 7) a converti
 *               105 colonnes monétaires d'integer vers numeric. Mais convertir
 *               la colonne ne suffit pas — si le code la retronque à la
 *               lecture, le bénéfice est annulé silencieusement. Quatre
 *               séquelles de ce type ont été trouvées à la main au LOT 7,
 *               dont un Math.round sur les lignes d'une FACTURE CLIENT
 *               (services/invoice-service.js) et un parseInt dans l'export de
 *               rapprochement comptable Stripe (routes/finance.js) — ce
 *               dernier juste sous un parseFloat correct pour l'EUR.
 *
 *               Aucun gate existant ne détectait ce motif.
 *
 * @inputs       services/**\/*.js, routes/**\/*.js
 * @outputs      stdout report, exit code
 * @depends      none
 * @used-by      npm run arch:gate (local + CI)
 * @db-read      none
 * @db-write     none
 * @db-txn       none
 * @doctrine     KOMERCE_DB_SCHEMA_DOCTRINE
 * @impact-areas governance, ci, economic-engine, orders, refunds
 * @version      2026-09
 *
 * Pourquoi un CLIQUET et non un blocage sec :
 *   Les 82 occurrences existantes ne sont pas toutes des bugs. Arrondir un
 *   KPI de dashboard à l'unité est défendable ; arrondir une ligne de facture
 *   ne l'est pas. Trancher les 82 d'un coup demanderait un jugement métier
 *   site par site, hors du périmètre d'un gate. Le cliquet fige donc l'état
 *   actuel et empêche toute AUGMENTATION — même patron que
 *   arch-header-sql-check et debt-zero-gate dans ce dépôt. Les lots suivants
 *   peuvent faire baisser la baseline ; rien ne peut la faire monter.
 *
 * Faux positifs volontairement exclus (motifs corrects) :
 *   - Math.round(x * 100) / 100  -> arrondi AU CENTIME, c'est la bonne façon
 *     de neutraliser une dérive flottante (cf. services/wallet-service.js).
 *   - Math.round(x * 100)        -> conversion en centimes (API Stripe).
 *   - Champs cible pct/percent/ratio/rate/count/qty/cents -> pas des montants.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SCAN_DIRS = ['services', 'routes'];

// Cliquet : nombre d'occurrences au moment de l'introduction du gate.
// Ne JAMAIS augmenter cette valeur pour faire passer une PR. La baisser
// quand un lot supprime réellement des troncatures est le comportement
// attendu.
const BASELINE = 86;

const TRUNCATION = String.raw`(?:Math\.(?:round|trunc|floor|ceil)|parseInt)`;
// Cible : un champ ou une variable nommée *_kmf recevant directement une
// troncature. Les deux formes comptent — un premier jet ne couvrait que le
// littéral d'objet (`champ: Math.round(...)`) et laissait passer
// `const total_kmf = Math.round(...)`, angle mort trouvé par test de
// mutation, pas par relecture.
const SUSPECT_RE = new RegExp(
  String.raw`([a-zA-Z_$][\w$]*_kmf)\s*(?::|=(?!=))\s*${TRUNCATION}\s*\(`,
  ''
);

function isLegitimate(line) {
  // Arrondi au centime : Math.round(... * 100) / 100
  if (/\*\s*100\s*\)\s*\/\s*100/.test(line)) return true;
  // Conversion en centimes (Stripe) : Math.round(... * 100)
  if (/\*\s*100\s*\)/.test(line) && /cent|stripe/i.test(line)) return true;
  return false;
}

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      walk(full, out);
    } else if (entry.name.endsWith('.js') && !entry.name.includes('.test.')) {
      out.push(full);
    }
  }
  return out;
}

function runCheck({ root = ROOT, print = true } = {}) {
  const findings = [];

  for (const dirName of SCAN_DIRS) {
    const dir = path.join(root, dirName);
    if (!fs.existsSync(dir)) continue;
    for (const file of walk(dir)) {
      const content = fs.readFileSync(file, 'utf8');
      content.split('\n').forEach((line, index) => {
        const withoutComment = line.split('//')[0];
        if (!withoutComment.trim()) return;
        const match = withoutComment.match(SUSPECT_RE);
        if (match && !isLegitimate(withoutComment)) {
          findings.push({
            file: path.relative(root, file),
            line: index + 1,
            field: match[1],
            raw: withoutComment.trim().slice(0, 120),
          });
        }
      });
    }
  }

  const ok = findings.length <= BASELINE;

  if (print) {
    console.log('============================================================');
    console.log(' KOMERCE - Cliquet anti-troncature monetaire');
    console.log('============================================================');
    console.log(`Cliquet                 : ${BASELINE}`);
    console.log(`Occurrences trouvees    : ${findings.length}`);
    console.log('');

    if (!ok) {
      console.error('--- TRONCATURES AU-DESSUS DU CLIQUET ---');
      console.error('Un montant affecte a un champ *_kmf est arrondi a l\'unite.');
      console.error('Les colonnes monetaires sont numeric depuis le chantier');
      console.error('currency debt : arrondir ici annule silencieusement la');
      console.error('conversion et fait perdre les centimes.');
      console.error('');
      for (const f of findings.slice(0, 40)) {
        console.error(`  ${f.file}:${f.line}  (${f.field})`);
        console.error(`      ${f.raw}`);
      }
      console.error('');
      console.error('Corriger : lire la valeur avec Number()/parseFloat(), sans arrondir.');
      console.error('Si l\'arrondi est VOULU (KPI de dashboard, pourcentage), le champ');
      console.error('ne devrait pas s\'appeler *_kmf, ou l\'arrondi doit etre au centime');
      console.error('(Math.round(x * 100) / 100).');
      console.error('');
      console.error('============================================================');
      console.error(`🚫 ${findings.length} > cliquet ${BASELINE}.`);
    } else if (findings.length < BASELINE) {
      console.log('============================================================');
      console.log(`✅ ${findings.length} occurrence(s) — SOUS le cliquet (${BASELINE}).`);
      console.log(`   Pensez a abaisser BASELINE a ${findings.length} dans ce fichier.`);
    } else {
      console.log('============================================================');
      console.log(`✅ Au niveau du cliquet (${BASELINE}). Aucune regression.`);
    }
  }

  return { ok, findings, count: findings.length, baseline: BASELINE };
}

if (require.main === module) {
  const result = runCheck();
  if (!result.ok) process.exitCode = 1;
}

module.exports = { runCheck, BASELINE };
