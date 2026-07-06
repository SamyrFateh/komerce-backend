'use strict';
/**
 * SettingsView.js (571L) — Lot suivant du plan.
 *
 * Particularité : `global.SettingsView` est une fonction bare (pas
 * `{render}`) — le kit la normalise via loadView(). Autre particularité,
 * plus gênante : _saveRule/_resetRule/_saveMatrixRow relisent le DOM via
 * `document.getElementById('main-content')` au lieu d'utiliser le `root`
 * reçu par render(root). Ça "marche" en prod parce que le container réel
 * s'appelle #main-content, mais c'est un couplage fragile (silencieux si
 * jamais ce nom change). On monte donc le container sous cet id précis
 * pour pouvoir exercer les flux save/reset.
 */
const {
  loadView, makeKmcApi, flush, mockEscHelpers,
} = require('./helpers/dashboardTestKit');

const VIEW_PATH = '../../dashboards/admin/js/views/SettingsView.js';
const VIEW_NAME = 'SettingsView';

function mountMainContent() {
  document.body.innerHTML = '<div id="main-content"></div>';
  return document.getElementById('main-content');
}

const rulesPayload = () => ({
  categories: {
    sla: {
      label: 'SLA',
      rules: [
        { key: 'SLA_LIVRAISON_JOURS', label_fr: 'Délai livraison', value: 5, value_type: 'number', min_value: 1, max_value: 30 },
        { key: 'MARGE_PCT', label_fr: 'Marge cible', value: 25, value_type: 'number' }, // clé critique
      ],
    },
    pricing: {
      label: 'Pricing',
      rules: [
        { key: 'AUTO_DISCOUNT', label_fr: 'Remise auto', value: true, value_type: 'boolean' },
      ],
    },
  },
});
const taxesPayload = () => ({ taxes: [{ category: 'tech', label_fr: 'Tech', douane_pct: 0.1, tva_pct: 0.05, taxe_add_pct: 0, updated_at: null }] });
const dimsPayload  = () => ({ dims: [{ category: 'tech', label_fr: 'Tech', length_cm: 20, width_cm: 10, height_cm: 5, updated_at: null }] });

function baseKmcApi(overrides = {}) {
  return makeKmcApi({
    getSettings: async () => rulesPayload(),
    getSettingsTaxes: async () => taxesPayload(),
    getSettingsDims: async () => dimsPayload(),
    ...overrides,
  });
}

describe('SettingsView', () => {
  beforeEach(() => {
    mountMainContent();
    mockEscHelpers();
    window.alert = jest.fn();
    window.confirm = jest.fn(() => true);
    window.prompt = jest.fn(() => 'Justification suffisamment longue');
  });

  it('expose une fonction render (contrat bare function, normalisée par le kit)', () => {
    const view = loadView(VIEW_PATH, VIEW_NAME);
    expect(typeof view.render).toBe('function');
  });

  it("charge les 3 sources et affiche l'onglet Règles par défaut, catégories + clé critique", async () => {
    window.KmcApi = baseKmcApi();
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    expect(root.querySelector('.sv-tab.active').dataset.tab).toBe('rules');
    expect(root.textContent).toContain('SLA_LIVRAISON_JOURS');
    expect(root.querySelector('.sv-badge-critical')).not.toBeNull();
  });

  it('filtre les règles via la recherche', async () => {
    window.KmcApi = baseKmcApi();
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    const search = root.querySelector('#sv-search');
    search.value = 'marge';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.textContent).toContain('MARGE_PCT');
    expect(root.textContent).not.toContain('AUTO_DISCOUNT');
  });

  it("affiche 'aucune règle' quand la recherche ne matche rien", async () => {
    window.KmcApi = baseKmcApi();
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    const search = root.querySelector('#sv-search');
    search.value = 'zzz-inexistant';
    search.dispatchEvent(new Event('input', { bubbles: true }));

    expect(root.querySelector('.sv-empty-msg').textContent).toContain('zzz-inexistant');
  });

  it('bascule entre les 4 onglets', async () => {
    window.KmcApi = baseKmcApi({ getSettingsAudit: async () => ({ history: [] }) });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-tab[data-tab="taxes"]').click();
    expect(root.querySelector('.sv-matrix')).not.toBeNull();
    expect(root.textContent).toContain('Douane');

    root.querySelector('.sv-tab[data-tab="dims"]').click();
    expect(root.textContent).toContain('Volume (cm³)');

    root.querySelector('.sv-tab[data-tab="audit"]').click();
    await flush();
    expect(root.querySelector('.sv-empty-msg').textContent).toContain('Aucune modification');
  });

  it("ouvre le panneau d'une règle, refuse une justification trop courte, puis sauvegarde avec succès", async () => {
    const patchSettingRule = jest.fn().mockResolvedValue({});
    window.KmcApi = baseKmcApi({
      getSettingRule: async (key) => ({
        rule: rulesPayload().categories.sla.rules.find(r => r.key === key),
        history: [{ changed_by_name: 'Admin', created_at: '2026-06-01', old_value: { value: 4 }, new_value: { value: 5 }, change_reason: 'Ajustement' }],
      }),
      patchSettingRule,
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-rule[data-key="SLA_LIVRAISON_JOURS"]').click();
    await flush();
    expect(document.getElementById('sv-panel').classList.contains('open')).toBe(true);
    expect(document.getElementById('sv-panel').textContent).toContain('Ajustement');

    // Justification trop courte → erreur, pas d'appel API
    document.getElementById('sv-new-val').value = '7';
    document.getElementById('sv-reason').value = 'trop';
    document.getElementById('sv-save').click();
    await flush();
    expect(document.getElementById('sv-error').style.display).toBe('block');
    expect(patchSettingRule).not.toHaveBeenCalled();

    // Justification valide → sauvegarde, fermeture du panneau, rechargement
    document.getElementById('sv-reason').value = 'Justification suffisamment détaillée';
    document.getElementById('sv-save').click();
    await flush();

    expect(patchSettingRule).toHaveBeenCalledWith('SLA_LIVRAISON_JOURS', { value: 7, reason: 'Justification suffisamment détaillée' });
    expect(document.getElementById('sv-panel').classList.contains('open')).toBe(false);
  });

  it('réinitialise une règle après confirmation, annule si confirm() refuse', async () => {
    const resetSettingRule = jest.fn().mockResolvedValue({});
    window.KmcApi = baseKmcApi({
      getSettingRule: async () => ({ rule: rulesPayload().categories.sla.rules[0], history: [{ change_reason: 'x', created_at: '2026-01-01' }] }),
      resetSettingRule,
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-rule[data-key="SLA_LIVRAISON_JOURS"]').click();
    await flush();

    window.confirm.mockReturnValueOnce(false);
    document.getElementById('sv-reset').click();
    expect(resetSettingRule).not.toHaveBeenCalled();

    document.getElementById('sv-reset').click(); // confirm() -> true par défaut
    await flush();
    expect(resetSettingRule).toHaveBeenCalledWith('SLA_LIVRAISON_JOURS');
  });

  it('affiche une erreur inline si getSettingRule échoue à l\'ouverture du panneau', async () => {
    window.KmcApi = baseKmcApi({ getSettingRule: async () => { throw new Error('Règle introuvable'); } });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-rule[data-key="SLA_LIVRAISON_JOURS"]').click();
    await flush();
    expect(document.getElementById('sv-panel').textContent).toContain('Règle introuvable');
  });

  it('active le bouton "Enregistrer" de la matrice taxes seulement si une valeur change, puis sauvegarde', async () => {
    const putSettingsTaxes = jest.fn().mockResolvedValue({});
    window.KmcApi = baseKmcApi({
      putSettingsTaxes,
      getSettingsTaxes: jest.fn()
        .mockResolvedValueOnce(taxesPayload())
        .mockResolvedValueOnce({ taxes: [{ ...taxesPayload().taxes[0], douane_pct: 0.12 }] }),
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-tab[data-tab="taxes"]').click();
    const row = root.querySelector('tr[data-cat="tech"]');
    const saveBtn = row.querySelector('.sv-matrix-save');
    expect(saveBtn.disabled).toBe(true);

    const douaneInput = row.querySelector('input[data-field="douane_pct"]');
    douaneInput.value = '0.12';
    douaneInput.dispatchEvent(new Event('input', { bubbles: true }));
    expect(saveBtn.disabled).toBe(false);
    expect(row.classList.contains('dirty')).toBe(true);

    saveBtn.click();
    await flush();

    expect(putSettingsTaxes).toHaveBeenCalledWith('tech', expect.objectContaining({
      reason: 'Justification suffisamment longue', douane_pct: 0.12,
    }));
  });

  it('refuse la sauvegarde matrice si la justification via prompt() est trop courte', async () => {
    window.prompt = jest.fn(() => 'court');
    const putSettingsDims = jest.fn();
    window.KmcApi = baseKmcApi({ putSettingsDims });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-tab[data-tab="dims"]').click();
    const row = root.querySelector('tr[data-cat="tech"]');
    const input = row.querySelector('input[data-field="length_cm"]');
    input.value = '25';
    input.dispatchEvent(new Event('input', { bubbles: true }));
    row.querySelector('.sv-matrix-save').click();
    await flush();

    expect(putSettingsDims).not.toHaveBeenCalled();
    expect(window.alert).toHaveBeenCalledWith('Justification trop courte.');
  });

  it("affiche l'historique d'audit avec ses colonnes", async () => {
    window.KmcApi = baseKmcApi({
      getSettingsAudit: async () => ({
        history: [{ created_at: '2026-06-01', rule_key: 'MARGE_PCT', rule_label: 'Marge cible', changed_by_name: 'Admin', old_value: { value: 20 }, new_value: { value: 25 }, change_reason: 'Ajustement Q3' }],
      }),
    });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    root.querySelector('.sv-tab[data-tab="audit"]').click();
    await flush();
    expect(root.querySelector('.sv-audit-table').textContent).toContain('Ajustement Q3');
  });

  it("affiche une erreur pleine page si le chargement initial échoue", async () => {
    window.KmcApi = baseKmcApi({ getSettings: async () => { throw new Error('boom réseau'); } });
    const view = loadView(VIEW_PATH, VIEW_NAME);
    const root = document.getElementById('main-content');
    await view.render(root);
    await flush();

    expect(root.textContent).toContain('boom réseau');
  });
});
