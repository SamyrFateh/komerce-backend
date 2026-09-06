#!/usr/bin/env node
'use strict';

const fs = require('fs');

function replaceOnce(source, needle, replacement, label) {
  const idx = source.indexOf(needle);
  if (idx < 0) throw new Error(`Missing patch anchor: ${label}`);
  if (source.indexOf(needle, idx + needle.length) >= 0) throw new Error(`Non-unique patch anchor: ${label}`);
  return source.slice(0, idx) + replacement + source.slice(idx + needle.length);
}

function replaceFunction(source, name, nextSource) {
  const marker = `function ${name}(`;
  const start = source.indexOf(marker);
  if (start < 0) throw new Error(`Function not found: ${name}`);
  const brace = source.indexOf('{', start);
  if (brace < 0) throw new Error(`Opening brace not found: ${name}`);
  let depth = 0;
  let quote = null;
  let escape = false;
  let lineComment = false;
  let blockComment = false;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    const next = source[i + 1];
    if (lineComment) { if (ch === '\n') lineComment = false; continue; }
    if (blockComment) { if (ch === '*' && next === '/') { blockComment = false; i++; } continue; }
    if (quote) {
      if (escape) { escape = false; continue; }
      if (ch === '\\') { escape = true; continue; }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '/' && next === '/') { lineComment = true; i++; continue; }
    if (ch === '/' && next === '*') { blockComment = true; i++; continue; }
    if (ch === "'" || ch === '"' || ch === '`') { quote = ch; continue; }
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        return source.slice(0, start) + nextSource.trimEnd() + source.slice(i + 1);
      }
    }
  }
  throw new Error(`Closing brace not found: ${name}`);
}

let impact = fs.readFileSync('scripts/impact-check.js', 'utf8');

impact = replaceOnce(
  impact,
  "    case 'xss': {\n      if (!/innerHTML\\s*\\+?=/.test(L)) return false;       // autres patterns (document.write/res.send) : garder",
  "    case 'xss': {\n      // Convention sûre : staticHtml(target)`...` refuse toute substitution et\n      // n'injecte que le segment littéral strings[0] dans un <template>.\n      if (/template\\.innerHTML\\s*=\\s*strings\\[0\\]/.test(L)\n          && /Array\\.isArray\\(strings\\?\\.raw\\)/.test(content)\n          && /values\\.length\\s*!==\\s*0/.test(content)\n          && /substitution-free tagged templates/.test(content)) return true;\n      if (!/innerHTML\\s*\\+?=/.test(L)) return false;       // autres patterns (document.write/res.send) : garder",
  'xss staticHtml convention'
);

impact = replaceOnce(
  impact,
  "    case 'hardcodedSecrets': {\n      const m = L.match(/(?:password|passwd|secret|key|token|api[_-]?key|apikey)\\s*[:=]\\s*['\"]([^'\"]+)['\"]/i);\n      if (!m) return false;                                // patterns STRIPE_/Bearer : garder",
  "    case 'hardcodedSecrets': {\n      const m = L.match(/(?:password|passwd|secret|key|token|api[_-]?key|apikey)\\s*[:=]\\s*['\"]([^'\"]+)['\"]/i);\n      // Le pattern d'env est scanné en /i pour les autres catégories : un identifiant\n      // de données comme sms_log / stripe_events_processed ne doit pas devenir un secret.\n      // Si le nom contient réellement password/secret/key/token/api_key, `m` reste prioritaire.\n      if (!m && /\\b(?:sms|stripe|jwt|db|smtp)_[a-z0-9_]+\\s*[:=]\\s*['\"][^'\"]+['\"]/.test(L)\n          && !/\\b(?:SMS|STRIPE|JWT|DB|SMTP)_[A-Z0-9_]+\\s*[:=]/.test(L)) return true;\n      if (!m) return false;                                // vrais patterns STRIPE_/Bearer : garder",
  'lowercase env-prefix false positives'
);

impact = replaceOnce(
  impact,
  "  for (const [category, config] of Object.entries(CONFIG.securityPatterns)) {\n    for (const pattern of config.patterns) {",
  "  for (const [category, config] of Object.entries(CONFIG.securityPatterns)) {\n    // XSS est un risque d'exécution navigateur. Les fixtures Jest ne sont jamais servies\n    // en production ; on continue en revanche à y scanner secrets et opérations dangereuses.\n    const normalizedFile = String(filePath).replace(/\\\\/g, '/');\n    if (category === 'xss' && /(?:^|\\/)tests\\//.test(normalizedFile)) continue;\n    for (const pattern of config.patterns) {",
  'runtime xss scope'
);

fs.writeFileSync('scripts/impact-check.js', impact);

let komerce = fs.readFileSync('public/boutique/js/b-komerce.js', 'utf8');
const helperAnchor = "function fmtDateFr(iso) {\n  if (!iso) return null;\n  try {\n    const raw = String(iso);\n    const d = new Date(/^\\d{4}-\\d{2}-\\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw);\n    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });\n  } catch (_) { return null; }\n}\n";
const helper = helperAnchor + "\n// Rendu HTML réservé aux templates littéraux sans aucune substitution dynamique.\n// Les données runtime sont toujours posées ensuite via textContent/value/hidden.\nfunction staticHtml(target) {\n  return (strings, ...values) => {\n    if (!target) return;\n    if (!Array.isArray(strings?.raw) || values.length !== 0) {\n      throw new TypeError('staticHtml accepts only substitution-free tagged templates');\n    }\n    const template = document.createElement('template');\n    template.innerHTML = strings[0];\n    target.replaceChildren(template.content.cloneNode(true));\n  };\n}\n";
komerce = replaceOnce(komerce, helperAnchor, helper, 'staticHtml helper');

komerce = replaceFunction(komerce, 'ensureShell', `function ensureShell() {
  let el = document.getElementById('k-komerce-view');
  if (el) return el;

  el = document.createElement('div');
  el.id = 'k-komerce-view';
  el.className = 'k-komerce-view';
  el.setAttribute('role', 'main');
  el.setAttribute('aria-label', 'Mon Komerce');
  staticHtml(el)\`
    <header class="k-kmc-header">
      <h2 class="k-kmc-title">Mon Komerce</h2>
      <p class="k-kmc-subtitle">Compte personnel protégé</p>
    </header>
    <div class="k-kmc-page-grid">
      <div class="k-kmc-col-primary">
        <section id="k-kmc-documents-block" class="k-kmc-block" aria-label="Mes documents"></section>
        <section id="k-kmc-wallet-block" class="k-kmc-block k-kmc-block--compact" aria-label="Mon wallet"></section>
      </div>
      <div class="k-kmc-col-secondary">
        <section id="k-kmc-profile-block" class="k-kmc-block" aria-label="Mon profil"></section>
        <section id="k-kmc-security-block" class="k-kmc-block" aria-label="Retrait et sécurité"></section>
      </div>
    </div>
  \`;

  const anchor = document.getElementById('k-track-view')
    || document.getElementById('k-fav-view')
    || document.getElementById('k-catalog-section');
  if (anchor) anchor.after(el);
  else document.body.appendChild(el);

  return el;
}`);

komerce = replaceFunction(komerce, 'renderBlockLoading', `function renderBlockLoading(block) {
  staticHtml(block)\`
    <div class="k-kmc-loading">
      <div class="k-kmc-spin"></div>
      <p>Chargement…</p>
    </div>
  \`;
}`);

komerce = replaceFunction(komerce, 'renderBlockError', `function renderBlockError(block, err, onRetry) {
  const isTimeout = !!(err && (err.isTimeout || err.name === 'TimeoutError'));
  staticHtml(block)\`
    <div class="k-kmc-empty">
      <div class="k-kmc-empty-icon">⚠️</div>
      <div class="k-kmc-empty-title"></div>
      <div class="k-kmc-empty-sub">Vérifiez votre connexion puis réessayez.</div>
      <button class="k-kmc-action-btn" id="k-kmc-retry">🔄 Réessayer</button>
    </div>
  \`;
  const title = block.querySelector('.k-kmc-empty-title');
  if (title) title.textContent = isTimeout ? 'Cela met trop de temps à répondre' : 'Impossible de charger';
  block.querySelector('#k-kmc-retry')?.addEventListener('click', onRetry);
}`);

komerce = replaceFunction(komerce, 'renderSessionExpired', `function renderSessionExpired() {
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const documentsBlock = document.getElementById('k-kmc-documents-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  [walletBlock, documentsBlock, profileBlock, secBlock].forEach(b => { if (b) b.replaceChildren(); });
  if (walletBlock) {
    staticHtml(walletBlock)\`
      <div class="k-kmc-empty">
        <div class="k-kmc-empty-icon">🔐</div>
        <div class="k-kmc-empty-title">Session expirée</div>
        <div class="k-kmc-empty-sub">Confirmez votre numéro WhatsApp pour continuer.</div>
        <button class="k-kmc-action-btn" id="k-kmc-reauth">📲 M’identifier</button>
      </div>
    \`;
    walletBlock.querySelector('#k-kmc-reauth')?.addEventListener('click', async () => {
      const btn = walletBlock.querySelector('#k-kmc-reauth');
      btn.disabled = true;
      btn.textContent = '⏳ Identification…';
      const user = await requireIdentity({ reason: 'mon-komerce', title: 'Mon Komerce' });
      if (user) _loadAndRender(++_renderSeq);
      else { btn.disabled = false; btn.textContent = '📲 M’identifier'; }
    });
  }
}`);

komerce = replaceFunction(komerce, 'renderIdentityRequired', `function renderIdentityRequired({ focus = null } = {}) {
  const documentsBlock = document.getElementById('k-kmc-documents-block');
  const walletBlock  = document.getElementById('k-kmc-wallet-block');
  const profileBlock = document.getElementById('k-kmc-profile-block');
  const secBlock     = document.getElementById('k-kmc-security-block');
  const blocks = [documentsBlock, walletBlock, profileBlock, secBlock];

  blocks.forEach((block) => {
    if (!block) return;
    block.replaceChildren();
    block.hidden = block !== documentsBlock;
  });

  if (!documentsBlock) return;
  staticHtml(documentsBlock)\`
    <div class="k-kmc-empty">
      <div class="k-kmc-empty-icon">🔐</div>
      <div class="k-kmc-empty-title">Identifiez-vous pour accéder à Mon Komerce</div>
      <div class="k-kmc-empty-sub">Retrouvez vos documents, votre wallet et vos informations personnelles.</div>
      <button class="k-kmc-action-btn" id="k-kmc-identify">M’identifier</button>
    </div>
  \`;

  documentsBlock.querySelector('#k-kmc-identify')?.addEventListener('click', async () => {
    const btn = documentsBlock.querySelector('#k-kmc-identify');
    if (!btn || btn.disabled) return;
    btn.disabled = true;
    btn.textContent = '⏳ Identification…';

    const user = await requireIdentity({ reason: 'mon-komerce', title: 'Accéder à Mon Komerce' });
    if (user) {
      _loadAndRender(++_renderSeq);
      focusRequestedBlock(focus);
      return;
    }

    btn.disabled = false;
    btn.textContent = 'M’identifier';
  });
}`);

komerce = replaceFunction(komerce, 'renderProfileBlock', `function renderProfileBlock(block, me) {
  const phone     = maskPhone(me?.phone);
  const fullName0 = me?.full_name || '';
  const currency0 = me?.currency_pref === 'EUR' ? 'EUR' : 'KMF';

  staticHtml(block)\`
    <form class="k-kmc-form" id="k-kmc-profile-form" novalidate>
      <h3 class="k-kmc-block-title">Mon profil</h3>
      <label class="k-kmc-field">
        <span>Nom complet</span>
        <input type="text" id="k-kmc-fullname" maxlength="100" autocomplete="name">
      </label>
      <label class="k-kmc-field k-kmc-field--readonly" id="k-kmc-email-field">
        <span>Email</span>
        <input type="text" id="k-kmc-email" disabled aria-readonly="true">
      </label>
      <label class="k-kmc-field k-kmc-field--readonly">
        <span>WhatsApp du compte</span>
        <input type="text" id="k-kmc-account-phone" disabled aria-readonly="true">
      </label>
      <p class="k-kmc-field-hint">Le WhatsApp du compte ne se modifie pas ici — il se confirme par code lors d’une prochaine commande.</p>
      <label class="k-kmc-field">
        <span>Devise d’affichage</span>
        <select id="k-kmc-currency">
          <option value="KMF">Franc comorien (KMF)</option>
          <option value="EUR">Euro (EUR)</option>
        </select>
      </label>
      <p class="k-kmc-save-status" id="k-kmc-save-status" role="status" aria-live="polite"></p>
      <button type="submit" class="k-kmc-action-btn" id="k-kmc-profile-save" disabled>Enregistrer mes modifications</button>
    </form>
  \`;

  const form      = block.querySelector('#k-kmc-profile-form');
  const nameInput = block.querySelector('#k-kmc-fullname');
  const curSelect = block.querySelector('#k-kmc-currency');
  const saveBtn   = block.querySelector('#k-kmc-profile-save');
  const status    = block.querySelector('#k-kmc-save-status');
  const emailField = block.querySelector('#k-kmc-email-field');
  const emailInput = block.querySelector('#k-kmc-email');
  const phoneInput = block.querySelector('#k-kmc-account-phone');

  nameInput.value = String(fullName0);
  if (emailField) emailField.hidden = !me?.email;
  if (emailInput) emailInput.value = String(me?.email || '');
  if (phoneInput) phoneInput.value = phone || '—';
  curSelect.value = currency0;

  let pendingSubmit = false;

  function checkDirty() {
    const dirty = nameInput.value.trim() !== fullName0 || curSelect.value !== currency0;
    saveBtn.disabled = !dirty || pendingSubmit;
  }

  nameInput.addEventListener('input', checkDirty);
  curSelect.addEventListener('change', checkDirty);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (pendingSubmit || saveBtn.disabled) return;
    const newName     = nameInput.value.trim();
    const newCurrency = curSelect.value;
    if (!newName) { nameInput.focus(); return; }

    pendingSubmit = true;
    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement…';
    status.textContent = '';

    try {
      await apiPut('/api/auth/me', { full_name: newName, currency_pref: newCurrency });
      status.textContent = '✅ Enregistré';
    } catch (_) {
      status.textContent = '⚠️ Échec — réessayez';
      saveBtn.disabled = false;
    } finally {
      pendingSubmit = false;
      saveBtn.textContent = 'Enregistrer mes modifications';
      checkDirty();
    }
  });
}`);

komerce = replaceFunction(komerce, 'renderSecurityBlock', `function renderSecurityBlock(block, me) {
  const phone = maskPhone(me?.phone);
  staticHtml(block)\`
    <div class="k-kmc-security">
      <h3 class="k-kmc-block-title">Retrait &amp; sécurité</h3>
      <div class="k-kmc-sec-row">
        <span class="k-kmc-sec-label">WhatsApp du compte</span>
        <span class="k-kmc-sec-value" id="k-kmc-security-phone"></span>
      </div>
      <div class="k-kmc-auth-block" id="k-kmc-passkeys-block">
        <h4 class="k-kmc-auth-title">Moyens de connexion</h4>
        <p class="k-kmc-field-hint">Vos passkeys permettent de vous connecter sans code WhatsApp. Révoquez uniquement un appareil que vous ne souhaitez plus autoriser.</p>
        <div id="k-kmc-passkeys-content"></div>
      </div>
      <div class="k-kmc-sec-doctrine">
        <p>Le code de retrait est envoyé sur votre WhatsApp lorsque votre commande est prête au relais. Vous pouvez le transmettre à la personne de votre choix.</p>
        <p>Ce code est personnel et unique à chaque commande : ne le partagez qu’avec la personne qui viendra récupérer votre colis.</p>
      </div>
      <div class="k-kmc-auth-block" id="k-kmc-auth-block">
        <h4 class="k-kmc-auth-title">Autorisation de retrait exceptionnel</h4>
        <p class="k-kmc-field-hint">Si le code n’a pas été reçu ou transmis, vous pouvez autoriser nommément une personne — l’agent relais contrôlera sa pièce d’identité et comparera le nom, sans jamais connaître à l’avance le nom attendu.</p>
        <div id="k-kmc-auth-content"></div>
      </div>
    </div>
  \`;
  const phoneValue = block.querySelector('#k-kmc-security-phone');
  if (phoneValue) phoneValue.textContent = phone || '—';

  loadPasskeySecurity(block.querySelector('#k-kmc-passkeys-content'));
  _loadAuthSection(block.querySelector('#k-kmc-auth-content'));
}`);

komerce = replaceFunction(komerce, '_renderAuthActive', `function _renderAuthActive(container, data) {
  staticHtml(container)\`
    <div class="k-kmc-sec-row">
      <span class="k-kmc-sec-label">Personne autorisée</span>
      <span class="k-kmc-sec-value" id="k-kmc-auth-name">
        <span id="k-kmc-auth-given"></span> <span id="k-kmc-auth-family"></span>
      </span>
    </div>
    <p class="k-kmc-field-hint" id="k-kmc-auth-updated"></p>
    <p class="k-kmc-save-status" id="k-kmc-auth-status" role="status" aria-live="polite"></p>
    <div class="k-kmc-auth-actions">
      <button type="button" class="k-kmc-action-btn k-kmc-action-btn--secondary" id="k-kmc-auth-edit">Modifier</button>
      <button type="button" class="k-kmc-action-btn k-kmc-action-btn--danger" id="k-kmc-auth-delete">Supprimer</button>
    </div>
  \`;

  const givenEl  = container.querySelector('#k-kmc-auth-given');
  const familyEl = container.querySelector('#k-kmc-auth-family');
  if (givenEl) givenEl.textContent = data.given_names;
  if (familyEl) familyEl.textContent = data.family_name;
  const updatedEl = container.querySelector('#k-kmc-auth-updated');
  const updatedDate = fmtDateFr(data.updated_at);
  if (updatedEl) {
    updatedEl.hidden = !updatedDate;
    updatedEl.textContent = updatedDate ? `Enregistrée le ${updatedDate}.` : '';
  }

  container.querySelector('#k-kmc-auth-edit')?.addEventListener('click', () => {
    _renderAuthForm(container, { given_names: data.given_names, family_name: data.family_name });
  });

  container.querySelector('#k-kmc-auth-delete')?.addEventListener('click', async () => {
    const btn = container.querySelector('#k-kmc-auth-delete');
    const status = container.querySelector('#k-kmc-auth-status');
    if (!window.confirm('Supprimer cette autorisation de retrait exceptionnel ?')) return;
    btn.disabled = true;
    try {
      await withStepUpRetry(() => apiDelete('/api/auth/me/pickup-authorization'));
      _renderAuthForm(container, null);
    } catch (_) {
      btn.disabled = false;
      if (status) status.textContent = '⚠️ Échec — réessayez';
    }
  });
}`);

komerce = replaceFunction(komerce, '_renderAuthForm', `function _renderAuthForm(container, prefill) {
  const isEdit = !!prefill;
  staticHtml(container)\`
    <form class="k-kmc-form" id="k-kmc-auth-form">
      <label class="k-kmc-field">
        <span>Prénom(s)</span>
        <input type="text" id="k-kmc-auth-given" maxlength="100" autocomplete="off">
      </label>
      <label class="k-kmc-field">
        <span>Nom de famille</span>
        <input type="text" id="k-kmc-auth-family" maxlength="100" autocomplete="off">
      </label>
      <p class="k-kmc-field-hint">Saisissez le nom exactement tel qu’il figure sur la pièce d’identité de la personne autorisée.</p>
      <p class="k-kmc-save-status" id="k-kmc-auth-status" role="status" aria-live="polite"></p>
      <div class="k-kmc-auth-actions">
        <button type="button" class="k-kmc-action-btn k-kmc-action-btn--secondary" id="k-kmc-auth-cancel">Annuler</button>
        <button type="submit" class="k-kmc-action-btn" id="k-kmc-auth-save" disabled></button>
      </div>
    </form>
  \`;

  const form        = container.querySelector('#k-kmc-auth-form');
  const givenInput  = container.querySelector('#k-kmc-auth-given');
  const familyInput = container.querySelector('#k-kmc-auth-family');
  const cancelBtn   = container.querySelector('#k-kmc-auth-cancel');
  const saveBtn     = container.querySelector('#k-kmc-auth-save');
  const status      = container.querySelector('#k-kmc-auth-status');

  givenInput.value  = prefill ? String(prefill.given_names) : '';
  familyInput.value = prefill ? String(prefill.family_name) : '';
  cancelBtn.hidden = !isEdit;
  saveBtn.textContent = isEdit ? 'Enregistrer les modifications' : 'Enregistrer l’autorisation';

  function checkFilled() {
    saveBtn.disabled = !givenInput.value.trim() || !familyInput.value.trim();
  }
  givenInput.addEventListener('input', checkFilled);
  familyInput.addEventListener('input', checkFilled);
  checkFilled();

  cancelBtn.addEventListener('click', () => {
    _loadAuthSection(container);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (saveBtn.disabled) return;
    const givenNames = givenInput.value.trim();
    const familyName  = familyInput.value.trim();

    saveBtn.disabled = true;
    saveBtn.textContent = 'Enregistrement…';
    status.textContent = '';

    try {
      const result = await withStepUpRetry(() => apiPut('/api/auth/me/pickup-authorization', {
        given_names: givenNames, family_name: familyName,
      }));
      _renderAuthActive(container, result);
    } catch (_) {
      status.textContent = '⚠️ Échec — réessayez';
      saveBtn.disabled = false;
      saveBtn.textContent = isEdit ? 'Enregistrer les modifications' : 'Enregistrer l’autorisation';
    }
  });
}`);

fs.writeFileSync('public/boutique/js/b-komerce.js', komerce);

const suppressions = JSON.parse(fs.readFileSync('scripts/impact-suppressions.json', 'utf8'));
const retained = suppressions.filter((entry) => {
  if (entry.category === 'xss' && entry.file.startsWith('public/boutique/tests/')) return false;
  if (entry.category === 'hardcodedSecrets' && entry.file === 'scripts/gen-data-ownership.js') return false;
  if (entry.category === 'xss' && entry.file === 'public/boutique/js/b-komerce.js') return false;
  return true;
});
if (suppressions.length !== 20) throw new Error(`Expected 20 suppressions before cleanup, got ${suppressions.length}`);
if (retained.length !== 4) throw new Error(`Expected 4 suppressions after cleanup, got ${retained.length}`);
fs.writeFileSync('scripts/impact-suppressions.json', `${JSON.stringify(retained, null, 2)}\n`);

const testPath = 'tests/unit/impact-check-security-conventions.test.js';
const testSource = `'use strict';\n\nconst { scanSecurity, suppressSecurity } = require('../../scripts/impact-check');\n\ndescribe('impact-check security conventions', () => {\n  test('ignore uniquement XSS dans les fixtures de tests non servies', () => {\n    const testIssues = scanSecurity('public/boutique/tests/unit/example.test.js', 'document.body.innerHTML = userHtml;', null);\n    expect(testIssues.filter(x => x.category === 'xss')).toHaveLength(0);\n\n    const runtimeIssues = scanSecurity('public/boutique/js/example.js', 'document.body.innerHTML = userHtml;', null);\n    expect(runtimeIssues.some(x => x.category === 'xss')).toBe(true);\n  });\n\n  test('conserve les autres catégories sécurité dans les tests', () => {\n    const issues = scanSecurity('tests/unit/example.test.js', \\"const child_process = require('child_process');\\", null);\n    expect(issues.some(x => x.category === 'dangerousOps')).toBe(true);\n  });\n\n  test('ne confond pas les identifiants de données lowercase avec des variables env', () => {\n    expect(suppressSecurity('hardcodedSecrets', \\"sms_log: 'notifications'\\", '')).toBe(true);\n    expect(suppressSecurity('hardcodedSecrets', \\"stripe_events_processed: 'payments'\\", '')).toBe(true);\n    expect(suppressSecurity('hardcodedSecrets', \\"SMS_TOKEN: 'Abcd1234Efgh5678'\\", '')).toBe(false);\n  });\n\n  test('autorise uniquement le sink staticHtml protégé contre les substitutions', () => {\n    const guarded = \\"function staticHtml(target) { return (strings, ...values) => { if (!Array.isArray(strings?.raw) || values.length !== 0) throw new TypeError('staticHtml accepts only substitution-free tagged templates'); const template = document.createElement('template'); template.innerHTML = strings[0]; }; }\\";\n    expect(suppressSecurity('xss', 'template.innerHTML = strings[0];', guarded)).toBe(true);\n    expect(suppressSecurity('xss', 'el.innerHTML = userHtml;', guarded)).toBe(false);\n    expect(suppressSecurity('xss', 'template.innerHTML = strings[0];', 'function unsafe(strings) { template.innerHTML = strings[0]; }')).toBe(false);\n  });\n});\n`;
fs.writeFileSync(testPath, testSource);

let feature = fs.readFileSync('features/infrastructure.feature.js', 'utf8');
const testAnchor = "    tests: [\n";
if (!feature.includes(testPath)) {
  feature = replaceOnce(feature, testAnchor, `${testAnchor}      '${testPath}',\n`, 'infrastructure test declaration');
}
fs.writeFileSync('features/infrastructure.feature.js', feature);

console.log(`Impact suppressions: ${suppressions.length} -> ${retained.length}`);
console.log('Applied runtime XSS scope, hardcoded-secret case fix, staticHtml conversion, and tests.');
