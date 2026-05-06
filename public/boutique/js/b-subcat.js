/**
 * b-subcat.js — Module ES · §5 FLAT SUBCAT
 * Extrait de boutique.js Sprint 2F — Option C
 *
 * Gestion pager sous-catégories + swipe dans modal
 */

import { bus }           from './b-bus.js';
import {
  state, dom, $, $$,
}                         from './b-store.js';
import {
  sanitize, fmt, bindCarouselDots,
}                         from './b-utils.js';
import { getSubcategories } from './shop-schema.js';
import {
  showToast,
}                         from './b-cart-core.js';
import {
  _setupMobilePager,
  destroyMobilePager,
}                         from './b-pager.js';
import { _renderCard, renderGrid } from './b-catalog.js';
import { openModal }               from './b-modal.js';
import { toggleFav, quickAdd, quickRemove } from './b-cart.js';
import { isDesktop }               from './b-scroll-owner.js';


'use strict';

  // ║  §5 · FLAT SUBCAT — Pager sous-catégories + swipe               ║
  // ╚══════════════════════════════════════════════════════════════════╝
  //  → Futur module: b-subcat.js

  // ══════════════════════════════════════════════════════════
  // TEMU FLAT SUBCAT MODE — Pager horizontal de sous-catégories
  // 1 page par sous-cat · swipe ← → pour changer · scroll vertical
  // infini indépendant dans chaque page · IO par page pour pagination
  // ══════════════════════════════════════════════════════════

  // Produits filtrés sur (cat, sub)
  /**
   * Filtre les produits d'une catégorie par sous-catégorie.
   * @param {Array} products - Produits de la catégorie
   * @param {string|null} subcat - Slug sous-catégorie (null = tout)
   * @returns {Array} Produits filtrés
   */
  function _productsForSubcat(cat, sub) {
    return state.filtered.filter(function(p) {
      return p.category === cat && p.subcategory === sub;
    });
  }

  // Meta (label + icon) d'une sous-cat depuis SUBCATS
  /**
   * Retourne les métadonnées d'une sous-catégorie (label, count).
   * Utilisé pour construire les chips filtrants dans le modal.
   * @param {string} catSlug - Slug catégorie parente
   * @returns {Array<{label:string, slug:string, count:number}>}
   */
  function _subcatMeta(cat, subKey) {
    var subs = getSubcategories(cat) || [];
    for (var i = 0; i < subs.length; i++) {
      if (subs[i].key === subKey) return subs[i];
    }
    return { key: subKey, label: subKey, icon: '✨' };
  }

  // Sous-cat suivante dans l'ordre SUBCATS (null si dernière)
  /**
   * Retourne la sous-catégorie suivante dans le cycle (modal infini).
   * Dernière subcat → revient à null (= "Tout").
   * @param {string} catSlug - Catégorie courante
   * @param {string|null} currentSubcat - Subcat active
   * @returns {string|null} Subcat suivante
   */
  function _nextSubcat(cat, currentSub) {
    var subs = getSubcategories(cat) || [];
    for (var i = 0; i < subs.length - 1; i++) {
      if (subs[i].key === currentSub) return subs[i + 1].key;
    }
    return null;
  }

  // Helper : bind events sur les nouvelles cartes ajoutées (append incremental)
  /**
   * Relie les listeners click/stepper sur les cartes fraîchement injectées dans le DOM.
   * Appelée après chaque append de produits (infinite scroll, subcat change).
   */
  function _bindAppendedCards() {
    dom.grid.querySelectorAll('.k-card:not([data-bound])').forEach(function(card) {
      card.dataset.bound = '1';
      bindCarouselDots(card);
      card.addEventListener('click', function(e) {
        if (e.target.closest('.k-card-fav') || e.target.closest('.k-card-add') || e.target.closest('.k-card-tab') || e.target.closest('.k-card-dots')) return;
        if (card.dataset.justSwiped === '1') return;
        openModal(card.dataset.id);
      });
    });
    dom.grid.querySelectorAll('.k-card-fav:not([data-bound])').forEach(function(btn) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function(e) { e.stopPropagation(); toggleFav(btn.dataset.fav, btn); });
    });
    dom.grid.querySelectorAll('.k-card-add:not([data-bound])').forEach(function(btn) {
      btn.dataset.bound = '1';
      btn.addEventListener('click', function(e) {
        e.stopPropagation();
        if (e.target.closest('.k-add-minus')) { quickRemove(btn.dataset.add, btn); }
        else { quickAdd(btn.dataset.add, btn); }
      });
    });
  }

  // Rendu : 1 page par sous-cat dans .k-grid + chrome header/tabs stocké pour injection
  /**
   * Render complet d'une sous-catégorie dans le pager plat mobile.
   * Injecte les chips + la grille produits filtrés.
   * @param {string} catSlug - Catégorie à afficher
   * @param {string|null} subcatSlug - Filtre actif (null = tout)
   */
  function _renderFlatSubcat() {
    var fs = state.flatSubcat;
    if (!fs) return '';
    var subs = getSubcategories(fs.cat) || [];

    // Chrome (header + tabs) — stocké pour _mountFlatSubcatChrome
    var headerHtml =
      '<div class="k-flat-subcat-header">' +
        '<button class="k-flat-subcat-close" id="k-flat-subcat-close" aria-label="Fermer">' +
          '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>' +
        '</button>' +
        '<span class="k-flat-subcat-crumb">' +
          '<span class="k-flat-subcat-cat">' + sanitize(fs.cat) + '</span>' +
          '<span class="k-flat-subcat-sep">›</span>' +
          '<span class="k-flat-subcat-sub" id="k-flat-subcat-sub-label"></span>' +
        '</span>' +
        '<span class="k-flat-subcat-count" id="k-flat-subcat-count"></span>' +
      '</div>' +
      '<div class="k-flat-subcat-tabs" id="k-flat-subcat-tabs">' +
        subs.map(function(s) {
          return '<button class="k-flat-subcat-tab" data-flat-sub="' + s.key + '">' +
            '<span class="k-flat-subcat-tab-icon">' + s.icon + '</span>' +
            '<span class="k-flat-subcat-tab-label">' + sanitize(s.label) + '</span>' +
          '</button>';
        }).join('') +
      '</div>';

    // Pages du pager (1 par sous-cat) — classe DÉDIÉE .k-flat-subcat-page
    // (indépendante de .k-cat-section pour éviter les collisions avec le pager principal)
    var pagesHtml = subs.map(function(s) {
      var prods = _productsForSubcat(fs.cat, s.key);
      var total = prods.length;
      var firstPage = prods.slice(0, state.pageSize);
      var gridHtml = firstPage.length > 0
        ? ('<div class="k-sec-grid">' + firstPage.map(_renderCard).join('') + '</div>')
        : ('<div class="k-flat-subcat-empty">' +
            '<div class="k-flat-subcat-empty-emoji">🔎</div>' +
            '<div class="k-flat-subcat-empty-title">Bientôt disponible</div>' +
            '<div class="k-flat-subcat-empty-sub">Swipe → pour voir d\'autres sélections</div>' +
          '</div>');
      return '<div class="k-flat-subcat-page" data-flat-sub="' + s.key +
             '" data-flat-total="' + total + '" data-flat-page="0">' +
          gridHtml +
          '<div class="k-flat-page-sentinel" data-flat-sub="' + s.key + '"></div>' +
        '</div>';
    }).join('');

    state._flatSubcatHeaderHtml = headerHtml;
    return pagesHtml;
  }

  // Injection/retrait du chrome (header + tabs) AU-DESSUS de .k-grid
  /**
   * Monte le chrome de navigation sous-catégorie (chips + header sticky).
   * Appelé une seule fois à l'activation du pager plat.
   * @param {HTMLElement} section - Élément section catégorie
   */
  function _mountFlatSubcatChrome() {
    // Couper le pager principal AVANT de monter le flat subcat
    destroyMobilePager();
    _unmountFlatSubcatChrome();
    var sec = document.getElementById('k-catalog-section');
    var grid = document.getElementById('k-grid');
    if (!sec || !grid) return;
    var wrapper = document.createElement('div');
    wrapper.id = 'k-flat-subcat-chrome';
    wrapper.innerHTML = state._flatSubcatHeaderHtml || '';
    sec.insertBefore(wrapper, grid);
  }
  /**
   * Démonte le chrome de navigation (cleanup avant changement de catégorie).
   * @param {HTMLElement} section - Élément section catégorie
   */
  function _unmountFlatSubcatChrome() {
    var old = document.getElementById('k-flat-subcat-chrome');
    if (old) old.remove();
  }

  // Bouton ✕ de sortie + clics sur les tabs
  /**
   * Initialise les contrôles de navigation inter-subcats dans la vue mobile plate.
   * Gère les chips, le swipe horizontal et la synchronisation de l'onglet actif.
   */
  function _bindFlatSubcatControls() {
    var closeBtn = document.getElementById('k-flat-subcat-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        state.flatSubcat = null;
        state.page = 0;
        renderGrid();
        var _sc = document.getElementById('k-page-scroll');
        if (_sc) _sc.scrollTo({ top: 0, behavior: 'auto' });
      });
    }
    document.querySelectorAll('.k-flat-subcat-tab').forEach(function(tab) {
      tab.addEventListener('click', function(e) {
        e.preventDefault();
        e.stopPropagation();
        _scrollFlatPagerToSub(tab.dataset.flatSub);
      });
    });
  }

  // Scroll horizontal vers une sous-cat précise
  /**
   * Fait défiler le pager plat (scroll-snap horizontal) jusqu'à la page de la subcat donnée.
   * @param {string} sub - Slug de la sous-catégorie cible
   */
  function _scrollFlatPagerToSub(sub) {
    var grid = document.getElementById('k-grid');
    if (!grid || !sub) return;
    var page = grid.querySelector('.k-flat-subcat-page[data-flat-sub="' + sub + '"]');
    if (!page) return;
    grid.scrollTo({ left: page.offsetLeft, behavior: 'smooth' });
    _syncFlatActiveTab(sub);
  }

  // Met à jour header + tab actif selon la page visible
  /**
   * Met à jour la chip active dans la barre subcats et le titre de section visible.
   * @param {string} sub - Slug de la sous-catégorie active
   */
  function _syncFlatActiveTab(sub) {
    if (!state.flatSubcat) return;
    state.flatSubcat.sub = sub;
    var fs = state.flatSubcat;
    var meta = _subcatMeta(fs.cat, sub);
    var lbl = document.getElementById('k-flat-subcat-sub-label');
    if (lbl) lbl.innerHTML = meta.icon + ' ' + sanitize(meta.label);
    var total = _productsForSubcat(fs.cat, sub).length;
    var cnt = document.getElementById('k-flat-subcat-count');
    if (cnt) cnt.textContent = total + ' produit' + (total > 1 ? 's' : '');
    var tabs = document.querySelectorAll('.k-flat-subcat-tab');
    var activeTab = null;
    tabs.forEach(function(t) {
      var on = t.dataset.flatSub === sub;
      t.classList.toggle('is-active', on);
      if (on) activeTab = t;
    });
    if (activeTab) {
      var bar = document.getElementById('k-flat-subcat-tabs');
      if (bar) {
        var left = activeTab.offsetLeft - bar.clientWidth / 2 + activeTab.clientWidth / 2;
        bar.scrollTo({ left: left, behavior: 'smooth' });
      }
    }
  }

  // Calcule --pager-h sans brancher les listeners de _setupMobilePager
  /**
   * Recalcule --pager-h (hauteur disponible pager) après resize ou rotation.
   * Utilise offsetHeight pour mesurer le header/nav runtime.
   */
  function _recalcPagerHeight() {
    var hdr = document.querySelector('.k-header');
    var hero = document.getElementById('k-hero');
    var cats = document.querySelector('.k-cats-shell');
    var usedH = (hdr ? hdr.offsetHeight : 0)
              + (hero ? hero.offsetHeight : 0)
              + (cats ? cats.offsetHeight : 0);
    document.documentElement.style.setProperty('--pager-h', (window.innerHeight - usedH) + 'px');
  }

  // Setup pager horizontal : scroll initial vers la sous-cat choisie + listener sync
  /**
   * Crée et injecte les pages du pager plat (une page par subcat).
   * Appelée à chaque chargement de catégorie en mode mobile.
   */
  /**
   * Prépare le layout du #k-grid pour le mode flat subcat.
   * Nettoie les styles inline du pager principal, ajoute les classes nécessaires.
   */
  function _prepareFlatSubcatLayout() {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    // Nettoyer les styles inline laissés par b-pager.js (translateX, etc.)
    grid.style.transform  = '';
    grid.style.transition = '';
    grid.style.width      = '';
    grid.style.height     = '';
    grid.style.position   = '';
    grid.style.overflow   = '';
    grid.style.willChange = '';
    grid.style.display    = '';
    // Classes CSS pour le layout flat (géré par CSS, pas par inline styles)
    grid.classList.add('k-grid-has-sections', 'k-grid-flat-subcat');
  }

  function _setupFlatSubcatPager() {
    var grid = document.getElementById('k-grid');
    if (!grid || !state.flatSubcat) return;
    _prepareFlatSubcatLayout();

    var fs = state.flatSubcat;
    var initialPage = grid.querySelector('.k-flat-subcat-page[data-flat-sub="' + fs.sub + '"]');
    if (initialPage) {
      requestAnimationFrame(function() {
        grid.scrollLeft = initialPage.offsetLeft;
        _syncFlatActiveTab(fs.sub);
      });
    }

    // Sync tab actif au swipe horizontal (guard double-binding)
    if (grid._flatScrollBound) {
      grid.removeEventListener('scroll', grid._flatScrollHandler);
    }
    var syncRaf = null;
    grid._flatScrollHandler = function() {
      if (syncRaf) cancelAnimationFrame(syncRaf);
      syncRaf = requestAnimationFrame(function() {
        var pages = grid.querySelectorAll('.k-flat-subcat-page');
        var scrollL = grid.scrollLeft;
        var bestPage = null;
        var bestDist = Infinity;
        pages.forEach(function(p) {
          var d = Math.abs(p.offsetLeft - scrollL);
          if (d < bestDist) { bestDist = d; bestPage = p; }
        });
        if (bestPage && state.flatSubcat && bestPage.dataset.flatSub !== state.flatSubcat.sub) {
          _syncFlatActiveTab(bestPage.dataset.flatSub);
        }
      });
    };
    grid.addEventListener('scroll', grid._flatScrollHandler, { passive: true });
    grid._flatScrollBound = true;

    _setupFlatSubcatDragScroll();
    _setupFlatSubcatTouchSwipe();
    _setupFlatSubcatInfiniteScroll();
  }

  // Fallback touch natif — certains mobiles n'émettent pas des pointerevents
  // exploitables pour le drag scroll, donc on double avec touchstart/move/end.
  // touchmove est en passive: false pour pouvoir faire preventDefault et
  // empêcher le browser de scroller verticalement quand on swipe horizontalement.
  // ── Helper partagé : détecte si le pager sous-cat plat est actif ──
  /**
   * @brief _isFlatActive — Détecte si le pager Temu (mode flat subcat) est actif
   * Conditions : mobile (<900px) + state.flatSubcat + grille DOM présente
   * @returns {boolean}
   */
    function _isFlatActive() {
    var _g = document.getElementById('k-grid');
    return window.innerWidth < 900 &&
      !!state.flatSubcat &&
      !!_g &&
      _g.classList.contains('k-grid-flat-subcat');
  }

  /**
   * Active le swipe tactile horizontal sur le pager plat via touch events.
   * Calcule la vélocité et déclenche la navigation subcat si seuil atteint.
   */
  function _setupFlatSubcatTouchSwipe() {
    var grid = document.getElementById('k-grid');
    if (!grid || grid._flatTouchBound) return;
    grid._flatTouchBound = true;
    var active = false;
    var dragging = false;
    var startX = 0, startY = 0, startScrollLeft = 0;


    grid.addEventListener('touchstart', function(e) {
      if (!_isFlatActive()) return;
      if (e.touches.length !== 1) return;
      var t = e.touches[0];
      // Respecter les vrais boutons
      if (e.target.closest(
        'button, a, input, textarea, select, .k-card-add, .k-card-fav, .k-flat-subcat-tab, .k-flat-subcat-close'
      )) return;
      active = true;
      dragging = false;
      startX = t.clientX;
      startY = t.clientY;
      startScrollLeft = grid.scrollLeft;
    }, { capture: true, passive: true });

    grid.addEventListener('touchmove', function(e) {
      if (!active || !_isFlatActive()) return;
      var t = e.touches[0];
      var dx = t.clientX - startX;
      var dy = t.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        // Geste vertical → on laisse la page interne scroller
        if (Math.abs(dy) > Math.abs(dx)) {
          active = false;
          return;
        }
        dragging = true;
        grid._flatDidDrag = true;
        grid.classList.add('is-flat-dragging');
      }
      // Horizontal confirmé : on prend le contrôle
      if (e.cancelable) e.preventDefault();
      e.stopPropagation();
      grid.scrollLeft = startScrollLeft - dx;
    }, { capture: true, passive: false });

    function endTouch(e) {
      if (!active) return;
      active = false;
      if (dragging) {
        dragging = false;
        setTimeout(function() {
          grid._flatDidDrag = false;
          grid.classList.remove('is-flat-dragging');
        }, 180);
      }
    }
    grid.addEventListener('touchend', endTouch, { capture: true, passive: true });
    grid.addEventListener('touchcancel', endTouch, { capture: true, passive: true });
  }

  // Drag-scroll programmatique : force le pager sous-cat à gagner le swipe
  // horizontal contre tout concurrent (carrousels cartes, auto-advance, etc.)
  /**
   * Active le drag-scroll souris (desktop) sur le pager plat.
   * Permet de faire glisser le pager avec la souris comme un doigt.
   */
  function _setupFlatSubcatDragScroll() {
    var grid = document.getElementById('k-grid');
    if (!grid || grid._flatDragBound) return;
    grid._flatDragBound = true;
    var down = false;
    var dragging = false;
    var startX = 0;
    var startY = 0;
    var startScrollLeft = 0;
    grid.addEventListener('pointerdown', function(e) {
      if (!_isFlatActive()) return;
      /* Ne pas voler les vrais boutons */
      if (e.target.closest(
        'button, a, input, textarea, select, .k-card-add, .k-card-fav, .k-flat-subcat-tab, .k-flat-subcat-close'
      )) return;
      down = true;
      dragging = false;
      startX = e.clientX;
      startY = e.clientY;
      startScrollLeft = grid.scrollLeft;
    }, true);
    grid.addEventListener('pointermove', function(e) {
      if (!down || !_isFlatActive()) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      if (!dragging) {
        if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
        /* Geste vertical : on laisse la page interne scroller */
        if (Math.abs(dy) > Math.abs(dx)) {
          down = false;
          dragging = false;
          return;
        }
        dragging = true;
        grid._flatDidDrag = true;
        grid.classList.add('is-flat-dragging');
      }
      e.preventDefault();
      e.stopPropagation();
      grid.scrollLeft = startScrollLeft - dx;
    }, { capture: true, passive: false });
    function endDrag(e) {
      if (!down) return;
      if (dragging) {
        e.preventDefault();
        e.stopPropagation();
        setTimeout(function() {
          grid._flatDidDrag = false;
          grid.classList.remove('is-flat-dragging');
        }, 180);
      }
      down = false;
      dragging = false;
    }
    grid.addEventListener('pointerup', endDrag, true);
    grid.addEventListener('pointercancel', endDrag, true);
    /* Empêche l'ouverture de modale après un swipe horizontal */
    grid.addEventListener('click', function(e) {
      if (!grid._flatDidDrag) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      grid._flatDidDrag = false;
      grid.classList.remove('is-flat-dragging');
    }, true);
  }

  // IO par page → pagination indépendante par sous-cat
  /**
   * Installe un IntersectionObserver sur le sentinel de fin de page.
   * Charge la page suivante automatiquement quand l'utilisateur atteint le bas.
   */
  function _setupFlatSubcatInfiniteScroll() {
    var grid = document.getElementById('k-grid');
    if (!grid) return;
    grid.querySelectorAll('.k-flat-subcat-page').forEach(function(page) {
      if (page._flatIO) { try { page._flatIO.disconnect(); } catch(e){} page._flatIO = null; }
      var sentinel = page.querySelector('.k-flat-page-sentinel');
      if (!sentinel) return;
      var io = new IntersectionObserver(function(entries) {
        if (entries[0].isIntersecting) _appendNextToFlatPage(page);
      }, { root: page, rootMargin: '0px 0px 300px 0px', threshold: 0.01 });
      io.observe(sentinel);
      page._flatIO = io;
    });
  }

  // Append next batch à une page donnée ; fin de parcours = message + bouton swipe
  /**
   * Injecte les produits de la page suivante dans la page subcat courante.
   * @param {number} page - Index de page à charger (0-indexed)
   */
  function _appendNextToFlatPage(page) {
    var sub = page.dataset.flatSub;
    var fs = state.flatSubcat;
    if (!fs) return;
    var currentPage = parseInt(page.dataset.flatPage || '0', 10);
    var list = _productsForSubcat(fs.cat, sub);
    var start = (currentPage + 1) * state.pageSize;

    if (start >= list.length) {
      if (!page.querySelector('.k-flat-page-end')) {
        var nextSub = _nextSubcat(fs.cat, sub);
        var endHtml =
          '<div class="k-flat-page-end">' +
            '<div class="k-flat-page-end-emoji">✨</div>' +
            '<div class="k-flat-page-end-title">Tout vu dans ' + sanitize(_subcatMeta(fs.cat, sub).label) + '</div>' +
            (nextSub
              ? '<button class="k-flat-page-end-next" data-next-sub="' + nextSub + '">Swipe pour ' +
                  _subcatMeta(fs.cat, nextSub).icon + ' ' + sanitize(_subcatMeta(fs.cat, nextSub).label) +
                  ' →</button>'
              : '<div class="k-flat-page-end-sub">Dernière sous-catégorie !</div>') +
          '</div>';
        var gridEl = page.querySelector('.k-sec-grid');
        if (gridEl) {
          gridEl.insertAdjacentHTML('afterend', endHtml);
        } else {
          var sent = page.querySelector('.k-flat-page-sentinel');
          if (sent) sent.insertAdjacentHTML('beforebegin', endHtml);
        }
        var nextBtn = page.querySelector('.k-flat-page-end-next');
        if (nextBtn) {
          nextBtn.addEventListener('click', function(e) {
            e.preventDefault();
            e.stopPropagation();
            _scrollFlatPagerToSub(nextBtn.dataset.nextSub);
          });
        }
      }
      return;
    }

    page.dataset.flatPage = String(currentPage + 1);
    var nextItems = list.slice(start, start + state.pageSize);
    var fragment = nextItems.map(_renderCard).join('');
    var gridEl = page.querySelector('.k-sec-grid');
    if (gridEl) {
      gridEl.insertAdjacentHTML('beforeend', fragment);
    } else {
      var sent = page.querySelector('.k-flat-page-sentinel');
      if (sent) sent.insertAdjacentHTML('beforebegin', '<div class="k-sec-grid">' + fragment + '</div>');
    }
    _bindAppendedCards();
  }

  /**
   * Point d'entrée public : initialise le pager flat sous-catégories.
   * Appelé depuis boutique.js §13 après chargement des produits.
   */
  function initFlatSubcat() {
    _setupFlatSubcatPager();
    _installSubchipListener();
  }

  /**
   * Listener délégué pour les chips .k-sec-subchip (flat subcat mode).
   * Déplacé de boutique.js ici pour accéder à renderGrid par import direct
   * (évite le pont window.renderGrid).
   * Capture phase + stopImmediatePropagation — source unique, installé une seule fois.
   */
  function _installSubchipListener() {
    document.addEventListener('click', function(e) {
      var chip = e.target.closest('.k-sec-subchip');
      if (!chip) return;
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      var cat = chip.dataset.secCat;
      var sub = chip.dataset.secSub;
      if (!cat || !sub) return;
      if (!isDesktop()) {
        state.flatSubcat = { cat: cat, sub: sub };
        state.page = 0;
        renderGrid();
        var _sc = document.getElementById('k-page-scroll');
        if (_sc) _sc.scrollTo({ top: 0, behavior: 'auto' });
      } else {
        if (!state.sectionSubcats) state.sectionSubcats = {};
        state.sectionSubcats[cat] = (state.sectionSubcats[cat] === sub) ? null : sub;
        renderGrid();
      }
    }, true);
  }

  /**
   * Render subcat chips (stub — le rendu réel est inline dans b-modal.js renderSuggestions).
   * Conservé pour compatibilité import.
   * @param {string} cat - Catégorie courante
   */
  function renderSubcatChips(cat) {
    // no-op stub: chips rendered inline in renderSuggestions (b-modal.js)
  }

export {
  initFlatSubcat, renderSubcatChips,
  _setupFlatSubcatPager, _renderFlatSubcat,
  _mountFlatSubcatChrome, _unmountFlatSubcatChrome,
  _bindFlatSubcatControls, _scrollFlatPagerToSub, _syncFlatActiveTab,
  _recalcPagerHeight,
};
