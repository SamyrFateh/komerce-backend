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
    const input   = K.dom.searchInput;
    const drop    = K.dom.searchDrop;
    const clearBtn = K.$('#k-search-clear');
    if (!input) return;

    // Trending suggestions (categories)
    const TRENDING = [
      { label: '🔥 Tendance', cat: 'all' },
      { label: '👗 Mode',     cat: 'Mode' },
      { label: '✨ Beauté',   cat: 'Beauté' },
      { label: '📱 Tech',     cat: 'Tech' },
      { label: '✂️ Couture',  cat: 'Sur-mesure' },
      { label: '🧸 Enfant',   cat: 'Enfant' },
    ];

    let focusedIndex = -1;

    // Show/hide clear button
    function syncClear() {
      if (clearBtn) clearBtn.classList.toggle('visible', input.value.length > 0);
    }

    // Close dropdown
    function closeDrop() {
      if (drop) drop.classList.remove('open');
      focusedIndex = -1;
    }

    // Highlight keyboard-focused result
    function applyFocus(items) {
      items.forEach((el, i) => el.classList.toggle('focused', i === focusedIndex));
      if (focusedIndex >= 0 && items[focusedIndex]) {
        items[focusedIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    // Show trending dropdown
    function showTrending() {
      if (!drop || !K.state.products.length) return;
      drop.innerHTML =
        '<div class="k-search-header">Tendances</div>' +
        '<div class="k-search-trending">' +
          TRENDING.map(t =>
            '<span class="k-search-trend-chip" data-cat="' + t.cat + '">' + t.label + '</span>'
          ).join('') +
        '</div>';
      drop.classList.add('open');
      drop.querySelectorAll('.k-search-trend-chip').forEach(chip => {
        chip.addEventListener('click', () => {
          // Activate the corresponding chip in the chip bar
          K.$$('.k-chip').forEach(c => {
            c.classList.toggle('active', c.dataset.cat === chip.dataset.cat);
          });
          K.state.activeCat = chip.dataset.cat;
          K.state.page = 0;
          K.renderGrid();
          closeDrop();
          input.blur();
        });
      });
    }

    // Input handler
    input.addEventListener('input', () => {
      clearTimeout(K.state.searchTimeout);
      syncClear();
      const q = input.value.trim().toLowerCase();
      focusedIndex = -1;
      if (q.length < 2) {
        K.state.filtered = [...K.state.products];
        K.state.activeCat = 'all';
        K.$$('.k-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === 'all'));
        K.renderGrid();
        if (q.length === 0) showTrending();
        else closeDrop();
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
        K.renderSearchDropdown(results.slice(0, 8), results.length);
      }, 220);
    });

    // Focus → show trending if empty
    input.addEventListener('focus', () => {
      if (!input.value.trim() && K.state.products.length) showTrending();
    });

    // Clear button
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        input.value = '';
        syncClear();
        K.state.filtered = [...K.state.products];
        K.state.activeCat = 'all';
        K.$$('.k-chip').forEach(c => c.classList.toggle('active', c.dataset.cat === 'all'));
        K.renderGrid();
        closeDrop();
        input.focus();
      });
    }

    // Keyboard navigation
    input.addEventListener('keydown', e => {
      if (!drop || !drop.classList.contains('open')) return;
      const items = [...drop.querySelectorAll('.k-search-result')];
      if (!items.length) {
        if (e.key === 'Escape') { closeDrop(); input.blur(); }
        return;
      }
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusedIndex = Math.min(focusedIndex + 1, items.length - 1);
        applyFocus(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusedIndex = Math.max(focusedIndex - 1, 0);
        applyFocus(items);
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedIndex >= 0 && items[focusedIndex]) {
          items[focusedIndex].click();
        } else if (items.length === 1) {
          items[0].click();
        }
      } else if (e.key === 'Escape') {
        closeDrop();
        input.blur();
      }
    });

    // Click outside → close
    document.addEventListener('click', e => {
      if (!e.target.closest('#k-search')) closeDrop();
    });
  };

  K.renderSearchDropdown = function (results, total) {
    const drop = K.dom.searchDrop;
    if (!drop) return;
    if (!results.length) {
      drop.innerHTML =
        '<div class="k-search-hint">😕 Aucun résultat — essayez un autre mot</div>';
      drop.classList.add('open');
      return;
    }
    const countLabel = total > results.length
      ? results.length + ' / ' + total + ' résultats'
      : total + ' résultat' + (total > 1 ? 's' : '');

    drop.innerHTML =
      '<div class="k-search-count">' + countLabel + '</div>' +
      results.map(p =>
        '<div class="k-search-result" data-id="' + p.id + '" tabindex="-1">' +
          '<img class="k-search-result-img" src="' + K.optimizeImgUrl(p.image_url, 80) + '" alt="' + K.sanitize(p.name) + '" loading="lazy">' +
          '<div class="k-search-result-info">' +
            '<div class="k-search-result-name">' + K.sanitize(p.name) + '</div>' +
            '<div class="k-search-result-meta">' +
              '<span class="k-search-result-price">' + K.fmtPrice(p.price_kmf) + '</span>' +
              (p.category ? '<span class="k-search-result-cat">' + K.sanitize(p.category) + '</span>' : '') +
            '</div>' +
          '</div>' +
        '</div>'
      ).join('');

    drop.classList.add('open');
    drop.querySelectorAll('.k-search-result').forEach(item => {
      item.addEventListener('click', () => {
        K.openModal(item.dataset.id);
        drop.classList.remove('open');
        if (K.dom.searchInput) K.dom.searchInput.value = '';
        const clearBtn = K.$('#k-search-clear');
        if (clearBtn) clearBtn.classList.remove('visible');
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
