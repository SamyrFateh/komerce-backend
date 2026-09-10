/**
 * @jest-environment jsdom
 */
'use strict';

const fs = require('fs');
const path = require('path');

const SOURCE = fs.readFileSync(
  path.join(__dirname, '../../js/market-hydration.js'),
  'utf8'
);

describe('market hydration — relay boundary', () => {
  beforeEach(() => {
    document.body.innerHTML = `
      <div id="k-order-modal"></div>
      <div class="ck-relais-overlay">
        <div class="ck-relais-step"><span class="ck-relais-step-n">1</span> Île</div>
        <div class="ck-relais-iles"><button>Cameroun</button></div>
        <button class="ck-relais-sheet-cta">Valider Comores</button>
      </div>
    `;

    window.KomerceMarket = {
      getPreviewOverride: () => 'CM',
      getByCode: () => ({
        code: 'CM',
        name: 'Cameroun',
        relay_group_label: 'Ville',
        relay_default_zone: 'Yaoundé',
      }),
      get: () => ({ code: 'KM', name: 'Comores' }),
    };

    window.fetch = jest.fn();
  });

  afterEach(() => {
    delete window.K;
    delete window.KomerceMarket;
  });

  test('scope /api/relais sur CM, rejette KM et adapte zone vers le picker legacy', async () => {
    const nativeRequest = jest.fn(async () => ([
      { id: 'km-1', market_code: 'KM', zone: 'Moroni', island: 'Ngazidja' },
      { id: 'cm-1', market_code: 'CM', zone: 'Yaoundé', island: null },
    ]));
    window.K = { request: nativeRequest };

    window.eval(SOURCE);

    const rows = await window.K.request('/api/relais', 'GET', null, 0, {});

    expect(nativeRequest).toHaveBeenCalledWith(
      '/api/relais?market=CM',
      'GET',
      null,
      0,
      {}
    );
    expect(rows).toEqual([
      expect.objectContaining({
        id: 'cm-1',
        market_code: 'CM',
        zone: 'Yaoundé',
        island: 'Yaoundé',
      }),
    ]);
    expect(rows.some(row => row.market_code === 'KM')).toBe(false);

    expect(document.body.dataset.marketCode).toBe('CM');
    expect(document.querySelector('.ck-relais-step').textContent).toMatch(/Ville/i);
    expect(document.querySelector('.ck-relais-iles button').textContent).toBe('Yaoundé');
    expect(document.querySelector('.ck-relais-sheet-cta').textContent).toBe('Valider Yaoundé');
  });
});
