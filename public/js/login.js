/**
 * @komerce-arch-lite
 * @role          dashboard-admin-login
 * @domain        dashboard
 * @layer         ui-bootstrap
 * @owner         dashboards
 * @purpose       Soumission du formulaire de connexion admin / responsable pays (/login.html) —
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
 *   2. Cette page est l'entrée commune des surfaces Canonical pour `admin` et
 *      `market_operator`. L'autorité de marché reste exclusivement côté serveur.
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
      var ALLOWED_DASHBOARD_ROLES = new Set(['admin', 'market_operator']);

      function nextUrl() {
        var params = new URLSearchParams(window.location.search);
        var next   = params.get('next');
        if (!next) return '/admin/pilotage';
        // Sécurité : accepter uniquement les chemins internes
        if (next.startsWith('/') && !next.startsWith('//')) return next;
        return '/admin/pilotage';
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

          // La page de login ouvre les surfaces Canonical aux rôles dashboard
          // autorisés. Les permissions fines et le MarketScope restent vérifiés
          // par les API côté serveur après redirection.
          var user = data.user || data;
          if (!ALLOWED_DASHBOARD_ROLES.has(user.role)) {
            setLoading(false);
            showError('Accès refusé — compte sans droits dashboard.');
            return;
          }

          window.location.replace(nextUrl());

        } catch (err) {
          setLoading(false);
          showError('Erreur réseau — vérifiez votre connexion.');
        }
      }

      btn.addEventListener('click', doLogin);

      [emailEl, passEl].forEach(function (el) {
        el.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') doLogin();
        });
      });
    })();
  