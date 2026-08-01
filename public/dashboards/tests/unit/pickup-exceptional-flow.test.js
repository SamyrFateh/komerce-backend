/**
 * @komerce-arch-lite
 * @role          relay-exceptional-pickup-ui-tests
 * @domain        logistics
 * @layer         test
 * @status        production
 * @owner         public/dashboards/admin-legacy/js/ct-views-pickup-secret.js
 * @purpose       Qualifie le formulaire relais du retrait exceptionnel sans révéler le nom attendu.
 * @impact-areas  logistics, relay-dashboard, pickup-security
 * @version       2026-08-lot7
 */
'use strict';

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: jest.fn().mockResolvedValue(body),
  };
}

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) await Promise.resolve();
}

describe('Hub relais — retrait exceptionnel nominatif', () => {
  beforeAll(() => {
    document.body.innerHTML = '<main id="ct-main"></main>';
    window.CT = {
      api: { _authHeaders: () => ({ Authorization: 'Bearer test-agent' }) },
      toast: jest.fn(),
      views: { relais: jest.fn() },
      user: { role: 'agent_relais' },
    };
    global.fetch = jest.fn();
    require('../../admin-legacy/js/ct-views-pickup-secret.js');
  });

  beforeEach(() => {
    document.body.innerHTML = '<main id="ct-main"></main>';
    window.CT.toast.mockClear();
    window.CT.views.relais.mockClear();
    global.fetch.mockReset();
  });

  it('affiche des champs aveugles et envoie uniquement nom saisi + preuve de contrôle', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(200, { available: true }))
      .mockResolvedValueOnce(jsonResponse(200, {
        success: true,
        order_ref: 'KMR-L7-001',
      }));

    await window.KomercePickup.openExceptionalPickup('KMR-L7-001', 'order-l7-001');

    const modal = document.getElementById('pickup-modal');
    expect(modal).not.toBeNull();
    expect(modal.textContent).toContain('Retrait exceptionnel');
    expect(modal.textContent).toContain('le nom attendu ne vous est jamais communiqué');
    expect(modal.textContent).not.toMatch(/Fatima|Amina|Said/i);

    const given = document.getElementById('exceptional-given');
    const family = document.getElementById('exceptional-family');
    const checked = document.getElementById('exceptional-doc-checked');
    expect(given.value).toBe('');
    expect(family.value).toBe('');
    expect(checked.checked).toBe(false);
    expect(checked.required).toBe(true);

    given.value = 'Fatima Amina';
    family.value = 'Said';
    checked.checked = true;

    document.getElementById('pickup-exceptional-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    expect(global.fetch).toHaveBeenNthCalledWith(
      2,
      '/api/pickup/exceptional-pickup/order-l7-001/collect',
      expect.objectContaining({
        method: 'POST',
        credentials: 'include',
      })
    );
    const payload = JSON.parse(global.fetch.mock.calls[1][1].body);
    expect(payload).toEqual({
      given_names: 'Fatima Amina',
      family_name: 'Said',
      document_checked: true,
    });
    expect(payload).not.toHaveProperty('document_number');
    expect(payload).not.toHaveProperty('document_photo');
    expect(payload).not.toHaveProperty('signature');
    expect(document.getElementById('pickup-modal')).toBeNull();
    expect(window.CT.views.relais).toHaveBeenCalledWith(document.getElementById('ct-main'));
  });

  it('conserve le formulaire sur mismatch avec un message générique sans révéler le nom attendu', async () => {
    global.fetch
      .mockResolvedValueOnce(jsonResponse(200, { available: true }))
      .mockResolvedValueOnce(jsonResponse(401, {
        error: 'Le nom ne correspond pas à l’autorisation enregistrée',
        code: 'NAME_MISMATCH',
        remaining: 2,
      }));

    await window.KomercePickup.openExceptionalPickup('KMR-L7-002', 'order-l7-002');

    document.getElementById('exceptional-given').value = 'Nom Saisi';
    document.getElementById('exceptional-family').value = 'Incorrect';
    document.getElementById('exceptional-doc-checked').checked = true;
    document.getElementById('pickup-exceptional-form')
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flush();

    const error = document.getElementById('exceptional-error');
    expect(document.getElementById('pickup-modal')).not.toBeNull();
    expect(error.style.display).toBe('block');
    expect(error.textContent).toContain('2 tentative(s) restante(s)');
    expect(error.textContent).not.toMatch(/Fatima|Amina|Said/i);
    expect(document.getElementById('pickup-exceptional-submit').disabled).toBe(false);
  });
});
