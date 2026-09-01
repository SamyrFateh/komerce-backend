'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */

const {
  openDiscoveryDetail,
  closeDiscoveryDetail,
  isDetailOpen,
} = require('../../js/render/render-discovery-detail.js');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('openDiscoveryDetail', () => {
  it('creates a detail sheet with title, description, provider, and CTA', () => {
    openDiscoveryDetail({
      id: 's-1',
      kind: 'service',
      title: 'Installation climatiseur',
      description: 'Pose et mise en service',
      zone: 'Mutsamudu',
      provider_name: 'Bâtir Anjouan',
      image_ref: '/images/install.webp',
    });

    expect(isDetailOpen()).toBe(true);
    const panel = document.querySelector('.k-discovery-detail-panel');
    expect(panel).not.toBeNull();
    expect(panel.textContent).toContain('Installation climatiseur');
    expect(panel.textContent).toContain('Bâtir Anjouan');
    expect(panel.textContent).toContain('Mutsamudu');
    expect(panel.textContent).toContain('Pose et mise en service');
    expect(panel.textContent).toContain('Sur demande');
    expect(panel.querySelector('.k-discovery-detail-cta').textContent).toBe('Demander');
    expect(panel.querySelector('.k-discovery-detail-cta').dataset.discoveryAction).toBe('service');
    expect(panel.querySelector('.k-discovery-detail-cta').dataset.discoveryRef).toBe('s-1');
    expect(panel.querySelector('.k-discovery-detail-img').src).toContain('/images/install.webp');
  });

  it('shows Commander for physical_offer', () => {
    openDiscoveryDetail({
      id: 'o-1',
      kind: 'physical_offer',
      title: 'Samboussas mariage',
      provider_name: 'Fatima Traiteur',
    });

    expect(document.querySelector('.k-discovery-detail-cta').textContent).toBe('Commander');
    expect(document.querySelector('.k-discovery-detail-badge').textContent).toContain('Préparation sur commande');
  });

  it('returns null and does not open if detail is missing id or title', () => {
    expect(openDiscoveryDetail(null)).toBeNull();
    expect(openDiscoveryDetail({ id: 'x' })).toBeNull();
    expect(isDetailOpen()).toBe(false);
  });

  it('closes previous sheet when opening a new one', () => {
    openDiscoveryDetail({ id: 's-1', kind: 'service', title: 'First' });
    openDiscoveryDetail({ id: 's-2', kind: 'service', title: 'Second' });

    expect(document.querySelectorAll('#k-discovery-detail-sheet')).toHaveLength(1);
    expect(document.querySelector('.k-discovery-detail-title').textContent).toBe('Second');
  });
});

describe('closeDiscoveryDetail', () => {
  it('removes the sheet from the DOM', () => {
    openDiscoveryDetail({ id: 's-1', kind: 'service', title: 'Test' });
    expect(isDetailOpen()).toBe(true);
    closeDiscoveryDetail();
    expect(isDetailOpen()).toBe(false);
    expect(document.getElementById('k-discovery-detail-sheet')).toBeNull();
  });

  it('is safe to call when no sheet is open', () => {
    expect(() => closeDiscoveryDetail()).not.toThrow();
  });
});

describe('XSS protection', () => {
  it('escapes all user-provided fields', () => {
    openDiscoveryDetail({
      id: 's-xss',
      kind: 'service',
      title: '<script>alert(1)</script>',
      description: '<img src=x onerror=alert(2)>',
      provider_name: '<b>evil</b>',
      zone: '<i>zone</i>',
    });

    expect(document.querySelector('script')).toBeNull();
    expect(document.querySelector('img.k-discovery-detail-img')).toBeNull();
    expect(document.querySelector('b')).toBeNull();
    expect(document.querySelector('i')).toBeNull();
  });
});
