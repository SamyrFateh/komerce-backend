/**
 * @komerce-arch
 * @role          official-fx-reference-ingestion
 * @domain        market
 * @layer         service
 * @criticality   critical
 * @inputs        trusted_ecb_xml_feed
 * @outputs       immutable_public_eur_cross_quotes
 * @depends       db.js
 * @db-read       none
 * @db-write      fx_public_reference_quotes
 * @db-txn        caller-supplied transaction or db.withTransaction
 * @doctrine      official_public_source, eur_pivot, dated_provenance, append_only, no_rate_fallback
 * @impact-areas  market, sourcing, pricing, payments
 * @version       2026-10
 */
'use strict';

const db = require('../db');

const ECB_DAILY_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';
const MAX_RESPONSE_BYTES = 128 * 1024;
const MAX_QUOTE_AGE_DAYS = 7;
const MIN_QUOTES = 10;

/**
 * Cotation BCE : 1 EUR = `rate` unités de `currency`. L'XML officiel
 * est publié les jours ouvrés, mais sa dernière édition reste lisible 7j/7.
 * Les champs sont strictement validés AVANT toute écriture.
 */
function parseEcbDailyXml(xml, { now = new Date() } = {}) {
  if (typeof xml !== 'string' || !xml.length || Buffer.byteLength(xml) > MAX_RESPONSE_BYTES) {
    throw new Error('ECBFxFeed: réponse XML absente ou trop volumineuse');
  }
  if (!/<(?:[a-z]+:)?Envelope\b/i.test(xml) || !/European Central Bank/i.test(xml)) {
    throw new Error('ECBFxFeed: enveloppe officielle BCE invalide');
  }
  const dayMatch = /<(?:[a-z]+:)?Cube\b[^>]*\btime=['"](\d{4}-\d{2}-\d{2})['"][^>]*>/i.exec(xml);
  if (!dayMatch) throw new Error('ECBFxFeed: date de cotation absente');
  const asOf = dayMatch[1];
  const day = new Date(asOf + 'T00:00:00Z');
  if (Number.isNaN(day.getTime()) || day.toISOString().slice(0, 10) !== asOf) {
    throw new Error('ECBFxFeed: date de cotation invalide');
  }
  const nowTime = new Date(now).getTime();
  const age = nowTime - day.getTime();
  if (!Number.isFinite(nowTime) || age < -24 * 3600 * 1000 || age > MAX_QUOTE_AGE_DAYS * 86400000) {
    throw new Error('ECBFxFeed: cotation hors fenêtre de fraîcheur');
  }

  const quotes = new Map();
  const cubeTags = xml.match(/<(?:[a-z]+:)?Cube\b[^>]*\/?\s*>/gi) || [];
  for (const tag of cubeTags) {
    const cur = /\bcurrency=['"]([A-Z]{3})['"]/i.exec(tag)?.[1]?.toUpperCase();
    const rate = /\brate=['"]([0-9]+(?:\.[0-9]{1,8})?)['"]/i.exec(tag)?.[1];
    if (!cur || !rate) continue;
    const n = Number(rate);
    if (!(n > 0 && n < 100000000) || ['EUR', 'KMF', 'XAF'].includes(cur) || quotes.has(cur)) {
      throw new Error('ECBFxFeed: cotation invalide ou doublonnée pour ' + cur);
    }
    quotes.set(cur, rate);
  }
  if (quotes.size < MIN_QUOTES || !quotes.has('USD')) {
    throw new Error('ECBFxFeed: données BCE insuffisantes ou USD absent');
  }
  return { asOf, quotes: [...quotes].map(([currency, rate]) => ({ currency, rate })) };
}

async function fetchEcbDaily({ fetchFn = globalThis.fetch, now = new Date() } = {}) {
  const response = await fetchFn(ECB_DAILY_URL, {
    method: 'GET',
    headers: { Accept: 'application/xml, text/xml' },
    signal: AbortSignal.timeout(12000),
    redirect: 'error',
  });
  if (!response.ok) throw new Error('ECBFxFeed: HTTP ' + response.status);
  const contentLength = Number(response.headers?.get?.('content-length') || 0);
  if (contentLength > MAX_RESPONSE_BYTES) throw new Error('ECBFxFeed: réponse trop volumineuse');
  const body = await response.text();
  return parseEcbDailyXml(body, { now });
}

async function ingestEcbDaily({ fetchFn = globalThis.fetch, client = db, now = new Date() } = {}) {
  // Tous les taux sont validés avant la première requête INSERT.
  const feed = await fetchEcbDaily({ fetchFn, now });
  const write = async (executor) => {
    let inserted = 0;
    for (const quote of feed.quotes) {
      const result = await executor.query(
        `INSERT INTO fx_public_reference_quotes
           (base_ccy, quote_ccy, rate, as_of, source_label, source_ref)
         VALUES ('EUR', $1, $2, $3::date, 'Banque centrale européenne', $4)
         ON CONFLICT (base_ccy, quote_ccy, as_of) DO NOTHING
         RETURNING id`,
        [quote.currency, quote.rate, feed.asOf, ECB_DAILY_URL]
      );
      inserted += result.rowCount || result.rows?.length || 0;
    }
    return { as_of: feed.asOf, rates_received: feed.quotes.length, inserted };
  };
  if (client === db && typeof db.withTransaction === 'function') {
    return db.withTransaction(write);
  }
  return write(client);
}

module.exports = { ECB_DAILY_URL, parseEcbDailyXml, fetchEcbDaily, ingestEcbDaily };
