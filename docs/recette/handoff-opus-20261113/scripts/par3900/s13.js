require('./hubpo.js')('agent-hub',process.argv[2],async({p,shot,btns})=>{
 await p.getByRole('button',{name:/Réceptionner une livraison/}).first().click();await p.waitForTimeout(2500);
 const b=p.getByRole('button',{name:/Réceptionner une livraison/}).first();await shot('H1-reception-'+process.argv[2]);
 await p.evaluate(()=>{const e=[...document.querySelectorAll('input,select,textarea,button')].filter(x=>x.offsetParent).slice(0,0)[0];e&&e.scrollIntoView()});
 console.log(await p.evaluate(()=>[...document.querySelectorAll('input,select,textarea')].filter(e=>e.offsetParent&&e.name!=='reference'&&e.type!=='checkbox').map(e=>e.tagName+':'+e.type+':'+(e.name||e.id)+':'+(e.placeholder||'')+':'+(e.tagName==='SELECT'?[...e.options].map(o=>o.text.slice(0,25)).join('/'):'')).slice(0,16)));
 console.log((await btns()).slice(-8));
 await p.screenshot({path:'/tmp/claude-0/-home-claude/011d1491-2f57-5b4d-98e0-a4b4e0b2f674/scratchpad/par3900/shots/H1b.png',fullPage:false});
});
