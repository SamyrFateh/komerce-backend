/**
 * @komerce-arch
 * @role          phone-normalization-ui
 * @domain        auth
 * @layer         util-ui
 * @criticality   high
 * @inputs        country_code, local_digits, phone_input
 * @outputs       normalized_phone, e164_phone, validation_state, phone_dom
 * @depends       none
 * @used-by       b-checkout.js, b-identity.js, b-tracking.js, b-share-cart.js
 * @doctrine      phone_normalization, format_local_lisible, otp_une_fois
 * @impact-areas  otp, checkout, tracking, shared-cart-access, identity
 * @version       2026-06
 */
'use strict';

/**
 * @module b-phone
 * @brief Utilitaires téléphone partagés — indicatifs, format, validation, rendu.
 * Source de vérité unique pour tous les champs téléphone du site.
 *
 * Utilisé par : b-checkout.js, b-tracking.js
 */


// ── Table des pays ────────────────────────────────────────────────
// digits : nombre de chiffres locaux attendus (hors indicatif, hors 0 initial)
// max    : longueur max de saisie brute (inclut 0 initial pour les pays qui l'ont)
// ph     : placeholder exemple affiché dans le champ

export const PHONE_COUNTRIES = [
  { code: '+269', flag: '🇰🇲', name: 'Comores',          digits: 7,  max: 7,  ph: '321 12 34' },
  { code: '+33',  flag: '🇫🇷', name: 'France',           digits: 9,  max: 10, ph: '06 12 34 56 78' },
  { code: '+262', flag: '🇷🇪', name: 'Réunion / Mayotte',digits: 9,  max: 10, ph: '0692 12 34 56' },
  { code: '+32',  flag: '🇧🇪', name: 'Belgique',         digits: 9,  max: 10, ph: '0470 12 34 56' },
  { code: '+41',  flag: '🇨🇭', name: 'Suisse',           digits: 9,  max: 10, ph: '076 123 45 67' },
  { code: '+44',  flag: '🇬🇧', name: 'Royaume-Uni',      digits: 10, max: 11, ph: '07911 123456' },
  { code: '+1',   flag: '🇺🇸', name: 'USA / Canada',     digits: 10, max: 10, ph: '202 555 0147' },
  { code: '+971', flag: '🇦🇪', name: 'Émirats',          digits: 9,  max: 10, ph: '050 123 4567' },
  { code: '+966', flag: '🇸🇦', name: 'Arabie Saoudite',  digits: 9,  max: 10, ph: '055 123 4567' },
  { code: '+60',  flag: '🇲🇾', name: 'Malaisie',         digits: 9,  max: 10, ph: '012 345 6789' },
  { code: '+212', flag: '🇲🇦', name: 'Maroc',            digits: 9,  max: 10, ph: '0612 345678' },
];

// Identité Komerce et historique client : même défaut Comores. Les écrans
// d'expédition peuvent choisir explicitement un autre pays selon leur contexte.
export const DEFAULT_IDENTITY_PHONE_CODE = '+269';

// ── Helpers bas niveau ────────────────────────────────────────────

/** Retourne uniquement les chiffres d'une chaîne. */
export function digitsOnly(v) {
  return String(v || '').replace(/\D+/g, '');
}

/**
 * Supprime le 0 national initial pour les pays qui l'utilisent,
 * afin de construire un E.164 correct (ex: 0612345678 → 612345678 pour +33).
 */
export function normalizeLocal(code, digits) {
  const withLeadingZero = ['+33','+262','+32','+41','+44','+971','+966','+60','+212'];
  if (withLeadingZero.includes(code) && digits.startsWith('0')) {
    return digits.slice(1);
  }
  return digits;
}

/**
 * Longueur maximum visuelle autorisée dans l'input.
 * On ne peut pas faire country.max + 3 : un numéro FR complet
 * "06 12 34 56 78" contient 10 chiffres + 4 espaces = 14 caractères.
 */
function formattedMaxLength(country) {
  return Math.max(country.max + 6, String(country.ph || '').length);
}

/**
 * Formate visuellement les chiffres selon le pays (espaces, groupes).
 * Utilisé uniquement pour l'affichage dans l'input — ne pas envoyer à l'API.
 */
export function prettifyLocal(raw, country) {
  const d = digitsOnly(raw).slice(0, country.max);
  if (!d) return '';
  if (['+33','+262','+32','+41'].includes(country.code)) {
    return d.replace(/(\d{2})(?=\d)/g, '$1 ').trim();
  }
  if (country.code === '+44') {
    return d.replace(/(\d{5})(\d{0,6})/, (_, a, b) => b ? a + ' ' + b : a).trim();
  }
  if (country.code === '+1') {
    return d.replace(/(\d{3})(\d{0,3})(\d{0,4})/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join(' ')
    ).trim();
  }
  if (country.code === '+269') {
    // 321 12 34
    return d.replace(/(\d{3})(\d{0,2})(\d{0,2})/, (_, a, b, c) =>
      [a, b, c].filter(Boolean).join(' ')
    ).trim();
  }
  return d.replace(/(\d{3})(?=\d)/g, '$1 ').trim();
}

/**
 * Construit un numéro E.164 (ex : +33612345678).
 * Retourne '' si les chiffres sont vides.
 */
export function buildE164(code, raw) {
  let digits = digitsOnly(raw);
  if (!digits) return '';
  digits = normalizeLocal(code, digits);
  return code + digits;
}

/**
 * Valide qu'un numéro local a exactement le bon nombre de chiffres.
 * Retourne true si valide.
 */
export function isValidLocalLength(code, rawInput) {
  const country = PHONE_COUNTRIES.find(c => c.code === code);
  if (!country) return false;
  const digits = normalizeLocal(code, digitsOnly(rawInput));
  return digits.length === country.digits;
}

// ── Rendu d'un select indicatif ───────────────────────────────────

/**
 * Construit le <select> d'indicatifs et le branche sur l'input.
 *
 * @param {string}   selectId     - ID du <select>
 * @param {string}   inputId      - ID du <input type="tel">
 * @param {string}   defaultCode  - Indicatif pré-sélectionné (ex: '+33')
 * @param {Function} onChange     - Callback(e164: string, isValid: boolean) appelé à chaque changement
 * @returns {{ select: HTMLElement, input: HTMLElement, getValue: Function }}
 */
export function buildPhoneSelect(selectId, inputId, defaultCode, onChange) {
  // Accepte soit des IDs (string) soit des éléments DOM directement
  const sel   = typeof selectId === 'string' ? document.getElementById(selectId) : selectId;
  const input = typeof inputId  === 'string' ? document.getElementById(inputId)  : inputId;
  if (!sel || !input) return null;

  // Vider et repeupler
  sel.innerHTML = '';
  PHONE_COUNTRIES.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.flag + ' ' + c.code;
    if (c.code === defaultCode) opt.selected = true;
    sel.appendChild(opt);
  });

  function currentCountry() {
    return PHONE_COUNTRIES.find(c => c.code === sel.value) || PHONE_COUNTRIES[0];
  }

  function sync() {
    const country = currentCountry();
    input.placeholder = country.ph;
    input.maxLength   = formattedMaxLength(country);
    const raw     = digitsOnly(input.value).slice(0, country.max);
    input.value   = prettifyLocal(raw, country);
    const e164    = buildE164(country.code, raw);
    const valid   = isValidLocalLength(country.code, raw);
    if (onChange) onChange(e164, valid);
  }

  sel.addEventListener('change', () => { input.value = ''; sync(); });
  input.addEventListener('input', sync);
  input.addEventListener('blur',  sync);

  // Sync initial
  sync();

  return {
    select: sel,
    input,
    getValue: () => {
      const country = currentCountry();
      const raw     = digitsOnly(input.value);
      return buildE164(country.code, raw);
    },
    isValid: () => isValidLocalLength(sel.value, input.value),
  };
}

// ── Rendu HTML d'un bloc téléphone complet (select + input) ──────

/**
 * Génère le HTML d'un bloc indicatif + input pour les pages event (innerHTML).
 * Utilise les classes ev-phone-prefix / ev-input déjà stylées.
 *
 * @param {string} selectId
 * @param {string} inputId
 * @param {string} defaultCode  - Indicatif pré-sélectionné
 * @returns {string} HTML string
 */
export function phoneBlockHTML(selectId, inputId, defaultCode) {
  const opts = PHONE_COUNTRIES.map(c =>
    `<option value="${c.code}"${c.code === defaultCode ? ' selected' : ''}>${c.flag} ${c.code}</option>`
  ).join('');

  const country = PHONE_COUNTRIES.find(c => c.code === defaultCode) || PHONE_COUNTRIES[0];

  return `<select class="ev-phone-prefix" id="${selectId}" aria-label="Indicatif">${opts}</select>`
       + `<input type="tel" id="${inputId}" name="${inputId}" class="ev-input" `
       + `placeholder="${country.ph}" inputmode="numeric" autocomplete="tel" maxlength="${formattedMaxLength(country)}">`;
}

/**
 * Initialise la validation live sur un bloc téléphone event (après insertion dans le DOM).
 *
 * @param {string}   selectId
 * @param {string}   inputId
 * @param {Function} [onChange]  - Callback(e164, isValid)
 */
export function initEventPhoneBlock(selectId, inputId, onChange) {
  return buildPhoneSelect(selectId, inputId,
    (document.getElementById(selectId)?.value) || '+269',
    onChange
  );
}

/**
 * Lit et valide un bloc téléphone event, retourne le E.164 ou null si invalide.
 * Affiche un message d'erreur dans errEl si invalide.
 */
export function readEventPhone(selectId, inputId, errEl) {
  const sel   = document.getElementById(selectId);
  const input = document.getElementById(inputId);
  if (!sel || !input) return null;
  const rawInput = input.value.trim();
  if (!rawInput) return null; // champ vide = optionnel
  if (!isValidLocalLength(sel.value, rawInput)) {
    const country = PHONE_COUNTRIES.find(c => c.code === sel.value);
    if (errEl) errEl.textContent = `Numéro ${country ? country.name : ''} invalide (ex : ${country?.ph || ''}).`;
    return null;
  }
  return buildE164(sel.value, digitsOnly(rawInput));
}

/**
 * makeIntlPhoneInput
 *
 * Crée un bloc téléphone international stylé (sélecteur indicatif + input E.164)
 * compatible avec le checkout et la modale identité.
 *
 * Déplacé depuis b-checkout.js dans b-phone.js pour briser le cycle
 * b-checkout ↔ b-identity (feat/checkout-otp).
 * b-checkout.js ré-exporte cette fonction pour compatibilité.
 *
 * @param {string} id        - id de l'input (le select aura id+'-country')
 * @param {string} label     - Label affiché
 * @param {Object} dataObj   - Objet synchronisé avec la valeur E.164
 * @param {string} key       - Clé dans dataObj
 * @returns {HTMLElement}    - .k-ck-group prêt à insérer
 */
export function makeIntlPhoneInput(id, label, dataObj, key) {
  const group = document.createElement('div');
  group.className = 'k-ck-group';

  const lbl = document.createElement('label');
  lbl.className = 'k-ck-label';
  lbl.htmlFor = id;
  lbl.textContent = label;
  group.appendChild(lbl);

  const wrap = document.createElement('div');
  wrap.className = 'k-ck-phone-wrap';
  wrap.style.display = 'grid';
  wrap.style.gridTemplateColumns = '82px minmax(0, 1fr)';
  wrap.style.gap = '6px';
  wrap.style.alignItems = 'stretch';
  wrap.style.height = '42px';
  wrap.style.maxWidth = '100%';

  const sel = document.createElement('select');
  sel.id = id + '-country';
  sel.setAttribute('aria-label', 'Indicatif téléphonique');
  sel.className = 'k-ck-phone-select';
  sel.style.width = '82px';
  sel.style.height = '42px';
  sel.style.boxSizing = 'border-box';
  sel.style.flex = '0 0 82px';
  PHONE_COUNTRIES.forEach(function(c) {
    const opt = document.createElement('option');
    opt.value = c.code;
    opt.textContent = c.flag + ' ' + c.code;
    if (c.code === DEFAULT_IDENTITY_PHONE_CODE) opt.selected = true;
    sel.appendChild(opt);
  });

  const input = document.createElement('input');
  input.type = 'tel';
  input.id = id;
  input.inputMode = 'numeric';
  input.autocomplete = 'tel';
  input.placeholder = '321 12 34';
  input.className = 'k-ck-phone-input';
  input.style.width = '100%';
  input.style.minWidth = '0';
  input.style.height = '42px';
  input.style.boxSizing = 'border-box';
  input.style.flex = '1 1 auto';

  const help = document.createElement('div');
  help.className = 'k-ck-phone-help';
  help.textContent = '';
  help.hidden = true;
  help.style.display = 'none';

  function currentCountry() {
    return PHONE_COUNTRIES.find(c => c.code === sel.value) || PHONE_COUNTRIES[0];
  }

  function sync() {
    const country = currentCountry();
    input.placeholder = country.ph;
    input.maxLength   = formattedMaxLength(country);

    let rawDigits = digitsOnly(input.value).slice(0, country.max);
    input.value = prettifyLocal(rawDigits, country);

    const e164 = buildE164(country.code, rawDigits);
    dataObj[key] = e164 || '';

    // Validation conservée, mais pas d'annotation rouge sous le champ.
    // Le checkout garde ses propres erreurs bloquantes au moment de valider.
    help.textContent = '';
    help.hidden = true;
    help.style.display = 'none';
  }

  sel.addEventListener('change', function() {
    input.value = '';
    help.textContent = '';
    sync();
  });

  input.addEventListener('blur', sync);
  input.addEventListener('input', sync);

  if (dataObj[key]) {
    const existing = String(dataObj[key]).trim();
    const found = PHONE_COUNTRIES.find(c => existing.startsWith(c.code));
    if (found) {
      sel.value = found.code;
      const local = existing.slice(found.code.length);
      input.value = prettifyLocal(local, found);
    }
  }

  wrap.appendChild(sel);
  wrap.appendChild(input);
  group.appendChild(wrap);
  group.appendChild(help);

  sync();
  return group;
}
