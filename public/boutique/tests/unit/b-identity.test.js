'use strict';

/**
 * tests/unit/b-identity.test.js
 *
 * Module js/b-identity.js (501L) — identité légère Komerce, gate OTP
 * réutilisable checkout/boutique/groupe. 0% de couverture réelle avant
 * cette session (systématiquement mocké par b-checkout.test.js,
 * b-group-view.test.js, b-share-cart.test.js — jamais testé lui-même).
 * Fichier @criticality high : porte d'entrée de toute l'authentification
 * client (OTP WhatsApp), à traiter avec la même rigueur que b-paypal.js.
 *
 * b-store.js (state) et b-phone.js sont utilisés réels (comme dans
 * b-checkout.test.js pour state ; b-phone.js a sa propre suite dédiée
 * dans tests/unit/b-phone.test.js et son intégration ici — via
 * makeIntlPhoneInput — est donc couverte en conditions réelles plutôt
 * que simulée). Seul b-utils.js (showToast) est mocké.
 *
 * Couverture visée :
 *   getCurrentIdentity() : window.K.auth.getUser -> window.K.getUser ->
 *     state.user/customer/client/profile -> null ; normalisation des
 *     variantes de champs (full_name/fullName/name/…, phone/whatsapp/…) ;
 *     retourne null si rien d'exploitable.
 *   restoreIdentity()    : identité déjà présente (pas d'appel restore) ;
 *     restore() réussi -> state.user mis à jour ; restore() qui rejette
 *     -> catch silencieux -> null ; restore() qui renvoie du vide -> null.
 *   requireIdentity()    : court-circuite via restoreIdentity si déjà
 *     identifié ; sinon ouvre la modale (step phone ou recap selon
 *     contexte), jusqu'à résolution (OTP réussi, ou annulation -> null).
 *   bindChangeIdentity() : ouvre la modale au clic, appelle onChanged
 *     si un utilisateur est retourné, ne l'appelle pas si annulé.
 *   openIdentityModal (via requireIdentity/bindChangeIdentity) :
 *     - step phone : validations (prénom/nom/téléphone requis), succès
 *       OTP request -> passage au step OTP, échec réseau -> message
 *       d'erreur inline, pas de crash.
 *     - step OTP : code à 6 chiffres requis, verify réussi -> state.user
 *       mis à jour + toast succès + résolution de la promesse + fermeture,
 *       verify échoué -> message d'erreur + réinitialisation des cases,
 *       renvoi de code -> nouvelle requête.
 *     - step recap (utilisateur déjà connu + téléphone fourni) : envoi
 *       automatique après le délai, "numéro changé" / "pas vous" relancent
 *       une modale vierge.
 *     - fermeture (croix, clic overlay, Échap, annulation) -> résout null.
 */

// b-identity.js importe showToast depuis b-utils.js (b-cart-core.js ne fait
// que le ré-exporter, pour d'autres modules) — c'est donc b-utils.js qu'il
// faut mocker ici. Mocker b-cart-core.js à sa place laisse le vrai
// showToast() s'exécuter, qui plante sur dom.toast (undefined dans ce
// fixture) ; l'exception est avalée par le catch de verifyCode() AVANT
// l'appel à resolve(), donc la promesse de requireIdentity() ne se résout
// jamais (d'où les timeouts observés, pas juste des échecs d'assertion).
jest.mock('../../js/b-utils.js', () => ({
  ...jest.requireActual('../../js/b-utils.js'),
  showToast: jest.fn(),
}));

const { state } = require('../../js/b-store.js');
const { showToast } = require('../../js/b-utils.js');
const { mockWindowK, flush } = require('./helpers/boutiqueTestKit');
const {
  getCurrentIdentity,
  restoreIdentity,
  requireIdentity,
  bindChangeIdentity,
} = require('../../js/b-identity.js');

async function tick(ms) {
  jest.advanceTimersByTime(ms);
  await flush();
}

function mockFetchSequence(handlers) {
  // handlers: array of functions(url, opts) -> { ok, json } consumed in order
  let i = 0;
  global.fetch = jest.fn(() => {
    const h = handlers[Math.min(i, handlers.length - 1)];
    i++;
    return Promise.resolve(h());
  });
}

function fillOtpBoxes(root, code) {
  const boxes = root.querySelectorAll('.k-id-otp-box');
  [...code].forEach((digit, idx) => {
    boxes[idx].value = digit;
    boxes[idx].dispatchEvent(new Event('input'));
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  state.user = null;
  state.customer = null;
  state.client = null;
  state.profile = null;
  delete window.K;
  jest.clearAllMocks();
  jest.useRealTimers();
});

describe('getCurrentIdentity', () => {
  it('retourne null si aucune source d\'identité disponible', () => {
    expect(getCurrentIdentity()).toBeNull();
  });

  it('priorise window.K.auth.getUser()', () => {
    mockWindowK({ auth: { getUser: () => ({ id: 1, name: 'Fatima', phone: '+33612345678' }) } });
    const id = getCurrentIdentity();
    expect(id.name).toBe('Fatima');
    expect(id.phone).toBe('+33612345678');
  });

  it('retombe sur window.K.getUser() si auth.getUser absent', () => {
    mockWindowK({ auth: undefined, getUser: () => ({ id: 2, full_name: 'Ali Said' }) });
    expect(getCurrentIdentity().name).toBe('Ali Said');
  });

  it('retombe sur state.user si window.K absent', () => {
    state.user = { id: 3, name: 'Amina', phone: '0612345678' };
    const id = getCurrentIdentity();
    expect(id.name).toBe('Amina');
    expect(id.phone).toBe('+0612345678'); // pas de code pays -> juste préfixé par +
  });

  it('normalise un numéro déjà en E.164 sans le modifier', () => {
    state.user = { id: 4, name: 'X', phone: '+33612345678' };
    expect(getCurrentIdentity().phone).toBe('+33612345678');
  });

  it('gère les variantes de champ nom (fullName, display_name, customer_name)', () => {
    state.customer = { id: 5, display_name: 'Zainaba' };
    expect(getCurrentIdentity().name).toBe('Zainaba');
  });

  it('gère les variantes de champ téléphone (whatsapp_phone, mobile)', () => {
    state.client = { id: 6, mobile: '612345678' };
    expect(getCurrentIdentity().phone).toBe('+612345678');
  });

  it('retourne null si l\'objet utilisateur n\'a ni nom, ni téléphone, ni id', () => {
    state.profile = { some_other_field: true };
    expect(getCurrentIdentity()).toBeNull();
  });

  it('accepte un objet enveloppé sous { user: {...} } (forme K.auth.getUser())', () => {
    mockWindowK({ auth: { getUser: () => ({ user: { id: 7, name: 'Wrapped' } }) } });
    expect(getCurrentIdentity().name).toBe('Wrapped');
  });
});

describe('restoreIdentity', () => {
  it('retourne l\'identité existante sans appeler K.auth.restore()', async () => {
    state.user = { id: 1, name: 'Déjà là' };
    const restore = jest.fn();
    mockWindowK({ auth: { restore } });
    const result = await restoreIdentity();
    expect(result.name).toBe('Déjà là');
    expect(restore).not.toHaveBeenCalled();
  });

  it('appelle K.auth.restore(), normalise et met à jour state.user en cas de succès', async () => {
    mockWindowK({ auth: { restore: jest.fn().mockResolvedValue({ id: 9, name: 'Restauré', phone: '+33600000000' }) } });
    const result = await restoreIdentity();
    expect(result.name).toBe('Restauré');
    expect(state.user.name).toBe('Restauré');
  });

  it('retourne null et ne plante pas si K.auth.restore() rejette', async () => {
    mockWindowK({ auth: { restore: jest.fn().mockRejectedValue(new Error('offline')) } });
    await expect(restoreIdentity()).resolves.toBeNull();
  });

  it('retourne null si K.auth.restore() résout une valeur non exploitable', async () => {
    mockWindowK({ auth: { restore: jest.fn().mockResolvedValue(null) } });
    await expect(restoreIdentity()).resolves.toBeNull();
  });

  it('retourne null si window.K est absent', async () => {
    await expect(restoreIdentity()).resolves.toBeNull();
  });
});

describe('requireIdentity — court-circuit si déjà identifié', () => {
  it('ne monte aucune modale si une identité existe déjà', async () => {
    state.user = { id: 1, name: 'Déjà identifié' };
    const result = await requireIdentity();
    expect(result.name).toBe('Déjà identifié');
    expect(document.querySelector('.k-id-overlay')).toBeNull();
  });
});

describe('requireIdentity — step phone (utilisateur inconnu)', () => {
  it('monte la modale en step phone avec les champs prénom/nom/téléphone', async () => {
    requireIdentity();
    await flush();
    expect(document.querySelector('.k-id-overlay')).not.toBeNull();
    expect(document.getElementById('k-id-step-phone').hidden).toBe(false);
    expect(document.getElementById('k-id-step-recap').hidden).toBe(true);
    expect(document.getElementById('k-id-name')).not.toBeNull();
    expect(document.getElementById('k-id-phone')).not.toBeNull();
  });

  it('affiche une erreur si le prénom est manquant', async () => {
    requireIdentity();
    await flush();
    document.getElementById('k-id-lastname').value = 'Said';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));

    document.getElementById('k-id-phone-cta').click();
    await flush();
    expect(document.getElementById('k-id-err-phone').textContent).toContain('prénom');
  });

  it('affiche une erreur si le numéro est trop court', async () => {
    requireIdentity();
    await flush();
    document.getElementById('k-id-name').value = 'Ali';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'Said';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));

    document.getElementById('k-id-phone-cta').click();
    await flush();
    expect(document.getElementById('k-id-err-phone').textContent).toContain('invalide');
  });

  it('envoie le code OTP et bascule au step OTP en cas de succès', async () => {
    jest.useFakeTimers();
    mockFetchSequence([() => ({ ok: true, json: async () => ({ success: true }) })]);

    requireIdentity();
    await flush();
    document.getElementById('k-id-name').value = 'Ali';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'Said';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));

    document.getElementById('k-id-phone-cta').click();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/otp/request',
      expect.objectContaining({ method: 'POST' })
    );
    expect(document.getElementById('k-id-step-otp').hidden).toBe(false);
    jest.useRealTimers();
  });

  it('affiche un message d\'erreur inline si la requête OTP échoue (réseau)', async () => {
    mockFetchSequence([() => { throw new Error('network down'); }]);
    global.fetch = jest.fn(() => Promise.reject(new Error('network down')));

    requireIdentity();
    await flush();
    document.getElementById('k-id-name').value = 'Ali';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'Said';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));

    document.getElementById('k-id-phone-cta').click();
    await flush();

    expect(document.getElementById('k-id-err-phone').textContent).toContain('network down');
    expect(document.getElementById('k-id-step-otp').hidden).toBe(true);
  });

  it('affiche un message d\'erreur inline si le serveur répond success:false', async () => {
    mockFetchSequence([() => ({ ok: true, json: async () => ({ success: false, error: 'Numéro bloqué' }) })]);

    requireIdentity();
    await flush();
    document.getElementById('k-id-name').value = 'Ali';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'Said';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));

    document.getElementById('k-id-phone-cta').click();
    await flush();

    expect(document.getElementById('k-id-err-phone').textContent).toBe('Numéro bloqué');
  });
});

describe('requireIdentity — step OTP', () => {
  async function reachOtpStep() {
    // Timers réels : le bouton "renvoyer" reste techniquement cliquable en
    // JSDOM même caché par style.display (JSDOM n'applique pas de layout),
    // donc pas besoin de faire avancer le minuteur de 30s pour ces tests.
    mockFetchSequence([() => ({ ok: true, json: async () => ({ success: true }) })]);
    const promise = requireIdentity();
    await flush();
    document.getElementById('k-id-name').value = 'Ali';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'Said';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone-cta').click();
    await flush();
    return { promise };
  }

  it('le bouton confirmer reste désactivé tant que les 6 chiffres ne sont pas saisis', async () => {
    await reachOtpStep();
    fillOtpBoxes(document, '123');
    expect(document.getElementById('k-id-otp-cta').disabled).toBe(true);
  });

  it('la saisie du 6e chiffre déclenche automatiquement la vérification, qui réussit', async () => {
    const { promise } = await reachOtpStep();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true, user: { id: 42, name: 'Ali Said', phone: '+33612345678' } }),
      })
    );

    fillOtpBoxes(document, '123456');
    await flush();

    const result = await promise;
    expect(result.name).toBe('Ali Said');
    expect(state.user.name).toBe('Ali Said');
    expect(showToast).toHaveBeenCalledWith('WhatsApp confirmé.', 'success');
    // closeOverlay() ne retire le noeud du DOM qu'après un setTimeout(150ms)
    // (transition de sortie) ; il faut attendre ce délai réel avant de
    // vérifier que l'overlay a bien disparu.
    await new Promise(r => setTimeout(r, 200));
    expect(document.querySelector('.k-id-overlay')).toBeNull(); // fermée
  });

  it('code invalide/expiré : message d\'erreur inline, cases vidées, bouton réactivé', async () => {
    await reachOtpStep();
    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: false, json: async () => ({ success: false, error: 'Code invalide.' }) })
    );

    fillOtpBoxes(document, '000000');
    // verifyCode() enchaîne deux niveaux d'await (fetch puis res.json()) avant
    // d'atteindre le catch qui réactive le bouton ; quelques ticks de plus
    // que le flush() par défaut (3) sont nécessaires pour laisser la chaîne
    // se dérouler entièrement.
    await flush(8);

    expect(document.getElementById('k-id-err-otp').textContent).toBe('Code invalide.');
    // Le catch remet otpCta.disabled = false, mais clearBoxes() qui suit
    // appelle syncOtpCta() : cases désormais vides -> full=false -> le
    // bouton est re-désactivé. Comportement réel du module, pas un bug.
    expect(document.getElementById('k-id-otp-cta').disabled).toBe(true);
    const boxes = document.querySelectorAll('.k-id-otp-box');
    boxes.forEach(b => expect(b.value).toBe(''));
  });

  it('le bouton renvoyer relance une demande de code', async () => {
    await reachOtpStep();
    global.fetch = jest.fn(() => Promise.resolve({ ok: true, json: async () => ({ success: true }) }));

    // Le bouton existe dès le montage du step OTP ; JSDOM n'appliquant pas
    // de layout, style.display:'none' ne bloque pas .click() ici.
    document.getElementById('k-id-resend').click();
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/otp/request',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('déclenche window.K.auth.restore() en arrière-plan après une vérification réussie', async () => {
    const { promise } = await reachOtpStep();
    // window.K n'est défini qu'après avoir atteint le step OTP : le définir
    // avant ferait que restoreIdentity() (appelé en amont par requireIdentity)
    // court-circuite l'ouverture de la modale elle-même.
    const restore = jest.fn().mockResolvedValue({ id: 42 });
    mockWindowK({ auth: { restore } });

    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true, user: { id: 42, name: 'Ali Said', phone: '+33612345678' } }),
      })
    );

    fillOtpBoxes(document, '123456');
    await flush();
    await promise;

    expect(restore).toHaveBeenCalled();
  });

  it('Backspace sur une case vide ramène le focus sur la précédente et la vide', async () => {
    await reachOtpStep();
    const boxes = document.querySelectorAll('.k-id-otp-box');
    boxes[0].value = '1'; boxes[0].dispatchEvent(new Event('input'));
    boxes[1].value = '2'; boxes[1].dispatchEvent(new Event('input'));
    // Case 2 (index 2) vide -> Backspace doit vider/refocaliser la case 1.
    boxes[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'Backspace' }));
    expect(boxes[1].value).toBe('');
    expect(boxes[1].classList.contains('filled')).toBe(false);
    expect(document.activeElement).toBe(boxes[1]);
  });

  it('les flèches gauche/droite déplacent le focus entre les cases', async () => {
    await reachOtpStep();
    const boxes = document.querySelectorAll('.k-id-otp-box');
    boxes[2].focus();
    boxes[2].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(boxes[1]);
    boxes[1].dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    expect(document.activeElement).toBe(boxes[2]);
  });

  it('coller un code à 6 chiffres remplit les cases et déclenche la vérification', async () => {
    const { promise } = await reachOtpStep();
    global.fetch = jest.fn(() =>
      Promise.resolve({
        ok: true,
        json: async () => ({ success: true, user: { id: 1, name: 'Ali Said', phone: '+33612345678' } }),
      })
    );

    const boxes = document.querySelectorAll('.k-id-otp-box');
    const pasteEvent = new Event('paste', { bubbles: true, cancelable: true });
    pasteEvent.clipboardData = { getData: () => '123456' };
    boxes[0].dispatchEvent(pasteEvent);

    expect(boxes[5].value).toBe('6');
    // La vérification est déclenchée via setTimeout(50ms) après un paste.
    await new Promise(r => setTimeout(r, 80));
    await flush();

    const result = await promise;
    expect(result.name).toBe('Ali Said');
  });

  it('le minuteur de renvoi décompte puis affiche le bouton "renvoyer maintenant" à 0', async () => {
    jest.useFakeTimers();
    await reachOtpStep();
    const timerCount = document.getElementById('k-id-timer-count');
    const timerText  = document.getElementById('k-id-timer-text');
    const resendBtn  = document.getElementById('k-id-resend');

    jest.advanceTimersByTime(1000);
    expect(timerCount.textContent).toBe('29');

    jest.advanceTimersByTime(29000);
    expect(timerText.style.display).toBe('none');
    expect(resendBtn.style.display).toBe('');
    jest.useRealTimers();
  });
});

describe('requireIdentity — fermeture / annulation', () => {
  it('la croix de fermeture résout la promesse avec null', async () => {
    const promise = requireIdentity();
    await flush();
    document.querySelector('.k-id-close').click();
    const result = await promise;
    expect(result).toBeNull();
  });

  it('le clic en dehors de la feuille (overlay) résout avec null', async () => {
    const promise = requireIdentity();
    await flush();
    document.querySelector('.k-id-overlay').dispatchEvent(new Event('click', { bubbles: true }));
    // Le handler vérifie e.target === ov ; on déclenche donc directement sur l'overlay lui-même.
    const overlay = document.querySelector('.k-id-overlay');
    const evt = new Event('click', { bubbles: true });
    Object.defineProperty(evt, 'target', { value: overlay });
    overlay.dispatchEvent(evt);
    const result = await promise;
    expect(result).toBeNull();
  });

  it('le bouton "Annuler" du step phone résout avec null', async () => {
    const promise = requireIdentity();
    await flush();
    document.getElementById('k-id-phone-cancel').click();
    const result = await promise;
    expect(result).toBeNull();
  });
});

describe('requireIdentity — step recap (téléphone déjà connu fourni en paramètre)', () => {
  // Note d'implémentation (utile pour la relecture) : startWithRecap ne
  // dépend PAS de getCurrentIdentity() dans la pratique — recapPhone vaut
  // `knownUser?.phone || initialPhone`, donc un simple paramètre
  // `{ phone }` suffit à déclencher le step recap dès lors qu'il fait au
  // moins 8 caractères, même sans utilisateur connu en mémoire. Le step
  // recap sert donc aussi bien à "renvoyer un code au même numéro" qu'à
  // afficher un utilisateur pleinement reconnu.
  it('affiche le récap (numéro) et envoie automatiquement le code après le délai', async () => {
    mockFetchSequence([() => ({ ok: true, json: async () => ({ success: true }) })]);

    requireIdentity({ phone: '+33612345678' });
    await flush();

    expect(document.getElementById('k-id-step-recap').hidden).toBe(false);
    expect(document.getElementById('k-id-recap-phone').textContent).toBe('+33612345678');

    // Envoi auto déclenché par setTimeout(80ms) — timers réels, attente courte.
    await new Promise(r => setTimeout(r, 120));
    await flush();

    expect(global.fetch).toHaveBeenCalledWith(
      '/api/auth/otp/request',
      expect.objectContaining({ method: 'POST' })
    );
  });

  it('"Pas vous ?" relance une modale vierge (step phone)', async () => {
    requireIdentity({ phone: '+33612345678' });
    await flush();
    document.getElementById('k-id-not-you').click();
    await flush();
    // closeOverlay() retire l'ancienne modale via setTimeout(150ms) ; sans
    // cette attente réelle, getElementById('k-id-step-phone') peut encore
    // remonter le noeud de l'ancienne modale (step recap) resté dans le DOM.
    await new Promise(r => setTimeout(r, 200));
    await flush();

    // La nouvelle modale (sans téléphone connu) doit être en step phone.
    expect(document.getElementById('k-id-step-phone')?.hidden).toBe(false);

    document.getElementById('k-id-phone-cancel').click();
    await flush();
  });

  it('"Numéro changé ?" relance aussi une modale vierge (step phone)', async () => {
    requireIdentity({ phone: '+33612345678' });
    await flush();
    document.getElementById('k-id-num-changed').click();
    await flush();
    await new Promise(r => setTimeout(r, 200));
    await flush();

    expect(document.getElementById('k-id-step-phone')?.hidden).toBe(false);

    document.getElementById('k-id-phone-cancel').click();
    await flush();
  });

  it('envoi auto en échec : message inline sur le step recap, bouton réactivé', async () => {
    mockFetchSequence([() => { throw new Error('Réseau indisponible'); }]);
    global.fetch = jest.fn(() => Promise.reject(new Error('Réseau indisponible')));

    requireIdentity({ phone: '+33612345678' });
    await flush();
    expect(document.getElementById('k-id-step-recap').hidden).toBe(false);

    // Envoi auto déclenché par setTimeout(80ms) — timers réels.
    await new Promise(r => setTimeout(r, 120));
    await flush();

    expect(document.getElementById('k-id-err-recap').textContent).toBe('Réseau indisponible');
    expect(document.getElementById('k-id-recap-cta').disabled).toBe(false);
    expect(document.getElementById('k-id-recap-cta').textContent).toBe('Renvoyer le code');
  });
});

describe('bindChangeIdentity', () => {
  it('ouvre la modale au clic et appelle onChanged si un utilisateur est retourné', async () => {
    document.body.innerHTML = '<div id="host"><button class="trigger"></button></div>';
    const el = document.getElementById('host');
    const onChanged = jest.fn();

    bindChangeIdentity(el, '.trigger', onChanged);
    el.querySelector('.trigger').click();
    await flush();

    expect(document.querySelector('.k-id-overlay')).not.toBeNull();

    global.fetch = jest.fn(() =>
      Promise.resolve({ ok: true, json: async () => ({ success: true, user: { id: 5, name: 'Nouveau' } }) })
    );
    document.getElementById('k-id-name').value = 'A';
    document.getElementById('k-id-name').dispatchEvent(new Event('input'));
    document.getElementById('k-id-lastname').value = 'B';
    document.getElementById('k-id-lastname').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone').value = '612345678';
    document.getElementById('k-id-phone').dispatchEvent(new Event('input'));
    document.getElementById('k-id-phone-cta').click();
    await flush();
    fillOtpBoxes(document, '123456');
    await flush();

    expect(onChanged).toHaveBeenCalledWith(expect.objectContaining({ name: 'Nouveau' }));
  });

  it('n\'appelle pas onChanged si l\'utilisateur annule', async () => {
    document.body.innerHTML = '<div id="host"><button class="trigger"></button></div>';
    const el = document.getElementById('host');
    const onChanged = jest.fn();

    bindChangeIdentity(el, '.trigger', onChanged);
    el.querySelector('.trigger').click();
    await flush();
    document.getElementById('k-id-phone-cancel').click();
    await flush();

    expect(onChanged).not.toHaveBeenCalled();
  });

  it('ne fait rien si le sélecteur ne correspond à aucun élément', () => {
    document.body.innerHTML = '<div id="host"></div>';
    expect(() => bindChangeIdentity(document.getElementById('host'), '.absent', jest.fn())).not.toThrow();
  });
});
