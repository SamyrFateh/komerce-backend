const ref=process.argv[2],code=process.argv[3],qty=process.argv[4]||'1';
require('./hubpo.js')('agent-hub',ref,async({p,shot,btns,log})=>{
 await p.getByRole('button',{name:/Réceptionner une livraison/}).first().click();await p.waitForTimeout(2500);
 const sc=p.locator('input[placeholder^="Scanner EAN"]:visible');await sc.scrollIntoViewIfNeeded();
 const just=p.locator('input[placeholder^="Mode dégradé"]:visible');
 await just.fill('Saisie clavier volontaire CLAUDE-PAR-20261113 : lecteur non utilisé, étiquette lue à l’œil');
 await sc.fill(code);await sc.press('Enter');await p.waitForTimeout(3000);
 const conf=p.getByRole('button',{name:'Confirmer cette référence'});
 if(await conf.count()){await conf.click();await p.waitForTimeout(1500);
  const sel=p.locator('select:visible').filter({hasText:'Variante attendue'}).first();
  const opts=await sel.locator('option').allTextContents();console.log('variantes',opts);
  await sel.selectOption({index:+(process.env.VAR||1)});
  await p.locator('input[placeholder^="Preuve"]:visible').fill('CLAUDE-PAR-20261113 photo étiquette '+code);
  await p.getByRole('button',{name:'Valider la confirmation'}).click();await p.waitForTimeout(3000);}
 await shot('H5-apres-confirm-'+ref);
 const q=p.locator('table input[type=number]:visible');const nq=await q.count();console.log('nq',nq);
 const sub=p.getByRole('button',{name:'Enregistrer la réception'});
 if(process.env.BAD){await q.first().fill(process.env.BAD);console.log('btn disabled avec qte incorrecte',await sub.isDisabled());await shot('H6-qte-incorrecte-'+ref);}
 const qs=(process.env.QTYS||'1').split(',');
 for(let i=0;i<nq;i++)await q.nth(i).fill(qs[i]||qs[0]);
 await p.waitForTimeout(500);await sub.click();await p.waitForTimeout(4000);await shot('H7-recu-'+ref);
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference'&&e.type!=='checkbox').map(e=>(e.placeholder||e.name||e.tagName)+'='+e.value).slice(0,12)));
});
