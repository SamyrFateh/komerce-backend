/* ═══════════════════════════════════════════════════════════════
   KOMERCE — b-utils.js
   Helpers purs : image, prix, format, sanitize, carousel
   Extrait de boutique.js §1 — expose window.KUtils
   ═══════════════════════════════════════════════════════════════ */
/* global Intl, crypto */
(function () {
  'use strict';

  function optimizeImgUrl(url, w) {
    if (!url || url.indexOf('res.cloudinary.com') === -1) return url;
    if (url.indexOf('f_auto') !== -1) return url;
    return url.replace('/upload/', '/upload/f_auto,q_auto' + (w ? ',w_' + w : '') + '/');
  }

  function sanitize(s) {
    var div = document.createElement('div');
    div.textContent = s;
    return div.innerHTML;
  }

  function promoImgUrl(url, w) {
    return optimizeImgUrl(url, w);
  }

  function renderProductCarousel(p, width) {
    width = width || 400;
    var imgs = [];
    if (p.images) {
      try {
        imgs = typeof p.images === 'string' ? JSON.parse(p.images) : p.images;
      } catch (_) { imgs = []; }
    }
    if (!Array.isArray(imgs) || imgs.length === 0) {
      imgs = p.image_url ? [p.image_url, p.image_url, p.image_url, p.image_url] : [];
    }
    if (!imgs.length) {
      return '<img class="k-card-img" src="" alt="' + sanitize(p.name || '') + '" loading="lazy" decoding="async">';
    }
    var slides = imgs.map(function(src, i) {
      return '<div class="k-card-slide"><img class="k-card-slide-img" src="' +
        optimizeImgUrl(src, width) + '" alt="' + sanitize(p.name || '') + ' ' + (i + 1) +
        '" loading="lazy" decoding="async"></div>';
    }).join('');
    var dots = imgs.length > 1
      ? '<div class="k-card-dots">' + imgs.map(function(_, i) {
          return '<span class="k-card-dot' + (i === 0 ? ' active' : '') + '"></span>';
        }).join('') + '</div>'
      : '';
    return '<div class="k-card-carousel">' + slides + '</div>' + dots;
  }

  function bindCarouselDots(card) {
    var carousel = card.querySelector('.k-card-carousel');
    var dots = card.querySelectorAll('.k-card-dot');
    if (!carousel || carousel.dataset.bound) return;
    carousel.dataset.bound = '1';
    if (dots.length > 1) {
      var raf = null;
      carousel.addEventListener('scroll', function() {
        if (raf) return;
        raf = requestAnimationFrame(function() {
          raf = null;
          var idx = Math.round(carousel.scrollLeft / carousel.clientWidth);
          dots.forEach(function(d, i) { d.classList.toggle('active', i === idx); });
        });
      }, { passive: true });
    }
    var sx = 0, sy = 0, moved = false;
    function onStart(e) {
      var t = e.touches ? e.touches[0] : e;
      sx = t.clientX; sy = t.clientY; moved = false;
    }
    function onMove(e) {
      var t = e.touches ? e.touches[0] : e;
      if (Math.abs(t.clientX - sx) > 10 || Math.abs(t.clientY - sy) > 10) moved = true;
    }
    function onEnd() {
      if (moved) {
        card.dataset.justSwiped = '1';
        setTimeout(function() { delete card.dataset.justSwiped; }, 250);
      }
    }
    carousel.addEventListener('touchstart', onStart, { passive: true });
    carousel.addEventListener('touchmove', onMove, { passive: true });
    carousel.addEventListener('touchend', onEnd, { passive: true });
    carousel.addEventListener('mousedown', onStart);
    carousel.addEventListener('mousemove', function(e) { if (e.buttons) onMove(e); });
    carousel.addEventListener('mouseup', onEnd);
  }

  function detectCurrency() {
    try {
      var tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
      if (/Comoro|Mayotte/i.test(tz)) return 'KMF';
    } catch (e) {}
    return 'EUR';
  }

  var _rates = { EUR: 495, KMF: 1 };
  var _currency = detectCurrency();

  function fmt(kmf, currency) {
    var c = currency || _currency;
    var rate = _rates[c] || 1;
    var val = Math.round(kmf / rate);
    return val.toLocaleString('fr-FR') + (c === 'EUR' ? ' €' : ' KMF');
  }

  function fmtPrice(kmf) {
    return new Intl.NumberFormat('fr-FR').format(kmf) + ' KMF';
  }

  function productEmoji(p) { return p.emoji || '📦'; }

  function genIdempotencyKey() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      var r = Math.random() * 16 | 0;
      var v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  window.KUtils = {
    optimizeImgUrl   : optimizeImgUrl,
    sanitize         : sanitize,
    promoImgUrl      : promoImgUrl,
    renderProductCarousel : renderProductCarousel,
    bindCarouselDots : bindCarouselDots,
    detectCurrency   : detectCurrency,
    fmt              : fmt,
    fmtPrice         : fmtPrice,
    productEmoji     : productEmoji,
    genIdempotencyKey: genIdempotencyKey,
    // State exposé pour boutique.js (usage direct L2908)
    _currency        : _currency,
    _rates           : _rates
  };

})();
