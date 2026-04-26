/* Komerce Auth Guard v2 — session expiry detection */
(function(){
  // Monkey-patch fetch to detect expired sessions (401)
  var _fetch = window.fetch;
  window.fetch = function(){
    return _fetch.apply(this, arguments).then(function(res){
      if(res.status === 401 && res.url && res.url.indexOf('/api/') !== -1){
        localStorage.removeItem('kmrc_logged_in');
        localStorage.removeItem('komerce_token');
        var l = document.getElementById('login-screen');
        var a = document.getElementById('bo-app');
        if(l) l.style.display = 'flex';
        if(a) a.style.display = 'none';
      }
      return res;
    });
  };
  
  // On load: verify session if localStorage says logged in
  function checkSession(){
    if(!localStorage.getItem('kmrc_logged_in')) return;
    _fetch('/api/auth/me', { credentials:'include' }).then(function(r){
      if(!r.ok){
        localStorage.removeItem('kmrc_logged_in');
        localStorage.removeItem('komerce_token');
        var l = document.getElementById('login-screen');
        var a = document.getElementById('bo-app');
        if(l) l.style.display = 'flex';
        if(a) a.style.display = 'none';
      }
    }).catch(function(){});
  }
  
  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', checkSession);
  } else {
    checkSession();
  }
})();
