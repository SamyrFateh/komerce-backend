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
async function request(path,method='GET',body){
  const res=await fetch(path,{method,body,credentials:'same-origin',cache:'no-store',headers:{Accept:'application/json'}});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw Object.assign(new Error(data.error||'Demande indisponible.'),{status:res.status});
  return data;
}
function path(ref){return BASE+'/'+encodeURIComponent(ref)}
function marketCode(){return window.KomerceMarket?.get()?.code||null}
function stop(){if(timer)clearInterval(timer);timer=null}
function shell(){if(dialog)return dialog;dialog=node('dialog',null,'k-on-demand');dialog.setAttribute('aria-labelledby','k-on-demand-title');dialog.addEventListener('close',()=>{session++;stop();dispose();dialog.replaceChildren();if(trigger?.isConnected)trigger.focus();trigger=null});dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dialog.close()}});document.body.append(dialog);return dialog}

const QUESTIONS={
 auto_parts:[['vehicle','Marque et modèle','Ex. Toyota Yaris'],['year','Année et motorisation','Ex. 2012, diesel'],['part','Pièce ou référence','Ex. alternateur, référence gravée'],['condition','Neuf ou occasion','Si vous le savez']],
 express:[['product','Produit ou référence','Nom du produit ou lien'],['destination','Destination ou relais','Ex. Douala'],['deadline','Date souhaitée','Ex. avant le 15 décembre']],
 other:[['product','Produit recherché','Marque, modèle, lien ou usage'],['quantity','Quantité','Ex. 2 pièces'],['budget','Budget indicatif','Si vous en avez un'],['deadline','Délai souhaité','Si vous en avez un']]
};
const LABELS={auto_parts:'Pièce automobile',express:'Livraison express',other:'Produit hors catalogue'};
const HINTS={auto_parts:'Photographiez la pièce et sa référence si elle est visible. Aucun document personnel nécessaire.',express:'Indiquez le produit et votre échéance. Le conseiller vérifiera les possibilités.',other:'Une photo, un lien ou une description suffit pour commencer.'};
const MAX=5*1024*1024;
let cleanup=null,trigger=null;
function dispose(){if(cleanup){cleanup();cleanup=null}}
function button(text,fn,style='secondary'){const b=node('button',text,'k-od-btn k-od-'+style);b.type='button';b.addEventListener('click',fn);return b}
function header(title,back,subtitle='Échange privé · Votre conseiller'){
 const h=node('header',null,'k-on-demand-head');
 if(back){const b=button('‹',back,'icon');b.setAttribute('aria-label','Retour');h.append(b)}
 const avatar=node('span','K','k-od-avatar');avatar.setAttribute('aria-hidden','true');
 const copy=node('div',null,'k-od-heading'),t=node('h2',title);t.id='k-on-demand-title';copy.append(t,node('small',subtitle));
 const close=button('×',()=>shell().close(),'icon');close.setAttribute('aria-label','Fermer');h.append(avatar,copy,close);return h
}
function active(s){return session===s&&dialog?.open}
function feedback(){const e=node('p',null,'k-on-demand-feedback');e.setAttribute('role','status');return e}
function panel(){return node('div',null,'k-od-scroll')}
function helper(text){const e=node('div',null,'k-od-helper');e.append(node('small','Aide à la demande'),node('p',text));return e}
function field(label,placeholder,value,change){
 const wrap=node('label',label,'k-od-field'),input=node('input');input.type='text';input.placeholder=placeholder;input.maxLength=180;input.value=value||'';input.addEventListener('input',()=>change(input.value));wrap.append(input);return wrap
}
function textField(value,change,placeholder){
 const wrap=node('label',null,'k-od-field'),input=node('textarea');input.name='body';input.rows=3;input.maxLength=2000;input.placeholder=placeholder;input.value=value;input.setAttribute('aria-label','Votre message');input.addEventListener('input',()=>change(input.value));wrap.append(input);return wrap
}
function draft(motif='other',body='',productId=null,skuId=null){return {motif,body,productId,skuId,market:marketCode(),answers:{},photos:[],busy:false,photoBusy:false,disposed:false}}
function resetPhotos(d){d.photos=[]}
function readPreview(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(Error('Aperçu de la photo indisponible.'));reader.readAsDataURL(file)})}
function ownDraft(d){dispose();cleanup=()=>{d.disposed=true;resetPhotos(d)}}
function formatBody(d){return [d.body.trim(),...(QUESTIONS[d.motif]||[]).map(([k,l])=>d.answers[k]?.trim()?l+' : '+d.answers[k].trim():'')].filter(Boolean).join('\n')}
async function preparePhoto(file){
 if(!file?.type?.startsWith('image/'))throw Error('Choisissez une image.');
 if(['image/jpeg','image/png','image/webp'].includes(file.type)&&file.size<=MAX)return file;
 if(typeof createImageBitmap!=='function')throw Error('Choisissez une photo JPEG, PNG ou WebP de moins de 5 Mo.');
 let bitmap;try{bitmap=await createImageBitmap(file)}catch{throw Error('Photo non lisible. Essayez JPEG, PNG ou WebP.')}
 try{for(const [edge,quality] of [[2560,.92],[2048,.88],[1600,.84]]){
  const ratio=Math.min(1,edge/Math.max(bitmap.width,bitmap.height)),canvas=document.createElement('canvas');
  canvas.width=Math.max(1,Math.round(bitmap.width*ratio));canvas.height=Math.max(1,Math.round(bitmap.height*ratio));
  const ctx=canvas.getContext('2d');if(!ctx)break;ctx.fillStyle='#fff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(bitmap,0,0,canvas.width,canvas.height);
  const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/jpeg',quality));if(blob&&blob.size<=MAX)return new File([blob],'photo.jpg',{type:'image/jpeg'})
 }}finally{bitmap.close()}
 throw Error('Photo trop volumineuse. Essayez une photo plus légère.')
}
function picker(d,msg,changed=()=>{}){
 const box=node('div',null,'k-od-photos'),preview=node('div',null,'k-od-previews'),tools=node('div',null,'k-od-photo-actions');
 const gallery=node('input'),camera=node('input');gallery.type=camera.type='file';gallery.accept='image/jpeg,image/png,image/webp';gallery.multiple=true;camera.accept='image/*';camera.setAttribute('capture','environment');gallery.hidden=camera.hidden=true;
 gallery.setAttribute('aria-label','Choisir des photos');camera.setAttribute('aria-label','Prendre une photo');
 const choose=button('＋ Photos',()=>gallery.click()),take=button('📷 Appareil photo',()=>camera.click(),'camera');
 tools.append(choose,take);box.append(tools,gallery,camera,preview,node('small','3 photos maximum · 5 Mo chacune','k-od-muted'));
 const redraw=()=>{preview.replaceChildren();for(const item of d.photos){const tile=node('div',null,'k-od-preview'),img=node('img');img.src=item.url;img.alt='Photo à envoyer';const b=button('×',()=>{if(d.busy)return;d.photos=d.photos.filter(p=>p!==item);redraw();changed()},'remove');b.setAttribute('aria-label','Supprimer la photo');tile.append(img,b);preview.append(tile)}choose.disabled=take.disabled=d.photos.length>=3||d.busy||d.photoBusy};
 async function add(files){
  if(d.photoBusy||d.busy||d.disposed)return;d.photoBusy=true;redraw();changed();
  try{for(const file of files){if(d.disposed)break;if(d.photos.length>=3){msg.textContent='Maximum 3 photos par message.';break}
    const result=await preparePhoto(file);const url=await readPreview(result);if(d.disposed)break;d.photos.push({file:result,url});msg.textContent=''
  }}catch(e){if(!d.disposed)msg.textContent=e.message}finally{d.photoBusy=false;if(!d.disposed){redraw();changed()}}
 }
 for(const input of [gallery,camera])input.addEventListener('change',()=>{const files=[...input.files];input.value='';void add(files)});
 box.addEventListener('dragover',e=>{if(e.dataTransfer?.types?.includes('Files'))e.preventDefault()});
 box.addEventListener('drop',e=>{e.preventDefault();void add([...e.dataTransfer.files])});
 box.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();void add(files)}});
 redraw();return {box,add,redraw}
}
function bindPaste(input,p){input.addEventListener('paste',e=>{const files=[...(e.clipboardData?.files||[])];if(files.length){e.preventDefault();void p.add(files)}})}
function payload(d,create){
 const data=new FormData(),body=create?formatBody(d):d.body.trim();
 if(!body&&!d.photos.length)throw Error('Décrivez votre besoin ou ajoutez une photo.');
 if(body.length>2000)throw Error('Votre message est trop long (2 000 caractères maximum).');
 data.append('body',body);for(const item of d.photos)data.append('photos',item.file);
 if(create){const market=d.market;if(!market||market!==marketCode())throw Error('Le marché a changé. Ouvrez une nouvelle demande.');data.append('market',market);data.append('motif',d.motif);if(d.motif==='express'&&d.productId){data.append('product_id',d.productId);if(d.skuId)data.append('sku_id',d.skuId)}}
 return data
}
function startRequest(seed={}){
 stop();const s=++session,d=draft(seed.motif||'other',seed.body||'',seed.productId||null,seed.skuId||null);ownDraft(d);
 function render(step){
  if(!active(s)||d.busy||d.photoBusy)return;const content=panel(),msg=feedback(),bottom=node('div',null,'k-od-bottom');
  shell().replaceChildren(header('Votre conseiller Komerce',step===1?()=>inbox():()=>render(step-1),'Nouvelle demande · '+(d.market||'Komerce')),content,bottom);
  content.append(node('p','Étape '+step+' sur 3','k-od-progress'));
  if(step===1){
   content.append(helper('Bonjour ! Que recherchez-vous ? Décrivez votre besoin, ajoutez une photo ou choisissez un sujet.'));
   const choices=node('div',null,'k-od-choices'),hint=node('p',HINTS[d.motif],'k-od-muted');
   for(const [key,label] of Object.entries(LABELS)){const b=button(label,()=>{d.motif=key;for(const c of choices.children)c.setAttribute('aria-pressed',String(c===b));hint.textContent=HINTS[key]},'choice');b.dataset.motif=key;b.setAttribute('aria-pressed',String(d.motif===key));choices.append(b)}
   const input=textField(d.body,value=>{d.body=value},'Ex. Je recherche cette pièce…');
   const next=button('Continuer',()=>render(2),'primary'),p=picker(d,msg,()=>{next.disabled=d.photoBusy});bindPaste(input,p);
   content.append(choices,input,p.box,hint);bottom.append(msg,next)
  }else if(step===2){
   content.append(helper('Quelques précisions peuvent aider votre conseiller. Répondez seulement à ce que vous connaissez.'));
   for(const [key,label,placeholder] of QUESTIONS[d.motif])content.append(field(label,placeholder,d.answers[key],value=>{d.answers[key]=value}));
   bottom.append(msg,button('Passer cette étape',()=>render(3)),button('Vérifier ma demande',()=>render(3),'primary'))
  }else{
   content.append(helper('Vérifiez votre demande avant de l’envoyer. Vous pourrez ensuite échanger avec votre conseiller.'));
   const summary=node('section',null,'k-od-summary');summary.append(node('strong',LABELS[d.motif]),node('p',formatBody(d)||'Demande illustrée par photo'));
   if(d.photos.length){const previews=node('div',null,'k-od-previews');for(const item of d.photos){const img=node('img');img.src=item.url;img.alt='Photo à envoyer';previews.append(img)}summary.append(previews)}
   content.append(summary,node('p','Le conseiller vérifiera la disponibilité et les conditions. Cette demande ne constitue pas une commande.','k-od-muted'));
   const edit=button('Modifier',()=>render(1)),send=button('Envoyer ma demande',async()=>{
    if(d.busy)return;let data;try{data=payload(d,true)}catch(e){msg.textContent=e.message;return}
    d.busy=true;send.disabled=edit.disabled=true;msg.textContent='Envoi…';
    try{const result=await request(BASE,'POST',data);if(active(s)){dispose();await thread(result.request.reference)}}catch(e){if(active(s))msg.textContent=e.message}finally{d.busy=false;send.disabled=edit.disabled=false}
   },'primary');bottom.append(msg,edit,send)
  }
 }
 render(1)
}
function compose({submit}){
 const d=draft(),f=node('form',null,'k-on-demand-compose'),msg=feedback(),send=node('button','Envoyer','k-od-btn k-od-primary');send.type='submit';ownDraft(d);
 const input=textField('',value=>{d.body=value},'Écrivez votre message…'),p=picker(d,msg,()=>{send.disabled=d.photoBusy||d.busy});bindPaste(input,p);
 const row=node('div',null,'k-od-send-row');row.append(input,send);f.append(p.box,row,msg);
 f.addEventListener('submit',async e=>{e.preventDefault();if(d.busy||d.photoBusy)return;let data;try{data=payload(d,false)}catch(err){msg.textContent=err.message;return}
  d.busy=true;send.disabled=true;p.redraw();msg.textContent='Envoi…';
  try{await submit(data);if(!d.disposed){resetPhotos(d);d.body='';input.querySelector('textarea').value='';msg.textContent='Envoyé.'}}
  catch(err){if(!d.disposed)msg.textContent=err.message}finally{d.busy=false;send.disabled=false;if(!d.disposed)p.redraw()}
 });return f
}
function renderMessages(host,ref,messages,prepend=false){
  const fragment=document.createDocumentFragment();for(const m of messages){if(m.visibility!=='client')continue;const item=node('article',null,'k-on-demand-message'+(m.author_side==='client'?' is-own':''));item.dataset.messageId=m.id;item.append(node('small',m.author_side==='client'?'Vous':'Conseiller'),node('p',m.body));for(const a of m.attachments||[]){const img=node('img');img.src=path(ref)+'/attachments/'+encodeURIComponent(a.id);img.alt='Photo jointe';img.loading='lazy';item.append(img)}fragment.append(item)}
  if(prepend)host.prepend(fragment);else{host.replaceChildren(fragment);host.scrollTop=host.scrollHeight}
}

async function inbox(seed=null){
 stop();dispose();const s=++session,content=panel(),list=node('div',null,'k-on-demand-list'),msg=feedback(),create=button('Nouvelle demande',()=>startRequest(seed||{}),'primary');
 create.disabled=true;shell().replaceChildren(header('Votre conseiller Komerce'),content);
 content.append(helper('Un produit introuvable ? Une pièce à identifier ? Parlez-nous de votre besoin.'),create,node('h3','Mes conversations'),list,msg);
 let oldest=null;
 async function load(append=false){try{const data=await request(BASE+(append&&oldest?'?before='+encodeURIComponent(oldest):''));if(!active(s))return;create.disabled=false;const rows=data.requests||[];if(!append)list.replaceChildren();if(!rows.length&&!append)list.append(node('p','Aucune demande pour le moment.','k-od-muted'));list.querySelector('[data-more]')?.remove();for(const r of rows){const b=button('',()=>thread(r.reference),'conversation');b.append(node('strong',MOTIFS[r.motif]||r.motif),node('small',STATUS[r.status]||r.status),node('span','›'));list.append(b)}oldest=rows.at(-1)?.reference||null;if(rows.length===50){const more=button('Demandes précédentes',()=>load(true));more.dataset.more='1';list.append(more)}}catch(err){if(active(s))msg.textContent=err.message}}
 await load();if(seed&&active(s)&&!msg.textContent)startRequest(seed)
}
async function thread(ref){
  stop();dispose();const s=++session;const d=shell();const title=header('Votre conseiller Komerce',inbox);const state=node('p',null,'k-od-state');const log=node('div',null,'k-on-demand-thread');log.setAttribute('role','log');const msg=feedback();const controls=node('div',null,'k-od-bottom');let last='',older=false,loading=false;
  d.replaceChildren(title,state,button('Messages précédents',async()=>{const first=log.firstElementChild?.dataset.messageId;if(!first)return;try{const data=await request(path(ref)+'?before='+encodeURIComponent(first));if(active(s)){older=true;renderMessages(log,ref,data.messages||[],true)}}catch(err){msg.textContent=err.message}}),log,controls,msg);
  const form=compose({submit:async data=>{await request(path(ref)+'/messages','POST',data);if(active(s))await load(true)}});controls.append(form);
  async function load(force=false){if(loading)return;loading=true;try{const data=await request(path(ref));if(!active(s))return;const r=data.request;state.textContent=(MOTIFS[r.motif]||r.motif)+' · '+(STATUS[r.status]||r.status);form.hidden=r.status==='closed';const messages=data.messages||[];const signature=JSON.stringify(messages.map(m=>[m.id,m.attachments?.map(a=>a.id)]));if(force||signature!==last){if(!older||force){renderMessages(log,ref,messages);older=false}else{const known=new Set([...log.children].map(e=>e.dataset.messageId));for(const m of messages.filter(m=>!known.has(m.id))){const temp=node('div');renderMessages(temp,ref,[m]);log.append(...temp.children)}}last=signature}msg.textContent=''}catch(err){if(active(s)){msg.textContent=err.message;if([401,403,404].includes(err.status)){stop();form.hidden=true;log.replaceChildren()}}}finally{loading=false}}
  await load();if(active(s))timer=setInterval(()=>{if(document.visibilityState==='visible')load()},30000);
}

export async function openOnDemand(ref=null,origin=null,seed=null){
 if(opening)return;opening=true;try{
  const user=await requireIdentity({reason:'contacter un conseiller Komerce',title:'Confirmer votre identité',returnFocusTo:origin});if(!user)return;
  const d=shell();if(d.open&&!ref&&!seed){d.querySelector('[aria-label="Fermer"]')?.focus();return}trigger=origin;if(!d.open){if(typeof d.show==='function'&&window.matchMedia?.('(min-width: 900px)').matches)d.show();else d.showModal()}
  if(user.role!=='client'){
   stop();dispose();session++;const content=panel();content.append(helper('Vous utilisez une session interne. Pour envoyer une demande commerciale, ouvrez la boutique dans une session client séparée.'));const link=node('a','Accéder à mon espace professionnel','k-od-btn k-od-primary');link.href='/admin';content.append(link);d.replaceChildren(header('Votre conseiller Komerce'),content);return
  }
  if(ref)await thread(ref);else await inbox(seed)
 }finally{opening=false}
}
export function setupOnDemand(){
 if(installed)return;installed=true;
 document.addEventListener('click',e=>{const b=e.target.closest?.('[data-on-demand]');if(!b)return;e.preventDefault();
  const seed=b.dataset.onDemand==='search'?{motif:'other',body:document.getElementById('k-search-input')?.value?.trim()||''}:null;
  if(seed)document.getElementById('k-search-dropdown')?.classList.remove('open');
  openOnDemand(null,b,seed).catch(()=>{})
 });
 bus.on('on-demand:open',payload=>openOnDemand(payload?.reference||null).catch(()=>{}));
 window.addEventListener('komerce:identity-cleared',()=>{if(dialog?.open)dialog.close()})
}
