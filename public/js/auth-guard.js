/* Komerce Auth Guard v3 — canonical cookie session check */
(function () {
  'use strict';

  var AUTH_ME_URL = '/api/auth/me';
  var LOGIN_URL = '/login.html';

  function isLoginPage() {
    return /(^|\/)(login|admin-login|connexion)(\.html)?$/i.test(window.location.pathname || '');
  }

  function redirectToLogin() {
    if (isLoginPage()) return;

    var next = (window.location.pathname || '/') +
      (window.location.search || '') +
      (window.location.hash || '');

    window.location.replace(LOGIN_URL + '?next=' + encodeURIComponent(next));
  }

  async function checkSession() {
    try {
      var res = await fetch(AUTH_ME_URL, {
        method: 'GET',
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
      });

      if (!res.ok) {
        redirectToLogin();
        return null;
      }

      var user = await res.json();
      window.KOMERCE_AUTH_USER = user;
      return user;
    } catch (_) {
      redirectToLogin();
      return null;
    }
  }

  var _fetch = window.fetch;
  window.fetch = function () {
    return _fetch.apply(this, arguments).then(function (res) {
      if (
        res.status === 401 &&
        res.url &&
        res.url.indexOf('/api/') !== -1 &&
        res.url.indexOf('/api/auth/login') === -1
      ) {
        redirectToLogin();
      }
      return res;
    });
  };

  window.KomerceAuthGuard = {
    checkSession: checkSession,
    redirectToLogin: redirectToLogin,
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', checkSession);
  } else {
    checkSession();
  }
})();
