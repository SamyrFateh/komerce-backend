'use strict';
/**
 * @test-kind helper
 * FA-22 : POST /api/orders exige Idempotency-Key ; L3/N06 : il exige aussi le total accepté
 * (expected_total_kmf, issu de l'aperçu). Ce wrapper de supertest ajoute une clé neuve à
 * chaque POST /api/orders et, si le corps n'a pas de total, interroge d'abord
 * POST /api/orders/preview avec les mêmes en-têtes (aperçu réel, base réelle).
 * Un `.set('Idempotency-Key', …)` ou un expected_total_kmf explicite du test prévaut.
 * `.keyOnly` : clé seule, pour les tests dont la base est simulée par séquences.
 */
const crypto = require('crypto');
const supertest = require('supertest');

function wrap(app, { preview }) {
  const agent = supertest(app);
  const post = agent.post.bind(agent);
  agent.post = (url, ...rest) => {
    const t = post(url, ...rest);
    if (url !== '/api/orders') return t;
    t.set('Idempotency-Key', crypto.randomUUID());
    if (!preview) return t;
    const origEnd = t.end.bind(t);
    t.end = (cb) => {
      const body = t._data;
      if (!body || typeof body !== 'object' || body.expected_total_kmf != null) return origEnd(cb);
      const pv = supertest(app).post('/api/orders/preview');
      for (const [k, v] of Object.entries(t._header || {})) if (k !== 'idempotency-key') pv.set(k, v);
      return pv.send(body).then((res) => {
        if (res.status === 200 && Number.isSafeInteger(res.body && res.body.total_kmf)) {
          t._data = { ...body, expected_total_kmf: res.body.total_kmf };
        }
        return origEnd(cb);
      }, () => origEnd(cb));
    };
    return t;
  };
  return agent;
}

module.exports = (app) => wrap(app, { preview: true });
module.exports.keyOnly = (app) => wrap(app, { preview: false });
