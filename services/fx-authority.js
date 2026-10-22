/**
 * @komerce-arch
 * @role          fx-authority
 * @domain        market
 * @layer         service
 * @criticality   critical
 * @inputs        amount, from_currency, to_currency, at, client
 * @outputs       converted_amount, legs, rounding
 * @depends       db, services/fx-chain-service.js
 * @used-by       utils/currency.js, services/market-transport-sale-rates.js
 * @db-read       currency_parities, fx_pegs, fx_rate_observations
 * @db-write      none
 * @db-txn        none
 * @doctrine      eur_is_the_pivot, single_conversion_authority, fail_closed, no_float_arithmetic, single_rounding
 * @impact-areas  pricing, transport, orders, payments, finance
 * @version       2026-10
 *
 * UNIQUE autorité de conversion de Komerce. EUR est le pivot : toute conversion X→Y vaut
 *   montant × U(Y) / U(X), où U(c) = unités de c pour 1 EUR, produit de jambes sourcées :
 *     EUR            : 1 (identité)
 *     KMF, XAF       : currency_parities (parité fixe, ancrage garanti)
 *     USD            : observation EUR/USD approuvée par une 2e personne, fraîche (fx_rate_observations)
 *     DJF, AED       : observation EUR/USD × peg USD→devise daté (fx_pegs)
 *     toute autre    : refus typé (aucun taux inventé)
 * Calcul en rationnel exact (BigInt), UN SEUL arrondi half-even au minor_unit ISO de la devise cible.
 * Chaque conversion retourne les jambes (id, paire, taux, source) à figer dans le snapshot de transaction.
 * `at` absent = heure de la base (jamais l'horloge du process).
 */
'use strict';

const db = require('../db');
const fxChain = require('./fx-chain-service');

// ISO 4217. Une devise absente ici est refusée.
const MINOR_UNITS = Object.freeze({ EUR: 2, USD: 2, AED: 2, CNY: 2, KMF: 0, XAF: 0, DJF: 0 });
const FIXED_PARITY_CURRENCIES = Object.freeze(['KMF', 'XAF']);
const PEGGED_CURRENCIES = Object.freeze(['DJF', 'AED']);

class FxError extends Error {
  constructor(message, code, statusCode) {
    super(message);
    this.name = 'FxError';
    this.code = code;
    this.statusCode = statusCode;
  }
}

// ── Décimal exact ────────────────────────────────────────────────────────────
function parseDecimal(value, label = 'montant') {
  const s = typeof value === 'bigint' ? value.toString() : String(value).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new FxError(`${label} invalide : « ${s} »`, 'fx_amount_invalid', 422);
  const frac = m[3] || '';
  const n = BigInt(m[2] + frac) * (m[1] === '-' ? -1n : 1n);
  return { n, d: 10n ** BigInt(frac.length) };
}

function roundHalfEven(num, den, minor) {
  const scale = 10n ** BigInt(minor);
  let n = num * scale;
  let d = den;
  if (d < 0n) { n = -n; d = -d; }
  const neg = n < 0n;
  if (neg) n = -n;
  let q = n / d;
  const r2 = (n % d) * 2n;
  if (r2 > d || (r2 === d && q % 2n === 1n)) q += 1n;
  return neg ? -q : q;
}

function formatScaled(q, minor) {
  const neg = q < 0n;
  let s = (neg ? -q : q).toString();
  if (minor > 0) {
    s = s.padStart(minor + 1, '0');
    s = `${s.slice(0, -minor)}.${s.slice(-minor)}`;
  }
  return (neg ? '-' : '') + s;
}

// ── Jambes ───────────────────────────────────────────────────────────────────
function assertSupported(ccy) {
  if (!Object.prototype.hasOwnProperty.call(MINOR_UNITS, ccy)) {
    throw new FxError(`Devise inconnue, aucune parité gouvernée : ${ccy}`, 'fx_currency_unsupported', 422);
  }
}

async function fixedParityLeg(ccy, client) {
  const { rows: [row] } = await client.query(
    'SELECT eur_rate::text AS rate, updated_at FROM currency_parities WHERE currency = $1', [ccy]);
  if (!row) throw new FxError(`Aucune parité fixe enregistrée pour ${ccy} : conversion refusée`, 'fx_rate_unavailable', 503);
  return { kind: 'parity', id: `${ccy}@${row.updated_at ? new Date(row.updated_at).toISOString() : 'unversioned'}`, pair: `EUR/${ccy}`,
    rate: row.rate, source: 'currency_parities' };
}

// Unités de `ccy` pour 1 EUR sous forme de jambes (le produit des taux = U(ccy)).
async function legsPerEur(ccy, ctx) {
  assertSupported(ccy);
  if (ccy === 'EUR') return [];
  if (FIXED_PARITY_CURRENCIES.includes(ccy)) return [await fixedParityLeg(ccy, ctx.client)];
  if (ccy === 'USD' || PEGGED_CURRENCIES.includes(ccy)) {
    const legs = [await ctx.observation()];
    if (ccy !== 'USD') legs.push(await ctx.peg(ccy));
    return legs;
  }
  throw new FxError(`Aucune source de taux gouvernée pour ${ccy} : conversion refusée`, 'fx_currency_unsupported', 422);
}

function makeContext({ at, maxAgeDays, client }) {
  const memo = new Map();
  const once = (k, fn) => { if (!memo.has(k)) memo.set(k, fn()); return memo.get(k); };
  return {
    client,
    observation: () => once('obs', async () => {
      const o = await fxChain.resolveObservation({ at, maxAgeDays, client });
      return { kind: 'observation', id: o.id, pair: 'EUR/USD', rate: o.rate_text, as_of: o.as_of, source: o.source_label };
    }),
    peg: (quote) => once(`peg:${quote}`, async () => {
      const p = await fxChain.resolvePeg({ quote, at, client });
      return { kind: 'peg', id: p.id, pair: `USD/${quote}`, rate: p.rate_text, valid_from: p.valid_from, source: p.source_label };
    }),
  };
}

function product(legs) {
  return legs.reduce((acc, leg) => {
    const r = parseDecimal(leg.rate, `taux ${leg.pair}`);
    if (r.n <= 0n) throw new FxError(`Taux ${leg.pair} non positif`, 'fx_rate_unavailable', 503);
    return { n: acc.n * r.n, d: acc.d * r.d };
  }, { n: 1n, d: 1n });
}

/**
 * Convertit `amount` de `from` vers `to` via le pivot EUR.
 * @param {object} p
 * @param {string|number} p.amount  montant décimal exact (chaîne recommandée) ; refus si non numérique
 * @param {string} p.from @param {string} p.to
 * @param {boolean} [p.round=true] false = pleine précision (12 décimales, projection de compatibilité)
 * @returns {{amount:number, amount_text:string, from, to, pivot:'EUR', legs:object[], rounding:object}}
 */
async function convert({ amount, from, to, at = null, client = db, maxAgeDays = fxChain.DEFAULT_MAX_AGE_DAYS, round = true }) {
  const f = String(from || '').trim().toUpperCase();
  const t = String(to || '').trim().toUpperCase();
  assertSupported(f);
  assertSupported(t);
  const a = parseDecimal(amount);
  const minor = round ? MINOR_UNITS[t] : 12;

  let legsFrom = [];
  let legsTo = [];
  if (f !== t) {
    const ctx = makeContext({ at, maxAgeDays, client });
    legsFrom = await legsPerEur(f, ctx);
    legsTo = await legsPerEur(t, ctx);
  }
  const uFrom = product(legsFrom);
  const uTo = product(legsTo);
  // montant × U(to) / U(from)
  const num = a.n * uTo.n * uFrom.d;
  const den = a.d * uTo.d * uFrom.n;
  const q = roundHalfEven(num, den, minor);
  const text = formatScaled(q, minor);
  return {
    amount: Number(text),
    amount_text: text,
    from: f,
    to: t,
    pivot: 'EUR',
    legs: [...legsFrom.map(l => ({ ...l, side: 'from' })), ...legsTo.map(l => ({ ...l, side: 'to' }))],
    rounding: { mode: 'half_even', minor_unit: minor, currency: t },
  };
}

/** Unités de `ccy` pour 1 EUR (nombre, compatibilité getCurrencyParity) — parités fixes uniquement. */
async function fixedUnitsPerEur(ccy, client = db) {
  const c = String(ccy || '').trim().toUpperCase();
  assertSupported(c);
  if (c === 'EUR') return 1;
  if (!FIXED_PARITY_CURRENCIES.includes(c)) {
    throw new FxError(`${c} : devise sans parité fixe (flottante ou à peg) — utiliser convert()`, 'fx_currency_unsupported', 422);
  }
  return Number((await fixedParityLeg(c, client)).rate);
}

module.exports = { convert, fixedUnitsPerEur, FxError, MINOR_UNITS, roundHalfEven, parseDecimal };
