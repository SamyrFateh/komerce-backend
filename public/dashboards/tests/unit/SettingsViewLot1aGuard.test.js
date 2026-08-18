'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires jsdom
 */
const path = require('path');
const {
  loadView, makeKmcApi, flush, mockEscHelpers,
} = require('./helpers/dashboardTestKit');

const VIEW_PATH = '../../admin/js/views/SettingsView.js';
const VIEW_NAME = 'SettingsView';
const GUARD_PATH = path.resolve(__dirname, '../../admin/js/views/SettingsViewLot1aGuard.js');

function rulesPayload() {
  return {
    categories: {
      sla: {
        label: 'SLA',
        rules: [{ key: 'SLA_LIVRAISON_JOURS', label_fr: 'Délai livraison', value: 5, value_type: 'number' }],
      },
    },
  };
}

function installGuard() {
  delete require.cache[require.resolve(GUARD_PATH)];
  require(GUARD_PATH);
  return { render: global.SettingsView };
}

describe('SettingsViewLot1aGuard', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="main-content"></div>';
    mockEscHelpers();
    window.KmcApi = makeKmcApi({
      getSettings: async () => rulesPayload(),
      getSettingsTaxes: async () => ({ taxes: [{ category: 'legacy' }] }),
      getSettingsDims: async () => ({ dims: [{ category: 'legacy' }] }),
      getSettingsAudit: async () => ({ history: [] }),
    });
  });

  afterEach(() => {
    const root = document.getElementById('main-content');
    root?.__lot1aSettingsObserver?.disconnect();
    delete global.SettingsView;
  });

  it('masque Taxes et Dimensions mais conserve Règles et Historique', async () => {
    loadView(VIEW_PATH, VIEW_NAME);
    const guarded = installGuard();
    const root = document.getElementById('main-content');

    await guarded.render(root);
    await flush();

    expect(root.querySelector('.sv-tab[data-tab="taxes"]')).toBeNull();
    expect(root.querySelector('.sv-tab[data-tab="dims"]')).toBeNull();
    expect(root.querySelector('.sv-tab[data-tab="rules"]')).not.toBeNull();
    expect(root.querySelector('.sv-tab[data-tab="audit"]')).not.toBeNull();
    expect(root.textContent).toContain('SLA_LIVRAISON_JOURS');
  });

  it('remasque un bouton legacy réintroduit par un rerender interne', async () => {
    loadView(VIEW_PATH, VIEW_NAME);
    const guarded = installGuard();
    const root = document.getElementById('main-content');

    await guarded.render(root);
    await flush();

    const tabs = root.querySelector('.sv-tabs');
    const legacy = document.createElement('button');
    legacy.className = 'sv-tab';
    legacy.dataset.tab = 'taxes';
    legacy.textContent = 'Taxes legacy';
    tabs.appendChild(legacy);

    await flush();
    expect(root.querySelector('.sv-tab[data-tab="taxes"]')).toBeNull();
  });
});
