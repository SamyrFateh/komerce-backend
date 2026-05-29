import{i as ne}from"./chunk-43ELGPLX.js";import{d as g,e as h,k as I,l as q,m as ee,o as c,t as y,w as te}from"./chunk-MECZG36V.js";var Me="k-group-banner";var N=null,V=null;function j(e){return Math.round(Number(e)||0)}function Ie(){N&&(clearInterval(N),N=null),V&&(clearTimeout(V),V=null)}function ze(e){T()}function T(){Ie();let e=document.getElementById(Me);e&&e.classList.remove("show","is-compact")}function tt(){if(!c.shareToken){T();return}fetch(`/api/shared-carts/public/${c.shareToken}`,{credentials:"include"}).then(e=>e.ok?e.json():null).then(e=>{if(!e?.cart){T();try{sessionStorage.removeItem("kmrc_share"),sessionStorage.removeItem("kmrc_banner_dismissed")}catch{}return}c.shareExpiry=e.cart.expires_at,c.shareStatus=e.cart.status,c.shareTotalKmf=j(e.cart.total_kmf_snapshot),c.shareContributedKmf=j(e.cart.contributed_kmf),c.shareRemainingKmf=j(e.cart.remaining_kmf),ze({title:e.cart.title,expires_at:e.cart.expires_at,status:e.cart.status,contributed_kmf:e.cart.contributed_kmf,total_kmf_snapshot:e.cart.total_kmf_snapshot})}).catch(()=>{})}function O(e){if(!e)return null;let t=e.user||e,o=t.full_name||t.fullName||t.name||t.display_name||t.displayName||t.customer_name||"",n=t.phone||t.whatsapp_phone||t.whatsapp||t.mobile||"";return!o&&!n&&!t.id?null:{...t,name:o,full_name:o,phone:n}}function Ae(){let e=O(window.K?.auth?.getUser?.()||window.K?.getUser?.());return e||O(c.user||c.customer||c.client||c.profile||null)}async function Ke(){let e=Ae();if(e)return e;try{let t=await window.K?.auth?.restore?.(),o=O(t);if(o)return c.user=o,o}catch{}return null}function $(e){e&&(e.style.animation="kIdFade .12s ease reverse",setTimeout(()=>e.remove(),120))}function re(e){return/groupe|panier/i.test(e||"")?"Confirmez votre WhatsApp pour s\xE9curiser votre panier groupe.":/commande|checkout/i.test(e||"")?"Confirmez votre WhatsApp pour s\xE9curiser votre commande.":/particip/i.test(e||"")?"Confirmez votre WhatsApp pour retrouver votre participation.":"Confirmez votre WhatsApp pour continuer en s\xE9curit\xE9."}function oe({reason:e="continuer",title:t="Confirmer votre WhatsApp"}={}){return new Promise(o=>{let n=document.createElement("div");n.className="k-id-overlay",n.setAttribute("role","dialog"),n.setAttribute("aria-modal","true");let s={phone:""};n.innerHTML=`
      <div class="k-id-sheet">
        <div class="k-id-head">
          <div>
            <span class="k-id-title">${g(t)}</span>
            <span class="k-id-sub">${g(re(e))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">\u2715</button>
        </div>
        <div class="k-id-trust">
          <strong>Votre num\xE9ro devient votre registre Komerce.</strong>
          <span>On pourra retrouver vos paniers, engagements et commandes sans vous redemander les m\xEAmes informations.</span>
        </div>
        <div id="k-id-phone-host"></div>
        <div class="k-id-code-row" id="k-id-code-row" hidden>
          <div class="k-id-field">
            <label for="k-id-code">Code re\xE7u</label>
            <input id="k-id-code" class="k-id-input" inputmode="numeric" maxlength="6" autocomplete="one-time-code" placeholder="123456">
          </div>
          <button class="k-id-link" type="button" id="k-id-resend">Renvoyer</button>
        </div>
        <p class="k-id-error" id="k-id-error"></p>
        <button class="k-id-btn" type="button" id="k-id-next">Recevoir le code</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-id-cancel">Annuler</button>
      </div>`;let r=n.querySelector("#k-id-phone-host"),i=ne("k-id-phone","Votre num\xE9ro WhatsApp",s,"phone");r.appendChild(i);let a=n.querySelector("#k-id-error"),u=n.querySelector("#k-id-next"),l=n.querySelector("#k-id-code-row"),f=n.querySelector("#k-id-code"),b="phone",k=!1,_=v=>{a.textContent=v||"Erreur."};async function w(){let v=String(s.phone||"").trim();if(v.length<8){_("Num\xE9ro WhatsApp invalide.");return}k=!0,u.disabled=!0,u.textContent="Envoi du code\u2026",a.textContent="";try{let p=await fetch("/api/auth/otp/request",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({phone:v})}),m=await p.json().catch(()=>({}));if(!p.ok||m.success===!1)throw new Error(m.error||"Impossible d\u2019envoyer le code.");b="code",l.hidden=!1,u.textContent="Confirmer",setTimeout(()=>f?.focus(),50)}catch(p){_(p.message),u.textContent="Recevoir le code"}finally{k=!1,u.disabled=!1}}async function S(){let v=String(s.phone||"").trim(),p=String(f?.value||"").replace(/\D/g,"");if(!/^\d{6}$/.test(p)){_("Code \xE0 6 chiffres requis.");return}u.disabled=!0,u.textContent="V\xE9rification\u2026",a.textContent="";try{let m=await fetch("/api/auth/otp/verify",{method:"POST",headers:{"Content-Type":"application/json"},credentials:"include",body:JSON.stringify({phone:v,code:p})}),x=await m.json().catch(()=>({}));if(!m.ok||x.success===!1)throw new Error(x.error||"Code invalide.");let C=O(x.user);if(c.user=C,window.K?.auth?.restore)try{await window.K.auth.restore()}catch{}y("WhatsApp confirm\xE9.","success"),$(n),o(C||x.user||{phone:v})}catch(m){_(m.message),u.disabled=!1,u.textContent="Confirmer"}}u.addEventListener("click",()=>{k||(b==="phone"?w():S())}),n.querySelector("#k-id-resend")?.addEventListener("click",w),n.querySelector("#k-id-cancel")?.addEventListener("click",()=>{$(n),o(null)}),n.querySelector(".k-id-close")?.addEventListener("click",()=>{$(n),o(null)}),n.addEventListener("click",v=>{v.target===n&&($(n),o(null))}),n.addEventListener("keydown",v=>{v.key==="Enter"&&u.click()}),document.body.appendChild(n),setTimeout(()=>n.querySelector("#k-id-phone")?.focus(),80)})}function Oe(e,t={}){let{reason:o,title:n="Votre commande"}=t;return new Promise(s=>{let r=document.createElement("div");r.className="k-id-overlay",r.setAttribute("role","dialog"),r.setAttribute("aria-modal","true");let i=g(e.full_name||e.name||e.phone||""),a=g(e.phone||"");r.innerHTML=`
      <div class="k-id-sheet">
        <div class="k-id-head">
          <div>
            <span class="k-id-title">${g(n)}</span>
            <span class="k-id-sub">${g(re(o))}</span>
          </div>
          <button class="k-id-close" type="button" aria-label="Fermer">\u2715</button>
        </div>
        <div class="k-id-known" role="status">
          <div>
            <strong>${i||a}</strong>
            ${i&&a?`<span>${a}</span>`:""}
          </div>
          <button type="button" id="k-id-change-btn">Ce n'est pas vous ?</button>
        </div>
        <p class="k-id-error" id="k-id-error"></p>
        <button class="k-id-btn" type="button" id="k-id-confirm-btn">Continuer</button>
        <button class="k-id-btn k-id-secondary" type="button" id="k-id-cancel">Annuler</button>
      </div>`;let u=r.querySelector("#k-id-confirm-btn"),l=r.querySelector("#k-id-change-btn");u.addEventListener("click",()=>{$(r),s(e)}),l.addEventListener("click",async()=>{$(r);let f=await oe({reason:"changer d'identit\xE9",title:"Utiliser un autre num\xE9ro"});s(f)}),r.querySelector("#k-id-cancel")?.addEventListener("click",()=>{$(r),s(null)}),r.querySelector(".k-id-close")?.addEventListener("click",()=>{$(r),s(null)}),r.addEventListener("click",f=>{f.target===r&&($(r),s(null))}),r.addEventListener("keydown",f=>{f.key==="Enter"&&u.click()}),document.body.appendChild(r),setTimeout(()=>u?.focus(),80)})}async function D(e={}){let{allowOtherPhone:t=!1}=e,o=await Ke();return o?t?Oe(o,e):o:oe(e)}function ae(){return I("/api/shared-carts/mine")}function H(e){return I(`/api/shared-carts/${e}`)}function U(e){return I(`/api/shared-carts/${e}/as-cart-items`)}function ie(e,t){return q(`/api/shared-carts/${e}/open-settlement`,t)}function se(e,t){return q(`/api/shared-carts/${e}/finalize`,t)}function ce(e,t){return q(`/api/shared-carts/${e}/cancel`,t)}async function J(e){let t=await fetch(`/api/shared-carts/public/${e}`,{credentials:"include"});return t.ok?t.json():null}async function F(e){let t=await fetch(`/api/shared-carts/public/${e}/commitments`,{credentials:"include"});return t.ok?(await t.json()).commitments||[]:[]}function ue(e,t){return q(`/api/shared-carts/public/${e}/commitments`,t)}function le(e,t){return I(`/api/shared-carts/public/${e}/commitments/by-phone?phone=${encodeURIComponent(t)}`)}function pe(e,t){return q(`/api/shared-carts/public/${e}/contributions`,t)}function d(e){return Math.round(Number(e)||0)}function de(e,t){return t?Math.max(0,Math.min(100,Math.round(e/t*100))):0}function me(e=[],t=0){let o=e.reduce((r,i)=>r+d(i.amount_kmf),0);if(!t)return{pctCapped:0,pctRaw:0,engagementsTotal:o};let n=Math.round(o/t*100);return{pctCapped:Math.min(100,n),pctRaw:n,engagementsTotal:o}}function z(e,t){return t?"\u{1F510} En r\xE8glement":{active:"\u{1F7E2} Ouvert",partially_funded:"\u{1F7E1} Partiellement financ\xE9",fully_funded:"\u2705 Financ\xE9",converted_to_order:"\u{1F4E6} Cl\xF4tur\xE9",finalized:"\u{1F4E6} Cl\xF4tur\xE9",cancelled:"\u274C Annul\xE9",expired:"\u23F1\uFE0F Expir\xE9"}[e]||e}function L(e){if(!e?.metadata)return{};if(typeof e.metadata=="object")return e.metadata;try{return JSON.parse(e.metadata)}catch{return{}}}function P(e){return L(e).settlement_open===!0}function M(e){let t=d(e.total_kmf_snapshot),o=d(e.contributed_kmf);return Math.max(0,d(e.remaining_kmf)||t-o)}function ge(e){let t=L(e);if(!t.settlement_open||!t.settlement_opened_at)return null;let o=Number(t.settlement_window_hours)||48;return new Date(new Date(t.settlement_opened_at).getTime()+o*36e5)}function fe(e){if(!e)return null;let t=new Date(e)-Date.now();if(t<=0)return"Expir\xE9";let o=Math.floor(t/36e5),n=Math.floor(t%36e5/6e4);return o>=48?`${Math.floor(o/24)}j restants`:o>=1?`${o}h${n>0?n+"min":""} restantes`:`${Math.max(1,n)}min restantes`}function G(e){return e?!["cancelled","expired","finalized","converted_to_order"].includes(e.status):!1}function W(e=[]){return[...e].sort((t,o)=>new Date(o.created_at||0)-new Date(t.created_at||0))}function ke(e=[],t=null){let o=W(e).filter(G);if(!o.length)return null;if(t){let n=o.find(s=>String(s.id)===String(t));if(n)return n}return o[0]}function he(e){if(e){c.shareToken=e.token||null,c.shareId=e.id||null,c.shareExpiry=e.expires_at||null,c.cartName=e.title||"Panier groupe",c.shareStatus=e.status||null,c.shareTotalKmf=d(e.total_kmf_snapshot),c.shareContributedKmf=d(e.contributed_kmf),c.shareRemainingKmf=d(e.remaining_kmf),c.shareUrl=e.share_url||(e.token?`${window.location.origin}/boutique/?p=${e.token}`:null);try{sessionStorage.setItem("kmrc_share",JSON.stringify({token:c.shareToken,id:c.shareId,expiry:c.shareExpiry,name:c.cartName,status:c.shareStatus,total_kmf:c.shareTotalKmf,contributed_kmf:c.shareContributedKmf,remaining_kmf:c.shareRemainingKmf,share_url:c.shareUrl}))}catch{}}}function be(e=[],t){let o=W(e).filter(G);return o.length<=1?"":`
    <div class="k-group-cart-switcher" aria-label="Mes paniers groupe">
      <div class="k-group-cart-switcher-head">
        <strong>Mes paniers groupe</strong>
        <span>${o.length} actifs</span>
      </div>
      <div class="k-group-cart-tabs">
        ${o.map(n=>{let s=String(n.id)===String(t),r=d(n.total_kmf_snapshot),i=n.title||"Panier groupe",a=P(n);return`
            <button
              type="button"
              class="k-group-cart-tab ${s?"is-active":""}"
              data-k-group-cart-id="${g(String(n.id))}">
              <strong>${g(i)}</strong>
              <span>${h(r,"KMF")} \xB7 ${g(z(n.status,a).replace(/^../,"").trim())}</span>
            </button>`}).join("")}
      </div>
    </div>`}function ve(e=!1){return e?`
      <div class="k-group-mini-guide">
        <span><b>1</b> Paiements ouverts</span>
        <span><b>2</b> Suivez les r\xE8glements</span>
        <span><b>3</b> Finalisez la commande</span>
      </div>`:`
    <div class="k-group-mini-guide">
      <span><b>1</b> Partagez le lien</span>
      <span><b>2</b> Les proches s'engagent</span>
      <span><b>3</b> Lancez le r\xE8glement</span>
    </div>`}function ye(e=[],t={}){let o=Array.isArray(e)?e:[],n=o.slice(0,8).map(i=>{let a=i.product_name||i.name||i.product?.name||"Produit",u=Number(i.quantity||i.qty||1),l=Number(i.unit_price_kmf||i.price_kmf||i.price||i.product?.price_kmf||0),f=i.product_image||i.product_image_url||i.image_url||i.image||i.product?.image_url||"";return`
      <div class="k-group-side-item">
        ${f?`<img src="${g(f)}" alt="">`:'<div class="k-group-side-item-fallback">\u{1F4E6}</div>'}
        <div class="k-group-side-item-main">
          <strong>${g(a)}</strong>
          <span>\xD7${u} \xB7 ${h(d(l),"KMF")}</span>
        </div>
      </div>`}).join(""),s=o.length,r=d(t.total_kmf_snapshot||0);return`
    <aside class="k-group-side-panel">
      <div class="k-group-side-card">
        <div class="k-group-side-head">
          <strong>Articles du panier</strong>
          <span>${s} article${s>1?"s":""}</span>
        </div>
        <div class="k-group-side-list">
          ${n||'<p class="k-group-side-empty">Aucun article \xE0 afficher.</p>'}
        </div>
        <div class="k-group-side-total">
          <span>Total panier</span>
          <strong>${h(r,"KMF")}</strong>
        </div>
      </div>
    </aside>`}function Y(e,t,o){let n=P(e),s=d(e.total_kmf_snapshot),r=d(e.contributed_kmf),i=M(e),a=["active","partially_funded","fully_funded"].includes(e.status),u=L(e),l="";n&&o?.length?l=`
      <div class="k-group-contribs-label">Engagements verrouill\xE9s (${o.length})</div>
      <div class="k-group-commitment-list">
        ${o.map(m=>{let x=t?.some(C=>C.commitment_id===m.id&&C.status==="paid");return`
            <div class="k-group-commitment-row">
              <span class="k-group-commitment-name">${g(m.participant_name?.split(" ")[0]||"Participant")}</span>
              <span class="k-group-commitment-amount">${h(d(m.amount_kmf),"KMF")}</span>
              <span class="k-group-commitment-status">${x?"\u2705 Pay\xE9":"\u23F3 En attente"}</span>
            </div>`}).join("")}
      </div>`:!n&&o?.length?l=`
      <div class="k-group-contribs-label">Engagements indicatifs (${o.length})</div>
      <div class="k-group-commitment-list">
        ${o.map(m=>`
          <div class="k-group-commitment-row">
            <span class="k-group-commitment-name">${g(m.participant_name?.split(" ")[0]||"Participant")}</span>
            <span class="k-group-commitment-amount">${h(d(m.amount_kmf),"KMF")}</span>
            <span class="k-group-commitment-status" style="color:var(--text-muted)">indicatif</span>
          </div>`).join("")}
      </div>`:l=`<p class="k-group-contrib-empty">${n?"Aucun engagement verrouill\xE9.":"Aucun engagement encore \u2014 partagez le lien !"}</p>`;let f=n?`
    <div class="k-group-settlement-summary">
      <strong>Panier en r\xE8glement \u{1F510}</strong>
      ${u.locked_commitments_count>0?`<span>${u.locked_commitments_count} engagement(s) verrouill\xE9(s) \xB7 total indicatif : ${h(d(u.locked_commitments_total_kmf),"KMF")}</span>`:""}
    </div>`:"",b=de(r,s),k=me(o,s),w=k.pctRaw>100?`<span class="k-group-progress-badge k-group-progress-badge--over"
          aria-label="${k.pctRaw}% engag\xE9 \u2014 sur-couvert">${k.pctRaw}\xA0% engag\xE9</span>`:"",S=`<span class="k-group-progress-legend-paid">\u25CF pay\xE9&nbsp;: ${h(r,"KMF")}</span>`,v=k.engagementsTotal>0?`<span class="k-group-progress-legend-engaged">\u25CF engag\xE9&nbsp;: ${h(k.engagementsTotal,"KMF")}</span>`:"",p=`<span class="k-group-progress-legend-total">total&nbsp;: ${h(s,"KMF")}</span>`;return`
    <div class="k-group-progress-card" id="k-group-progress-card">
      <div class="k-group-card-head">
        <div>
          <div class="k-group-card-title">${g(e.title||"Panier groupe")}</div>
          <div class="k-group-card-meta">${z(e.status,n)}</div>
        </div>
      </div>
      ${f}
      <div class="k-group-progress-wrap">
        ${w}
        <div class="k-group-progress"
             aria-label="Pay\xE9 ${b}% \xB7 Engag\xE9 ${k.pctCapped}%"
             role="group">
          <!-- Couche intention (fond, toujours sous le pay\xE9) -->
          ${k.pctCapped>0?`<span class="k-group-progress-bar k-group-progress-bar--engaged"
                     style="width:${k.pctCapped}%"
                     aria-label="Engag\xE9 ${k.pctCapped}%"></span>`:""}
          <!-- Couche r\xE9elle (premier plan) -->
          <span class="k-group-progress-bar k-group-progress-bar--paid"
                style="width:${b}%"
                aria-label="Pay\xE9 ${b}%"></span>
        </div>
        <div class="k-group-progress-legend" aria-hidden="true">
          ${S}
          ${v}
          ${p}
        </div>
      </div>
      ${i>0&&a&&n?`<p class="k-group-remaining">Reste \xE0 payer : <strong>${h(i,"KMF")}</strong></p>`:""}
      <div class="k-group-contribs">
        ${l}
      </div>
    </div>`}function _e(e){let t=P(e),o=["active","partially_funded","fully_funded"].includes(e.status);if(e.status==="converted_to_order"||e.finalized_order_id)return`
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">Commande cr\xE9\xE9e</div>
        <p class="k-group-finalized-hint">Ce panier est cl\xF4tur\xE9 et li\xE9 \xE0 une commande Komerce.</p>
        ${e.finalized_order_id?'<button class="k-group-btn k-group-btn--ghost" id="k-group-to-track">\u{1F4E6} Voir la commande</button>':""}
      </div>`;if(!o)return'<p class="k-group-finalized-hint">Ce panier est cl\xF4tur\xE9.</p>';let n=e.status==="fully_funded"||M(e)<=0,s=M(e),r=ge(e),i=r?fe(r):null,a=r&&r-Date.now()<6*36e5,u=t&&i?`
    <p class="k-group-share-hint${a?" is-exp-soon":""}" style="margin-top:6px">
      \u23F1\uFE0F R\xE8glement ouvert jusqu'au
      ${r.toLocaleString("fr-FR",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"})}
      \u2014 ${i}
    </p>`:"",l=`
    <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <button class="k-group-btn k-group-btn--ghost k-group-btn--danger" id="k-group-cancel">
        \u{1F5D1} Annuler le panier
      </button>
    </div>`;if(!t)return`
      <div class="k-group-card k-group-actions-card">
        <div class="k-group-section-title">G\xE9rer le panier</div>
        <div class="k-group-creator-actions">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">\u{1F4F2} WhatsApp</button>
          <button class="k-group-btn k-group-btn--copy" id="k-group-copy">\u{1F517} Copier</button>
        </div>
        <p class="k-group-share-hint">Une fois que tout le monde a confirm\xE9 son engagement, passez au r\xE8glement.</p>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <label style="font-size:12px;font-weight:700;color:var(--text-muted);display:block;margin-bottom:6px">
            D\xE9lai de paiement
          </label>
          <select id="k-group-settlement-window"
            style="width:100%;padding:9px 12px;border:1px solid var(--border);border-radius:10px;font-size:14px;font-family:var(--font);margin-bottom:10px">
            <option value="24">24 heures</option>
            <option value="48" selected>48 heures (d\xE9faut)</option>
            <option value="168">7 jours</option>
          </select>
          <button class="k-group-btn k-group-btn--primary" id="k-group-open-settlement" style="background:var(--accent,#1f7a54)">
            \u{1F510} Passer au r\xE8glement
          </button>
          <p class="k-group-share-hint" style="margin-top:6px">
            Fige les engagements et ouvre les paiements. Action irr\xE9versible.
          </p>
        </div>
        <div style="margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
          <button class="k-group-btn k-group-btn--ghost" id="k-group-edit-items"
            style="width:100%">
            \u270F\uFE0F Modifier les articles
          </button>
          <p class="k-group-share-hint" style="margin-top:4px">
            Les participants seront notifi\xE9s du nouveau total.
          </p>
        </div>
        <p class="k-group-input-error" id="k-group-settlement-err"></p>
        ${l}
      </div>`;let f=n?`<div class="k-group-funded-callout">
        <strong>\u2705 Tout est r\xE9gl\xE9</strong>
        <p>Validez maintenant pour que la commande parte en pr\xE9paration.</p>
        <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize">\u2713 Valider et commander</button>
      </div>`:s>0?`<div class="k-group-funded-callout k-group-funded-callout--gap">
          <strong>Il manque ${d(s).toLocaleString("fr-FR")} KMF</strong>
          <p>Vous pouvez couvrir le reste et valider maintenant.</p>
          <button class="k-group-btn k-group-btn--finalize" id="k-group-finalize-gap">
            Je couvre le reste et je valide
          </button>
        </div>
        <button class="k-group-btn k-group-disabled-finalize" type="button" disabled style="margin-top:8px;width:100%">
          Valider disponible \xE0 100%
        </button>`:'<button class="k-group-btn k-group-disabled-finalize" type="button" disabled>Valider disponible \xE0 100%</button>';return`
    <div class="k-group-card k-group-actions-card">
      <div class="k-group-section-title">Panier en r\xE8glement</div>
      ${u}
      <div class="k-group-creator-actions" style="margin-top:10px">
        <button class="k-group-btn k-group-btn--ghost" id="k-group-reshare">\u{1F4F2} Relancer WhatsApp</button>
        <button class="k-group-btn k-group-btn--copy" id="k-group-copy">\u{1F517} Copier</button>
      </div>
      <p class="k-group-share-hint">Partagez le lien pour que les participants puissent payer leur engagement verrouill\xE9.</p>
      ${f}
      <p class="k-group-input-error" id="k-group-finalize-err"></p>
      ${l}
    </div>`}function At(){let e=new URL(window.location.href),t=e.searchParams.get("p");if(t)return t;let o=e.pathname.match(/\/cart\/shared\/([^/?#]+)/);return o?o[1]:null}function Fe(){let e=document.getElementById("k-group-view");return e||(e=document.createElement("div"),e.id="k-group-view",e.className="k-group-view",(document.getElementById("k-fav-view")||document.getElementById("k-catalog-section"))?.after(e)),e}var B=null;function Be(e,t){Q(),B=setInterval(async()=>{if(!document.getElementById("k-group-view")?.classList.contains("show")){Q();return}try{let o=await H(e);if(!o)return;let n=o.commitments||[];if(!n.length)try{let s=o.cart?.token;s&&(n=await F(s))}catch{}t(o,n)}catch{}},3e4)}function Q(){B&&(clearInterval(B),B=null)}var X="kmrc_group_participant_token";function Pe(e){return`kmrc_group_commitment_${e}`}function Re(e){try{let t=localStorage.getItem(e);return t?JSON.parse(t):null}catch{return null}}function Ne(e,t){try{localStorage.setItem(e,JSON.stringify(t))}catch{}}function qe(e){if(e)try{localStorage.setItem(X,e)}catch{}}function Ve(){try{return localStorage.getItem(X)||null}catch{return null}}function je(){try{localStorage.removeItem(X)}catch{}}function De(e,t){!e||!t||Ne(Pe(e),{...t,saved_at:Date.now()})}function He(e){return e?Re(Pe(e)):null}function Ue(){let e=new URL(window.location.href),t=e.searchParams.get("shared_payment");if(!t)return null;try{e.searchParams.delete("shared_payment"),window.history.replaceState({},"",e.toString())}catch{}return t}async function Je(){if(c.shareToken&&c.shareId)return!0;try{return!!await(await import("./b-share-cart-GF2OAJN5.js")).restoreSharedCartFromBackend?.({silent:!0})}catch{return!1}}function Te(e){let t=e?.full_name||e?.name||e?.display_name||"Client Komerce",o=e?.phone||e?.whatsapp_phone||e?.whatsapp||"";return{name:String(t||"").trim(),phone:String(o||"").trim()}}function xe(e,t,o=!1){let n=L(t),r=d(n.locked_commitments_total_kmf||0)>0?Math.round(d(t.total_kmf_snapshot)/Math.max(1,d(n.locked_commitments_count||1)+1)/100)*100:0,i=d(n.locked_commitments_count||0)+1,a=Math.ceil(d(t.total_kmf_snapshot)/i/100)*100,u=a>=2500?`<div class="k-group-split-hint">\u{1F4A1} \xC0 participation \xE9gale : environ ${h(a,"KMF")} par personne</div>`:"",l=o?null:He(e),f=l?`
      <div class="k-group-saved-commitment" id="k-ge-saved-state">
        <strong>\u2705 Engagement enregistr\xE9</strong>
        <span>${g(l.name||"Participant")} \xB7 ${h(d(l.amount),"KMF")}</span>
        ${l.phone?`<span>T\xE9l\xE9phone : ${g(l.phone)}</span>`:""}
        <button type="button" id="k-ge-edit-btn">\u270F\uFE0F Modifier mon engagement</button>
      </div>`:"";return`
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--open">Phase ouverte \u2014 concertation</div>
      <div class="k-group-section-title">${o?"\u{1F4B8} Enregistrer ma participation":"\u{1F4B8} Participer"}</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 12px">
        Indiquez votre engagement indicatif. Aucun paiement maintenant \u2014 vous paierez quand le cr\xE9ateur lancera le r\xE8glement.
      </p>
      ${u}
      ${f}
      <div class="k-group-eng-fields" id="k-ge-fields" ${l?"hidden":""}>
        <div class="k-group-identity-note">
          <strong>Identit\xE9 s\xE9curis\xE9e par OTP</strong>
          <span>Votre num\xE9ro v\xE9rifi\xE9 sera utilis\xE9 pour retrouver cet engagement. Vous pourrez utiliser un autre num\xE9ro si besoin.</span>
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-amount">Montant d'engagement (KMF)</label>
          <input id="k-ge-amount" class="k-group-input" type="number" min="500" step="100"
            placeholder="${r>0?`Suggestion : ${h(r,"KMF")}`:"Ex : 5000"}"
            inputmode="numeric" value="${l?.amount?d(l.amount):""}">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-ge-msg">Message (optionnel)</label>
          <input id="k-ge-msg" class="k-group-input" type="text" placeholder="Ex : Je participe avec plaisir !" maxlength="200" value="${g(l?.message||"")}">
        </div>
        <p class="k-group-input-error" id="k-ge-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-ge-submit-btn">
          ${l?"\u270F\uFE0F Mettre \xE0 jour mon engagement":"\u270B Enregistrer mon engagement"}
        </button>
      </div>
    </div>`}function we(e,t,o,n){e.querySelector("#k-ge-edit-btn")?.addEventListener("click",()=>{let s=e.querySelector("#k-ge-fields"),r=e.querySelector("#k-ge-saved-state");s&&(s.hidden=!1),r&&(r.hidden=!0),e.querySelector("#k-ge-amount")?.focus()}),e.querySelector("#k-ge-submit-btn")?.addEventListener("click",async()=>{let s=Number(e.querySelector("#k-ge-amount")?.value),r=(e.querySelector("#k-ge-msg")?.value||"").trim(),i=e.querySelector("#k-ge-err"),a=e.querySelector("#k-ge-submit-btn");if(i.textContent="",!s||s<500){i.textContent="Minimum 500 KMF.";return}a.disabled=!0,a.textContent="\u{1F510} V\xE9rification\u2026";try{let u=await D({reason:"participer au panier",title:"S\xE9curiser votre participation",allowOtherPhone:!0});if(!u){a.disabled=!1,a.textContent="\u270B Enregistrer mon engagement";return}let l=Te(u),f=l.name||"Client Komerce",b=l.phone;if(!b){i.textContent="Num\xE9ro v\xE9rifi\xE9 introuvable. R\xE9essayez avec un autre num\xE9ro.",a.disabled=!1,a.textContent="\u270B Enregistrer mon engagement";return}a.textContent="\u23F3 Enregistrement\u2026";let k=await ue(t,{participant_name:f,participant_phone:b,amount_kmf:s,...r?{message:r}:{}});qe(t),De(t,{name:f,phone:b,amount:s,message:r}),y(k?.updated?"Engagement mis \xE0 jour !":"Engagement enregistr\xE9 !","success"),a.disabled=!1,a.textContent="\u2705 Engagement enregistr\xE9",n?.()}catch(u){i.textContent=u?.message||"Erreur.",a.disabled=!1,a.textContent="\u270B Enregistrer mon engagement"}})}function Ce(e,t){return`
    <div class="k-group-card k-group-contribute-card">
      <div class="k-group-phase-badge k-group-phase-badge--settlement">Phase r\xE8glement \u2014 paiement</div>
      <div class="k-group-section-title">\u{1F4B3} Payer ma contribution</div>
      <p style="font-size:13px;color:var(--text-muted);margin:0 0 10px">
        Le panier est pass\xE9 au r\xE8glement. Komerce utilise votre num\xE9ro v\xE9rifi\xE9 pour retrouver votre engagement verrouill\xE9.
      </p>
      <div class="k-group-identity-note">
        <strong>Identit\xE9 s\xE9curis\xE9e par OTP</strong>
        <span>Vous pouvez continuer avec le num\xE9ro reconnu ou utiliser un autre num\xE9ro si l'engagement est rattach\xE9 ailleurs.</span>
      </div>
      <p class="k-group-input-error" id="k-gp-lookup-err"></p>
      <button class="k-group-btn k-group-btn--ghost" id="k-gp-lookup-btn">\u{1F510} Retrouver mon engagement</button>

      <!-- Zone affich\xE9e apr\xE8s lookup -->
      <div id="k-gp-locked-zone" style="display:none;margin-top:14px">
        <div class="k-group-locked-amount">
          <div>
            <span>Votre engagement verrouill\xE9</span><br>
            <strong id="k-gp-locked-amount-text">\u2014</strong>
          </div>
          <span style="font-size:22px">\u{1F510}</span>
        </div>
        <div class="k-group-field" style="margin-top:10px">
          <label class="k-group-label" for="k-gp-name">Votre pr\xE9nom (pour la confirmation)</label>
          <input id="k-gp-name" class="k-group-input" type="text" placeholder="Ex : Fatima" maxlength="60" autocomplete="given-name">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-gp-email">Email (re\xE7u de paiement Stripe)</label>
          <input id="k-gp-email" class="k-group-input" type="email" placeholder="Ex : fatima@email.com" maxlength="120" autocomplete="email">
        </div>
        <div class="k-group-field">
          <label class="k-group-label" for="k-gp-msg">Message (optionnel)</label>
          <input id="k-gp-msg" class="k-group-input" type="text" placeholder="Ex : Bon courage !" maxlength="200">
        </div>
        <p class="k-group-input-error" id="k-gp-pay-err"></p>
        <button class="k-group-btn k-group-btn--primary" id="k-gp-pay-btn" data-amount="0" data-phone="">
          \u{1F4B3} Payer \u2014
        </button>
      </div>
    </div>`}function $e(e,t,o){let n=e.querySelector("#k-gp-lookup-btn");n?.addEventListener("click",async()=>{let s=e.querySelector("#k-gp-lookup-err");s.textContent="",n.disabled=!0,n.textContent="\u{1F510} V\xE9rification\u2026";try{let r=await D({reason:"payer ma contribution",title:"S\xE9curiser votre paiement",allowOtherPhone:!0});if(!r){n.disabled=!1,n.textContent="\u{1F510} Retrouver mon engagement";return}let i=Te(r),a=i.phone;if(!a)throw new Error("Num\xE9ro v\xE9rifi\xE9 introuvable. R\xE9essayez avec un autre num\xE9ro.");n.textContent="\u23F3 Recherche\u2026";let l=(await le(t,a))?.commitment;if(!l)throw new Error("Aucun engagement verrouill\xE9 trouv\xE9 pour ce num\xE9ro.");let f=e.querySelector("#k-gp-locked-zone"),b=e.querySelector("#k-gp-locked-amount-text"),k=e.querySelector("#k-gp-pay-btn"),_=e.querySelector("#k-gp-name");b.textContent=h(d(l.amount_kmf),"KMF"),k.textContent=`\u{1F4B3} Payer ${h(d(l.amount_kmf),"KMF")}`,k.dataset.amount=String(l.amount_kmf),k.dataset.phone=a,_&&(_.value=l.participant_name||i.name||"Client Komerce"),f.style.display="",n.textContent="\u2705 Engagement trouv\xE9"}catch(r){s.textContent=r?.message||"Aucun engagement verrouill\xE9 pour ce num\xE9ro.",n.disabled=!1,n.textContent="\u{1F510} Retrouver mon engagement"}}),e.querySelector("#k-gp-pay-btn")?.addEventListener("click",async()=>{let s=e.querySelector("#k-gp-pay-btn"),r=e.querySelector("#k-gp-pay-err"),i=(e.querySelector("#k-gp-name")?.value||"").trim(),a=(e.querySelector("#k-gp-email")?.value||"").trim(),u=(e.querySelector("#k-gp-msg")?.value||"").trim(),l=Number(s.dataset.amount),f=s.dataset.phone;if(r.textContent="",!i){r.textContent="Pr\xE9nom requis.";return}if(!a||!a.includes("@")){r.textContent="Email valide requis.";return}if(!l){r.textContent="Montant invalide.";return}s.disabled=!0,s.textContent="\u23F3 Redirection\u2026";try{let b=await pe(t,{amount_kmf:l,contributor_name:i,contributor_email:a,contributor_phone:f,...u?{message:u}:{}});b?.checkout_url?window.location.href=b.checkout_url:(y("Contribution enregistr\xE9e !","success"),s.textContent="\u2705 Enregistr\xE9")}catch(b){r.textContent=b?.message||"Erreur.",s.disabled=!1,s.textContent=`\u{1F4B3} Payer ${h(l,"KMF")}`}})}async function Se(e,t,o,n,s=!1){let r=e.querySelector(s?"#k-group-finalize-gap":"#k-group-finalize"),i=e.querySelector("#k-group-finalize-err");r&&(r.disabled=!0,r.textContent="\u23F3 Validation\u2026");try{let a=await se(t,s?{accept_partial:!0}:{});c.shareToken=null,c.shareId=null,c.cartName="",c.shareExpiry=null,c.shareStatus=null;try{sessionStorage.removeItem("kmrc_share"),sessionStorage.removeItem("kmrc_banner_dismissed")}catch{}Qe(),T(),import("./b-share-cart-GF2OAJN5.js").then(u=>u.refreshSharedBadges?.(!1)),e.innerHTML=`
      <div class="k-group-success">
        <div class="k-group-success-icon">\u{1F389}</div>
        <strong>Panier cl\xF4tur\xE9 !</strong>
        <p>Commande <strong>${g(a.order_reference||"")}</strong> cr\xE9\xE9e.</p>
        ${a.prepaid_kmf>0?`<p class="k-group-success-detail">${h(a.prepaid_kmf,"KMF")} pr\xE9pay\xE9s.</p>`:""}
        <button class="k-group-btn k-group-btn--ghost k-group-btn--mt" id="k-group-to-track">\u{1F4E6} Voir ma commande</button>
      </div>`,Le(e,{...n,finalized_order_id:a.order_id},o,t)}catch(a){a?.code==="stock_issues"||a?.message?.includes("stock")?i&&(i.textContent=a.message||"Probl\xE8me de stock."):y(a?.message||"Erreur validation.","error"),r&&(r.disabled=!1,r.textContent=s?"Je couvre le reste et je valide":"\u2713 Valider et commander")}}function Le(e,t,o,n,s){e.querySelector("#k-group-reshare")?.addEventListener("click",()=>{let r=`Rejoins mon panier Komerce : "${g(t.title||"Panier groupe")}" \u2192 ${o}`;window.open(`https://wa.me/?text=${encodeURIComponent(r)}`,"_blank","noopener")}),e.querySelector("#k-group-copy")?.addEventListener("click",async()=>{try{await navigator.clipboard.writeText(o),y("Lien copi\xE9 !","success")}catch{y("Impossible de copier.","error")}}),e.querySelector("#k-group-to-track")?.addEventListener("click",()=>{import("./b-nav-CB3BL6QB.js").then(({switchView:r})=>{import("./b-tracking-HKIQN4KI.js").then(({renderTrackView:i})=>{document.querySelectorAll(".k-bnav-item, .k-header-nav-btn").forEach(a=>a.classList.toggle("active",a.dataset.tab==="track")),i(),r("track")})})}),e.querySelector("#k-group-open-settlement")?.addEventListener("click",async()=>{let r=e.querySelector("#k-group-open-settlement"),i=e.querySelector("#k-group-settlement-err"),a=Number(e.querySelector("#k-group-settlement-window")?.value)||48;if(confirm("Passer au r\xE8glement ? Les engagements seront verrouill\xE9s et les modifications du panier seront bloqu\xE9es. Action irr\xE9versible.")){r.disabled=!0,r.textContent="\u23F3 Passage en cours\u2026",i.textContent="";try{await ie(n,{settlement_window_hours:a}),y("Panier pass\xE9 au r\xE8glement. Les participants peuvent maintenant payer.","success"),s?.()}catch(u){i.textContent=u?.message||"Erreur.",r.disabled=!1,r.textContent="\u{1F510} Passer au r\xE8glement"}}}),e.querySelector("#k-group-finalize")?.addEventListener("click",()=>Se(e,n,o,t,!1)),e.querySelector("#k-group-finalize-gap")?.addEventListener("click",()=>{confirm("Vous allez couvrir le montant manquant et valider la commande. Confirmer ?")&&Se(e,n,o,t,!0)}),e.querySelector("#k-group-cancel")?.addEventListener("click",async()=>{let i=d(t.contributed_kmf)>0?`\u26A0\uFE0F Ce panier a des contributions pay\xE9es (${d(t.contributed_kmf).toLocaleString("fr-FR")} KMF). L'annulation n\xE9cessitera des remboursements manuels. Confirmer quand m\xEAme ?`:"Annuler le panier ? Cette action est irr\xE9versible.";if(confirm(i))try{await ce(n,{reason:"creator_cancel"}),import("./b-share-cart-GF2OAJN5.js").then(a=>a.clearShareState?.()),y("Panier annul\xE9.","success"),s?.()}catch(a){y(a?.message||"Impossible d'annuler.","error")}}),e.querySelector("#k-group-edit-items")?.addEventListener("click",async()=>{let r=e.querySelector("#k-group-edit-items");r&&(r.disabled=!0,r.textContent="\u23F3 Chargement\u2026");try{let i=await U(n);if(!i?.cart_items?.length){y("Panier collectif vide \u2014 impossible de charger les articles.","error"),r&&(r.disabled=!1,r.textContent="\u270F\uFE0F Modifier les articles");return}c.cart=i.cart_items.map(a=>({product:{id:a.product_id,name:a.product_name||"",price_kmf:a.unit_price_kmf||0,image_url:a.product_image||"",category:a.product_category||"",promo_pct:0,is_promo:!1},id:a.product_id,name:a.product_name||"",price:a.unit_price_kmf||0,image:a.product_image||"",qty:a.quantity||1})),te(),c.editSharedCart={shared_cart_id:n,token:c.shareToken,return_tab:"group",started_at:Date.now()},import("./b-nav-CB3BL6QB.js").then(({switchView:a})=>{document.querySelectorAll(".k-bnav-item, .k-header-nav-btn").forEach(u=>u.classList.toggle("active",u.dataset.tab==="shop")),a("shop"),ee.emit("side-cart:render")}),y('Modifiez les articles, puis cliquez "Mettre \xE0 jour le panier collectif".',"success")}catch(i){y(i?.message||"Impossible de charger le panier sauvegard\xE9.","error"),r&&(r.disabled=!1,r.textContent="\u270F\uFE0F Modifier les articles")}})}function Ge(e,t,o,n){let s=e.map(a=>`
    <div class="k-group-item-row">
      <span class="k-group-item-name">${g(a.name||"Produit")}</span>
      <span class="k-group-item-qty">\xD7${a.quantity||1}</span>
      <span class="k-group-item-price">${h(d(a.unit_price_kmf),"KMF")}</span>
    </div>`).join("")||'<p class="k-group-contrib-empty">Aucun article.</p>',r=e.length,i=r<=3;return`
    <div class="k-group-card k-group-items-card ${i?"is-open":""}">
      <button class="k-group-items-toggle" type="button" id="k-group-items-toggle" aria-expanded="${i?"true":"false"}">
        <span>
          <strong>${g(o.title||"Panier groupe")}</strong><br>
          <span>Total : ${h(t,"KMF")} \xB7 ${z(o.status,n)} \xB7 ${r} article${r>1?"s":""}</span>
        </span>
        <span class="k-group-items-chevron">\u2304</span>
      </button>
      <div class="k-group-items-list" id="k-group-items-list" ${i?"":"hidden"}>
        ${s}
      </div>
    </div>`}function We(e){let t=e.querySelector("#k-group-items-toggle"),o=e.querySelector("#k-group-items-list"),n=t?.closest(".k-group-items-card");!t||!o||t.addEventListener("click",()=>{let s=t.getAttribute("aria-expanded")!=="true";t.setAttribute("aria-expanded",s?"true":"false"),o.hidden=!s,n?.classList.toggle("is-open",s)})}function Ye(e){e.innerHTML='<div class="k-group-loading"><div class="k-group-spin"></div><p>Chargement\u2026</p></div>'}function Ze(e){e.innerHTML=`
    <div class="k-group-empty">
      <div class="k-group-empty-icon">\u{1F465}</div>
      <strong>Aucun panier groupe actif</strong>
      <span>Cr\xE9ez-en un depuis votre panier avec "Payer en groupe".</span>
    </div>`}function Ee(e){e.innerHTML=`
    <div class="k-group-empty">
      <div class="k-group-empty-icon">\u274C</div>
      <strong>Panier introuvable</strong>
      <span>Ce lien est peut-\xEAtre expir\xE9 ou invalide.</span>
    </div>`}async function Z(e={}){Q();let t=Fe();Ye(t);let o=Ue();o==="success"&&y("Contribution enregistr\xE9e !","success"),o==="cancel"&&y("Paiement annul\xE9. Aucun montant pr\xE9lev\xE9.","info");let n=e.participantToken||(c.shareToken?null:Ve());if(!(!n||n===c.shareToken)){qe(n);let p=await J(n);if(!p?.cart){je(),Ee(t);return}let m=p.cart,x=p.items||[],C=d(m.total_kmf_snapshot),E=P(m),A=["active","partially_funded"].includes(m.status),K=[];try{K=await F(n)}catch{}t.innerHTML=`
      <div class="k-group-header">
        <h2>\u{1F465} Panier groupe</h2>
        <p class="k-group-subhead">Panier de ${g(m.beneficiary_name_snapshot||"")}.</p>
      </div>
      ${Ge(x,C,m,E)}
      ${K.length>0?`
        <div class="k-group-card" style="padding:14px 16px">
          <div class="k-group-contribs-label">Engagements ${E?"verrouill\xE9s":"indicatifs"} (${K.length})</div>
          <div class="k-group-commitment-list">
            ${K.map(R=>`
              <div class="k-group-commitment-row">
                <span class="k-group-commitment-name">${g(R.participant_name?.split(" ")[0]||"Participant")}</span>
                <span class="k-group-commitment-amount">${h(d(R.amount_kmf),"KMF")}</span>
              </div>`).join("")}
          </div>
        </div>`:""}
      ${A&&!E?xe(n,m,!1):A&&E?Ce(n,m):`<div class="k-group-card"><strong>${m.status==="fully_funded"?"\u2705 Panier financ\xE9, merci !":"Ce panier n'accepte plus de contribution."}</strong></div>`}`,We(t),A&&!E?we(t,n,m,()=>Z({participantToken:n})):A&&E&&$e(t,n,m);return}let r=[];try{let p=await ae();r=Array.isArray(p?.carts)?p.carts:[]}catch{r=[]}if(r.length){let p=ke(r,e.cartId||c.shareId);p&&he(p)}else if((!c.shareToken||!c.shareId)&&!await Je()){Ze(t);return}let i;try{i=await H(c.shareId)}catch{i=await J(c.shareToken)}if(!i?.cart){Ee(t);return}let a=i.cart,u=i.contributions||[],l=c.shareId||a.id,f=i.share_url||c.shareUrl||`${window.location.origin}/boutique/?p=${c.shareToken}`,b=[];try{b=(await U(l))?.cart_items||[]}catch{b=i.items||i.cart_items||[]}let k=P(a),_=["active","partially_funded","fully_funded"].includes(a.status),w=i.commitments||[];if(!w.length&&c.shareToken)try{w=await F(c.shareToken)}catch{}let S=_&&a.status!=="fully_funded"&&M(a)>0,v=()=>Z(e);t.innerHTML=`
    <div class="k-group-cockpit">
      <div class="k-group-main-col">
        <div class="k-group-header">
          <h2>\u{1F465} Mon panier groupe</h2>
          <p class="k-group-subhead">${k?"\u{1F510} Panier en r\xE8glement \u2014 les participants peuvent maintenant payer.":"Phase de concertation \u2014 partagez le lien et collectez les engagements."}</p>
        </div>
        ${be(r,l)}
        ${ve(k)}
        ${Y(a,u,w)}
        ${S&&!k?`
          <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je veux aussi m'engager</button>
          <div class="k-group-self-panel" id="k-group-self-panel" hidden>
            ${xe(c.shareToken,a,!0)}
          </div>`:""}
        ${S&&k?`
          <button class="k-group-self-toggle" id="k-group-self-toggle" type="button">Je veux aussi payer</button>
          <div class="k-group-self-panel" id="k-group-self-panel" hidden>
            ${Ce(c.shareToken,a)}
          </div>`:""}
        ${_e(a)}
      </div>
      ${ye(b,a)}
    </div>`,t.querySelectorAll("[data-k-group-cart-id]").forEach(p=>{p.addEventListener("click",()=>{let m=p.dataset.kGroupCartId;!m||String(m)===String(l)||Z({...e,cartId:m})})}),S&&(t.querySelector("#k-group-self-toggle")?.addEventListener("click",()=>{let p=t.querySelector("#k-group-self-panel");p&&(p.hidden=!p.hidden)}),k?$e(t,c.shareToken,a):we(t,c.shareToken,a,v)),Le(t,a,f,l,v),T(),_&&Be(l,(p,m=w)=>{let x=t.querySelector("#k-group-progress-card");x&&(x.outerHTML=Y(p.cart,p.contributions||[],m)),import("./b-share-cart-GF2OAJN5.js").then(C=>C.refreshSharedBadges?.(!0,p.cart))})}function Qe(){let e=!!c.shareToken;document.getElementById("k-bnav-group-badge")?.classList.toggle("show",e),document.getElementById("k-header-group-badge")?.classList.toggle("show",e),document.getElementById("k-header-group-btn")?.classList.toggle("has-active",e)}export{Ae as a,Ke as b,D as c,ze as d,T as e,tt as f,At as g,Q as h,Z as i,Qe as j};
