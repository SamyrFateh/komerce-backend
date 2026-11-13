const {run,B}=require('./R.js');
run('agent-relais',async({p,shot,btns,S})=>{
 await p.goto(B+'/admin/relais-live?view=execute&market=KM',{waitUntil:'domcontentloaded'});await p.waitForTimeout(6000);
 await p.getByRole('button',{name:'Identifier le sac'}).click();await p.waitForTimeout(1500);
 const sc=p.locator('input[placeholder="Scanner un sac de cette expédition"]:visible').first();
 await sc.fill('KOM-ITEM-3BB76F7ACED566962E');await sc.press('Enter');await p.waitForTimeout(1500);
 const q=p.locator('input[placeholder="0 à 1"]:visible');console.log('nq',await q.count());
 const sub=p.getByRole('button',{name:'Attester la réception'});
 await q.nth(0).fill('2');await p.waitForTimeout(400);console.log('qte 2 > expédié: btn disabled=',await sub.isDisabled(),'val=',await q.nth(0).inputValue());await shot('R3-qte-incorrecte');
 for(let i=0;i<3;i++)await q.nth(i).fill('1');
 await p.locator('input[placeholder^="Référence de preuve"]:visible').fill('CLAUDE-PAR-20261113 bordereau relais saisi manuellement');
 await shot('R4-avant-attestation');
 await sub.click();await p.waitForTimeout(4500);await shot('R5-apres-attestation');
});
