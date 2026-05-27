/**
 * @module b-group-view
 * @owner sélecteurs .k-group-* — onglet dédié panier partagé
 *
 * Doctrine v4 — deux phases distinctes :
 *
 *   PHASE OUVERTE (metadata.settlement_open = false)
 *     → Participant : formulaire d'engagement indicatif (nom + téléphone + montant)
 *       Aucun Stripe. Bouton : "Enregistrer mon engagement"
 *     → Créateur : voir les engagements, modifier le panier, bouton "Passer au règlement"
 *
 *   PHASE RÈGLEMENT (metadata.settlement_open = true)
 *     → Participant : saisit son téléphone, retrouve son engagement verrouillé,
 *       voit le montant fixé, bouton "Payer X KMF" → Stripe Checkout
 *     → Créateur : suivi des paiements, finalisation possible
 *
 * Règle absolue : tout vit dans la boutique. Pas de page annexe.
 */

import { state } from './b-store.js';
import { showToast } from './b-cart-core.js';
import { sanitize, fmt, apiGet, apiPost } from './b-utils.js';
import { saveCart } from './b-cart-core.js';  // FIX CHARGER — repeupler state.cart depuis snapshot
import { showBanner, hideBanner } from './b-group-banner.js';

/* ── Token participant URL ─────────────────────────────────────── */
export function detectParticipantToken() {
  const url = new URL(window.location.href);
  const qp = url.searchParams.get('p');
  if (qp) return qp;
  const m = url.pathname.match(/\/cart\/shared\/([^/?#]+)/);
  return m ? m[1] : null;
}

/* ── Conteneur ─────────────────────────────────────────────────── */
function getOrCreateEl() {
  let el = document.getElementById('k-group-view');
  if (!el) {
    el = document.createElement('div');
    el.id = 'k-group-view';
    el.className = 'k-group-view';
    const anchor = document.getElementById('k-fav-view')
                || document.getElementById('k-catalog-section');
    anchor?.after(el);
  }
  return el;
}

/* ── Polling ───────────────────────────────────────────────────── */
let _pollTimer = null;
function startPolling(cartId, onRefresh) {
  stopPolling();
  _pollTimer = setInterval(async () => {
    if (!document.getElementById('k-group-view')?.classList.contains('show')) {
      stopPolling(); return;
    }
    try {
      const fresh = await apiGet(`/api/shared-carts/${cartId}`);
      if (!fresh) return;
      // Priorité : commitments inclus dans la réponse owner (§2.4 — Option B)
      // Fallback : fetch séparé si l'endpoint ne les inclut pas encore
      let freshCommitments = fresh.commitments || [];
      if (!freshCommitments.length) {
        try {
          const token = fresh.cart?.token;
          if (token) {
            const cRes = await fetch(`/api/shared-carts/public/${token}/commitments`, { credentials: 'include' });
            if (cRes.ok) { const cd = await cRes.json(); freshCommitments = cd.commitments || []; }
          }
        } catch (_) {}
      }
      onRefresh(fresh, freshCommitments);
    } catch (_) {}
  }, 30_000);
}
function stopPolling() {
  if (_pollTimer) { clearInterval(_pollTimer); _pollTimer = null; }
}

/* ── Helpers ───────────────────────────────────────────────────── */
function r(n) { return Math.round(Number(n) || 0); }
function pct(confirmed, total) {
  if (!total) return 0;
  return Math.max(0, Math.min(100, Math.round((confirmed / total) * 100)));
}
function statusLabel(status, isSettlementOpen) {
  if (isSettlementOpen) return '🔐 En règlement';
  return {
    active: '🟢 Ouvert',
    partially_funded: '🟡 Partiellement financé',
    fully_funded: '✅ Financé',
    converted_to_order: '📦 Clôturé',
    finalized: '📦 Clôturé',
    cancelled: '❌ Annulé',
    expired: '⏱️ Expiré',
  }[status] || status;
}
function remainingKmf(cart) {
  const total = r(cart.total_kmf_snapshot);
  const confirmed = r(cart.contributed_kmf);
  return Math.max(0, r(cart.remaining_kmf) || total - confirmed);
}
function metaOf(cart) {
  if (!cart?.metadata) return {};
  if (typeof cart.metadata === 'object') return cart.metadata;
  try { return JSON.parse(cart.metadata); } catch (_) { return {}; }
}
function isSettlementOpen(cart) {
  return metaOf(cart).settlement_open === true;
}

/* ── Persistance participant — source unique : onglet Groupe ─────────────── */
const PARTICIPANT_TOKEN_KEY = 'kmrc_group_participant_token';
function participantCommitmentKey(token) { return `kmrc_group_commitment_${token}`; }

function readJsonStorage(key) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) {}
}

function rememberParticipantToken(token) {
  if (!token) return;
  try { localStorage.setItem(PARTICIPANT_TOKEN_KEY, token); } catch (_) {}
}

function recallParticipantToken() {
  try { return localStorage.getItem(PARTICIPANT_TOKEN_KEY) || null; } catch (_) { return null; }
}

function rememberParticipantCommitment(token, commitment) {
  if (!token || !commitment) return;
  writeJsonStorage(participantCommitmentKey(token), {
    ...commitment,
    saved_at: Date.now(),
  });
}

function readParticipantCommitment(token) {
  if (!token) return null;
  return readJsonStorage(participantCommitmentKey(token));
}

function consumeSharedPaymentReturn() {
  const url = new URL(window.location.href);
  const value = url.searchParams.get('shared_payment');
  if (!value) return null;
  try {
    url.searchParams.delete('shared_payment');
    window.history.replaceState({}, '', url.toString());
  } catch (_) {}
  return value;
}

function settlementExpiresAt(cart) {
  const meta = metaOf(cart);
  if (!meta.settlement_open || !meta.settlement_opened_at) return null;
  const windowH = Number(meta.settlement_window_hours) || 48;
  return new Date(new Date(meta.settlement_opened_at).getTime() + windowH * 3_600_000);
}

function timeRemaining(expiresAt) {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return 'Expiré';
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h >= 48) return `${Math.floor(h / 24)}j restants`;
  if (h >= 1)  return `${h}h${m > 0 ? m + 'min' : ''} restantes`;
  return `${Math.max(1, m)}min restantes`;
}

async function ensureCreatorCartState() {
  if (state.shareToken && state.shareId) return true;
  try {
    const mod = await import('./b-share-cart.js');
    const cart = await mod.restoreSharedCartFromBackend?.({ silent: true });
    return !!cart;
  } catch (_) {
    return false;
  }
}

function injectStyles() {
  if (document.getElementById('k-group-view-v4-styles')) return;
  const s = document.createElement('style');
  s.id = 'k-group-view-v4-styles';
  s.textContent = `


.k-group-view{
  max-width:1180px;
  margin:24px auto 80px;
  padding:0 24px;
  box-sizing:border-box;
}
.k-group-view > *{
  max-width:720px;
}
.k-group-view .k-group-header{
  background:var(--white,#fff);
  border:1px solid var(--border);
  border-bottom:0;
  border-radius:24px 24px 0 0;
  padding:20px 28px 8px;
  box-shadow:0 18px 50px rgba(30,40,25,.08);
}
.k-group-view .k-group-header h2{
  margin:0 0 8px;
  font-size:23px;
  line-height:1.2;
  color:var(--text);
}
.k-group-view .k-group-subhead{
  margin:0;
  font-size:15px;
  line-height:1.45;
  color:var(--text-muted);
}
.k-group-view .k-group-progress-card{
  background:var(--white,#fff);
  border:1px solid var(--border);
  border-radius:0 0 24px 24px;
  padding:20px 28px 22px;
  margin:0 0 16px;
  box-shadow:0 18px 50px rgba(30,40,25,.08);
}
.k-group-view .k-group-card,
.k-group-view .k-group-actions-card,
.k-group-view .k-group-contribute-card,
.k-group-view .k-group-items-card{
  background:var(--white,#fff);
  border:1px solid var(--border);
  border-radius:24px;
  padding:20px 28px;
  margin:12px 0 0;
  box-shadow:0 14px 42px rgba(30,40,25,.06);
}
.k-group-view .k-group-section-title{
  font-size:18px;
  font-weight:800;
  margin:0 0 14px;
  color:var(--text);
}
.k-group-view .k-group-creator-actions{
  display:grid;
  grid-template-columns:1fr 1fr;
  gap:12px;
}
.k-group-view .k-group-btn{
  min-height:50px;
  border-radius:999px;
}
.k-group-view .k-group-self-toggle{
  background:var(--white,#fff);
  border:1px dashed var(--border);
  border-radius:20px;
  padding:16px 18px;
  margin:12px 0 0;
  font-size:15px;
  box-shadow:0 10px 32px rgba(30,40,25,.04);
}
.k-group-view .k-group-progress{
  height:8px;
  background:rgba(31,122,84,.10);
  border-radius:999px;
  overflow:hidden;
}
.k-group-view .k-group-progress-bar{
  display:block;
  height:100%;
  background:var(--green,#2f8f46);
  border-radius:999px;
}
@media(min-width:1100px){
  .k-group-view{
    max-width:1180px;
  }
}
@media(max-width:700px){
  .k-group-view{
    max-width:none;
    margin:22px auto 72px;
    padding:0 14px;
  }
  .k-group-view > *{
    max-width:none;
  }
  .k-group-view .k-group-header{
    padding:20px 18px 8px;
    border-radius:20px 20px 0 0;
  }
  .k-group-view .k-group-header h2{
    font-size:21px;
  }
  .k-group-view .k-group-progress-card{
    padding:18px;
    border-radius:0 0 20px 20px;
  }
  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card{
    padding:18px;
    border-radius:20px;
  }
  .k-group-view .k-group-creator-actions{
    grid-template-columns:1fr;
  }
}



/* Compact creator cockpit — optimiser la surface utile desktop */
@media(min-width:1000px){
  #k-group-view.k-group-view{
    margin:0 auto 56px!important;
    padding:0 32px!important;
  }

  #k-group-view.k-group-view > *{
    width:700px!important;
    max-width:700px!important;
  }

  .k-group-view .k-group-header{
    padding:16px 24px 8px!important;
    border-radius:20px 20px 0 0!important;
  }

  .k-group-view .k-group-header h2{
    font-size:22px!important;
    margin:0 0 4px!important;
  }

  .k-group-view .k-group-subhead{
    font-size:14px!important;
    line-height:1.35!important;
  }

  .k-group-view .k-group-progress-card{
    padding:16px 24px 18px!important;
    margin:0 0 14px!important;
    border-radius:0 0 20px 20px!important;
  }

  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card{
    padding:16px 24px!important;
    margin:12px 0 0!important;
    border-radius:20px!important;
  }

  .k-group-view .k-group-section-title,
  .k-group-view h3{
    font-size:18px!important;
    margin:0 0 10px!important;
  }

  .k-group-view .k-group-self-toggle{
    margin:10px 0 0!important;
    padding:13px 16px!important;
    border-radius:18px!important;
    min-height:46px!important;
  }

  .k-group-view .k-group-creator-actions{
    gap:10px!important;
  }

  .k-group-view .k-group-btn{
    min-height:44px!important;
    padding:10px 16px!important;
  }

  .k-group-view .k-group-share-hint,
  .k-group-view .k-group-finalize-hint{
    margin:8px 0 0!important;
    font-size:12px!important;
    line-height:1.35!important;
  }

  .k-group-view hr{
    margin:12px 0!important;
  }

  .k-group-view select,
  .k-group-view input,
  .k-group-view textarea{
    min-height:42px!important;
  }
}

@media(max-width:999px){
  #k-group-view.k-group-view{
    margin:10px auto 56px!important;
  }

  .k-group-view .k-group-header{
    padding:16px 16px 8px!important;
  }

  .k-group-view .k-group-progress-card,
  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card{
    padding:16px!important;
    margin-top:10px!important;
  }
}

/* Desktop cockpit layout : colonne gauche + réserve articles droite */
@media(min-width:1000px){
  #k-group-view.k-group-view{
    max-width:1240px!important;
    width:100%!important;
    margin:8px auto 64px!important;
    padding:0 32px!important;
    box-sizing:border-box!important;
  }

  #k-group-view.k-group-view > *{
    width:720px!important;
    max-width:720px!important;
    margin-left:0!important;
    margin-right:auto!important;
  }
}

@media(min-width:1400px){
  #k-group-view.k-group-view{
    max-width:1280px!important;
  }

  #k-group-view.k-group-view > *{
    width:740px!important;
    max-width:740px!important;
  }
}

@media(max-width:999px){
  #k-group-view.k-group-view{
    max-width:none!important;
    width:100%!important;
    margin:12px auto 64px!important;
    padding:0 14px!important;
  }

  #k-group-view.k-group-view > *{
    width:auto!important;
    max-width:none!important;
    margin-left:0!important;
    margin-right:0!important;
  }
}


/* SAFE V2 — cockpit groupe compact desktop, sans changement HTML */
@media(min-width:1000px){
  #k-group-view.k-group-view{
    max-width:1240px!important;
    width:100%!important;
    margin:0 auto 56px!important;
    padding:0 32px!important;
    box-sizing:border-box!important;
  }

  #k-group-view.k-group-view > *{
    width:700px!important;
    max-width:700px!important;
    margin-left:0!important;
    margin-right:auto!important;
  }

  .k-group-view .k-group-header{
    padding:14px 22px 8px!important;
    border-radius:18px 18px 0 0!important;
  }

  .k-group-view .k-group-header h2{
    font-size:22px!important;
    margin:0 0 3px!important;
    line-height:1.15!important;
  }

  .k-group-view .k-group-subhead{
    font-size:14px!important;
    line-height:1.3!important;
  }

  .k-group-view .k-group-progress-card{
    padding:14px 22px 16px!important;
    margin:0 0 10px!important;
    border-radius:0 0 18px 18px!important;
  }

  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card{
    padding:14px 22px!important;
    margin:10px 0 0!important;
    border-radius:18px!important;
  }

  .k-group-view .k-group-self-toggle{
    margin:10px 0 0!important;
    padding:11px 14px!important;
    min-height:42px!important;
    border-radius:16px!important;
    font-size:14px!important;
  }

  .k-group-view .k-group-creator-actions{
    display:grid!important;
    grid-template-columns:1fr 1fr!important;
    gap:10px!important;
  }

  .k-group-view .k-group-btn{
    min-height:42px!important;
    padding:9px 14px!important;
    border-radius:999px!important;
  }

  .k-group-view h3,
  .k-group-view .k-group-section-title{
    font-size:18px!important;
    margin:0 0 9px!important;
  }

  .k-group-view .k-group-share-hint,
  .k-group-view .k-group-finalize-hint{
    margin:7px 0 0!important;
    font-size:12px!important;
    line-height:1.3!important;
  }

  .k-group-view hr{
    margin:10px 0!important;
  }

  .k-group-view select,
  .k-group-view input,
  .k-group-view textarea{
    min-height:40px!important;
  }
}

@media(max-width:999px){
  #k-group-view.k-group-view{
    margin:10px auto 56px!important;
    padding:0 14px!important;
  }

  #k-group-view.k-group-view > *{
    width:auto!important;
    max-width:none!important;
    margin-left:0!important;
    margin-right:0!important;
  }

  .k-group-view .k-group-header{
    padding:15px 16px 8px!important;
  }

  .k-group-view .k-group-progress-card,
  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card{
    padding:15px 16px!important;
    margin-top:10px!important;
  }
}


/* SAFE V2-B — cockpit avec articles à droite */
.k-group-cockpit{
  display:block;
}
.k-group-main-col{
  min-width:0;
}
.k-group-side-panel{
  margin-top:12px;
}
.k-group-side-card{
  background:var(--white,#fff);
  border:1px solid var(--border);
  border-radius:18px;
  padding:14px;
  box-shadow:0 14px 42px rgba(30,40,25,.06);
}
.k-group-side-card + .k-group-side-card{
  margin-top:10px;
}
.k-group-side-head{
  display:flex;
  align-items:baseline;
  justify-content:space-between;
  gap:10px;
  margin-bottom:10px;
}
.k-group-side-head strong{
  font-size:15px;
  color:var(--text);
}
.k-group-side-head span{
  font-size:12px;
  color:var(--text-muted);
}
.k-group-side-list{
  display:grid;
  gap:9px;
}
.k-group-side-item{
  display:grid;
  grid-template-columns:44px 1fr;
  gap:10px;
  align-items:center;
}
.k-group-side-item img,
.k-group-side-item-fallback{
  width:44px;
  height:44px;
  border-radius:12px;
  object-fit:cover;
  background:var(--sand);
  display:flex;
  align-items:center;
  justify-content:center;
}
.k-group-side-item-main{
  min-width:0;
}
.k-group-side-item-main strong{
  display:block;
  font-size:13px;
  line-height:1.25;
  color:var(--text);
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
.k-group-side-item-main span{
  display:block;
  margin-top:3px;
  font-size:12px;
  color:var(--text-muted);
}
.k-group-side-empty{
  margin:0;
  font-size:13px;
  color:var(--text-muted);
}
.k-group-side-total{
  display:flex;
  justify-content:space-between;
  align-items:center;
  border-top:1px solid var(--border);
  margin-top:12px;
  padding-top:10px;
  font-size:13px;
}
.k-group-side-total span{
  color:var(--text-muted);
}
.k-group-side-total strong{
  color:var(--text);
}
.k-group-side-help ol{
  margin:8px 0 0 18px;
  padding:0;
  color:var(--text-muted);
  font-size:13px;
  line-height:1.5;
}

@media(min-width:1000px){
  #k-group-view.k-group-view{
    max-width:1240px!important;
    margin:0 auto 56px!important;
    padding:0 32px!important;
  }

  #k-group-view.k-group-view > *{
    width:auto!important;
    max-width:none!important;
  }

  .k-group-cockpit{
    display:grid;
    grid-template-columns:minmax(620px,700px) minmax(300px,360px);
    gap:20px;
    align-items:start;
  }

  .k-group-side-panel{
    margin-top:0;
    position:sticky;
    top:96px;
  }
}

@media(max-width:999px){
  .k-group-cockpit{
    display:block;
  }
}


/* SAFE V2-C — condensation cockpit groupe */
@media(min-width:1000px){
  #k-group-view.k-group-view{
    margin:-18px auto 44px!important;
    padding:0 32px!important;
  }

  .k-group-cockpit{
    grid-template-columns:minmax(600px,680px) minmax(300px,340px)!important;
    gap:16px!important;
  }

  .k-group-view .k-group-header{
    padding:12px 20px 7px!important;
    border-radius:16px 16px 0 0!important;
  }

  .k-group-view .k-group-header h2{
    font-size:21px!important;
    margin:0 0 2px!important;
    line-height:1.12!important;
  }

  .k-group-view .k-group-subhead{
    font-size:13px!important;
    line-height:1.25!important;
  }

  .k-group-view .k-group-progress-card{
    padding:12px 20px 14px!important;
    margin:0 0 8px!important;
    border-radius:0 0 16px 16px!important;
  }

  .k-group-view .k-group-progress-card h3,
  .k-group-view .k-group-progress-card strong{
    margin-top:0!important;
  }

  .k-group-view .k-group-progress{
    height:6px!important;
    margin:7px 0!important;
  }

  .k-group-view .k-group-self-toggle{
    margin:8px 0 0!important;
    padding:9px 12px!important;
    min-height:38px!important;
    border-radius:14px!important;
    font-size:13px!important;
  }

  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card{
    padding:12px 20px!important;
    margin:8px 0 0!important;
    border-radius:16px!important;
  }

  .k-group-view h3,
  .k-group-view .k-group-section-title{
    font-size:17px!important;
    margin:0 0 8px!important;
  }

  .k-group-view .k-group-creator-actions{
    gap:8px!important;
  }

  .k-group-view .k-group-btn{
    min-height:38px!important;
    padding:8px 12px!important;
    font-size:13px!important;
  }

  .k-group-view .k-group-share-hint,
  .k-group-view .k-group-finalize-hint{
    margin:6px 0 0!important;
    font-size:11.5px!important;
    line-height:1.25!important;
  }

  .k-group-view hr{
    margin:8px 0!important;
  }

  .k-group-view label{
    font-size:12px!important;
    margin-bottom:4px!important;
  }

  .k-group-view select,
  .k-group-view input,
  .k-group-view textarea{
    min-height:36px!important;
    padding-top:7px!important;
    padding-bottom:7px!important;
    font-size:13px!important;
  }

  .k-group-side-panel{
    top:84px!important;
  }

  .k-group-side-card{
    padding:12px!important;
    border-radius:16px!important;
  }

  .k-group-side-card + .k-group-side-card{
    margin-top:8px!important;
  }

  .k-group-side-head{
    margin-bottom:8px!important;
  }

  .k-group-side-head strong{
    font-size:14px!important;
  }

  .k-group-side-head span{
    font-size:11.5px!important;
  }

  .k-group-side-list{
    gap:7px!important;
  }

  .k-group-side-item{
    grid-template-columns:38px 1fr!important;
    gap:8px!important;
  }

  .k-group-side-item img,
  .k-group-side-item-fallback{
    width:38px!important;
    height:38px!important;
    border-radius:10px!important;
  }

  .k-group-side-item-main strong{
    font-size:12.5px!important;
  }

  .k-group-side-item-main span{
    font-size:11.5px!important;
    margin-top:2px!important;
  }

  .k-group-side-total{
    margin-top:8px!important;
    padding-top:8px!important;
    font-size:12px!important;
  }

  .k-group-side-help ol{
    margin-top:6px!important;
    font-size:12px!important;
    line-height:1.35!important;
  }
}

@media(max-width:999px){
  #k-group-view.k-group-view{
    margin:6px auto 48px!important;
  }

  .k-group-view .k-group-header,
  .k-group-view .k-group-progress-card,
  .k-group-view .k-group-card,
  .k-group-view .k-group-actions-card,
  .k-group-view .k-group-contribute-card,
  .k-group-view .k-group-items-card,
  .k-group-side-card{
    padding:13px 14px!important;
  }
}


/* SAFE V2-D — mini guide créateur dans la colonne gauche */
.k-group-mini-guide{
  display:grid;
  grid-template-columns:repeat(3,1fr);
  gap:8px;
  background:rgba(31,122,84,.06);
  border:1px solid rgba(31,122,84,.14);
  border-radius:14px;
  padding:9px 10px;
  margin:8px 0 8px;
}
.k-group-mini-guide span{
  display:flex;
  align-items:center;
  gap:6px;
  min-width:0;
  font-size:12px;
  line-height:1.25;
  color:var(--text);
  white-space:nowrap;
}
.k-group-mini-guide b{
  display:inline-flex;
  align-items:center;
  justify-content:center;
  width:18px;
  height:18px;
  flex:0 0 18px;
  border-radius:999px;
  background:var(--green,#2f8f46);
  color:#fff;
  font-size:11px;
  font-weight:800;
}
@media(max-width:700px){
  .k-group-mini-guide{
    grid-template-columns:1fr;
    gap:6px;
  }
}

.k-group-phase-badge{display:inline-block;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;margin-bottom:10px}
.k-group-phase-badge--open{background:rgba(31,122,84,.12);color:#1f7a54}
.k-group-phase-badge--settlement{background:rgba(230,130,0,.12);color:#b45309}
.k-group-funded-callout{border:1px solid rgba(31,122,84,.28);background:rgba(31,122,84,.09);border-radius:18px;padding:16px;margin-top:14px}
.k-group-funded-callout strong{display:block;font-size:16px;margin-bottom:6px;color:var(--text)}
.k-group-funded-callout p{font-size:13px;line-height:1.45;color:var(--text-muted);margin:0 0 12px}
.k-group-disabled-finalize{opacity:.72;cursor:not-allowed!important;background:var(--sand-dark)!important;color:var(--text-muted)!important}
.k-group-share-hint,.k-group-finalize-hint{font-size:12px;line-height:1.45;color:var(--text-muted);margin:10px 0 0}
.k-group-split-hint{background:#ede7f6;color:#4a2d9e;padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;margin:0 0 12px;line-height:1.4}
.k-group-self-toggle{margin-top:12px;width:100%;border:1px dashed var(--border);background:var(--sand);color:var(--text);border-radius:14px;padding:11px;font-weight:800;cursor:pointer}
.k-group-self-panel[hidden]{display:none!important}
.k-group-self-panel:not([hidden]) + .k-group-self-toggle{display:none!important}
.k-group-self-toggle.is-open{display:none!important}
.k-group-locked-amount{display:flex;align-items:center;gap:10px;background:rgba(31,122,84,.09);border:1px solid rgba(31,122,84,.2);border-radius:14px;padding:14px 16px;margin:12px 0}
.k-group-locked-amount strong{font-size:20px;color:var(--text)}
.k-group-locked-amount span{font-size:12px;color:var(--text-muted);line-height:1.3}
.k-group-commitment-list{margin:8px 0 0}
.k-group-commitment-row{display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)}
.k-group-commitment-row:last-child{border-bottom:none}
.k-group-commitment-name{flex:1;font-size:14px;font-weight:600}
.k-group-commitment-amount{font-size:14px;color:var(--text)}
.k-group-commitment-status{font-size:12px;color:var(--text-muted)}
.k-group-settlement-summary{background:var(--sand);border-radius:14px;padding:12px 14px;margin:10px 0;font-size:13px}
.k-group-settlement-summary strong{display:block;font-size:15px;margin-bottom:6px}

.k-group-saved-commitment{border:1px solid rgba(31,122,84,.24);background:rgba(31,122,84,.08);border-radius:14px;padding:13px 14px;margin:0 0 12px}
.k-group-saved-commitment strong{display:block;font-size:14px;margin-bottom:3px;color:var(--text)}
.k-group-saved-commitment span{display:block;font-size:12px;color:var(--text-muted);line-height:1.35}
.k-group-saved-commitment button{margin-top:10px;width:100%;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:12px;padding:10px;font-weight:800;cursor:pointer}
.k-group-eng-fields[hidden]{display:none!important}
.k-group-items-toggle{width:100%;border:0;background:transparent;display:flex;align-items:center;justify-content:space-between;gap:10px;padding:0;cursor:pointer;text-align:left;color:inherit;font:inherit}
.k-group-items-toggle strong{font-size:15px}
.k-group-items-toggle span{font-size:12px;color:var(--text-muted)}
.k-group-items-chevron{transition:transform .2s ease;font-size:13px!important}
.k-group-items-card.is-open .k-group-items-chevron{transform:rotate(180deg)}
.k-group-items-list[hidden]{display:none!important}
.k-group-items-list{margin-top:12px;border-top:1px solid var(--border);padding-top:8px}
`;
  document.head.appendChild(s);
}

/* ══════════════════════════════════════════════════════════════════
 * FORMULAIRE D'ENGAGEMENT (phase ouverte)
 * Collecte : nom + téléphone + montant indicatif
 * Aucun Stripe, aucun paiement.
 * ══════════════════════════════════════════════════════════════════ */
function renderEngagementForm(token, cart, isCreator = false) {
  const meta = metaOf(cart);
  const lockedTotal = r(meta.locked_commitments_total_kmf || 0);
  const suggestion = lockedTotal > 0
    ? Math.round(r(cart.total_kmf_snapshot) / Math.max(1, r(meta.locked_commitments_count || 1) + 1) / 100) * 100
    : 0;
  // TX-02 — montant moyen suggéré (hint visible, même logique que shared-cart-public.html)
  const totalParticipants = r(meta.locked_commitments_count || 0) + 1;
  const avgSuggestion = Math.ceil(r(cart.total_kmf_snapshot) / totalParticipants / 100) * 100;
  const splitHint = avgSuggestion >= 2500
    ? `<div class="k-group-split-hint">💡 À participation égale : environ ${fmt(avgSuggestion, 'KMF')} par personne</div>`
    : '';

  const saved = !isCreator ? readParticipantCommitment(token) : null;
  const savedState = saved ? `
      <div class="k-group-saved-commitment" id="k-ge-saved-state">
        <strong>✅ Engagement enregistré</strong>
        <span>${sanitize(saved.name || 'Participant')} · ${fmt(r(saved.amount), 'KMF')}</span>
        ${saved.phone ? `<span>Téléphone : ${sanitize(saved.phone)}</span>` : ''}
        <button type="button" id="k-ge-edit-btn">✏️ Modifier mon engagement</button>
      </div>` : '';

  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--open">Phase ouverte — concertation</div>
      <div class="k-group-section-title">${isCreator ? '💸 Enregistrer ma participation' : '💸 Participer'}</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
        Indiquez votre engagement indicatif. Aucun paiement maintenant — vous paierez quand le créateur lancera le règlement.
      </p>
      ${splitHint}
      ${savedState}
      <div class="k-group-eng-fields" id="k-ge-fields" ${saved ? 'hidden' : ''}>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-name">Prénom / Nom</label>
          <input id="k-ge-name" class="k-group-input" type="text" placeholder="Ex : Fatima Ali" maxlength="60" autocomplete="given-name" value="${sanitize(saved?.name || '')}">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-phone">Téléphone (pour retrouver votre engagement)</label>
          <input id="k-ge-phone" class="k-group-input" type="tel" placeholder="Ex : 0633000000" maxlength="20" autocomplete="tel" inputmode="tel" value="${sanitize(saved?.phone || '')}">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-amount">Montant d'engagement (KMF)</label>
          <input id="k-ge-amount" class="k-group-input" type="number" min="500" step="100"
            placeholder="${suggestion > 0 ? `Suggestion : ${fmt(suggestion, 'KMF')}` : 'Ex : 5000'}"
            inputmode="numeric" value="${saved?.amount ? r(saved.amount) : ''}">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-msg">Message (optionnel)</label>
          <input id="k-ge-msg" class="k-group-input" type="text" placeholder="Ex : Je participe avec plaisir !" maxlength="200" value="${sanitize(saved?.message || '')}">
        </div>
        <p class="k-group-input-error" id="k-ge-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-ge-submit-btn">
          ${saved ? '✏️ Mettre à jour mon engagement' : '✋ Enregistrer mon engagement'}
        </button>
      </div>
    </div>`;
}

function bindEngagementForm(el, token, cart, onSuccess) {
  el.querySelector('#k-ge-edit-btn')?.addEventListener('click', () => {
    const fields = el.querySelector('#k-ge-fields');
    const saved = el.querySelector('#k-ge-saved-state');
    if (fields) fields.hidden = false;
    if (saved) saved.hidden = true;
    el.querySelector('#k-ge-name')?.focus();
  });

  el.querySelector('#k-ge-submit-btn')?.addEventListener('click', async () => {
    const name   = (el.querySelector('#k-ge-name')?.value || '').trim();
    const phone  = (el.querySelector('#k-ge-phone')?.value || '').trim();
    const amount = Number(el.querySelector('#k-ge-amount')?.value);
    const msg    = (el.querySelector('#k-ge-msg')?.value || '').trim();
    const errEl  = el.querySelector('#k-ge-err');
    const btn    = el.querySelector('#k-ge-submit-btn');

    errEl.textContent = '';
    if (!name)            { errEl.textContent = 'Prénom requis.'; return; }
    if (!phone)           { errEl.textContent = 'Téléphone requis pour retrouver votre engagement.'; return; }
    if (!amount || amount < 500) { errEl.textContent = 'Minimum 500 KMF.'; return; }

    btn.disabled = true; btn.textContent = '⏳ Enregistrement…';

    try {
      const res = await apiPost(`/api/shared-carts/public/${token}/commitments`, {
        participant_name: name,
        participant_phone: phone,
        amount_kmf: amount,
        ...(msg ? { message: msg } : {}),
      });

      rememberParticipantToken(token);
      rememberParticipantCommitment(token, { name, phone, amount, message: msg });

      showToast(res?.updated ? 'Engagement mis à jour !' : 'Engagement enregistré !', 'success');
      btn.disabled = false;
      btn.textContent = '✅ Engagement enregistré';
      onSuccess?.();
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = '✋ Enregistrer mon engagement';
    }
  });
}

/* ══════════════════════════════════════════════════════════════════
 * FORMULAIRE DE PAIEMENT (phase règlement)
 * Le participant saisit son téléphone → lookup commitment verrouillé
 * → affichage du montant fixe → bouton "Payer X KMF" → Stripe Checkout
 * ══════════════════════════════════════════════════════════════════ */
function renderPaymentForm(token, cart) {
  return `
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--settlement">Phase règlement — paiement</div>
      <div class="k-group-section-title">💳 Payer ma contribution</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 14px">
        Le panier est passé au règlement. Entrez votre téléphone pour retrouver votre engagement verrouillé.
      </p>
      <div class="k-group-field">
        <label class="k-group-label" for="k-gp-phone">Votre téléphone</label>
        <input id="k-gp-phone" class="k-group-input" type="tel" placeholder="Ex : 0633000000"
          maxlength="20" autocomplete="tel" inputmode="tel">
      </div>
      <p class="k-group-input-error" id="k-gp-lookup-err"></p>
      <button class="k-group-btn k-group-btn--ghost" id="k-gp-lookup-btn">🔍 Retrouver mon engagement</button>

      <!-- Zone affichée après lookup -->
      <div id="k-gp-locked-zone" style="display:none;margin-top:14px">
        <div class="k-group-locked-amount">
          <div>
            <span>Votre engagement verrouillé</span><br>
            <strong id="k-gp-locked-amount-text">—</strong>
          </div>
          <span style="font-size:22px">🔐</span>
        </div>
        <div class="k-group-field" style="margin-top:10px">
          <label class="k-group-label" for="k-gp-name">Votre prénom (pour la confirmation)</label>
          <input id="k-gp-name" class="k-group-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-gp-email">Email (reçu de paiement Stripe)</label>
          <input id="k-gp-email" class="k-group-input" type="email" placeholder="Ex : fatima@email.com" maxlength="120" autocomplete="email">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-gp-msg">Message (optionnel)</label>
          <input id="k-gp-msg" class="k-group-input" type="text" placeholder="Ex : Bon courage !" maxlength="200">
        </div>
        <p class="k-group-input-error" id="k-gp-pay-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-gp-pay-btn" data-amount="0" data-phone="">
          💳 Payer —
        </button>
      </div>
    </div>`;
}

function bindPaymentForm(el, token, cart) {
  const lookupBtn = el.querySelector('#k-gp-lookup-btn');
  lookupBtn?.addEventListener('click', async () => {
    const phone    = (el.querySelector('#k-gp-phone')?.value || '').trim();
    const errEl    = el.querySelector('#k-gp-lookup-err');
    errEl.textContent = '';
    if (!phone) { errEl.textContent = 'Téléphone requis.'; return; }

    lookupBtn.disabled = true; lookupBtn.textContent = '⏳ Recherche…';
    try {
      const res = await apiGet(`/api/shared-carts/public/${token}/commitments/by-phone?phone=${encodeURIComponent(phone)}`);
      const c = res?.commitment;
      if (!c) throw new Error('Engagement introuvable.');

      const zone        = el.querySelector('#k-gp-locked-zone');
      const amountEl    = el.querySelector('#k-gp-locked-amount-text');
      const payBtn      = el.querySelector('#k-gp-pay-btn');
      const nameInput   = el.querySelector('#k-gp-name');

      amountEl.textContent = fmt(r(c.amount_kmf), 'KMF');
      payBtn.textContent   = `💳 Payer ${fmt(r(c.amount_kmf), 'KMF')}`;
      payBtn.dataset.amount = String(c.amount_kmf);
      payBtn.dataset.phone  = phone;
      if (nameInput && c.participant_name) nameInput.value = c.participant_name;
      zone.style.display = '';
      lookupBtn.textContent = '✅ Engagement trouvé';
    } catch (err) {
      errEl.textContent = err?.message || 'Aucun engagement verrouillé pour ce numéro.';
      lookupBtn.disabled = false; lookupBtn.textContent = '🔍 Retrouver mon engagement';
    }
  });

  el.querySelector('#k-gp-pay-btn')?.addEventListener('click', async () => {
    const payBtn = el.querySelector('#k-gp-pay-btn');
    const errEl  = el.querySelector('#k-gp-pay-err');
    const name   = (el.querySelector('#k-gp-name')?.value || '').trim();
    const email  = (el.querySelector('#k-gp-email')?.value || '').trim();
    const msg    = (el.querySelector('#k-gp-msg')?.value || '').trim();
    const amount = Number(payBtn.dataset.amount);
    const phone  = payBtn.dataset.phone;

    errEl.textContent = '';
    if (!name)                       { errEl.textContent = 'Prénom requis.'; return; }
    if (!email || !email.includes('@')) { errEl.textContent = 'Email valide requis.'; return; }
    if (!amount)                     { errEl.textContent = 'Montant invalide.'; return; }

    payBtn.disabled = true; payBtn.textContent = '⏳ Redirection…';

    try {
      const res = await apiPost(`/api/shared-carts/public/${token}/contributions`, {
        amount_kmf: amount,
        contributor_name: name,
        contributor_email: email,
        contributor_phone: phone,
        ...(msg ? { message: msg } : {}),
      });
      if (res?.checkout_url) {
        window.location.href = res.checkout_url;
      } else {
        showToast('Contribution enregistrée !', 'success');
        payBtn.textContent = '✅ Enregistré';
      }
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      payBtn.disabled = false; payBtn.textContent = `💳 Payer ${fmt(amount, 'KMF')}`;
    }
  });
}

/* ── Rendu progression ─────────────────────────────────────────── */
function renderProgress(cart, contributions, commitmentsList) {
  const settlementOpen = isSettlementOpen(cart);
  const total       = r(cart.total_kmf_snapshot);
  const confirmed   = r(cart.contributed_kmf);
  const remaining   = remainingKmf(cart);
  const p           = pct(confirmed, total);
  const isCartOpen  = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);
  const meta        = metaOf(cart);

  let commitmentRows = '';
  if (settlementOpen && commitmentsList?.length) {
    commitmentRows = `
      <div class="k-group-contribs-label">Engagements verrouillés (${commitmentsList.length})</div>
      <div class="k-group-commitment-list">
        ${commitmentsList.map(c => {
          const paid = contributions?.some(co =>
            co.commitment_id === c.id && co.status === 'paid'
          );
          return `
            <div class="k-group-commitment-row">
              <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
              <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
              <span class="k-group-commitment-status">${paid ? '✅ Payé' : '⏳ En attente'}</span>
            </div>`;
        }).join('')}
      </div>`;
  } else if (!settlementOpen && commitmentsList?.length) {
    commitmentRows = `
      <div class="k-group-contribs-label">Engagements indicatifs (${commitmentsList.length})</div>
      <div class="k-group-commitment-list">
        ${commitmentsList.map(c => `
          <div class="k-group-commitment-row">
            <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
            <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
            <span class="k-group-commitment-status" style="color:var(--text-muted)">indicatif</span>
          </div>`).join('')}
      </div>`;
  } else {
    commitmentRows = `<p class="k-group-contrib-empty">${
      settlementOpen
        ? 'Aucun engagement verrouillé.'
        : 'Aucun engagement encore — partagez le lien !'
    }</p>`;
  }

  const settlementSummary = settlementOpen ? `
    <div class="k-group-settlement-summary">
      <strong>Panier en règlement 🔐</strong>
      ${meta.locked_commitments_count > 0
        ? `<span>${meta.locked_commitments_count} engagement(s) verrouillé(s) · total indicatif : ${fmt(r(meta.locked_commitments_total_kmf), 'KMF')}</span>`
        : ''}
    </div>` : '';

  return `
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-card-head">
        <div>
          <div class="k-group-card-title">${sanitize(cart.title || 'Panier groupe')}</div>
          <div class="k-group-card-meta">${statusLabel(cart.status, settlementOpen)}</div>
        </div>
      </div>
      ${settlementSummary}
      <div class="k-group-money">
        <span>${fmt(confirmed, 'KMF')} payés</span>
        <strong>${fmt(total, 'KMF')} total</strong>
      </div>
      <div class="k-group-progress" aria-label="${p}%">
        <span style="width:${p}%" class="k-group-progress-bar"></span>
      </div>
      ${remaining > 0 && isCartOpen && settlementOpen
        ? `<p class="k-group-remaining">Reste à payer : <strong>${fmt(remaining, 'KMF')}</strong></p>`
        : ''}
      <div class="k-group-contribs">
        ${commitmentRows}
      </div>
    </div>`;
}

/* ── Rendu actions créateur ────────────────────────────────────── */
function renderCreatorActions(cart) {
  const settlementOpen = isSettlementOpen(cart);
  const isCartOpen = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  if (cart.status === 'converted_to_order' || cart.finalized_order_id) {
    return `
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Commande créée</div>
        <p class="k-group-finalized-hint">Ce panier est clôturé et lié à une commande Komerce.</p>
        ${cart.finalized_order_id ? `<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">📦 Voir la commande</button>` : ''}
      </div>`;
  }
  if (!isCartOpen) return `<p class="k-group-finalized-hint">Ce panier est clôturé.</p>`;

  const fullyFunded = cart.status === 'fully_funded' || remainingKmf(cart) <= 0;
  const gap = remainingKmf(cart);

  // S2-04 — Expiration règlement
  const expAt  = settlementExpiresAt(cart);
  const expLeft = expAt ? timeRemaining(expAt) : null;
  const expSoon = expAt && (expAt - Date.now() < 6 * 3_600_000);
  const expirationHtml = settlementOpen && expLeft ? `
    <p class="k-group-share-hint" style="margin-top:6px;${expSoon ? 'color:#e53935;font-weight:700' : ''}">
      ⏱️ Règlement ouvert jusqu'au
      ${expAt.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
      — ${expLeft}
    </p>` : '';

  // S2-01 — Bouton annuler (présent dans les deux phases)
  const cancelBtn = `
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <button class="k-group-btn k-group-btn--ghost" id="k-group-cancel"
        style="color:#e53935;border-color:#e53935;opacity:.8;width:100%">
        🗑 Annuler le panier
      </button>
    </div>`;

  if (!settlementOpen) {
    // S2-03 — Sélecteur durée règlement intégré
    return `
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Gérer le panier</div>
        <div class="k-group-creator-actions">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 WhatsApp</button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
        </div>
        <p class="k-group-share-hint">Une fois que tout le monde a confirmé son engagement, passez au règlement.</p>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <label style="font-size:12px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px">
            Délai de paiement
          </label>
          <select id="k-group-settlement-window"
            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:var(--font);margin-bottom:10px">
            <option value="24">24 heures</option>
            <option value="48" selected>48 heures (défaut)</option>
            <option value="168">7 jours</option>
          </select>
          <button class="k-group-btn k-group-btn--primary" id="k-group-open-settlement" style="background:var(--accent,#1f7a54)">
            🔐 Passer au règlement
          </button>
          <p class="k-group-share-hint" style="margin-top:6px">
            Fige les engagements et ouvre les paiements. Action irréversible.
          </p>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-edit-items"
            style="width:100%">
            ✏️ Modifier les articles
          </button>
          <p class="k-group-share-hint" style="margin-top:4px">
            Les participants seront notifiés du nouveau total.
          </p>
        </div>
        <p class="k-group-input-error" id="k-group-settlement-err"></p>
        ${cancelBtn}
      </div>`;
  }

  // S2-02 — Finalisation avec gap
  const finalizeBlock = fullyFunded
    ? `<div class="k-group-funded-callout">
        <strong>✅ Tout est réglé</strong>
        <p>Validez maintenant pour que la commande parte en préparation.</p>
        <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">✓ Valider et commander</button>
      </div>`
    : gap > 0
      ? `<div class="k-group-funded-callout" style="border-color:rgba(230,130,0,.28);background:rgba(230,130,0,.08)">
          <strong style="color:#b45309">Il manque ${r(gap).toLocaleString('fr-FR')} KMF</strong>
          <p>Vous pouvez couvrir le reste et valider maintenant.</p>
          <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize-gap" style="background:#b45309">
            Je couvre le reste et je valide
          </button>
        </div>
        <button class="k-group-btn k-group-disabled-finalize" type="button" disabled style="margin-top:8px;width:100%">
          Valider disponible à 100%
        </button>`
      : `<button class="k-group-btn k-group-disabled-finalize" type="button" disabled>Valider disponible à 100%</button>`;

  return `
    <div class="k-group-card k-group-actions-card">
      <div class="k-group-section-title">Panier en règlement</div>
      ${expirationHtml}
      <div class="k-group-creator-actions" style="margin-top:10px">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">📲 Relancer WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">🔗 Copier</button>
      </div>
      <p class="k-group-share-hint">Partagez le lien pour que les participants puissent payer leur engagement verrouillé.</p>
      ${finalizeBlock}
      <p class="k-group-input-error" id="k-group-finalize-err"></p>
      ${cancelBtn}
    </div>`;
}

/* ── helper finalize interne ─────────────────────────────────────── */
async function doFinalize(el, cartId, shareUrl, cart, acceptPartial = false) {
  const btn   = el.querySelector(acceptPartial ? '#k-group-finalize-gap' : '#k-group-finalize');
  const errEl = el.querySelector('#k-group-finalize-err');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Validation…'; }

  try {
    const res = await apiPost(`/api/shared-carts/${cartId}/finalize`,
      acceptPartial ? { accept_partial: true } : {}
    );

    state.shareToken  = null; state.shareId = null;
    state.cartName    = ''; state.shareExpiry = null; state.shareStatus = null;
    try {
      sessionStorage.removeItem('kmrc_share');
      sessionStorage.removeItem('kmrc_banner_dismissed');
    } catch (_) {}
    refreshGroupBadge();
    hideBanner();
    import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(false));

    el.innerHTML = `
      <div class="k-group-success">
        <div class="k-group-success-icon">🎉</div>
        <strong>Panier clôturé !</strong>
        <p>Commande <strong>${sanitize(res.order_reference || '')}</strong> créée.</p>
        ${res.prepaid_kmf > 0 ? `<p class="k-group-success-detail">${fmt(res.prepaid_kmf, 'KMF')} prépayés.</p>` : ''}
        <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">📦 Voir ma commande</button>
      </div>`;
    bindCreatorActions(el, { ...cart, finalized_order_id: res.order_id }, shareUrl, cartId);
  } catch (err) {
    if (err?.code === 'stock_issues' || err?.message?.includes('stock')) {
      if (errEl) errEl.textContent = err.message || 'Problème de stock.';
    } else {
      showToast(err?.message || 'Erreur validation.', 'error');
    }
    if (btn) { btn.disabled = false; btn.textContent = acceptPartial ? 'Je couvre le reste et je valide' : '✓ Valider et commander'; }
  }
}

/* ── Bind actions créateur ─────────────────────────────────────── */
function bindCreatorActions(el, cart, shareUrl, cartId, onSettlement) {
  el.querySelector('#k-group-reshare')?.addEventListener('click', () => {
    const msg = `Rejoins mon panier Komerce : "${sanitize(cart.title || 'Panier groupe')}" → ${shareUrl}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  });

  el.querySelector('#k-group-copy')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      showToast('Lien copié !', 'success');
    } catch (_) { showToast('Impossible de copier.', 'error'); }
  });

  el.querySelector('#k-group-to-track')?.addEventListener('click', () => {
    import('./b-nav.js').then(({ switchView }) => {
      import('./b-tracking.js').then(({ renderTrackView }) => {
        document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
          .forEach(i => i.classList.toggle('active', i.dataset.tab === 'track'));
        renderTrackView(); switchView('track');
      });
    });
  });

  // S2-03 — open-settlement avec durée choisie
  el.querySelector('#k-group-open-settlement')?.addEventListener('click', async () => {
    const btn   = el.querySelector('#k-group-open-settlement');
    const errEl = el.querySelector('#k-group-settlement-err');
    const windowH = Number(el.querySelector('#k-group-settlement-window')?.value) || 48;

    if (!confirm('Passer au règlement ? Les engagements seront verrouillés et les modifications du panier seront bloquées. Action irréversible.')) return;

    btn.disabled = true; btn.textContent = '⏳ Passage en cours…';
    errEl.textContent = '';

    try {
      await apiPost(`/api/shared-carts/${cartId}/open-settlement`, { settlement_window_hours: windowH });
      showToast('Panier passé au règlement. Les participants peuvent maintenant payer.', 'success');
      onSettlement?.();
    } catch (err) {
      errEl.textContent = err?.message || 'Erreur.';
      btn.disabled = false; btn.textContent = '🔐 Passer au règlement';
    }
  });

  // S2-02 — Finaliser normalement
  el.querySelector('#k-group-finalize')?.addEventListener('click', () =>
    doFinalize(el, cartId, shareUrl, cart, false)
  );

  // S2-02 — Finaliser en couvrant le gap
  el.querySelector('#k-group-finalize-gap')?.addEventListener('click', () => {
    if (!confirm('Vous allez couvrir le montant manquant et valider la commande. Confirmer ?')) return;
    doFinalize(el, cartId, shareUrl, cart, true);
  });

  // S2-01 — Annuler le panier
  el.querySelector('#k-group-cancel')?.addEventListener('click', async () => {
    const hasPaidContribs = r(cart.contributed_kmf) > 0;
    const msg = hasPaidContribs
      ? `⚠️ Ce panier a des contributions payées (${r(cart.contributed_kmf).toLocaleString('fr-FR')} KMF). L'annulation nécessitera des remboursements manuels. Confirmer quand même ?`
      : 'Annuler le panier ? Cette action est irréversible.';
    if (!confirm(msg)) return;

    try {
      await apiPost(`/api/shared-carts/${cartId}/cancel`, { reason: 'creator_cancel' });
      import('./b-share-cart.js').then(m => m.clearShareState?.());
      showToast('Panier annulé.', 'success');
      onSettlement?.(); // refresh la vue
    } catch (err) {
      showToast(err?.message || 'Impossible d\'annuler.', 'error');
    }
  });

  // SC-EDIT-02/03 — "Modifier les articles" : charge le snapshot depuis le backend,
  // reconstruit state.cart, active le contexte edit_shared_cart, bascule vers Boutique.
  // Remplace l'ancien handler S2-06 (confirm + PUT inline) par un flux UX complet
  // conforme à la doctrine v4.2 §Chemin B.
  el.querySelector('#k-group-edit-items')?.addEventListener('click', async () => {
    const btn = el.querySelector('#k-group-edit-items');
    if (btn) { btn.disabled = true; btn.textContent = '⏳ Chargement…'; }

    try {
      // SC-EDIT-03 — Toujours reconstruire depuis le snapshot backend
      // (pas depuis state.cart courant qui peut être vide après N4-CLEAR
      // ou contenir un panier personnel sans rapport avec le panier collectif).
      const snap = await apiGet(`/api/shared-carts/${cartId}/as-cart-items`);

      if (!snap?.cart_items?.length) {
        showToast('Panier collectif vide — impossible de charger les articles.', 'error');
        if (btn) { btn.disabled = false; btn.textContent = '✏️ Modifier les articles'; }
        return;
      }

      // Reconstruit state.cart depuis le snapshot (doctrine §Chemin B).
      // price_kmf = prix snapshot déjà promoé ; promo_pct/is_promo = 0/false
      // pour éviter la double application de remise dans renderSideCart/newTotal.
      // variant_label absent (non stocké dans le snapshot) → chip de variante omis, acceptable.
      state.cart = snap.cart_items.map(it => ({
        product: {
          id:        it.product_id,
          name:      it.product_name || '',
          price_kmf: it.unit_price_kmf || 0,
          image_url: it.product_image || '',
          category:  it.product_category || '',
          promo_pct: 0,
          is_promo:  false,
        },
        id:    it.product_id,
        name:  it.product_name || '',
        price: it.unit_price_kmf || 0,
        image: it.product_image || '',
        qty:   it.quantity || 1,
      }));
      saveCart(); // persiste en localStorage — badge + sidebar cohérents

      // SC-EDIT-01 — Activer le contexte d'édition
      state.editSharedCart = {
        shared_cart_id: cartId,
        token:          state.shareToken,
        return_tab:     'group',
        started_at:     Date.now(),
      };

      // SC-EDIT-02 — Basculer vers l'onglet Boutique.
      // Le side cart et le panier tiroir afficheront les CTAs edit (SC-EDIT-04/05).
      import('./b-nav.js').then(({ switchView }) => {
        document.querySelectorAll('.k-bnav-item, .k-header-nav-btn')
          .forEach(i => i.classList.toggle('active', i.dataset.tab === 'shop'));
        switchView('shop');
        // Forcer le rafraîchissement du side cart pour afficher le bandeau edit
        if (typeof window.__kmrcSideCart === 'function') window.__kmrcSideCart();
      });

      showToast('Modifiez les articles, puis cliquez "Mettre à jour le panier collectif".', 'success');
    } catch (err) {
      showToast(err?.message || 'Impossible de charger le panier sauvegardé.', 'error');
      if (btn) { btn.disabled = false; btn.textContent = '✏️ Modifier les articles'; }
    }
  });
}




function renderCreatorMiniGuide(settlementOpen = false) {
  if (settlementOpen) {
    return `
      <div class="k-group-mini-guide">
        <span><b>1</b> Paiements ouverts</span>
        <span><b>2</b> Suivez les règlements</span>
        <span><b>3</b> Finalisez la commande</span>
      </div>`;
  }

  return `
    <div class="k-group-mini-guide">
      <span><b>1</b> Partagez le lien</span>
      <span><b>2</b> Les proches s'engagent</span>
      <span><b>3</b> Lancez le règlement</span>
    </div>`;
}

function renderCreatorArticlesPanel(items = [], cart = {}) {
  const safeItems = Array.isArray(items) ? items : [];
  const rows = safeItems.slice(0, 8).map(it => {
    const name  = it.product_name || it.name || it.product?.name || 'Produit';
    const qty   = Number(it.quantity || it.qty || 1);
    const price = Number(it.unit_price_kmf || it.price_kmf || it.price || it.product?.price_kmf || 0);
    const img   = it.product_image || it.product_image_url || it.image_url || it.image || it.product?.image_url || '';

    return `
      <div class="k-group-side-item">
        ${img ? `<img src="${sanitize(img)}" alt="">` : '<div class="k-group-side-item-fallback">📦</div>'}
        <div class="k-group-side-item-main">
          <strong>${sanitize(name)}</strong>
          <span>×${qty} · ${fmt(r(price), 'KMF')}</span>
        </div>
      </div>`;
  }).join('');

  const count = safeItems.length;
  const total = r(cart.total_kmf_snapshot || 0);

  return `
    <aside class="k-group-side-panel">
      <div class="k-group-side-card">
        <div class="k-group-side-head">
          <strong>Articles du panier</strong>
          <span>${count} article${count > 1 ? 's' : ''}</span>
        </div>
        <div class="k-group-side-list">
          ${rows || '<p class="k-group-side-empty">Aucun article à afficher.</p>'}
        </div>
        <div class="k-group-side-total">
          <span>Total panier</span>
          <strong>${fmt(total, 'KMF')}</strong>
        </div>
      </div>
    </aside>`;
}

function renderParticipantItemsAccordion(items, total, cart, settlementOpen) {
  const itemRows = items.map(it => `
    <div class="k-group-item-row">
      <span class="k-group-item-name">${sanitize(it.name || 'Produit')}</span>
      <span class="k-group-item-qty">×${it.quantity || 1}</span>
      <span class="k-group-item-price">${fmt(r(it.unit_price_kmf), 'KMF')}</span>
    </div>`).join('') || '<p class="k-group-contrib-empty">Aucun article.</p>';

  const count = items.length;
  const openByDefault = count <= 3;
  return `
    <div class="k-group-card k-group-items-card ${openByDefault ? 'is-open' : ''}">
      <button class="k-group-items-toggle" type="button" id="k-group-items-toggle" aria-expanded="${openByDefault ? 'true' : 'false'}">
        <span>
          <strong>${sanitize(cart.title || 'Panier groupe')}</strong><br>
          <span>Total : ${fmt(total, 'KMF')} · ${statusLabel(cart.status, settlementOpen)} · ${count} article${count > 1 ? 's' : ''}</span>
        </span>
        <span class="k-group-items-chevron">⌄</span>
      </button>
      <div class="k-group-items-list" id="k-group-items-list" ${openByDefault ? '' : 'hidden'}>
        ${itemRows}
      </div>
    </div>`;
}

function bindParticipantItemsAccordion(el) {
  const btn = el.querySelector('#k-group-items-toggle');
  const list = el.querySelector('#k-group-items-list');
  const card = btn?.closest('.k-group-items-card');
  if (!btn || !list) return;
  btn.addEventListener('click', () => {
    const nextOpen = btn.getAttribute('aria-expanded') !== 'true';
    btn.setAttribute('aria-expanded', nextOpen ? 'true' : 'false');
    list.hidden = !nextOpen;
    card?.classList.toggle('is-open', nextOpen);
  });
}


/* ── Loaders ────────────────────────────────────────────────────── */
function renderLoading(el) {
  el.innerHTML = `<div class="k-group-loading"><div class="k-group-spin"></div><p>Chargement…</p></div>`;
}
function renderEmpty(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">👥</div>
      <strong>Aucun panier groupe actif</strong>
      <span>Créez-en un depuis votre panier avec "Payer en groupe".</span>
    </div>`;
}
function renderError(el) {
  el.innerHTML = `
    <div class="k-group-empty">
      <div class="k-group-empty-icon">❌</div>
      <strong>Panier introuvable</strong>
      <span>Ce lien est peut-être expiré ou invalide.</span>
    </div>`;
}

/* ══════════════════════════════════════════════════════════════════
 * POINT D'ENTRÉE
 * ══════════════════════════════════════════════════════════════════ */
export async function renderGroupView(opts = {}) {
  injectStyles();
  stopPolling();
  const el = getOrCreateEl();
  renderLoading(el);

  const paymentReturn = consumeSharedPaymentReturn();
  if (paymentReturn === 'success') showToast('Contribution enregistrée !', 'success');
  if (paymentReturn === 'cancel') showToast('Paiement annulé. Aucun montant prélevé.', 'info');

  const participantToken = opts.participantToken || (!state.shareToken ? recallParticipantToken() : null);
  const isCreator = !participantToken || participantToken === state.shareToken;

  /* ─────────────────────────────────────────────────────────────── */
  /* MODE PARTICIPANT                                                 */
  /* ─────────────────────────────────────────────────────────────── */
  if (!isCreator) {
    rememberParticipantToken(participantToken);
    const data = await fetch(`/api/shared-carts/public/${participantToken}`, { credentials: 'include' })
      .then(rsp => rsp.ok ? rsp.json() : null).catch(() => null);

    if (!data?.cart) { renderError(el); return; }
    const cart  = data.cart;
    const items = data.items || [];
    const total = r(cart.total_kmf_snapshot);
    const settlementOpen = isSettlementOpen(cart);
    const isCartOpen = ['active', 'partially_funded'].includes(cart.status);

    let commitmentsList = [];
    try {
      const cRes = await fetch(`/api/shared-carts/public/${participantToken}/commitments`, { credentials: 'include' });
      if (cRes.ok) { const cData = await cRes.json(); commitmentsList = cData.commitments || []; }
    } catch (_) {}

    el.innerHTML = `
      <div class="k-group-header">
        <h2>👥 Panier groupe</h2>
        <p class="k-group-subhead">Panier de ${sanitize(cart.beneficiary_name_snapshot || '')}.</p>
      </div>
      ${renderParticipantItemsAccordion(items, total, cart, settlementOpen)}
      ${commitmentsList.length > 0 ? `
        <div class="k-group-card" style="padding:14px 16px">
          <div class="k-group-contribs-label">Engagements ${settlementOpen ? 'verrouillés' : 'indicatifs'} (${commitmentsList.length})</div>
          <div class="k-group-commitment-list">
            ${commitmentsList.map(c => `
              <div class="k-group-commitment-row">
                <span class="k-group-commitment-name">${sanitize(c.participant_name?.split(' ')[0] || 'Participant')}</span>
                <span class="k-group-commitment-amount">${fmt(r(c.amount_kmf), 'KMF')}</span>
              </div>`).join('')}
          </div>
        </div>` : ''}
      ${isCartOpen && !settlementOpen
        ? renderEngagementForm(participantToken, cart, false)
        : isCartOpen && settlementOpen
          ? renderPaymentForm(participantToken, cart)
          : `<div class="k-group-card"><strong>${
              cart.status === 'fully_funded' ? '✅ Panier financé, merci !' : "Ce panier n'accepte plus de contribution."
            }</strong></div>`}`;

    bindParticipantItemsAccordion(el);

    if (isCartOpen && !settlementOpen) {
      bindEngagementForm(el, participantToken, cart, () => renderGroupView({ participantToken }));
    } else if (isCartOpen && settlementOpen) {
      bindPaymentForm(el, participantToken, cart);
    }
    return;
  }

  /* ─────────────────────────────────────────────────────────────── */
  /* MODE CRÉATEUR                                                    */
  /* ─────────────────────────────────────────────────────────────── */
  if (!state.shareToken || !state.shareId) {
    const restored = await ensureCreatorCartState();
    if (!restored) { renderEmpty(el); return; }
  }

  let data;
  try {
    data = await apiGet(`/api/shared-carts/${state.shareId}`);
  } catch (_) {
    data = await fetch(`/api/shared-carts/public/${state.shareToken}`, { credentials: 'include' })
      .then(rsp => rsp.ok ? rsp.json() : null).catch(() => null);
  }

  if (!data?.cart) { renderError(el); return; }

  const cart          = data.cart;
  const contributions = data.contributions || [];
  const cartId        = state.shareId || cart.id;
  const shareUrl      = data.share_url || state.shareUrl || `${window.location.origin}/boutique/?p=${state.shareToken}`;

  let creatorItems = [];
  try {
    const snap = await apiGet(`/api/shared-carts/${cartId}/as-cart-items`);
    creatorItems = snap?.cart_items || [];
  } catch (_) {
    creatorItems = data.items || data.cart_items || [];
  }
  const settlementOpen = isSettlementOpen(cart);
  const isCartOpen    = ['active', 'partially_funded', 'fully_funded'].includes(cart.status);

  let commitmentsList = data.commitments || [];
  // Fallback : si l'endpoint owner ne les inclut pas encore (compatibilité transitoire),
  // on tente le fetch séparé
  if (!commitmentsList.length && state.shareToken) {
    try {
      const cRes = await fetch(`/api/shared-carts/public/${state.shareToken}/commitments`, { credentials: 'include' });
      if (cRes.ok) { const cData = await cRes.json(); commitmentsList = cData.commitments || []; }
    } catch (_) {}
  }

  const showSelfForm = isCartOpen && cart.status !== 'fully_funded' && remainingKmf(cart) > 0;

  const refreshView = () => renderGroupView(opts);

  el.innerHTML = `
    <div class="k-group-cockpit">
      <div class="k-group-main-col">
        <div class="k-group-header">
          <h2>👥 Mon panier groupe</h2>
          <p class="k-group-subhead">${settlementOpen
            ? '🔐 Panier en règlement — les participants peuvent maintenant payer.'
            : 'Phase de concertation — partagez le lien et collectez les engagements.'}</p>
        </div>
        ${renderCreatorMiniGuide(settlementOpen)}
        ${renderProgress(cart, contributions, commitmentsList)}
        ${showSelfForm && !settlementOpen ? `
          <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je veux aussi m'engager</button>
          <div class="k-group-self-panel" id="k-group-self-panel" hidden>
            ${renderEngagementForm(state.shareToken, cart, true)}
          </div>` : ''}
        ${showSelfForm && settlementOpen ? `
          <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je veux aussi payer</button>
          <div class="k-group-self-panel" id="k-group-self-panel" hidden>
            ${renderPaymentForm(state.shareToken, cart)}
          </div>` : ''}
        ${renderCreatorActions(cart)}
      </div>
      ${renderCreatorArticlesPanel(creatorItems, cart)}
    </div>`;

  if (showSelfForm) {
    el.querySelector('#k-group-self-toggle')?.addEventListener('click', () => {
      const panel = el.querySelector('#k-group-self-panel');
      if (panel) panel.hidden = !panel.hidden;
    });
    if (!settlementOpen) {
      bindEngagementForm(el, state.shareToken, cart, refreshView);
    } else {
      bindPaymentForm(el, state.shareToken, cart);
    }
  }

  bindCreatorActions(el, cart, shareUrl, cartId, refreshView);
  hideBanner();

  if (isCartOpen) {
    // FIX — le callback reçoit freshCommitments (rafraîchi à chaque tick)
    startPolling(cartId, (fresh, freshCommitments = commitmentsList) => {
      const card = el.querySelector('#k-group-progress-card');
      if (card) card.outerHTML = renderProgress(fresh.cart, fresh.contributions || [], freshCommitments);
      import('./b-share-cart.js').then(m => m.refreshSharedBadges?.(true, fresh.cart));
    });
  }
}

/* ── Badge ─────────────────────────────────────────────────────── */
export function refreshGroupBadge() {
  const has = !!state.shareToken;
  document.getElementById('k-bnav-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-badge')?.classList.toggle('show', has);
  document.getElementById('k-header-group-btn')?.classList.toggle('has-active', has);
}