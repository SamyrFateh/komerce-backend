/** @test-kind unit @test-runner jest @test-requires none */
'use strict';

const path = require('path');
const express = require('express');
const request = require('supertest');
const { mountHtmlRoutes } = require('../../bootstrap/html-routes');

const app = express();
mountHtmlRoutes(app, path.join(__dirname, '../..'));

describe('Routes publiques des catalogues pays', () => {
  test.each(['KM', 'CM', 'CG', 'DJ', 'YT'])('/%s retourne la boutique sans redirection de marché', async code => {
    const res = await request(app).get('/' + code);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('/boutique/js/market-context.js');
  });

  test('codes minuscules et slash final redirigent vers l’URL canonique', async () => {
    const lower = await request(app).get('/cm?tab=shop');
    expect(lower.status).toBe(301);
    expect(lower.headers.location).toBe('/CM?tab=shop');

    const trailing = await request(app).get('/YT/');
    expect(trailing.status).toBe(301);
    expect(trailing.headers.location).toBe('/YT');
  });

  test('ancienne URL /boutique reste utilisable', async () => {
    const res = await request(app).get('/boutique?market=CG');
    expect(res.status).toBe(200);
  });
});
