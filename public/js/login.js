/**
 * @komerce-arch-lite
 * @role          internal-portal-login
 * @domain        dashboard
 * @layer         ui-bootstrap
 * @owner         dashboards
 * @purpose       Soumission du formulaire de connexion du portail interne Komerce (/login.html) —
 *                servi en <script src> same-origin.
 * @impact-areas  dashboard, auth, csp, market
 * @version       2026-09
 */

/**
 * login.js — logique de public/login.html, externalisée depuis un <script> inline.
 *
 * ── Pourquoi ce fichier existe (et pourquoi il ne doit PAS redevenir inline) ──
 * bootstrap/security.js pose `script-src 'self'` SANS 'unsafe-inline'. Le bloc
 * <script> inline de /login.html était donc silencieusement bloqué en
 * production (mesuré en navigateur réel — cf. AUDIT_COUTURES_COUCHES.md).
 * C'est le front le plus grave des trois : la page ne porte AUCUN <form>, le
 * bouton est un <button type="button"> et le fetch('/api/auth/login') vivait
 * dans le script bloqué — aucun repli natif. La connexion administrateur par
 * ce chemin était totalement inopérante, sans la moindre erreur serveur.
 *
 * ── Contraintes de chargement ──
 *   1. Chargé en <script src> SYNCHRONE (jamais defer/async), à l'emplacement
 *      exact du bloc inline d'origine.
 *   2. Cette page est l'entrée commune du portail interne Canonical. Elle
 *      authentifie l'identité ; les droits fins, rôles, MarketScope et
 *      capabilities restent vérifiés après redirection par le runtime et les
 *      APIs serveur.
 *   3. `/admin` est l'URL simple à communiquer. Les deep-links `/admin/...`
 *      restent préservés via `next=` lorsqu'ils sont autorisés.
 *
 * Gate associé : scripts/check-inline-scripts.js (étendu à tout public/, pas
 * seulement public/boutique/).
 */
'use strict';

    (function () {
      'use strict';

      var emailEl  = document.getElementById('email');
      var passEl   = document.getElementById('password');
      var btn      = document.getElementById('btn-submit');
      var banner   = document.getElementById('error-banner');

      // UX de landing uniquement — jamais une frontière d'autorisation.
      // Le runtime Canonical conserve sa propre liste de rôles internes admis,
      // puis chaque API revalide rôle, scope et capabilities côté serveur.
      var ROLE_DEFAULT_LANDING = Object.freeze({
        admin: '/admin/pilotage',
        market_operator: '/admin/pilotage',
        finance: '/admin/workspaces/accounting',
        sourcing: '/admin/import-runtime',
        agent_hub: '/admin/workspaces/operations',
        agent_relais: '/admin/workspaces/operations',
        agent_transitaire: '/admin/workspaces/shipping-customs',
      });

      function landingFor(user) {
        var role = user && user.role;
        return ROLE_DEFAULT_LANDING[role] || '/admin';
      }

      function nextUrl(user) {
        var params = new URLSearchParams(window.location.search);
        var next   = params.get('next');

        // `/admin` est le portail unique : après authentification on ouvre la
        // première surface métier utile au rôle, sans inventer de permission.
        if (!next || next === '/admin' || next === '/admin/') return landingFor(user);

        // Sécurité : accepter uniquement les chemins internes. Les droits sur
        // la destination restent vérifiés par le runtime/API après navigation.
        if (next.startsWith('/') && !next.startsWith('//')) return next;
        return landingFor(user);
      }

      function showError(msg) {
        banner.textContent = msg;
        banner.classList.add('is-visible');
        emailEl.classList.remove('is-error');
        passEl.classList.remove('is-error');
      }

      function clearError() {
        banner.classList.remove('is-visible');
        emailEl.classList.remove('is-error');
        passEl.classList.remove('is-error');
      }

      function setLoading(on) {
        btn.disabled = on;
        btn.classList.toggle('is-loading', on);
      }

      async function doLogin() {
        clearError();
        var email    = emailEl.value.trim();
        var password = passEl.value;

        if (!email) {
          emailEl.classList.add('is-error');
          emailEl.focus();
          showError('Adresse e-mail requise.');
          return;
        }
        if (!password) {
          passEl.classList.add('is-error');
          passEl.focus();
          showError('Mot de passe requis.');
          return;
        }

        setLoading(true);
        try {
          var res = await fetch('/api/auth/login', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
            body: JSON.stringify({ email: email, password: password }),
          });

          var data = await res.json().catch(function () { return {}; });

          if (!res.ok) {
            setLoading(false);
            var msg = (data && data.error) ? data.error : 'Identifiants incorrects.';
            showError(msg);
            passEl.value = '';
            passEl.classList.add('is-error');
            passEl.focus();
            return;
          }

          // Authentification uniquement. Le rôle retourné sert ici à choisir une
          // landing ergonomique depuis `/admin`; il ne confère aucun droit.
          var user = data.user || data;
          window.location.replace(nextUrl(user));

        } catch (err) {
          setLoading(false);
          showError('Erreur réseau — vérifiez votre connexion.');
        }
      }

      // Same portal, same session cookie; the server alone decides lead eligibility.
      var passwordPanel = document.getElementById('password-login');
      var phonePanel = document.getElementById('phone-login');
      var phoneMode = document.getElementById('btn-phone-mode');
      var passwordMode = document.getElementById('btn-password-mode');
      var phone = document.getElementById('market-phone');
      var otp = document.getElementById('market-otp');
      var otpStep = document.getElementById('market-otp-step');
      var requestOtp = document.getElementById('market-otp-request');
      var verifyOtp = document.getElementById('market-otp-verify');
      var otpStatus = document.getElementById('market-otp-status');
      var challengePhone = null;
      var otpBusy = false;
      var cooldownUntil = 0;
      var otpTimer = null;

      function resetChallenge() {
        challengePhone = null;
        otp.value = '';
        otpStep.hidden = true;
        otpStatus.textContent = '';
        cooldownUntil = 0;
        if (otpTimer) { clearTimeout(otpTimer); otpTimer = null; }
        requestOtp.disabled = false;
      }
      function setOtpBusy(on) {
        otpBusy = on;
        phone.disabled = on;
        otp.disabled = on;
        verifyOtp.disabled = on;
        requestOtp.disabled = on || Date.now() < cooldownUntil;
        passwordMode.disabled = on;
      }
      function updateCooldown() {
        if (otpTimer) clearTimeout(otpTimer);
        var seconds = Math.max(0, Math.ceil((cooldownUntil - Date.now()) / 1000));
        requestOtp.disabled = otpBusy || seconds > 0;
        requestOtp.textContent = seconds > 0 ? 'Renvoyer dans ' + seconds + ' s' : 'Recevoir le code';
        otpTimer = seconds > 0 ? setTimeout(updateCooldown, 1000) : null;
      }
      function switchMode(usePhone) {
        if (otpBusy || btn.disabled) return;
        clearError();
        passwordPanel.hidden = usePhone;
        phoneMode.hidden = usePhone;
        phonePanel.hidden = !usePhone;
        resetChallenge();
        updateCooldown();
        (usePhone ? phone : emailEl).focus();
      }
      async function postOtp(action, payload) {
        var res = await fetch('/api/auth/otp/' + action, {
          method:'POST', credentials:'include',
          headers:{'Content-Type':'application/json','Accept':'application/json'},
          body:JSON.stringify(Object.assign({purpose:'internal_market_login'},payload)),
        });
        var data = await res.json().catch(function(){return {};});
        return {res:res,data:data};
      }
      async function doRequestOtp() {
        if (otpBusy || Date.now() < cooldownUntil) return;
        clearError();
        var value = phone.value.trim().replace(/[\s().-]/g,'');
        if (!/^\+[1-9]\d{7,14}$/.test(value)) {
          showError('Saisissez le téléphone avec son indicatif international (+).');
          phone.focus(); return;
        }
        setOtpBusy(true);
        try {
          var result = await postOtp('request',{phone:value});
          if (!result.res.ok || result.data.success !== true) {
            if (result.res.status === 429) cooldownUntil = Date.now()+Math.max(1,Number(result.data.retryAfter)||300)*1000;
            showError('Impossible de demander un code maintenant. Réessayez plus tard.');
            return;
          }
          challengePhone = value;
          otpStep.hidden = false;
          otp.value = '';
          otpStatus.textContent = 'Si ce numéro correspond à un compte responsable éligible, un code lui est envoyé.';
          cooldownUntil = Date.now()+Math.max(0,Number(result.data.retryAfter)||0)*1000;
          otp.focus();
        } catch (_) { showError('Erreur réseau — vérifiez votre connexion.'); }
        finally { setOtpBusy(false); updateCooldown(); }
      }
      async function doVerifyOtp() {
        if (otpBusy || !challengePhone) return;
        clearError();
        var code = otp.value.trim();
        if (!/^\d{6}$/.test(code)) { showError('Saisissez les 6 chiffres du code.'); otp.focus(); return; }
        setOtpBusy(true);
        try {
          var result = await postOtp('verify',{phone:challengePhone,code:code});
          if (!result.res.ok || result.data.success !== true) {
            showError('Code expiré ou invalide. Vérifiez le code ou demandez-en un nouveau.');
            otp.value = ''; otp.focus(); return;
          }
          window.location.replace(nextUrl(result.data.user));
        } catch (_) { showError('Erreur réseau — vérifiez votre connexion.'); }
        finally { setOtpBusy(false); }
      }
      if (phoneMode && passwordMode && phone && otp && requestOtp && verifyOtp) {
        phoneMode.addEventListener('click',function(){switchMode(true);});
        passwordMode.addEventListener('click',function(){switchMode(false);});
        phone.addEventListener('input',function(){resetChallenge(); updateCooldown(); clearError();});
        phone.addEventListener('keydown',function(e){if(e.key==='Enter')doRequestOtp();});
        otp.addEventListener('keydown',function(e){if(e.key==='Enter')doVerifyOtp();});
        requestOtp.addEventListener('click',doRequestOtp);
        verifyOtp.addEventListener('click',doVerifyOtp);
      }

      btn.addEventListener('click', doLogin);

      [emailEl, passEl].forEach(function (el) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') doLogin();
        });
      });
    })();
