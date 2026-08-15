'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const mockGetCurrentIdentity = jest.fn();
const mockRestoreIdentity = jest.fn();
const fs = require('fs');
const path = require('path');

jest.mock('../../js/b-identity.js', () => ({
  getCurrentIdentity: mockGetCurrentIdentity,
  restoreIdentity: mockRestoreIdentity,
}));

function mountNav() {
  document.body.innerHTML = `
    <button id="k-header-komerce-btn" aria-label="Mon Komerce">
      <span class="k-komerce-nav-label" data-default-label="Mon Komerce">Mon Komerce</span>
    </button>
    <button id="k-bnav-komerce-btn" aria-label="Mon Komerce">
      <span class="k-komerce-nav-label" data-default-label="Komerce">Komerce</span>
    </button>
  `;
}

describe('b-komerce-nav-identity', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    mountNav();
    mockGetCurrentIdentity.mockReturnValue(null);
    mockRestoreIdentity.mockResolvedValue(null);
  });

  test('reste générique sans session authentifiée', () => {
    const { renderKomerceNavIdentity } = require('../../js/b-komerce-nav-identity.js');
    renderKomerceNavIdentity(null);

    expect(document.getElementById('k-header-komerce-btn').classList.contains('is-authenticated')).toBe(false);
    expect(document.querySelector('#k-header-komerce-btn .k-komerce-nav-label').textContent).toBe('Mon Komerce');
    expect(document.querySelector('#k-bnav-komerce-btn .k-komerce-nav-label').textContent).toBe('Komerce');
  });

  test('le shell contient deux têtes neutres et le CSS bascule uniquement après authentification', () => {
    const html = fs.readFileSync(path.join(__dirname, '../../index.html'), 'utf8');
    const css = fs.readFileSync(path.join(__dirname, '../../css/layout.css'), 'utf8');

    expect((html.match(/class="k-komerce-nav-avatar"/g) || [])).toHaveLength(2);
    expect(html).not.toMatch(/data-gender|data-sex/);
    expect(css).toMatch(/\.k-komerce-nav-avatar\s*\{[^}]*display:\s*none/s);
    expect(css).toMatch(/\.is-authenticated \.k-komerce-nav-avatar\s*\{[^}]*display:\s*block/s);
  });

  test('reste robuste si un libellé de navigation manque', () => {
    document.querySelector('#k-header-komerce-btn .k-komerce-nav-label').remove();
    const { renderKomerceNavIdentity } = require('../../js/b-komerce-nav-identity.js');

    expect(() => renderKomerceNavIdentity(null)).not.toThrow();
    expect(document.getElementById('k-header-komerce-btn').getAttribute('aria-label')).toBe('Mon Komerce');
  });

  test('affiche la tête authentifiée et le prénom sur mobile et desktop', () => {
    const { renderKomerceNavIdentity } = require('../../js/b-komerce-nav-identity.js');
    renderKomerceNavIdentity({ full_name: 'Fatima Ali' });

    document.querySelectorAll('#k-header-komerce-btn, #k-bnav-komerce-btn').forEach((button) => {
      expect(button.classList.contains('is-authenticated')).toBe(true);
      expect(button.getAttribute('aria-label')).toBe('Mon Komerce — Fatima');
      expect(button.title).toBe('Fatima');
      expect(button.querySelector('.k-komerce-nav-label').textContent).toBe('Fatima');
    });
  });

  test('réagit au signal OTP et restaure la session quand le payload est absent', async () => {
    mockRestoreIdentity.mockResolvedValue({ full_name: 'Samyr Fateh' });
    const { setupKomerceNavIdentity } = require('../../js/b-komerce-nav-identity.js');
    setupKomerceNavIdentity();

    window.dispatchEvent(new CustomEvent('komerce:identity-authenticated'));
    await Promise.resolve();
    await Promise.resolve();

    expect(mockRestoreIdentity).toHaveBeenCalledTimes(1);
    expect(document.querySelector('#k-bnav-komerce-btn .k-komerce-nav-label').textContent).toBe('Samyr');

    window.dispatchEvent(new CustomEvent('komerce:identity-cleared'));
    expect(document.querySelector('#k-bnav-komerce-btn .k-komerce-nav-label').textContent).toBe('Komerce');
  });

  test('le setup est idempotent et utilise directement le détail vérifié', async () => {
    const { setupKomerceNavIdentity } = require('../../js/b-komerce-nav-identity.js');
    setupKomerceNavIdentity();
    setupKomerceNavIdentity();

    window.dispatchEvent(new CustomEvent('komerce:identity-authenticated', {
      detail: { user: { full_name: 'Amina Soilihi' } },
    }));
    await Promise.resolve();

    expect(mockRestoreIdentity).not.toHaveBeenCalled();
    expect(document.querySelector('#k-bnav-komerce-btn .k-komerce-nav-label').textContent).toBe('Amina');
  });
});
