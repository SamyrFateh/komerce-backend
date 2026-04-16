/* ═══════════════════════════════════════════════════════════
   KOMERCE BOUTIQUE — b-search.js
   Category chips, search input, sort/filter bar
   Depends on: b-config.js, b-state.js, b-ui.js, b-catalog.js
   ═══════════════════════════════════════════════════════════ */
(function (K) {
  'use strict';

  // ── CATEGORY CHIPS ────────────────────────────────────────
  K.setupCats = function () {
    const emojiRx = /^(\p{Emoji_Presentation}|\p{Emoji}\uFE0F)\s*/u;
    K.$$('.k-chip').forEach(chip => {
      const raw = chip.textContent.trim();
      const m   = raw.match(emojiRx);
      if (m) {
        const emoji = m[1];
        const label = raw.slice(m[0].length);
        chip.innerHTML =
          '<span class="k-chip-emoji">' + emoji + '</span>' +
          '<span class="k-chip-label">' + label + '</span>';
      }
      chip.addEventListener('click', () => {
        K.$$('.k-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        K.state.activeCat = chip.dataset.cat;
        K.state.page = 0;
        K.renderGrid();
      });
    });
  };

  // ── SEARCH ────────────────────────────────────────────────
  K.setupSearch = function () {
    const input = K.dom.searchInput;
    const drop  = K.dom.searchDrop;
    if (!input) return;

    input.addEventListener('input', () => {
      clearTimeout(K.state.searchTimeout);
      const q = input.value.trim().toLowerCase();
      if (q.length < 2) {
        if (drop) drop.classList.remove('open');
        K.state.filtered = [...K.state.products];
        K.renderGrid();
        return;
      }
      K.state.searchTimeout = setTimeout(() => {
        const results = K.state.products.filter(p =>
          (p.name || '').toLowerCase().includes(q) ||
          (p.category || '').toLowerCase().includes(q) ||
          (p.description || '').toLowerCase().includes(q)
        );
        K.state.filtered = results;
        K.renderGrid();
        K.renderSearchDropdown(results.slice(0, 8));
      }, 250);
    });

    document.addEventListener('click', e => {
      if (!e.target.closest('.k-search') && drop) drop.classList.remove('open');
    });
  };

  K.renderSearchDropdown = function (results) {
    const drop = K.dom.searchDrop;
    if (!drop) return;
    if (!results.length) {
      drop.innerHTML = '<div class="k-search-hint">Aucun résultat</div>';
      drop.classList.add('open');
      return;
    }
    drop.innerHTML = results.map(p =>
      '<div class="k-search-result" data-id="' + p.id + '">' +
        '<img class="k-search-result-img" src="' + K.optimizeImgUrl(p.image_url, 80) + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
        '<div>' +
          '<div class="k-search-result-name">' + K.sanitize(p.name) + '</div>' +
          '<div class="k-search-result-price">' + K.fmtPrice(p.price_kmf) + '</div>' +
        '</div>' +
      '</div>'
    ).join('');
    drop.classList.add('open');
    drop.querySelectorAll('.k-search-result').forEach(item => {
      item.addEventListener('click', () => {
        K.openModal(item.dataset.id);
        drop.classList.remove('open');
        K.dom.searchInput.value = '';
      });
    });
  };

  // ── SORT BAR ──────────────────────────────────────────────
  K.setupSortBar = function () {
    const bar = K.$('#k-sort-bar');
    if (!bar) return;
    bar.querySelectorAll('.k-sort-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        bar.querySelectorAll('.k-sort-chip').forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        K.state.sortMode = chip.dataset.sort || 'default';
        K.state.page = 0;
        K.renderGrid();
      });
    });
  };

})(window.K = window.K || {});
