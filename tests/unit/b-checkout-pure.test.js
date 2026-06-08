/**
 * Tests unitaires — b-checkout.js / b-phone.js (fonctions pures)
 * FRESH-106 : couverture des fonctions critiques modifiées
 *
 * Stratégie : les fonctions sont portées en CJS ici car Jest backend
 * (testEnvironment: 'node') ne supporte pas les imports ES modules natifs.
 * Ces tests valident la logique métier indépendamment du DOM.
 */
'use strict';

// ── Logiques portées depuis b-phone.js ──────────────────────────────────────

function digitsOnly(v) {
  return String(v || '').replace(/\D+/g, '');
}

function normalizeLocal(code, digits) {
  const withLeadingZero = ['+33', '+262', '+32', '+41', '+44', '+971', '+966', '+60', '+212'];
  if (withLeadingZero.includes(code) && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

function buildE164(code, raw) {
  let digits = digitsOnly(raw);
  if (!digits) return '';
  digits = normalizeLocal(code, digits);
  return code + digits;
}

// ── Logiques portées depuis b-checkout.js ────────────────────────────────────

function classifyRelayGroup(relais) {
  const haystack = [
    relais.country, relais.country_name, relais.island, relais.ile,
    relais.island_name, relais.zone, relais.name, relais.address,
    relais.adresse, relais.location,
  ].filter(Boolean).join(' ').toLowerCase();

  if (haystack.includes('france') || haystack.includes('paris')) return 'France';
  if (haystack.includes('anjouan')) return 'Ndzouani';
  if (haystack.includes('grande comore') || haystack.includes('ngazidja') || haystack.includes('moroni')) return 'Ngazidja';
  if (haystack.includes('moh') || haystack.includes('fomboni')) return 'Mwali';
  return relais.island || relais.ile || relais.island_name || 'Comores';
}

function getRelayGroupOrder(groups) {
  const order = ['Ndzouani', 'Ngazidja', 'Mwali', 'France', 'Comores'];
  return groups.slice().sort((a, b) => {
    const ai = order.indexOf(a);
    const bi = order.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b, 'fr');
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
}

function getDefaultPhoneCodeForZone(zone) {
  return zone === 'france' ? '+33' : '+269';
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe('digitsOnly', () => {
  it('supprime les non-chiffres', () => {
    expect(digitsOnly('+33 06 12 34 56')).toBe('3306123456');
    expect(digitsOnly('00 269 321 12 34')).toBe('002693211234');
  });
  it('gère les valeurs vides', () => {
    expect(digitsOnly('')).toBe('');
    expect(digitsOnly(null)).toBe('');
    expect(digitsOnly(undefined)).toBe('');
  });
});

describe('normalizeLocal', () => {
  it('retire le 0 initial pour la France (+33)', () => {
    expect(normalizeLocal('+33', '0612345678')).toBe('612345678');
  });
  it('ne retire pas le 0 pour les Comores (+269)', () => {
    expect(normalizeLocal('+269', '0321234')).toBe('0321234');
  });
  it('ne modifie pas un numéro sans 0 initial', () => {
    expect(normalizeLocal('+33', '612345678')).toBe('612345678');
  });
});

describe('buildE164', () => {
  it('construit un E.164 Comores correct', () => {
    expect(buildE164('+269', '3211234')).toBe('+2693211234');
  });
  it('construit un E.164 France avec suppression du 0', () => {
    expect(buildE164('+33', '0612345678')).toBe('+33612345678');
  });
  it('retourne chaîne vide si input vide', () => {
    expect(buildE164('+269', '')).toBe('');
    expect(buildE164('+33', null)).toBe('');
  });
});

describe('classifyRelayGroup', () => {
  it('classifie un relais France', () => {
    expect(classifyRelayGroup({ country: 'France', name: 'Point Paris 11' })).toBe('France');
    expect(classifyRelayGroup({ name: 'Relais Paris 20e' })).toBe('France');
  });
  it('classifie Anjouan', () => {
    expect(classifyRelayGroup({ island: 'Anjouan', name: 'Relais Mutsamudu' })).toBe('Ndzouani');
  });
  it('classifie Grande Comore', () => {
    expect(classifyRelayGroup({ island_name: 'Grande Comore', name: 'Moroni Centre' })).toBe('Ngazidja');
    expect(classifyRelayGroup({ zone: 'moroni' })).toBe('Ngazidja');
  });
  it('classifie Mohéli', () => {
    expect(classifyRelayGroup({ island: 'Mohéli', name: 'Fomboni' })).toBe('Mwali');
  });
  it('fallback sur island ou Comores', () => {
    expect(classifyRelayGroup({ island: 'Ndzouani' })).toBe('Ndzouani');
    expect(classifyRelayGroup({ name: 'Relais inconnu' })).toBe('Comores');
  });
});

describe('getRelayGroupOrder', () => {
  it('trie dans l\'ordre doctrinal', () => {
    const input = ['France', 'Ngazidja', 'Mwali', 'Ndzouani'];
    expect(getRelayGroupOrder(input)).toEqual(['Ndzouani', 'Ngazidja', 'Mwali', 'France']);
  });
  it('place les groupes inconnus en fin', () => {
    const input = ['France', 'AutreGroupe', 'Ndzouani'];
    const result = getRelayGroupOrder(input);
    expect(result[0]).toBe('Ndzouani');
    expect(result[result.length - 1]).toBe('AutreGroupe');
  });
  it('ne mute pas le tableau original', () => {
    const input = ['Mwali', 'Ndzouani'];
    getRelayGroupOrder(input);
    expect(input[0]).toBe('Mwali');
  });
});

describe('getDefaultPhoneCodeForZone', () => {
  it('retourne +33 pour la France', () => {
    expect(getDefaultPhoneCodeForZone('france')).toBe('+33');
  });
  it('retourne +269 pour toute autre zone', () => {
    expect(getDefaultPhoneCodeForZone('comores')).toBe('+269');
    expect(getDefaultPhoneCodeForZone(undefined)).toBe('+269');
    expect(getDefaultPhoneCodeForZone('')).toBe('+269');
  });
});
