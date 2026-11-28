'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
const fs = require('fs');
const path = require('path');

describe('b-bus — registre des événements', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../js/b-bus.js'),
    'utf8'
  );

  test('modal:detail-ready est déclaré parmi les événements standard', () => {
    expect(source).toMatch(
      /Événements standard Komerce[\s\S]*\*\s+modal:detail-ready\b/
    );
  });

  test('modal:selection-rendered a un contrat standard après le rerender SKU', () => {
    expect(source.split('Événements standard Komerce')[1] || '').toContain('modal:selection-rendered');
  });

  test('modal:detail-ready n’est pas déclaré comme événement retiré', () => {
    const retiredSection = source.split(
      'Événements retirés du JSDoc'
    )[1] || '';

    expect(retiredSection).not.toContain('modal:detail-ready');
  });

  test('On Demand declares one producer, a reference payload and its consumer', () => {
    const ownership = source.split('Propriété des contrats')[1].split('Consommateurs déclarés')[0];
    const consumers = source.split('Consommateurs déclarés')[1].split('Événements retirés')[0];
    expect(ownership).toMatch(/on-demand:open\s+owner=notifications-client producer=b-notifications\.js payload=value/);
    expect(consumers).toMatch(/on-demand:open\s*:\s*b-on-demand\.js/);
    const producer = fs.readFileSync(path.join(__dirname, '../../js/b-notifications.js'), 'utf8');
    const consumer = fs.readFileSync(path.join(__dirname, '../../js/b-on-demand.js'), 'utf8');
    expect(producer).toMatch(/bus\.emit\('on-demand:open',\s*\{\s*reference:/);
    expect(consumer).toMatch(/bus\.on\('on-demand:open',/);
  });

  test('ne câble plus le spike Phase 2 (shell vertical)', () => {
    expect(source).not.toMatch(/spike-vertical-shell/);
    expect(source).not.toMatch(/spike-shell-vertical/);
  });
});