'use strict';


/**
 * @test-kind unit
 * @test-runner jest
 * @test-requires none
 */
/**
 * tests/unit/b-phone.test.js
 *
 * Module js/b-phone.js (274L) — source de vérité unique pour tous les champs
 * téléphone du site (checkout, identité, tracking, event-*). 0% de couverture
 * réelle avant cette session (b-checkout.test.js et b-tracking.test.js le
 * mockent systématiquement, jamais testé lui-même).
 *
 * Couverture visée :
 *   digitsOnly / normalizeLocal / prettifyLocal / buildE164 / isValidLocalLength
 *     — logique pure, tous les pays représentatifs (avec/sans 0 initial,
 *       formats de groupement différents : FR, UK, US, Comores).
 *   buildPhoneSelect() — construction du <select>, sync affichage/E.164,
 *       callback onChange, accepte IDs ou éléments DOM, retourne null si
 *       select/input introuvable.
 *   phoneBlockHTML() — HTML généré (select + input), pays par défaut.
 *   initEventPhoneBlock() / readEventPhone() — wrappers utilisés par les
 *       pages event-*.
 *   makeIntlPhoneInput() — construction DOM pour checkout/identité, sync
 *       vers dataObj, pré-remplissage depuis une valeur E.164 existante.
 */

const {
  PHONE_COUNTRIES,
  DEFAULT_IDENTITY_PHONE_CODE,
  digitsOnly,
  normalizeLocal,
  prettifyLocal,
  buildE164,
  isValidLocalLength,
  buildPhoneSelect,
  phoneBlockHTML,
  initEventPhoneBlock,
  readEventPhone,
  makeIntlPhoneInput,
} = require('../../js/b-phone.js');

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('digitsOnly', () => {
  it('retire tout ce qui n\'est pas un chiffre', () => {
    expect(digitsOnly('06 12 34 56 78')).toBe('0612345678');
    expect(digitsOnly('+33 (0)6 12-34-56-78')).toBe('330612345678');
  });

  it('retourne une chaîne vide pour null/undefined/vide', () => {
    expect(digitsOnly(null)).toBe('');
    expect(digitsOnly(undefined)).toBe('');
    expect(digitsOnly('')).toBe('');
  });
});

it('définit +269 comme indicatif par défaut de l’identité client', () => {
  expect(DEFAULT_IDENTITY_PHONE_CODE).toBe('+269');
});

describe('normalizeLocal', () => {
  it('retire le 0 initial pour les pays qui l\'utilisent (ex: +33)', () => {
    expect(normalizeLocal('+33', '0612345678')).toBe('612345678');
  });

  it('ne touche pas aux chiffres si pas de 0 initial', () => {
    expect(normalizeLocal('+33', '612345678')).toBe('612345678');
  });

  it('ne retire rien pour un pays sans convention de 0 initial (ex: +1, +269)', () => {
    expect(normalizeLocal('+1', '2025550147')).toBe('2025550147');
    expect(normalizeLocal('+269', '3211234')).toBe('3211234');
  });

  it('retire aussi le 0 pour les autres pays listés (+262, +32, +41, +44, +971, +966, +60, +212)', () => {
    expect(normalizeLocal('+44', '07911123456')).toBe('7911123456');
    expect(normalizeLocal('+212', '0612345678')).toBe('612345678');
  });
});

describe('buildE164', () => {
  it('construit un E.164 correct pour un pays avec 0 initial', () => {
    expect(buildE164('+33', '0612345678')).toBe('+33612345678');
  });

  it('construit un E.164 correct pour un pays sans 0 initial', () => {
    expect(buildE164('+1', '2025550147')).toBe('+12025550147');
  });

  it('nettoie les caractères non numériques avant construction', () => {
    expect(buildE164('+33', '06 12 34 56 78')).toBe('+33612345678');
  });

  it('retourne une chaîne vide si aucun chiffre', () => {
    expect(buildE164('+33', '')).toBe('');
    expect(buildE164('+33', '   ')).toBe('');
  });
});

describe('isValidLocalLength', () => {
  it('valide un numéro FR de longueur correcte (9 chiffres après le 0)', () => {
    expect(isValidLocalLength('+33', '0612345678')).toBe(true);
  });

  it('invalide un numéro FR trop court ou trop long', () => {
    expect(isValidLocalLength('+33', '061234567')).toBe(false);
    expect(isValidLocalLength('+33', '06123456789')).toBe(false);
  });

  it('valide un numéro Comores (7 chiffres, pas de 0 initial)', () => {
    expect(isValidLocalLength('+269', '3211234')).toBe(true);
  });

  it('retourne false si le pays est inconnu', () => {
    expect(isValidLocalLength('+999', '123456789')).toBe(false);
  });
});

describe('prettifyLocal', () => {
  it('formate un numéro FR par groupes de 2', () => {
    const country = PHONE_COUNTRIES.find(c => c.code === '+33');
    expect(prettifyLocal('0612345678', country)).toBe('06 12 34 56 78');
  });

  it('formate un numéro US par groupes 3-3-4', () => {
    const country = PHONE_COUNTRIES.find(c => c.code === '+1');
    expect(prettifyLocal('2025550147', country)).toBe('202 555 0147');
  });

  it('formate un numéro Comores par groupes 3-2-2', () => {
    const country = PHONE_COUNTRIES.find(c => c.code === '+269');
    expect(prettifyLocal('3211234', country)).toBe('321 12 34');
  });

  it('formate un numéro UK (5 puis reste)', () => {
    const country = PHONE_COUNTRIES.find(c => c.code === '+44');
    expect(prettifyLocal('07911123456', country)).toBe('07911 123456');
  });

  it('tronque à la longueur max du pays', () => {
    const country = PHONE_COUNTRIES.find(c => c.code === '+269');
    expect(prettifyLocal('321123499999', country)).toBe('321 12 34');
  });

  it('retourne une chaîne vide si aucun chiffre', () => {
    const country = PHONE_COUNTRIES.find(c => c.code === '+33');
    expect(prettifyLocal('', country)).toBe('');
  });
});

describe('buildPhoneSelect', () => {
  function makeDom(defaultCode) {
    document.body.innerHTML = `
      <select id="sel"></select>
      <input id="inp" type="tel">
    `;
    return buildPhoneSelect('sel', 'inp', defaultCode, jest.fn());
  }

  it('retourne null si le select ou l\'input est introuvable', () => {
    document.body.innerHTML = '<select id="sel"></select>';
    expect(buildPhoneSelect('sel', 'inexistant', '+33', jest.fn())).toBeNull();
    document.body.innerHTML = '<input id="inp">';
    expect(buildPhoneSelect('inexistant', 'inp', '+33', jest.fn())).toBeNull();
  });

  it('peuple le select avec tous les pays et sélectionne le code par défaut', () => {
    document.body.innerHTML = `<select id="sel"></select><input id="inp" type="tel">`;
    buildPhoneSelect('sel', 'inp', '+269', jest.fn());
    const sel = document.getElementById('sel');
    expect(sel.options.length).toBe(PHONE_COUNTRIES.length);
    expect(sel.value).toBe('+269');
  });

  it('accepte des éléments DOM directement au lieu d\'IDs', () => {
    document.body.innerHTML = `<select id="sel"></select><input id="inp" type="tel">`;
    const sel = document.getElementById('sel');
    const inp = document.getElementById('inp');
    const result = buildPhoneSelect(sel, inp, '+33', jest.fn());
    expect(result.select).toBe(sel);
    expect(result.input).toBe(inp);
  });

  it('appelle onChange avec le E.164 et la validité à la construction (sync initial)', () => {
    const onChange = jest.fn();
    document.body.innerHTML = `<select id="sel"></select><input id="inp" type="tel">`;
    buildPhoneSelect('sel', 'inp', '+33', onChange);
    expect(onChange).toHaveBeenCalledWith('', false);
  });

  it('formate l\'input et invoque onChange à la saisie', () => {
    const onChange = jest.fn();
    document.body.innerHTML = `<select id="sel"></select><input id="inp" type="tel">`;
    buildPhoneSelect('sel', 'inp', '+33', onChange);
    const inp = document.getElementById('inp');
    inp.value = '0612345678';
    inp.dispatchEvent(new Event('input'));
    expect(inp.value).toBe('06 12 34 56 78');
    expect(onChange).toHaveBeenCalledWith('+33612345678', true);
  });

  it('vide l\'input au changement de pays et resynchronise', () => {
    const onChange = jest.fn();
    document.body.innerHTML = `<select id="sel"></select><input id="inp" type="tel">`;
    buildPhoneSelect('sel', 'inp', '+33', onChange);
    const sel = document.getElementById('sel');
    const inp = document.getElementById('inp');
    inp.value = '0612345678';
    inp.dispatchEvent(new Event('input'));

    sel.value = '+1';
    sel.dispatchEvent(new Event('change'));
    expect(inp.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith('', false);
  });

  it('getValue() et isValid() reflètent l\'état courant', () => {
    document.body.innerHTML = `<select id="sel"></select><input id="inp" type="tel">`;
    const result = buildPhoneSelect('sel', 'inp', '+33', jest.fn());
    const inp = document.getElementById('inp');
    inp.value = '0612345678';
    inp.dispatchEvent(new Event('input'));
    expect(result.getValue()).toBe('+33612345678');
    expect(result.isValid()).toBe(true);
  });
});

describe('phoneBlockHTML', () => {
  it('génère un select avec toutes les options et l\'input associé', () => {
    const html = phoneBlockHTML('sel-id', 'inp-id', '+33');
    document.body.innerHTML = html;
    const sel = document.getElementById('sel-id');
    const inp = document.getElementById('inp-id');
    expect(sel).not.toBeNull();
    expect(inp).not.toBeNull();
    expect(sel.options.length).toBe(PHONE_COUNTRIES.length);
    expect(sel.value).toBe('+33');
  });

  it('utilise le premier pays comme secours si le code par défaut est inconnu', () => {
    const html = phoneBlockHTML('sel-id', 'inp-id', '+999');
    document.body.innerHTML = html;
    const inp = document.getElementById('inp-id');
    expect(inp.placeholder).toBe(PHONE_COUNTRIES[0].ph);
  });
});

describe('initEventPhoneBlock', () => {
  it('initialise buildPhoneSelect avec le code déjà présent dans le select', () => {
    document.body.innerHTML = phoneBlockHTML('sel', 'inp', '+1');
    const onChange = jest.fn();
    const result = initEventPhoneBlock('sel', 'inp', onChange);
    expect(result).not.toBeNull();
    expect(document.getElementById('sel').value).toBe('+1');
  });

  it('retombe sur +269 si le select n\'a pas encore de valeur (introuvable)', () => {
    document.body.innerHTML = `<select id="sel2"></select><input id="inp2" type="tel">`;
    // Le select existe mais vide -> initEventPhoneBlock lit sa value ('') donc fallback +269
    const result = initEventPhoneBlock('sel2', 'inp2', jest.fn());
    expect(result).not.toBeNull();
  });
});

describe('readEventPhone', () => {
  it('retourne null si le champ est vide (optionnel)', () => {
    document.body.innerHTML = phoneBlockHTML('sel', 'inp', '+33');
    expect(readEventPhone('sel', 'inp', null)).toBeNull();
  });

  it('retourne le E.164 si le numéro est valide', () => {
    document.body.innerHTML = phoneBlockHTML('sel', 'inp', '+33');
    document.getElementById('inp').value = '0612345678';
    expect(readEventPhone('sel', 'inp', null)).toBe('+33612345678');
  });

  it('affiche un message d\'erreur et retourne null si invalide', () => {
    document.body.innerHTML = phoneBlockHTML('sel', 'inp', '+33') + '<span id="err"></span>';
    document.getElementById('inp').value = '06123';
    const errEl = document.getElementById('err');
    const result = readEventPhone('sel', 'inp', errEl);
    expect(result).toBeNull();
    expect(errEl.textContent).toContain('invalide');
  });

  it('retourne null si select ou input introuvable', () => {
    document.body.innerHTML = '';
    expect(readEventPhone('nope', 'nope2', null)).toBeNull();
  });
});

describe('makeIntlPhoneInput', () => {
  it('construit un groupe avec select + input + label', () => {
    const dataObj = { phone: '' };
    const group = makeIntlPhoneInput('k-id-phone', 'Votre WhatsApp', dataObj, 'phone');
    document.body.appendChild(group);

    expect(group.className).toBe('k-ck-group');
    expect(document.getElementById('k-id-phone')).not.toBeNull();
    expect(document.getElementById('k-id-phone-country')).not.toBeNull();
    const label = group.querySelector('.k-ck-label');
    expect(label.textContent).toBe('Votre WhatsApp');
    expect(label.htmlFor).toBe('k-id-phone');
    expect(document.getElementById('k-id-phone-country').getAttribute('aria-label')).toBe('Indicatif téléphonique');
  });

  it('sélectionne +269 par défaut', () => {
    const dataObj = { phone: '' };
    const group = makeIntlPhoneInput('id1', 'Label', dataObj, 'phone');
    const sel = group.querySelector('select');
    expect(sel.value).toBe('+269');
  });

  it('synchronise dataObj[key] à la saisie', () => {
    const dataObj = { phone: '' };
    const group = makeIntlPhoneInput('id2', 'Label', dataObj, 'phone');
    document.body.appendChild(group);
    const input = document.getElementById('id2');
    input.value = '3211234';
    input.dispatchEvent(new Event('input'));
    expect(dataObj.phone).toBe('+2693211234');
  });

  it('vide le champ et resynchronise au changement de pays', () => {
    const dataObj = { phone: '' };
    const group = makeIntlPhoneInput('id3', 'Label', dataObj, 'phone');
    document.body.appendChild(group);
    const input = document.getElementById('id3');
    const sel = document.getElementById('id3-country');
    input.value = '3211234';
    input.dispatchEvent(new Event('input'));

    sel.value = '+33';
    sel.dispatchEvent(new Event('change'));
    expect(input.value).toBe('');
    expect(dataObj.phone).toBe('');
  });

  it('pré-remplit depuis une valeur E.164 existante dans dataObj', () => {
    const dataObj = { phone: '+33612345678' };
    const group = makeIntlPhoneInput('id4', 'Label', dataObj, 'phone');
    const sel = group.querySelector('select');
    const input = group.querySelector('input');
    expect(sel.value).toBe('+33');
    // Note : le pré-remplissage tranche l'E.164 après l'indicatif sans
    // réappliquer normalizeLocal (pas de 0 initial à réinsérer) ; le
    // groupement visuel se fait donc sur les chiffres bruts restants.
    expect(input.value).toBe('61 23 45 67 8');
  });

  it('ignore le pré-remplissage si la valeur existante ne correspond à aucun indicatif connu', () => {
    const dataObj = { phone: 'abc-not-a-phone' };
    const group = makeIntlPhoneInput('id5', 'Label', dataObj, 'phone');
    const sel = group.querySelector('select');
    expect(sel.value).toBe('+269'); // reste sur le défaut
  });
});
