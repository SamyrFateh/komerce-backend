'use strict';

/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 *
 * Remplace l'ancien tests/unit/discovery-detail.test.js (js/render/render-discovery-detail.js
 * a été fusionné dans js/b-modal-discovery-detail.js par aea829736 "unify local
 * detail in Komerce modal" ; le module et son API (openDiscoveryDetail /
 * closeDiscoveryDetail / isDetailOpen, sheet .k-discovery-detail-panel)
 * n'existent plus). Le comportement de rendu général est déjà couvert par
 * discovery-modal-detail.test.js, mais celui-ci mocke `sanitize` avec sa
 * propre implémentation d'échappement — l'échappement HTML réel des champs
 * fournis par le prestataire/utilisateur n'y est jamais vérifié avec du
 * contenu explicitement malveillant. C'est le seul trou de couverture
 * réintroduit ici, contre le vrai module fusionné.
 */

const { renderDiscoveryModalDetail, clearDiscoveryModalDetail } = require('../../js/b-modal-discovery-detail.js');

beforeEach(() => {
  document.body.innerHTML = '<div id="k-modal-discovery-detail" hidden></div>';
});

describe('renderDiscoveryModalDetail — protection XSS (contrat hérité de discovery-detail.test.js)', () => {
  it('échappe title/description/provider_name/zone pour une offre physique', () => {
    const rendered = renderDiscoveryModalDetail({
      kind: 'physical_offer',
      ref: 'o-xss',
      detail: {
        title: '<script>alert(1)</script>',
        description: '<img src=x onerror=alert(2)>',
        provider_name: '<b>evil</b>',
        zone: '<i>zone</i>',
        actions: ['request'],
      },
    });

    expect(rendered).toBe(true);
    const slot = document.getElementById('k-modal-discovery-detail');
    expect(slot.querySelector('script')).toBeNull();
    expect(slot.querySelector('img[onerror]')).toBeNull();
    expect(slot.querySelector('b')).toBeNull();
    expect(slot.querySelector('i')).toBeNull();
    // Le texte échappé reste présent tel quel (encodé), pas silencieusement supprimé.
    expect(slot.innerHTML).toContain('&lt;script&gt;');
  });

  it('échappe les mêmes champs pour un service', () => {
    renderDiscoveryModalDetail({
      kind: 'service',
      ref: 's-xss',
      detail: {
        title: '<script>alert(1)</script>',
        provider_name: '<b>evil</b>',
        zone: '<i>zone</i>',
        actions: ['request'],
      },
    });

    const slot = document.getElementById('k-modal-discovery-detail');
    expect(slot.querySelector('script')).toBeNull();
    expect(slot.querySelector('b')).toBeNull();
    expect(slot.querySelector('i')).toBeNull();
  });

  it('échappe image_ref (attribut src/alt) sans casser le rendu', () => {
    renderDiscoveryModalDetail({
      kind: 'physical_offer',
      ref: 'o-xss-img',
      detail: {
        title: 'Produit',
        image_ref: '"><script>alert(3)</script>',
        actions: ['request'],
      },
    });

    const slot = document.getElementById('k-modal-discovery-detail');
    expect(slot.querySelector('script')).toBeNull();
  });

  it('clearDiscoveryModalDetail vide bien le slot après un rendu malveillant', () => {
    renderDiscoveryModalDetail({
      kind: 'service',
      ref: 's-clear',
      detail: { title: '<script>alert(4)</script>', actions: ['request'] },
    });
    clearDiscoveryModalDetail();
    const slot = document.getElementById('k-modal-discovery-detail');
    expect(slot.innerHTML).toBe('');
    expect(slot.hidden).toBe(true);
  });
});
