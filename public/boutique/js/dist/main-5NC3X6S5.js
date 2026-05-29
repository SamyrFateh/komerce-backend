import{d as J,e as ee}from"./chunks/chunk-A6KAYHKR.js";import{a as te,b as re,d as oe,e as ae,f as ne}from"./chunks/chunk-BWQJVHJU.js";import"./chunks/chunk-ITN3AXZH.js";import{a as Y}from"./chunks/chunk-WEJXIU4M.js";import"./chunks/chunk-XTI5HQII.js";import"./chunks/chunk-43ELGPLX.js";import{E as me,H as S,K as ue,N as pe,a as d,b as x,c as G,d as L,e as Q,f as U,g as $,h as W,i as w,j as X,k as Z,m as ie,n as se,w as le,x as ce,z as de}from"./chunks/chunk-WCB2FJJ3.js";import{b as R,d as E,e as F,f as g,m as u,o as l,q as p,s as j,t as K,x as V}from"./chunks/chunk-MECZG36V.js";(function(){function t(){if(window.innerWidth>=900){var r=document.getElementById("k-page-scroll");r&&(r.style.top="",r.style.position="",r.style.height="",r.style.overflow="")}}t(),window.addEventListener("resize",t)})();var tt="33699272526",Vo="https://wa.me/"+tt;function fe(){j(),document.body.classList.add("k-view-shop"),Q(),V(),ue(),pe(),Z(),te(),oe(),ae(),re(),le(),ee(),rt(),me(),ne()}function rt(){document.querySelectorAll("[data-footer-cat]").forEach(function(e){e.addEventListener("click",function(t){t.preventDefault();var r=e.dataset.footerCat,o=document.querySelector('.k-chip[data-cat="'+r+'"]');o?o.click():import("./chunks/b-catalog-4ZKL2QRZ.js").then(function(n){n.setActiveCat&&n.setActiveCat(r)});var a=document.getElementById("k-grid");a&&a.scrollIntoView({behavior:"smooth",block:"start"})})})}u.on("checkout:open",Y);document.readyState==="loading"?(document.addEventListener("cart:setqty",function(e){var t=e.detail||{};t.pid!==void 0&&t.qty!==void 0&&se(t.pid,t.qty)}),document.addEventListener("DOMContentLoaded",fe)):fe();document.addEventListener("click",function(e){var t=e.target.closest(".k-modal-dot");if(t){e.preventDefault(),e.stopPropagation();var r=parseInt(t.dataset.index||t.getAttribute("data-index")||"0",10),o=document.querySelector(".k-modal-carousel-track");if(o){var a=o.querySelectorAll(".k-modal-slide");a.length&&(o.style.transform="translateX(-"+r*100+"%)",document.querySelectorAll(".k-modal-dot").forEach(function(n,i){n.classList.toggle("active",i===r)}))}}});function ot(){if(d()){var e=document.querySelector(".k-cats");if(e){var t=null,r=null;e.addEventListener("mouseenter",function(o){var a=o.target.closest(".k-chip");if(a){var n=a.dataset.cat;!n||n==="all"||n===r||(t&&clearTimeout(t),t=setTimeout(function(){r=n,ce(n),de(n,{center:!1})},80))}},!0),e.addEventListener("mouseleave",function(){t&&(clearTimeout(t),t=null)})}}}function at(){if(d()){return;var e,t,r}}function nt(){if(d()){return;var e,t,r,o}}function it(){if(!d())return;var e=document.querySelector("#k-hero-fixed-wrap .k-hero-media");if(!e||document.getElementById("k-optionb-search"))return;var t=document.createElement("div");t.id="k-optionb-search",t.setAttribute("role","search"),t.setAttribute("aria-label","Rechercher dans la boutique");var r=document.createElement("input");r.type="text",r.placeholder="Envoyez ce qui compte, partout aux Comores\u2026",r.setAttribute("autocomplete","off"),r.setAttribute("aria-label","Recherche produits");var o=document.createElement("button");o.type="button",o.setAttribute("aria-label","Lancer la recherche"),o.innerHTML='<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',t.appendChild(r),t.appendChild(o),e.appendChild(t);function a(n){var i=document.getElementById("k-search-input")||document.querySelector(".k-header-search input")||document.querySelector("[data-search-input]");i&&(i.value=n,i.dispatchEvent(new Event("input",{bubbles:!0})))}r.addEventListener("input",function(){a(r.value)}),r.addEventListener("keydown",function(n){n.key==="Enter"&&(a(r.value),r.blur())}),o.addEventListener("click",function(){a(r.value)})}function st(){u.on("view:changed",function(e){var t=e==="shop",r=document.querySelector(".k-home-merch"),o=document.querySelector(".k-promo-strip"),a=document.querySelector(".k-scroll-top");r&&(r.style.display=t?"":"none"),o&&(o.style.display=t?"":"none"),a&&a.classList.toggle("is-visible",t&&x()>600)})}function ke(){d()&&(ot(),at(),nt(),it(),st())}var lt="Produit Komerce",ve="/images/placeholder-product.png",ct="relay";var ge=40,dt=5,mt=95;function k(e,t=""){return e==null?t:String(e).trim()||t}function h(e){if(e==null||e==="")return null;let t=Number(e);return Number.isFinite(t)?t:null}function ut(e){let t=h(e);return t===null||t<dt||t>=mt?null:Math.round(t)}function he(e){let t=e.images,r=[];if(Array.isArray(t)&&(r=t.map(o=>o?typeof o=="string"?o.trim():typeof o=="object"&&o.url?String(o.url).trim():"":"").filter(Boolean)),r.length===0){let o=k(e.image_url||e.imageUrl,"");o&&(r=[o])}return r.length===0&&(r=[ve]),r}function pt(e){let t=k(e.fulfillment_type||e.fulfillmentType||e.source_type||e.sourceType,"").toLowerCase();return t==="local_stock"||t==="local"?"local":t==="preorder"||t==="backorder"?"preorder":t==="custom_made"||t==="custom"||t==="confection"?"custom":t==="dubai_sourcing"||t==="relay"||t==="standard"?"relay":ct}function ft(e){let t=k(e.stock_status||e.stockStatus||e.availability_status||e.availabilityStatus,"").toLowerCase();if(t==="unavailable"||t==="out_of_stock"||t==="rupture")return"unavailable";if(t==="low"||t==="low_stock")return"low";if(t==="available"||t==="in_stock")return"available";let r=h(e.stock??e.stock_qty??e.stockQty);return r!==null?r<=0?"unavailable":r<=10?"low":"available":"available"}function kt(e){let t=[e.delivery_estimate,e.deliveryEstimate,e.delivery_label,e.deliveryLabel,e.eta,e.etaLabel];for(let r of t){let o=k(r,"");if(o)return o}return null}function vt(e){let t=e.variants;if(!t)return e.has_variants||e.hasVariants?[]:null;if(Array.isArray(t))return t.length>0?t:null;if(typeof t=="object"){let r=Object.keys(t);return r.length>0?r.map(o=>({key:o,value:t[o]})):null}return null}function gt(e){let t=e.specs||e.specifications;if(!t)return null;if(Array.isArray(t)){let r=t.map(o=>o?typeof o=="string"?{label:"",value:o}:{label:k(o.label||o.key,""),value:k(o.value,"")}:null).filter(o=>o&&o.value);return r.length>0?r:null}if(typeof t=="object"){let r=Object.entries(t).map(([o,a])=>({label:k(o,""),value:k(a,"")})).filter(o=>o.value);return r.length>0?r:null}return null}function ht(e){let t=e.social_proof||e.socialProof;if(!t||typeof t!="object")return null;let r=h(t.sold_count??t.soldCount??t.sold),o=h(t.rating),a=h(t.reviews_count??t.reviewsCount??t.reviews);return r!==null&&r>0||o!==null&&o>0||a!==null&&a>0?{sold:r??null,rating:o??null,reviews:a??null,soldLabel:r>0?`${r} vendus`:"",ratingLabel:o>0?o.toFixed(1):"",reviewsLabel:a>0?`${a} avis`:""}:null}function bt(e){let t=e.data_quality_score??e.dataQualityScore,r=h(t);if(r!==null)return Math.max(0,Math.min(100,r));let o=0;k(e.name,"")&&(o+=25),h(e.price_kmf??e.priceKmf)&&(o+=25);let a=he(e);return a.length>0&&a[0]!==ve&&(o+=25),(e.category||e.category_key||e.categoryKey)&&(o+=15),k(e.description,"")&&(o+=10),Math.min(o,100)}function yt(e){let t=[];return e.oldPriceKmf!==null&&e.oldPriceKmf>0&&t.push("k-modal--has-promo"),e.variants!==null&&e.variants.length>0&&t.push("k-modal--has-variants"),e.deliveryEstimate&&t.push("k-modal--has-delivery"),e.stockStatus==="low"&&t.push("k-modal--stock-low"),e.socialProof&&t.push("k-modal--has-social-proof"),e.specs&&e.specs.length>0&&t.push("k-modal--has-specs"),e.dataQualityScore<ge&&t.push("k-modal--low-confidence"),(e.priceKmf===null||e.priceKmf===0)&&t.push("k-modal--no-price"),e.stockStatus==="unavailable"&&t.push("k-modal--stock-out"),t.push(`k-modal--fulfillment-${e.fulfillmentType}`),t}function be(e={},t={}){let r=t.imageSize||800,o=e.id??null,a=k(e.name,lt),n=k(e.description,""),i=k(e.category,""),s=he(e),c=s.map(et=>R(et,r)),m=h(e.price_kmf??e.priceKmf),f=ut(e.promo_pct??e.promoPct),v=f!==null&&m!==null&&m>0?Math.round(m/(1-f/100)):null,B=pt(e),D=ft(e),O=kt(e),Xe=vt(e),Ze=gt(e),Je=ht(e),H=bt(e),y={id:o,raw:e,name:a,safeName:E(a),description:n,safeDescription:E(n),category:i,images:s,optimizedImages:c,primaryImage:c[0],imageAlt:E(a),priceKmf:m,priceLabel:m!==null&&m>0?g(m):"Prix \xE0 confirmer",priceEurLabel:m!==null&&m>0?`\u2248 ${F(m,"EUR")}`:"",oldPriceKmf:v,oldPriceLabel:v!==null&&v>0?g(v):"",promoPct:f,promoLabel:f!==null?`-${f}%`:"",fulfillmentType:B,stockStatus:D,stockLabel:xt(D,e),deliveryEstimate:O,deliveryLabel:O||wt(B),variants:Xe,specs:Ze,socialProof:Je,dataQualityScore:H,isLowConfidence:H<ge};return y.cssClasses=yt(y),y.cssClassName=y.cssClasses.join(" "),y}function xt(e,t){if(e==="unavailable")return"\u2717 Rupture";if(e==="low"){let r=h(t.stock??t.stock_qty);return r!==null&&r>0?`\u{1F525} Plus que ${r} en stock`:"\u{1F525} Stock limit\xE9"}return"\u2713 Disponible"}function wt(e){return e==="local"?"Disponible imm\xE9diatement":e==="preorder"?"Sur pr\xE9commande":e==="custom"?"Sur commande / confection":"Livraison point relais"}function ye(e,t){if(!e||!t||!Array.isArray(t.cssClasses))return;let r=[];e.classList.forEach(o=>{o.startsWith("k-modal--")&&r.push(o)}),r.forEach(o=>e.classList.remove(o)),t.cssClasses.forEach(o=>e.classList.add(o))}function St(){if(d()){var e=p.modal?p.modal.querySelector(".k-modal-topbar"):null;if(e){var t=l.modalProduct;if(t){var r=e.querySelector(".k-modal-breadcrumb");r&&r.remove();var o=t.category||"",a=t.name||"",n=document.createElement("div");n.className="k-modal-breadcrumb",n.innerHTML='<span class="k-modal-breadcrumb-cat" data-cat="'+o+'">Boutique</span><span class="k-modal-breadcrumb-sep">\u203A</span><span class="k-modal-breadcrumb-cat" data-cat="'+o+'">'+o+'</span><span class="k-modal-breadcrumb-sep">\u203A</span><span class="k-modal-breadcrumb-name">'+a+"</span>";var i=e.querySelector(".k-modal-back");i&&i.nextSibling?e.insertBefore(n,i.nextSibling):e.appendChild(n),n.querySelectorAll(".k-modal-breadcrumb-cat").forEach(function(s){s.addEventListener("click",function(){var c=s.dataset.cat;if(c){var m=W(c)||c;u.emit("modal:close"),S(m)}})})}}}}function Ct(){if(d()){var e=p.modal?p.modal.querySelector(".k-modal-info"):null;if(e){var t=l.modalProduct;if(t){var r=e.querySelector(".k-modal-share-row");r&&r.remove();var o=window.location.origin+"/?p="+t.id,a=encodeURIComponent(`\u{1F440} Regarde ce que j'ai trouv\xE9 sur Komerce !
`+(t.name||"")+" \u2014 "+g(t.price_kmf)+`
`+o),n=document.createElement("div");n.className="k-modal-share-row",n.innerHTML='<button class="k-modal-share-btn k-modal-share-btn--wa" data-href="https://wa.me/?text='+a+'"><svg viewBox="0 0 24 24" fill="#fff"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347z"/><path d="M12 0C5.373 0 0 5.373 0 12c0 2.625.846 5.059 2.284 7.034L.789 23.492l4.634-1.215A11.95 11.95 0 0012 24c6.627 0 12-5.373 12-12S18.627 0 12 0zm0 21.75c-2.115 0-4.142-.578-5.906-1.672l-.424-.252-4.396 1.153 1.174-4.291-.276-.44A9.71 9.71 0 012.25 12 9.75 9.75 0 0112 2.25 9.75 9.75 0 0121.75 12 9.75 9.75 0 0112 21.75z"/></svg>Partager via WhatsApp</button><button class="k-modal-share-btn" data-action="copy"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/></svg>Copier le lien</button>',e.appendChild(n),n.querySelector(".k-modal-share-btn--wa").addEventListener("click",function(){window.open(this.dataset.href,"_blank")}),n.querySelector('[data-action="copy"]').addEventListener("click",function(){navigator.clipboard.writeText(o).then(function(){K("\u{1F517} Lien copi\xE9 !")})})}}}}function Et(){if(d()){var e=p.modal?p.modal.querySelector(".k-modal-info"):null;if(e){var t=l.modalProduct;if(t){var r=e.querySelector(".k-modal-specs");r&&r.remove();var o=Number(t.stock||0),a=t.category||"Non cat\xE9goris\xE9",n=t.weight_kg?t.weight_kg+" kg":"\u2014",i=document.createElement("div");i.className="k-modal-specs",i.innerHTML='<button class="k-modal-spec-toggle is-open">D\xE9tails du produit<svg class="k-modal-spec-toggle-arrow" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"/></svg></button><div class="k-modal-spec-body is-open"><table class="k-modal-spec-table"><tr><td>Cat\xE9gorie</td><td>'+a+"</td></tr><tr><td>R\xE9f\xE9rence</td><td>#"+t.id+"</td></tr><tr><td>Stock</td><td>"+(o>0?o+" unit\xE9"+(o>1?"s":""):"Rupture")+"</td></tr><tr><td>Poids estim\xE9</td><td>"+n+"</td></tr>"+(t.promo_pct?"<tr><td>Promotion</td><td>-"+t.promo_pct+"%</td></tr>":"")+"</table></div>";var s=e.querySelector(".k-modal-share-row");s?e.insertBefore(i,s):e.appendChild(i);var c=i.querySelector(".k-modal-spec-toggle"),m=i.querySelector(".k-modal-spec-body");c.addEventListener("click",function(){var f=c.classList.toggle("is-open");m.classList.toggle("is-open",f)})}}}}function Lt(){if(d()){var e=p.modal?p.modal.querySelector(".k-modal-info"):null;if(e){var t=e.querySelector(".k-modal-trust");t&&t.remove();var r=document.createElement("div");r.className="k-modal-trust",r.innerHTML='<span class="k-modal-trust-item"><svg viewBox="0 0 24 24"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>Paiement s\xE9curis\xE9</span><span class="k-modal-trust-item"><svg viewBox="0 0 24 24"><rect x="1" y="3" width="15" height="13" rx="2"/><path d="M16 8l4 2v6l-4 2"/></svg>Retrait en relais</span><span class="k-modal-trust-item"><svg viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>Stock garanti</span>';var o=e.querySelector(".k-modal-specs");o?e.insertBefore(r,o):e.appendChild(r)}}}var xe=.00204;function _t(){if(d()){var e=document.getElementById("k-modal-aed-price");if(e){var t=l.modalProduct;if(!t||!t.price_kmf){e.innerHTML="";return}e.innerHTML="";var r=Math.round(t.price_kmf*xe);if(r>0){var o=document.createElement("span");if(o.className="k-modal-eur-ref",t.original_price_kmf&&t.original_price_kmf>t.price_kmf){var a=Math.round(t.original_price_kmf*xe);o.innerHTML="\u2248\u202F<strong>"+r+"\u202F\u20AC</strong><s>"+a+"\u202F\u20AC</s>"}else o.innerHTML="\u2248\u202F<strong>"+r+"\u202F\u20AC</strong>";e.appendChild(o)}if(t.promo_pct){var n=document.createElement("span");n.className="k-modal-aed-pct",n.textContent="-"+t.promo_pct+"%",e.appendChild(n)}if(t.promo_pct&&t.price_kmf){var i=Math.round(t.price_kmf/(1-t.promo_pct/100)),s=i-t.price_kmf;if(s>0){var c=document.createElement("span");c.className="k-modal-price-saving",c.innerHTML='<span class="k-modal-price-saving-sep" aria-hidden="true">\xB7</span>\xE9conomie '+new Intl.NumberFormat("fr-FR").format(s)+" KMF",e.appendChild(c)}}}}}var M=null,we=!1,Se=!1;function qt(){M&&(clearInterval(M),M=null)}function Pt(){if(d()){var e=l.modalProduct;if(e){var t=document.getElementById("k-modal-flash-bar");t&&(t.innerHTML="",e.promo_pct&&(t.innerHTML='<span class="k-modal-flash-icon" aria-hidden="true"></span><span class="k-modal-flash-label">Offre promotionnelle</span><span class="k-modal-flash-pct">-'+e.promo_pct+'%</span><span class="k-modal-flash-suffix">sur ce produit</span>'));var r=document.getElementById("k-modal-stock-bar");if(r){r.innerHTML="";var o=Number(e.stock||0);o>0&&o<=20&&(r.innerHTML='<span class="k-modal-stock-line-icon" aria-hidden="true"></span>'+o+"\u202Farticle"+(o>1?"s":"")+" disponible"+(o>1?"s":""))}}}}function Mt(){if(d()){var e=document.getElementById("k-modal-delivery");e&&(e.innerHTML="",e.innerHTML='<div class="k-modal-section-title">Livraison</div><div class="k-modal-delivery-opt is-active" data-delivery="relay"><div class="k-modal-opt-radio"></div><div class="k-modal-opt-body"><div class="k-modal-opt-row1"><span class="k-modal-opt-icon">\u{1F4E6}</span><span>Point relais</span><span class="k-modal-opt-free">Gratuit</span></div><div class="k-modal-opt-row2">D\xE9lai estim\xE9 : 3 \xE0 5 semaines</div><div class="k-modal-islands"><span class="k-modal-island-chip">Grande Comore</span><span class="k-modal-island-chip">Anjouan</span><span class="k-modal-island-chip">Moh\xE9li</span></div></div></div>')}}function At(){if(d()){var e=document.getElementById("k-modal-payment");if(e){e.innerHTML="";var t=[{key:"stripe",icon:"\u{1F4B3}",label:"Carte bancaire",sub:"Visa, Mastercard \u2014 paiement s\xE9curis\xE9",badge:'<span class="k-modal-pay-badge k-modal-pay-badge--stripe">Stripe</span>',active:!0},{key:"cash",icon:"\u{1F4B5}",label:"Paiement \xE0 la livraison",sub:"En esp\xE8ces \xE0 la r\xE9ception",badge:"",active:!1},{key:"group",icon:"\u{1F465}",label:"Panier partag\xE9",sub:"Invitez des proches \xE0 contribuer",badge:'<span class="k-modal-pay-badge k-modal-pay-badge--group">Partage</span>',active:!1},{key:"pot",icon:"\u{1F381}",label:"Cagnotte collective",sub:"Offrir ensemble, payer ensemble",badge:'<span class="k-modal-pay-badge k-modal-pay-badge--group">Collectif</span>',active:!1}],r='<div class="k-modal-section-title">Paiement</div><div class="k-modal-payment-opts">';t.forEach(function(o){r+='<div class="k-modal-payment-opt'+(o.active?" is-active":"")+'" data-pay="'+o.key+'"><div class="k-modal-opt-radio"></div><span class="k-modal-pay-icon">'+o.icon+'</span><span class="k-modal-pay-label">'+o.label+'<span class="k-modal-pay-sub">'+o.sub+"</span></span>"+o.badge+"</div>"}),r+="</div>",e.innerHTML=r,e.querySelectorAll(".k-modal-payment-opt").forEach(function(o){o.addEventListener("click",function(){e.querySelectorAll(".k-modal-payment-opt").forEach(function(a){a.classList.remove("is-active")}),o.classList.add("is-active")})})}}}function Ce(){var e=p.modal?p.modal.querySelector(".k-modal-actions"):null;if(e){var t=l.modalProduct;if(t){var r=l.modalQty||1,o=t.price_kmf*r,a=e.querySelector(".k-modal-subtotal");a||(a=document.createElement("div"),a.className="k-modal-subtotal",e.appendChild(a)),a.innerHTML="Sous-total : <strong>"+g(o)+"</strong>"}}}function It(){if(d()){var e=p.modal?p.modal.querySelector(".k-modal-scroll"):null;if(e){var t=l.modalProduct;if(t){var r=(l.viewedHistory||[]).slice(),o=r.filter(function(s){return s!==t.id});o.reverse();var a=o.map(function(s){return l.products.find(function(c){return c.id===s})}).filter(Boolean).slice(0,8),n=e.querySelector(".k-modal-recent");if(n&&n.remove(),a.length!==0){var i=document.createElement("div");i.className="k-modal-recent",i.innerHTML='<h3 class="k-modal-recent-title">Vu r\xE9cemment</h3><div class="k-modal-recent-grid">'+a.map(function(s){return'<button class="k-modal-recent-card" data-pid="'+s.id+'" type="button"><div class="k-modal-recent-img"><img src="'+(s.image_url||"")+'" alt="" loading="lazy"></div><div class="k-modal-recent-name">'+(s.name||"")+'</div><div class="k-modal-recent-price">'+g(s.price_kmf)+"</div></button>"}).join("")+"</div>",e.appendChild(i),i.querySelectorAll(".k-modal-recent-card").forEach(function(s){s.addEventListener("click",function(){var c=s.getAttribute("data-pid");c&&w(c,!0)})})}}}}}function Tt(e){if(!(!e||!p.modal))try{let t=be(e);ye(p.modal,t),l._currentModalViewModel=t}catch(t){typeof console<"u"&&console.warn&&console.warn("[modal-view-model] build failed, falling back to legacy classes:",t)}}function Nt(){d()&&requestAnimationFrame(function(){St(),_t(),Pt(),Mt(),At(),Lt(),Et(),Ct(),It(),Ce()})}function zt(){if(d()){var e=document.getElementById("k-qty-val");if(e){var t=new MutationObserver(function(){Ce()});t.observe(e,{childList:!0,characterData:!0,subtree:!0})}}}function Ee(){Se||(Se=!0,u.on("modal:opened",Tt))}function Le(){d()&&(we||(we=!0,u.on("modal:opened",Nt),u.on("modal:close",function(){qt()}),zt()))}function Bt(){if(d()&&!document.querySelector(".k-scroll-top")){var e=document.createElement("button");e.className="k-scroll-top",e.setAttribute("aria-label","Retour en haut"),e.innerHTML='<svg viewBox="0 0 24 24"><polyline points="18 15 12 9 6 15"/></svg>',document.body.appendChild(e),e.addEventListener("click",function(){L("smooth")});var t=!1;window.addEventListener("scroll",function(){t||(t=!0,requestAnimationFrame(function(){e.classList.toggle("is-visible",x()>600),t=!1}))},{passive:!0})}}function Dt(){return;var e,t,r}function A(){d()&&(ke(),Le(),Bt(),Dt())}var _e=!1;function Ot(e,t){return String(e)===String(t)}function qe(e){let t=String(e);return l.products.find(r=>String(r.id)===t)||null}function Ht(e){return!!e.closest([".k-qty-btn",".k-cart-item-remove",".k-cart-event-btn",".k-cart-checkout","#k-cart-checkout",".k-side-cart-remove",".k-side-cart-qty",".k-side-cart-action",".k-side-cart-checkout",".k-sc-btn-checkout",".k-sc-btn-group",".k-sc-btn-cart",".k-sc-remove",".k-sc-qty",".k-sc-action","[data-cart-action]","[data-no-product-open]","button","select","input","textarea"].join(","))}function Rt(){document.getElementById("k-cart-overlay")?.classList.remove("open"),document.getElementById("k-cart-drawer")?.classList.remove("open"),document.body.classList.remove("cart-open","cart-empty");let e=document.getElementById("k-side-cart");e&&e.classList.remove("is-attention")}function Pe(e){let t=qe(e);return t?(Rt(),requestAnimationFrame(()=>{w(t.id,!1)}),!0):(console.warn("[cart\u2192modal] Produit introuvable depuis le panier:",e),!1)}function Ft(e){let t=e.closest(".k-cart-item-img");if(t){let a=t.closest(".k-cart-item[data-pid], [data-open-product]");if(a)return a.dataset.openProduct||a.dataset.pid||null}let r=e.closest(["#k-side-cart .k-cart-item-img","#k-side-cart .k-side-cart-item-img","#k-side-cart .k-side-item-img","#k-side-cart .k-cart-product-thumb","#k-side-cart .k-sc-item-img","#k-side-cart .k-sc-item-image","#k-side-cart .k-sc-product-img","#k-side-cart .k-sc-product-image","#k-side-cart .k-sc-thumb","#k-side-cart .k-sc-media","#k-side-cart [data-open-product-img]"].join(","));if(r){let a=r.closest("[data-open-product], [data-pid], [data-product-id], .k-sc-item");if(a)return a.dataset.openProduct||a.dataset.pid||a.dataset.productId||null}let o=e.closest("#k-side-cart .k-sc-item img");if(o){let a=o.closest(".k-sc-item[data-product-id], .k-sc-item[data-pid], .k-sc-item[data-open-product]");if(a)return a.dataset.productId||a.dataset.pid||a.dataset.openProduct||null}return null}function jt(e){let t=Ft(e.target);t!=null&&(Ht(e.target)||(e.preventDefault(),e.stopPropagation(),e.stopImmediatePropagation?.(),Pe(t)))}function Kt(){u.on("modal:open",function(e){if(!e||e.id==null)return;let t=String(e.id);requestAnimationFrame(()=>{if(l.modalProduct&&Ot(l.modalProduct.id,t))return;let r=qe(e.id);r&&w(r.id,!1)})})}function Me(){_e||(_e=!0,document.addEventListener("click",jt,!0),Kt(),u.on("product:open-from-cart",function(e){!e?.id&&e?.id!==0||Pe(e.id)}))}function Ae(){import("./chunks/b-friendly-group-redirect-BQOCX46Y.js").then(function(e){e&&typeof e.setupFriendlyGroupRedirect=="function"&&e.setupFriendlyGroupRedirect()}).catch(function(e){console.warn("[friendly-group-link] chargement impossible",e)}),import("./chunks/b-desktop-global-cart-access-SLEJ5AJE.js").then(function(e){e&&typeof e.setupDesktopGlobalCartAccess=="function"&&e.setupDesktopGlobalCartAccess()}).catch(function(e){console.warn("[desktop-cart-access] chargement impossible",e)})}var Ie=!1,Te=!1,Ne=!1,b=null;function Be(){if(Te||typeof document>"u")return;Te=!0;let e=document.createElement("style");e.id="k-approche-c-hybrid-style",e.textContent=`
@media (min-width: 900px) {
  #k-modal .k-modal-product-zone {
    grid-template-columns: minmax(0, 48%) minmax(0, 52%);
    background: radial-gradient(circle at 18% 12%, color-mix(in srgb, var(--sand-warm) 60%, transparent), transparent 28%), var(--white);
  }
  #k-modal .k-modal-product-zone .k-modal-img-wrap {
    background: radial-gradient(circle at 62% 20%, color-mix(in srgb, var(--ocean) 10%, transparent), transparent 30%), linear-gradient(135deg, var(--sand) 0%, var(--sand-warm) 100%);
  }
  #k-modal .k-modal-slide { padding: 22px 30px 22px 92px; }
  #k-modal .k-modal-product-zone .k-modal-details {
    background: linear-gradient(180deg, var(--white) 0%, color-mix(in srgb, var(--sand) 48%, var(--white)) 100%);
    padding: 0 clamp(28px, 4.4vw, 72px);
  }
  #k-modal .k-modal-product-zone .k-modal-info {
    max-width: 760px;
    padding-top: clamp(22px, 3vh, 42px);
    padding-bottom: 14px;
  }
  #k-modal .k-modal-info h2 {
    font-family: var(--font-display, var(--font));
    font-size: clamp(30px, 3vw, 46px);
    line-height: .98;
    font-weight: 700;
    letter-spacing: -.035em;
    color: var(--text);
    max-width: 760px;
  }
  #k-modal .k-modal-name-row { margin-top: 10px; align-items: flex-start; }
  #k-modal .k-modal-fav-btn { margin-top: 2px; }
  #k-modal .k-modal-price-row { margin-top: 18px; gap: 12px; }
  #k-modal .k-modal-price { font-size: clamp(34px, 4vw, 56px); letter-spacing: -.04em; color: var(--coral); }
  #k-modal .k-modal-price-unit { font-size: .34em; letter-spacing: .06em; }
  #k-modal .k-modal-old-price { font-size: 16px; opacity: .72; }
  #k-modal .k-modal-aed-price { margin-top: 8px; margin-bottom: 10px; }
  #k-modal .k-modal-eur-ref,
  #k-modal .k-modal-price-saving { font-size: 13px; }
  #k-modal .k-modal-flash-bar { display: none; }
  #k-modal .k-modal-desc {
    font-style: italic;
    font-size: 13px;
    line-height: 1.55;
    color: var(--text-muted);
    margin-top: 8px;
    max-width: 680px;
  }
  #k-modal .k-modal-delivery,
  #k-modal .k-modal-payment {
    display: block;
    border-top: 0;
    margin-top: 18px;
    padding-top: 0;
  }
  #k-modal .k-buybox-relay-card {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 14px;
    padding: 15px 16px;
    border-radius: 18px;
    border: 1px solid var(--border-ocean-14);
    background: linear-gradient(135deg, color-mix(in srgb, var(--ocean-bg-08) 78%, var(--white)) 0%, var(--white) 100%);
    box-shadow: 0 12px 28px var(--border-text-06);
  }
  #k-modal .k-buybox-relay-icon {
    width: 42px;
    height: 42px;
    border-radius: 14px;
    display: grid;
    place-items: center;
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    font-size: 22px;
  }
  #k-modal .k-buybox-relay-title {
    font-size: 14px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.1;
  }
  #k-modal .k-buybox-relay-sub {
    margin-top: 4px;
    font-size: 12px;
    color: var(--text-muted);
  }
  #k-modal .k-buybox-relay-free {
    font-size: 12px;
    font-weight: 800;
    color: var(--ocean-dark);
    background: var(--ocean-bg-08);
    border: 1px solid var(--border-ocean-14);
    border-radius: 999px;
    padding: 5px 10px;
    white-space: nowrap;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline {
    position: relative;
    display: grid;
    grid-template-columns: auto minmax(180px, 1fr) minmax(210px, 1.15fr);
    align-items: center;
    gap: 12px;
    margin-top: 16px;
    padding: 14px 0 4px;
    background: transparent;
    border-top: 0;
    box-shadow: none;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-qty,
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-add-cart-btn,
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-buy-now-btn {
    min-height: 50px;
    border-radius: 999px;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-qty {
    background: var(--sand);
    box-shadow: inset 0 0 0 1px var(--border-text-06);
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-add-cart-btn {
    background: var(--white);
    font-size: 14px;
    font-weight: 850;
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-buy-now-btn {
    font-size: 15px;
    font-weight: 900;
    box-shadow: 0 14px 30px color-mix(in srgb, var(--ocean) 24%, transparent);
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-modal-subtotal {
    grid-column: 3;
    justify-self: center;
    margin-top: -2px;
    font-size: 12px;
    color: var(--text-muted);
  }
  #k-modal .k-modal-info > .k-modal-actions.k-buybox-actions-inline .k-modal-subtotal strong {
    color: var(--coral);
    font-size: 15px;
  }
  #k-modal .k-modal-payment .k-modal-section-title { margin-bottom: 9px; }
  #k-modal .k-buybox-payment-tabs {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 8px;
    margin-bottom: 10px;
  }
  #k-modal .k-buybox-payment-tab {
    height: 42px;
    border-radius: 13px;
    border: 1px solid var(--border);
    background: var(--white);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: 7px;
    font-size: 13px;
    font-weight: 700;
    cursor: pointer;
    transition: border-color .16s var(--ease), background .16s var(--ease), color .16s var(--ease), box-shadow .16s var(--ease), transform .16s var(--ease);
  }
  #k-modal .k-buybox-payment-tab:hover {
    transform: translateY(-1px);
    border-color: var(--ocean-light);
    box-shadow: 0 8px 18px var(--border-text-06);
  }
  #k-modal .k-buybox-payment-tab.is-active {
    border-color: var(--ocean);
    background: var(--ocean-bg-08);
    color: var(--ocean-dark);
    box-shadow: inset 0 0 0 1px var(--border-ocean-14);
  }
  #k-modal .k-buybox-payment-detail {
    display: grid;
    grid-template-columns: auto auto minmax(0, 1fr) auto;
    align-items: center;
    gap: 12px;
    min-height: 56px;
    padding: 12px 14px;
    border-radius: 16px;
    background: var(--white);
    border: 1px solid var(--border);
    box-shadow: 0 8px 22px var(--border-text-06);
  }
  #k-modal .k-buybox-payment-check {
    width: 18px;
    height: 18px;
    border-radius: 999px;
    border: 2px solid var(--ocean);
    position: relative;
  }
  #k-modal .k-buybox-payment-check::after {
    content: "";
    position: absolute;
    inset: 3px;
    border-radius: inherit;
    background: var(--ocean);
  }
  #k-modal .k-buybox-payment-icon { font-size: 18px; line-height: 1; }
  #k-modal .k-buybox-payment-copy { min-width: 0; }
  #k-modal .k-buybox-payment-copy strong {
    display: block;
    font-size: 14px;
    font-weight: 800;
    color: var(--text);
    line-height: 1.15;
  }
  #k-modal .k-buybox-payment-copy small {
    display: block;
    margin-top: 3px;
    font-size: 12px;
    color: var(--text-muted);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  #k-modal .k-buybox-payment-badge {
    font-size: 11px;
    font-weight: 800;
    padding: 4px 9px;
    border-radius: 8px;
    color: var(--violet-dark);
    background: var(--violet-light);
    border: 1px solid var(--violet-mid);
  }
  #k-modal .k-modal-trust {
    border-top: 0;
    margin-top: 12px;
    padding: 0;
    gap: 8px;
  }
  #k-modal .k-modal-trust-item {
    background: color-mix(in srgb, var(--sand) 76%, var(--white));
    border: 1px solid var(--border-text-06);
    min-height: 30px;
  }
  #k-modal .k-modal-share-row {
    border-top: 0;
    margin-top: 10px;
    padding-top: 0;
    display: flex;
    align-items: center;
    gap: 8px;
    justify-content: flex-start;
  }
  #k-modal .k-modal-share-row::before {
    content: 'Partager ce produit :';
    font-size: 12px;
    color: var(--text-muted);
    font-weight: 600;
  }
  #k-modal .k-modal-share-btn,
  #k-modal .k-modal-share-btn.k-modal-share-btn--wa {
    width: auto;
    min-height: 0;
    height: 30px;
    padding: 0 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--sand) 78%, var(--white));
    color: var(--text-muted);
    border: 1px solid var(--border-text-06);
    box-shadow: none;
    font-size: 12px;
    font-weight: 700;
  }
  #k-modal .k-modal-share-btn svg { width: 13px; height: 13px; }
  #k-modal .k-modal-share-btn.k-modal-share-btn--wa svg { fill: currentColor; }
  #k-modal .k-modal-details > .k-modal-inner-search { display: none !important; }
  #k-modal-suggestions.k-modal-suggestions--desktop-list {
    background: linear-gradient(180deg, var(--sand) 0%, var(--sand-warm) 100%);
    padding: 34px clamp(32px, 5vw, 72px) 56px;
  }
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-title {
    border-bottom: 0;
    margin-bottom: 18px;
  }
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-title-text {
    font-family: var(--font-display, var(--font));
    font-size: clamp(22px, 2vw, 30px);
    line-height: 1;
    letter-spacing: -.025em;
    color: var(--text);
  }
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid,
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid--same,
  #k-modal-suggestions.k-modal-suggestions--desktop-list .k-sug-grid--other {
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 18px;
  }
}
`,document.head.appendChild(e)}function _(e){if(e)for(;e.firstChild;)e.removeChild(e.firstChild)}function Vt(e,t){e.appendChild(document.createTextNode(t))}function Gt(){let e=document.getElementById("k-modal-delivery");if(!e)return;_(e);let t=document.createElement("div");t.className="k-buybox-relay-card";let r=document.createElement("div");r.className="k-buybox-relay-icon",r.setAttribute("aria-hidden","true"),r.textContent="\u{1F4E6}";let o=document.createElement("div");o.className="k-buybox-relay-copy";let a=document.createElement("div");a.className="k-buybox-relay-title",a.textContent="Retrait en relais";let n=document.createElement("div");n.className="k-buybox-relay-sub",n.textContent="Grande Comore \xB7 Anjouan \xB7 Moh\xE9li";let i=document.createElement("span");i.className="k-buybox-relay-free",i.textContent="Gratuit",o.append(a,n),t.append(r,o,i),e.appendChild(t)}function De(){if(!l.modalProduct)return;(!Number.isFinite(Number(l.modalQty))||Number(l.modalQty)<1)&&(l.modalQty=1);let e=document.getElementById("k-qty-val");e&&Number(e.textContent||0)<1&&(e.textContent="1");let t=document.querySelector(".k-modal-subtotal");if(t&&l.modalProduct.price_kmf){_(t),Vt(t,"Sous-total : ");let r=document.createElement("strong");r.textContent=g(l.modalProduct.price_kmf*l.modalQty),t.appendChild(r)}}function Oe(){Ne||typeof document>"u"||(Ne=!0,document.addEventListener("click",function(e){if(!(e.target&&e.target.closest?e.target.closest("#k-qty-minus"):null)||!d()||!l.modalProduct)return;if(Number(l.modalQty||0)<=1){e.preventDefault(),e.stopPropagation(),typeof e.stopImmediatePropagation=="function"&&e.stopImmediatePropagation(),l.modalQty=1;let o=document.getElementById("k-qty-val");o&&(o.textContent="1"),De()}},!0))}function Qt(){let e=document.querySelector("#k-modal .k-modal-info"),t=document.getElementById("k-modal-delivery"),r=document.querySelector("#k-modal .k-modal-actions");!e||!t||!r||(!b&&r.parentElement&&(b={parent:r.parentElement,next:r.nextSibling}),r.classList.add("k-buybox-actions-inline"),(r.parentElement!==e||t.nextElementSibling!==r)&&e.insertBefore(r,t.nextSibling))}function Ut(){let e=document.querySelector("#k-modal .k-modal-actions");!e||!b||!b.parent||(e.classList.remove("k-buybox-actions-inline"),b.parent.insertBefore(e,b.next||null))}var q={stripe:{icon:"\u{1F4B3}",tab:"Carte",title:"Carte bancaire",sub:"Visa, Mastercard \u2014 Stripe s\xE9curis\xE9",badge:"Stripe"},cash:{icon:"\u{1F4B5}",tab:"Livraison",title:"Paiement \xE0 la livraison",sub:"En esp\xE8ces \xE0 la r\xE9ception",badge:"Cash"},group:{icon:"\u{1F465}",tab:"Partag\xE9",title:"Panier partag\xE9",sub:"Invitez des proches \xE0 contribuer",badge:"Partage"},pot:{icon:"\u{1F381}",tab:"Cagnotte",title:"Cagnotte collective",sub:"Offrir ensemble, payer ensemble",badge:"Collectif"}};function ze(e){let t=q[e]||q.stripe,r=document.createElement("div");r.className="k-buybox-payment-detail",r.dataset.payDetail=e;let o=document.createElement("span");o.className="k-buybox-payment-check",o.setAttribute("aria-hidden","true");let a=document.createElement("span");a.className="k-buybox-payment-icon",a.setAttribute("aria-hidden","true"),a.textContent=t.icon;let n=document.createElement("span");n.className="k-buybox-payment-copy";let i=document.createElement("strong");i.textContent=t.title;let s=document.createElement("small");s.textContent=t.sub;let c=document.createElement("span");return c.className="k-buybox-payment-badge",c.textContent=t.badge,n.append(i,s),r.append(o,a,n,c),r}function $t(){let e=document.getElementById("k-modal-payment");if(!e)return;let t=l.modalPaymentMode||"stripe";_(e);let r=document.createElement("div");r.className="k-modal-section-title",r.textContent="Mode de paiement";let o=document.createElement("div");o.className="k-buybox-payment-tabs",o.setAttribute("role","tablist"),o.setAttribute("aria-label","Mode de paiement");let a=document.createElement("div");a.className="k-buybox-payment-detail-wrap",Object.keys(q).forEach(function(n){let i=q[n],s=document.createElement("button");s.type="button",s.className="k-buybox-payment-tab"+(n===t?" is-active":""),s.dataset.pay=n,s.setAttribute("role","tab"),s.setAttribute("aria-selected",n===t?"true":"false");let c=document.createElement("span");c.setAttribute("aria-hidden","true"),c.textContent=i.icon;let m=document.createElement("span");m.textContent=i.tab,s.append(c,m),s.addEventListener("click",function(){if(n==="group"){if(!l.modalProduct)return;ie(l.modalProduct,l.modalQty||1,s),X(),setTimeout(()=>J(),250);return}l.modalPaymentMode=n,o.querySelectorAll(".k-buybox-payment-tab").forEach(function(f){let v=f===s;f.classList.toggle("is-active",v),f.setAttribute("aria-selected",v?"true":"false")}),_(a),a.appendChild(ze(n))}),o.appendChild(s)}),a.appendChild(ze(t)),e.append(r,o,a)}function Wt(){d()&&(Be(),Oe(),Gt(),Qt(),De(),$t())}function I(){Ie||(Ie=!0,Be(),Oe(),u.on("modal:opened",function(){d()&&requestAnimationFrame(function(){requestAnimationFrame(Wt)})}),u.on("modal:closed",Ut))}var He=!1,Re=!1,Yt={mode:"Compl\xE9ter le look",enfant:"Compl\xE9ter avec",tech:"Accessoires compatibles",ordinateurs:"Accessoires compatibles",phones:"Accessoires utiles",t\u00E9l\u00E9phones:"Accessoires utiles",maison:"\xC0 associer avec",beaut\u00E9:"Routine compl\xE8te",cuisine:"Compl\xE9ter l\u2019\xE9quipement"};function Xt(){if(Re||typeof document>"u")return;Re=!0;let e=document.createElement("style");e.id="k-pdp-curation-style",e.textContent=`
@media (min-width: 900px) {
  #k-modal-suggestions.k-pdp-curation {
    background:
      radial-gradient(circle at 14% 0%, color-mix(in srgb, var(--ocean-bg-08) 60%, transparent), transparent 26%),
      linear-gradient(180deg, var(--sand) 0%, var(--sand-warm) 100%);
    border-top: 1px solid var(--border-text-06);
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-section {
    max-width: 1480px;
    margin-inline: auto;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-section + .k-sug-section {
    margin-top: 34px;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-title {
    display: grid;
    grid-template-columns: auto minmax(0, 1fr);
    align-items: center;
    column-gap: 12px;
    margin-bottom: 14px;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-title-icon {
    width: 36px;
    height: 36px;
    display: grid;
    place-items: center;
    border-radius: 999px;
    background: var(--white);
    box-shadow: 0 10px 24px var(--border-text-06);
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-title-text {
    font-family: var(--font-display, var(--font));
    font-size: clamp(24px, 2.2vw, 34px);
    letter-spacing: -.03em;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-subtitle {
    grid-column: 2;
    margin-top: -7px;
    color: var(--text-muted);
    font-size: 13px;
    line-height: 1.45;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--complements {
    padding: 22px;
    border-radius: 26px;
    background: color-mix(in srgb, var(--white) 72%, transparent);
    border: 1px solid var(--border-text-06);
    box-shadow: 0 18px 46px var(--border-text-06);
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--complements .k-sug-grid {
    display: grid;
    grid-template-columns: repeat(6, minmax(150px, 1fr));
    gap: 14px;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--same .k-sug-grid,
  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-section--editorial .k-sug-grid {
    grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
    gap: 18px;
  }

  #k-modal-suggestions.k-pdp-curation .k-pdp-curation-badge {
    position: absolute;
    left: 10px;
    top: 10px;
    z-index: 2;
    height: 24px;
    padding: 0 9px;
    display: inline-flex;
    align-items: center;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ocean) 92%, var(--text));
    color: var(--white);
    font-size: 11px;
    font-weight: 850;
    box-shadow: 0 8px 18px var(--border-text-12);
  }

  /* Si la carte porte d\xE9j\xE0 un badge promo (.k-sug-promo-badge), masquer
     le badge curation Utile/Assorti \u2014 la promo a priorit\xE9 commerciale.
     Les deux badges occupaient le m\xEAme coin haut-gauche et le curation
     \xE9crasait visuellement le -X% qui est un argument d'achat plus fort. */
  #k-modal-suggestions.k-pdp-curation .k-sug-card-img:has(.k-sug-promo-badge) .k-pdp-curation-badge {
    display: none;
  }

  #k-modal-suggestions.k-pdp-curation .k-sug-card-img { position: relative; }
}
`,document.head.appendChild(e)}function Fe(e,t,r,o){if(!e)return;let a=e.querySelector(".k-sug-title");if(!a)return;let n=a.querySelector(".k-sug-title-icon");n&&(n.textContent=t);let i=a.querySelector(".k-sug-title-text");i&&(i.textContent=r);let s=a.querySelector(".k-pdp-curation-subtitle");s||(s=document.createElement("div"),s.className="k-pdp-curation-subtitle",a.appendChild(s)),s.textContent=o}function Zt(e,t){if(!e||e.querySelector(".k-pdp-curation-badge"))return;let r=e.querySelector(".k-sug-card-img");if(!r)return;let o=document.createElement("span");o.className="k-pdp-curation-badge",o.textContent=t,r.appendChild(o)}function Jt(e){let t=String(e&&e.category?e.category:"").trim().toLowerCase();return Yt[t]||"Compl\xE9ter avec"}function er(e,t){if(!e)return null;let r=e.querySelector(".k-sug-grid--other");if(!r)return null;let o=Array.from(r.querySelectorAll(".k-sug-card")).slice(0,t);if(!o.length)return null;let a=document.createElement("div");a.className="k-sug-section k-pdp-curation-section--complements";let n=document.createElement("div");n.className="k-sug-title";let i=document.createElement("span");i.className="k-sug-title-icon",i.textContent="\u{1F9E9}";let s=document.createElement("span");s.className="k-sug-title-text",s.textContent=Jt(l.modalProduct);let c=document.createElement("div");c.className="k-pdp-curation-subtitle",c.textContent="Des produits utiles pour composer un panier plus complet, sans quitter la fiche.";let m=document.createElement("div");return m.className="k-sug-grid k-sug-grid--complements",n.append(i,s,c),a.append(n,m),o.forEach(function(f,v){Zt(f,v<2?"Assorti":"Utile"),m.appendChild(f)}),a}function tr(){if(!d())return;let e=document.getElementById("k-modal-suggestions"),t=document.getElementById("k-sug-rail");if(!e||!t||e.classList.contains("u-hidden"))return;let r=Array.from(t.querySelectorAll(":scope > .k-sug-section"));if(!r.length)return;let o=e.dataset.curationProductId,a=l.modalProduct?String(l.modalProduct.id):"";if(o===a)return;e.dataset.curationProductId=a,e.classList.add("k-pdp-curation");let n=r.find(function(c){return!!c.querySelector(".k-sug-grid--same")}),i=r.find(function(c){return!!c.querySelector(".k-sug-grid--other")}),s=er(i,6);if(s&&t.insertBefore(s,t.firstChild),n){n.classList.add("k-pdp-curation-section--same");let c=l.modalProduct&&l.modalProduct.category?l.modalProduct.category:"ce produit";Fe(n,"\u{1F30A}","Dans le m\xEAme univers","Des alternatives proches dans "+c+", pour comparer sans perdre le fil.")}i&&(i.classList.add("k-pdp-curation-section--editorial"),i.querySelectorAll(".k-sug-card").length>0?Fe(i,"\u2728","S\xE9lection Komerce","Quelques d\xE9couvertes populaires pour continuer l\u2019exploration."):i.classList.add("u-hidden"))}function T(){He||(He=!0,Xt(),u.on("modal:opened",function(){d()&&requestAnimationFrame(function(){requestAnimationFrame(tr)})}))}var je=!1,Ke=!1,Ve=!1;function rr(){if(Ke||typeof document>"u")return;Ke=!0;let e=document.createElement("style");e.id="k-home-premium-v1-style",e.textContent=`
@media (min-width: 900px) {
  html.k-home-premium-v1 .k-header {
    backdrop-filter: blur(18px);
    background: color-mix(in srgb, var(--sand) 82%, var(--white));
    border-bottom: 1px solid var(--border-text-06);
  }

  html.k-home-premium-v1 .k-logo-text {
    font-weight: 900;
    letter-spacing: -.025em;
  }

  html.k-home-premium-v1 .k-search {
    min-height: 54px;
    border-radius: 999px;
    box-shadow: 0 14px 36px var(--border-text-06);
  }

  html.k-home-premium-v1 .k-search input::placeholder {
    color: color-mix(in srgb, var(--text-muted) 78%, transparent);
  }

  html.k-home-premium-v1 #k-hero-fixed-wrap {
    background:
      radial-gradient(circle at 10% 0%, color-mix(in srgb, var(--ocean-bg-08) 66%, transparent), transparent 24%),
      linear-gradient(180deg, var(--sand) 0%, color-mix(in srgb, var(--sand-warm) 55%, var(--white)) 100%);
  }

  html.k-home-premium-v1 .k-hero-inner {
    max-width: none;
    padding-inline: clamp(26px, 3.6vw, 60px);
  }

  html.k-home-premium-v1 .k-hero-media {
    border-radius: 0 0 28px 28px;
    overflow: hidden;
    box-shadow: 0 18px 50px var(--border-text-06);
  }

  html.k-home-premium-v1 .k-hero-mini-slogan--premium {
    max-width: 510px;
  }

  html.k-home-premium-v1 .k-hero-badge {
    letter-spacing: .06em;
  }

  html.k-home-premium-v1 .k-hero-sub {
    margin-top: 14px;
    max-width: 470px;
    font-size: 15px;
    line-height: 1.55;
  }

  html.k-home-premium-v1 .k-hero-cta-primary {
    min-height: 44px;
    border-radius: 14px;
    box-shadow: 0 16px 32px color-mix(in srgb, var(--coral) 22%, transparent);
  }

  html.k-home-premium-v1 .k-hero-cta-ghost {
    border-radius: 14px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
  }

  html.k-home-premium-v1 .k-hero-trust {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    border: 1px solid var(--border-text-06);
  }

  html.k-home-premium-v1 .k-cats-shell { padding-top: 18px; }

  html.k-home-premium-v1 .k-cats::before {
    content: 'Explorer par univers';
    position: absolute;
    left: clamp(24px, 3vw, 46px);
    top: -34px;
    font-family: var(--font-display, var(--font));
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -.025em;
    color: var(--text);
  }

  html.k-home-premium-v1 .k-cats {
    position: relative;
    gap: 14px;
  }

  html.k-home-premium-v1 .k-chip {
    border-radius: 24px;
    min-width: 164px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    box-shadow: 0 14px 34px var(--border-text-06);
    transition: transform .18s var(--ease), box-shadow .18s var(--ease), border-color .18s var(--ease);
  }

  html.k-home-premium-v1 .k-chip:hover {
    transform: translateY(-3px);
    box-shadow: 0 20px 44px var(--border-text-08);
  }

  html.k-home-premium-v1 .k-chip-label { font-weight: 850; }

  html.k-home-premium-v1 .k-home-curation {
    display: block;
    padding: 22px clamp(26px, 3.4vw, 56px) 14px;
    background:
      radial-gradient(circle at 84% 4%, color-mix(in srgb, var(--coral) 10%, transparent), transparent 22%),
      var(--sand);
  }

  body:not(.k-view-shop) .k-home-curation {
    display: none !important;
  }

  html.k-home-premium-v1 .k-home-curation-inner {
    max-width: 1500px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    text-align: center;
  }

  html.k-home-premium-v1 .k-home-baseline {
    margin: 0;
    font-family: var(--font-display, var(--font));
    font-size: clamp(20px, 1.6vw, 26px);
    line-height: 1.1;
    letter-spacing: -.02em;
    color: var(--text);
  }

  html.k-home-premium-v1 .k-home-promise-list {
    display: flex;
    flex-wrap: wrap;
    justify-content: center;
    gap: 8px;
  }

  html.k-home-premium-v1 .k-home-promise-chip {
    padding: 8px 14px;
    border-radius: 999px;
    background: color-mix(in srgb, var(--white) 78%, transparent);
    border: 1px solid var(--border-text-06);
    color: var(--text);
    font-size: 12px;
    font-weight: 700;
  }

  html.k-home-premium-v1 #k-catalog-section { padding-top: 22px; }

  html.k-home-premium-v1 #k-catalog-section::before {
    content: 'Bons plans du moment';
    display: block;
    max-width: 1500px;
    margin: 0 auto 6px;
    font-family: var(--font-display, var(--font));
    font-size: clamp(26px, 2.2vw, 36px);
    line-height: 1;
    letter-spacing: -.03em;
    color: var(--text);
  }

  html.k-home-premium-v1 #k-catalog-section::after {
    content: 'Des produits utiles, bien plac\xE9s, faciles \xE0 commander et \xE0 retirer en relais.';
    display: block;
    max-width: 1500px;
    margin: -2px auto 18px;
    color: var(--text-muted);
    font-size: 14px;
  }

  body:not(.k-view-shop) #k-catalog-section::before,
  body:not(.k-view-shop) #k-catalog-section::after {
    content: none !important;
    display: none !important;
  }

  html.k-home-premium-v1 .k-side-cart {
    box-shadow: -14px 0 44px var(--border-text-08);
    border-left: 1px solid var(--border-text-06);
  }

  html.k-home-premium-v1 .k-sc-btn-checkout { border-radius: 18px; }
}
`,document.head.appendChild(e)}function C(e,t,r){let o=document.createElement(e);return t&&(o.className=t),r!==void 0&&(o.textContent=r),o}function Qe(e){let t=document.querySelector(".k-home-curation");t&&t.classList.toggle("u-hidden",e!=="shop")}function Ge(){if(Ve||!d()||typeof document>"u")return;let e=document.getElementById("k-page-scroll"),t=document.getElementById("k-desktop-catalog-wrap");if(!e||!t)return;Ve=!0,document.documentElement.classList.add("k-home-premium-v1");let r=C("section","k-home-curation");r.setAttribute("aria-label","Promesse Komerce");let o=C("div","k-home-curation-inner"),a=C("p","k-home-baseline","Achetez pour vous, pour eux, ou ensemble."),n=C("div","k-home-promise-list");["Retrait relais","Paiement s\xE9curis\xE9","Suivi en 9 \xE9tapes","Panier partag\xE9","Prix en KMF","Livraison incluse aux Comores"].forEach(function(i){n.appendChild(C("span","k-home-promise-chip",i))}),o.append(a,n),r.appendChild(o),e.insertBefore(r,t),Qe(document.body.classList.contains("k-view-shop")?"shop":"other")}function N(){je||(je=!0,rr(),document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ge,{once:!0}):Ge(),u.on("view:changed",Qe))}var Ue="kmrc_greeted";var $e="k-greeting-chip";function or(e){return(e||"").trim().split(/\s+/)[0]||""}function ar(e){let t=or(e.full_name),r=e.loyalty_badge?` ${e.loyalty_badge}`:"";return t?`Kwezi ${t}${r} \u{1F60A}`:`Kwezi${r} \u{1F60A}`}function nr(e){document.getElementById($e)?.remove();let t=document.createElement("div");t.id=$e,t.setAttribute("aria-live","polite"),t.textContent=e,document.body.appendChild(t),requestAnimationFrame(()=>{requestAnimationFrame(()=>t.classList.add("k-greeting-chip--visible"))}),setTimeout(()=>{t.classList.add("k-greeting-chip--out"),t.classList.remove("k-greeting-chip--visible"),setTimeout(()=>t.remove(),280)},4e3)}async function We(){if(!sessionStorage.getItem(Ue))try{let e=await fetch("/api/auth/me",{method:"GET",credentials:"include"});if(!e.ok)return;let t=await e.json();if(!t||!t.id)return;sessionStorage.setItem(Ue,"1"),nr(ar(t))}catch{}}function Ye(){Ee(),A(),I(),T(),N(),Me(),Ae(),We()}typeof window<"u"&&(window._kbus=u,document.readyState==="loading"?document.addEventListener("DOMContentLoaded",Ye):Ye(),P=d(),z=null,window.addEventListener("resize",function(){P||(clearTimeout(z),z=setTimeout(function(){d()&&!P&&(P=!0,A(),I(),T(),N())},150))},{passive:!0}));var P,z;
