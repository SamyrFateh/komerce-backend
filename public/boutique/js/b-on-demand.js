/**
 * @komerce-arch-lite
 * @role          boutique-on-demand
 * @domain        boutique
 * @layer         ui-component
 * @owner         public/boutique/js/b-on-demand.js
 * @purpose       Client request inbox and private conversation, using existing identity.
 * @impact-areas  boutique, notifications, market-delegation
 */
'use strict';
import {requireIdentity} from './b-identity.js';
import {bus} from './b-bus.js';
const BASE='/api/client-requests';
const MOTIFS={auto_parts:'Pièces automobiles',express:'Livraison express',other:'Autre recherche'};
const STATUS={new:'Nouvelle',in_progress:'En cours',closed:'Clôturée'};
let installed=false,dialog=null,session=0,timer=null,opening=false;
function node(tag,text,cls){const e=document.createElement(tag);if(text!=null)e.textContent=text;if(cls)e.className=cls;return e}
function button(text,action){const b=node('button',text,'k-track-retry-btn');b.type='button';b.addEventListener('click',action);return b}
async function request(path,method='GET',body){
  const res=await fetch(path,{method,body,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.error||'Demande indisponible.'),{status:res.status});
  return data;
}
function path(ref){return BASE+'/'+encodeURIComponent(ref)}
function marketCode(){return window.KomerceMarket?.get()?.code||null}
function stop(){if(timer)clearInterval(timer);timer=null}
function shell(){if(dialog)return dialog;dialog=node('dialog',null,'k-on-demand');dialog.setAttribute('aria-labelledby','k-on-demand-title');dialog.addEventListener('close',()=>{session++;stop();dialog.replaceChildren()});document.body.append(dialog);return dialog}
function header(title,back){const h=node('header',null,'k-on-demand-head');const t=node('h2',title);t.id='k-on-demand-title';if(back)h.append(button('Retour',back));h.append(t,button('Fermer',()=>shell().close()));return h}
function active(s){return session===s&&dialog?.open}
function feedback(){const e=node('p',null,'k-on-demand-feedback');e.setAttribute('role','status');return e}
function compose({create=false,submit}){
  const f=node('form',null,'k-on-demand-compose');let motif;
  if(create){const label=node('label','Votre besoin');motif=node('select');motif.name='motif';for(const [v,t] of Object.entries(MOTIFS)){const o=node('option',t);o.value=v;motif.append(o)}label.append(motif);f.append(label)}
  const label=node('label',create?'Décrivez votre besoin':'Votre message');const input=node('textarea');input.name='body';input.maxLength=2000;input.rows=2;label.append(input);
  const photoLabel=node('label','Photos (3 maximum, 5 Mo chacune)');const photos=node('input');photos.type='file';photos.accept='image/jpeg,image/png,image/webp';photos.multiple=true;photoLabel.append(photos);
  const send=node('button',create?'Envoyer ma demande':'Envoyer','k-track-retry-btn');send.type='submit';const msg=feedback();f.append(label,photoLabel,send,msg);
  f.addEventListener('submit',async e=>{e.preventDefault();if(send.disabled)return;const files=[...photos.files];if(!input.value.trim()&&!files.length){msg.textContent='Écrivez un message ou ajoutez une photo.';return}if(files.length>3||files.some(p=>p.size>5*1024*1024)){msg.textContent='Maximum 3 photos de 5 Mo.';return}
    const data=new FormData();data.append('body',input.value);for(const file of files)data.append('photos',file);
    if(create){const market=marketCode();if(!market){msg.textContent='Marché indisponible.';return}data.append('market',market);data.append('motif',motif.value)}
    send.disabled=true;msg.textContent='Envoi…';try{await submit(data);input.value='';photos.value='';msg.textContent='Envoyé.'}catch(err){msg.textContent=err.message}finally{send.disabled=false}
  });return f;
}
function renderMessages(host,ref,messages,prepend=false){
  const fragment=document.createDocumentFragment();for(const m of messages){if(m.visibility!=='client')continue;const item=node('article',null,'k-on-demand-message'+(m.author_side==='client'?' is-own':''));item.dataset.messageId=m.id;item.append(node('small',m.author_side==='client'?'Vous':'Conseiller'),node('p',m.body));for(const a of m.attachments||[]){const img=node('img');img.src=path(ref)+'/attachments/'+encodeURIComponent(a.id);img.alt='Photo jointe';img.loading='lazy';item.append(img)}fragment.append(item)}
  if(prepend)host.prepend(fragment);else{host.replaceChildren(fragment);host.scrollTop=host.scrollHeight}
}
async function inbox(){
  stop();const s=++session;const d=shell();const list=node('div',null,'k-on-demand-list');const msg=feedback();d.replaceChildren(header('Komerce On Demand'),node('p','Pièces automobiles, livraison express ou recherche hors catalogue.'),button('Nouvelle demande',()=>createRequest()),list,msg);
  let oldest=null;
  async function load(append=false){try{const data=await request(BASE+(append&&oldest?'?before='+encodeURIComponent(oldest):''));if(!active(s))return;const rows=data.requests||[];if(!append)list.replaceChildren();if(!rows.length&&!append)list.append(node('p','Aucune demande pour le moment.'));list.querySelector('[data-more]')?.remove();for(const r of rows)list.append(button((MOTIFS[r.motif]||r.motif)+' · '+(STATUS[r.status]||r.status)+' · '+r.reference.slice(0,10),()=>thread(r.reference)));oldest=rows.at(-1)?.reference||null;if(rows.length===50){const more=button('Demandes précédentes',()=>load(true));more.dataset.more='1';list.append(more)}}catch(err){if(active(s))msg.textContent=err.message}}
  await load();
}
function createRequest(){stop();const s=++session;const d=shell();d.replaceChildren(header('Nouvelle demande',inbox),compose({create:true,submit:async data=>{const result=await request(BASE,'POST',data);if(active(s))await thread(result.request.reference)}}))}
async function thread(ref){
  stop();const s=++session;const d=shell();const title=header('Votre conseiller Komerce',inbox);const state=node('p');const log=node('div',null,'k-on-demand-thread');log.setAttribute('role','log');const msg=feedback();const controls=node('div');let last='',older=false,loading=false;
  d.replaceChildren(title,state,button('Messages précédents',async()=>{const first=log.firstElementChild?.dataset.messageId;if(!first)return;try{const data=await request(path(ref)+'?before='+encodeURIComponent(first));if(active(s)){older=true;renderMessages(log,ref,data.messages||[],true)}}catch(err){msg.textContent=err.message}}),log,controls,msg);
  const form=compose({submit:async data=>{await request(path(ref)+'/messages','POST',data);if(active(s))await load(true)}});controls.append(form);
  async function load(force=false){if(loading)return;loading=true;try{const data=await request(path(ref));if(!active(s))return;const r=data.request;state.textContent=(MOTIFS[r.motif]||r.motif)+' · '+(STATUS[r.status]||r.status);form.hidden=r.status==='closed';const messages=data.messages||[];const signature=JSON.stringify(messages.map(m=>[m.id,m.attachments?.map(a=>a.id)]));if(force||signature!==last){if(!older||force){renderMessages(log,ref,messages);older=false}else{const known=new Set([...log.children].map(e=>e.dataset.messageId));for(const m of messages.filter(m=>!known.has(m.id))){const temp=node('div');renderMessages(temp,ref,[m]);log.append(...temp.children)}}last=signature}msg.textContent=''}catch(err){if(active(s)){msg.textContent=err.message;if([401,403,404].includes(err.status)){stop();form.hidden=true;log.replaceChildren()}}}finally{loading=false}}
  await load();if(active(s))timer=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);
}
export async function openOnDemand(ref=null,origin=null){
  if(opening)return;opening=true;try{const user=await requireIdentity({reason:'contacter un conseiller Komerce',title:'Confirmer votre identité',returnFocusTo:origin});if(!user)return;const d=shell();if(!d.open)d.showModal();if(ref)await thread(ref);else await inbox()}finally{opening=false}
}
export function setupOnDemand(){if(installed)return;installed=true;document.addEventListener('click',e=>{const b=e.target.closest?.('[data-on-demand]');if(!b)return;e.preventDefault();openOnDemand(null,b).catch(()=>{})});bus.on('on-demand:open',payload=>openOnDemand(payload?.reference||null).catch(()=>{}));window.addEventListener('komerce:identity-cleared',()=>{if(dialog?.open)dialog.close()})}
