'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Garde CI de l'unification monétaire : aucun chemin applicatif ne relit finance_config.taux_*, ne fabrique un taux
 * de repli (492 / 138) ou un ratio USD/EUR figé (0,92). Seules exceptions listées et justifiées.
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const DIRS = ['routes', 'services', 'utils', 'jobs', 'bootstrap', 'middleware'];

// Fichiers autorisés à mentionner ces motifs (justification obligatoire).
const ALLOW = {
  'services/fx-engine-rates.js': 'superpose les taux autorité sur les colonnes taux_* (sortie, jamais lecture de finance_config)',
  'utils/rates.js': 'lit la ligne superposée par fx-engine-rates (taux_* = sortie de l\'autorité)',
  'services/pricing-cdr.js': 'config.finance superposée par withAuthorityRates (lecture de la ligne autorité)',
  'services/supplier-catalog-scanner.js': 'config.finance superposée ; PLN = devise hors autorité (arbitrage ouvert)',
  'routes/admin-finance-config.js': 'liste des champs retirés (410)',
  'services/pricing-recommend.js': 'config superposée par withAuthorityRates',
  'services/economic-config.js': 'aucun taux (paramètres économiques)',
  'routes/admin/system.js': 'générateur de démonstration, non transactionnel',
  'services/pricing-parameters-status.js': 'diagnostic : lit les parités et l\'autorité',
};

const FORBIDDEN = [
  { re: /\|\|\s*(492|138)\b/, why: 'repli de taux codé en dur (|| 492 / || 138)' },
  { re: /\bUSD_EUR_CURRENT_RATIO\b|\bRATES_FALLBACK\b|\bAED_KMF_FALLBACK\b|\bEUR_KMF_FALLBACK\b/, why: 'constante de repli supprimée' },
  { re: /\*\s*0\.92\b|\b0\.92\s*\*/, why: 'ratio USD/EUR figé 0,92' },
  { re: /FROM finance_config[^`'"]*taux_(change_eur_kmf|aed_kmf)|SELECT\s+taux_(change_eur_kmf|aed_kmf)/i, why: 'lecture directe de finance_config.taux_*' },
];

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (e.name.endsWith('.js')) out.push(p);
  }
  return out;
}

describe('autorité FX unique — aucune autorité concurrente dans le code applicatif', () => {
  const files = DIRS.flatMap((d) => fs.existsSync(path.join(ROOT, d)) ? walk(path.join(ROOT, d)) : [])
    .map((p) => path.relative(ROOT, p));

  test('aucun repli de taux, ratio figé ni lecture directe de finance_config.taux_*', () => {
    const offenders = [];
    for (const f of files) {
      if (ALLOW[f]) continue;
      const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
      for (const { re, why } of FORBIDDEN) {
        if (re.test(src)) offenders.push(`${f} — ${why}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test('les fichiers autorisés restent justifiés (liste à réduire, jamais à étendre sans raison)', () => {
    for (const [f, why] of Object.entries(ALLOW)) {
      expect(why.length).toBeGreaterThan(10);
      expect(fs.existsSync(path.join(ROOT, f))).toBe(true);
    }
  });
});
