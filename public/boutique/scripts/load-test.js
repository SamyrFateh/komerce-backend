/**
 * scripts/load-test.js — Test de charge k6
 *
 * Simule le parcours réel d'un utilisateur mobile :
 *   1. Charge le catalogue (GET /api/products)
 *   2. Consulte un produit (GET /api/products/:id)
 *   3. Charge les relais (GET /api/relais)
 *   4. Passe une commande (POST /api/orders) — optionnel
 *
 * Installation k6 :
 *   Windows : winget install Grafana.k6
 *   Mac     : brew install k6
 *   Linux   : sudo apt install k6
 *
 * Usage :
 *   # Smoke test (5 users, 30s) — vérifier que ça marche
 *   k6 run scripts/load-test.js
 *
 *   # Charge réaliste (20 users, 2 min)
 *   k6 run scripts/load-test.js --env SCENARIO=load
 *
 *   # Stress test (50 users, rampe progressive)
 *   k6 run scripts/load-test.js --env SCENARIO=stress
 *
 *   # Spike test (1→100 users en 10s)
 *   k6 run scripts/load-test.js --env SCENARIO=spike
 *
 * Variables d'environnement :
 *   BASE_URL          : URL du backend (défaut : https://komerce.co)
 *   SCENARIO          : smoke | load | stress | spike (défaut : smoke)
 *   ALLOW_ORDERS      : true pour inclure POST /api/orders (désactivé par défaut)
 *   TEST_PHONE        : numéro de test pour les commandes
 *   TEST_OTP          : OTP du compte de test
 */
'use strict';

import http from 'k6/http';
import { check, group, sleep } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

// ─── Configuration ───────────────────────────────────────────────────────────

const BASE = __ENV.BASE_URL || 'https://komerce.co';
const SCENARIO = __ENV.SCENARIO || 'smoke';
const ALLOW_ORDERS = __ENV.ALLOW_ORDERS === 'true';

// ─── Métriques custom ────────────────────────────────────────────────────────

const errorRate = new Rate('errors');
const catalogDuration = new Trend('catalog_duration', true);
const productDuration = new Trend('product_detail_duration', true);
const orderDuration = new Trend('order_creation_duration', true);
const ordersCreated = new Counter('orders_created');
const ordersBlocked = new Counter('orders_blocked_stock');

// ─── Scénarios ───────────────────────────────────────────────────────────────

const SCENARIOS = {
  // Smoke : vérifier que tout fonctionne sous charge minimale
  smoke: {
    stages: [
      { duration: '10s', target: 5 },
      { duration: '20s', target: 5 },
      { duration: '5s',  target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<3000'],  // 95% des requêtes < 3s
      errors: ['rate<0.05'],               // < 5% d'erreurs
    },
  },

  // Load : charge réaliste (heure de pointe Comores ~ 20 users simultanés)
  load: {
    stages: [
      { duration: '20s',  target: 10 },   // montée progressive
      { duration: '1m',   target: 20 },   // plateau
      { duration: '30s',  target: 20 },   // maintien
      { duration: '10s',  target: 0 },    // descente
    ],
    thresholds: {
      http_req_duration: ['p(95)<2000'],
      errors: ['rate<0.02'],
      catalog_duration: ['p(95)<1500'],
      product_detail_duration: ['p(95)<1000'],
    },
  },

  // Stress : trouver le point de rupture
  stress: {
    stages: [
      { duration: '20s', target: 10 },
      { duration: '30s', target: 30 },
      { duration: '30s', target: 50 },
      { duration: '30s', target: 50 },    // maintien à haute charge
      { duration: '20s', target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<5000'],   // plus tolérant
      errors: ['rate<0.10'],               // jusqu'à 10% d'erreurs accepté
    },
  },

  // Spike : montée soudaine (flash sale, viral WhatsApp)
  spike: {
    stages: [
      { duration: '5s',  target: 5 },     // calme
      { duration: '10s', target: 100 },   // explosion
      { duration: '30s', target: 100 },   // maintien
      { duration: '10s', target: 5 },     // retour au calme
      { duration: '10s', target: 0 },
    ],
    thresholds: {
      http_req_duration: ['p(95)<8000'],
      errors: ['rate<0.20'],               // on accepte 20% en spike
    },
  },
};

const config = SCENARIOS[SCENARIO] || SCENARIOS.smoke;

export const options = {
  stages: config.stages,
  thresholds: {
    ...config.thresholds,
  },
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };

function apiGet(path) {
  return http.get(`${BASE}${path}`, { headers, tags: { endpoint: path } });
}

function apiPost(path, body, opts = {}) {
  return http.post(`${BASE}${path}`, JSON.stringify(body), {
    headers,
    tags: { endpoint: path },
    ...opts,
  });
}

// ─── Parcours utilisateur ────────────────────────────────────────────────────

export default function () {
  let productId, relaisId;

  // ── 1. Catalogue (page d'accueil) ──
  group('Catalogue', () => {
    const res = apiGet('/api/products?in_stock=true');
    catalogDuration.add(res.timings.duration);

    const ok = check(res, {
      'catalogue 200': (r) => r.status === 200,
      'catalogue a des produits': (r) => {
        try {
          const data = JSON.parse(r.body);
          const products = data.products || [];
          if (products.length > 0) {
            // Sélectionner un produit aléatoire pour la suite
            const idx = Math.floor(Math.random() * products.length);
            productId = products[idx].id;
          }
          return products.length > 0;
        } catch { return false; }
      },
    });
    errorRate.add(!ok);
  });

  sleep(1 + Math.random() * 2); // Temps de scroll (~1-3s)

  // ── 2. Détail produit (clic sur une carte) ──
  if (productId) {
    group('Détail produit', () => {
      const res = apiGet(`/api/products/${productId}`);
      productDuration.add(res.timings.duration);

      const ok = check(res, {
        'produit 200': (r) => r.status === 200,
        'produit a un nom': (r) => {
          try { return JSON.parse(r.body).name?.length > 0; }
          catch { return false; }
        },
      });
      errorRate.add(!ok);
    });
  }

  sleep(0.5 + Math.random()); // Lecture fiche produit

  // ── 3. Catégories (navigation onglets) ──
  group('Catégories', () => {
    const res = apiGet('/api/categories');
    const ok = check(res, {
      'catégories 200': (r) => r.status === 200,
    });
    errorRate.add(!ok);
  });

  // ── 4. Relais (ouverture checkout) ──
  group('Relais', () => {
    const res = apiGet('/api/relais');
    const ok = check(res, {
      'relais 200': (r) => r.status === 200,
      'relais non vide': (r) => {
        try {
          const data = JSON.parse(r.body);
          const list = Array.isArray(data) ? data : data.relais || [];
          if (list.length > 0) {
            const real = list.filter((x) => !x.name?.startsWith('AAA'));
            relaisId = (real[0] || list[0])?.id;
          }
          return list.length > 0;
        } catch { return false; }
      },
    });
    errorRate.add(!ok);
  });

  sleep(0.5 + Math.random());

  // ── 5. Paliers fidélité (lecture publique) ──
  group('Fidélité', () => {
    const res = apiGet('/api/loyalty/tiers');
    check(res, { 'loyalty 200': (r) => r.status === 200 });
  });

  // ── 6. Commande (optionnel — staging uniquement) ──
  if (ALLOW_ORDERS && productId && relaisId) {
    group('Commande', () => {
      const phone = `700${1000 + Math.floor(Math.random() * 8999)}`;

      const res = apiPost('/api/orders', {
        items: [{ product_id: productId, quantity: 1 }],
        payment_mode: 'cash_relais',
        relais_id: relaisId,
        recipient_name: `Load Test ${__VU}`,
        recipient_phone: phone,
      });

      orderDuration.add(res.timings.duration);

      const ok = check(res, {
        'commande 201 ou 409': (r) => r.status === 201 || r.status === 409,
      });

      if (res.status === 201) {
        ordersCreated.add(1);
      } else if (res.status === 409) {
        ordersBlocked.add(1);
      }
      errorRate.add(!ok);
    });
  }

  sleep(1 + Math.random() * 3); // Temps avant le prochain parcours
}

// ─── Résumé ──────────────────────────────────────────────────────────────────

export function handleSummary(data) {
  const lines = [
    '',
    '╔══════════════════════════════════════════════════════╗',
    '║   📊 Résultat test de charge — Komerce              ║',
    '╚══════════════════════════════════════════════════════╝',
    '',
    `  Scénario    : ${SCENARIO}`,
    `  URL         : ${BASE}`,
    `  Commandes   : ${ALLOW_ORDERS ? 'activées' : 'lecture seule'}`,
    '',
  ];

  const metrics = data.metrics;

  if (metrics.http_req_duration) {
    const d = metrics.http_req_duration.values;
    lines.push(`  HTTP p50     : ${d.med?.toFixed(0) || '?'} ms`);
    lines.push(`  HTTP p95     : ${d['p(95)']?.toFixed(0) || '?'} ms`);
    lines.push(`  HTTP p99     : ${d['p(99)']?.toFixed(0) || '?'} ms`);
    lines.push(`  HTTP max     : ${d.max?.toFixed(0) || '?'} ms`);
  }
  if (metrics.http_reqs) {
    lines.push(`  Total reqs   : ${metrics.http_reqs.values.count}`);
    lines.push(`  Reqs/sec     : ${metrics.http_reqs.values.rate?.toFixed(1)}`);
  }
  if (metrics.errors) {
    lines.push(`  Taux erreur  : ${(metrics.errors.values.rate * 100).toFixed(2)}%`);
  }
  if (metrics.catalog_duration) {
    lines.push(`  Catalogue p95: ${metrics.catalog_duration.values['p(95)']?.toFixed(0)} ms`);
  }
  if (metrics.orders_created) {
    lines.push(`  Commandes    : ${metrics.orders_created.values.count} créées`);
  }
  if (metrics.orders_blocked_stock) {
    lines.push(`  Stock bloqué : ${metrics.orders_blocked_stock.values.count}`);
  }

  lines.push('');
  console.log(lines.join('\n'));

  return {
    stdout: lines.join('\n'),
  };
}
