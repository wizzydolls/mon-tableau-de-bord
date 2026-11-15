const {test, expect}=require('@playwright/test');
const KEY='mon-rythme-v1';
const monday='2026-11-16';
const at=(day,time)=>new Date(`${day}T${time}:00+01:00`);
async function open(page){ await page.clock.install({time:at(monday,'20:30')}); await page.goto('/'); }
async function planning(page){await page.locator('header [data-action=plus]').click();await page.locator('[data-action=planning]').click();}
let errors;
test.beforeEach(({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});});
test.afterEach(()=>expect(errors).toEqual([]));
test('quatre blocs, détails complets, synchronisation et jours futurs',async({page})=>{
 await open(page);
 await expect(page.locator('main > section')).toHaveCount(4);
 await expect(page.locator('#plusPanel')).not.toHaveAttribute('open','');
 await expect(page.locator('#timeline')).toHaveClass(/hide-markers/);
 await expect(page.locator('.minbtn').first()).not.toBeVisible();
 const mon=page.locator(`#weekStrip [data-date="${monday}"]`);
 await mon.click();
 const gym=page.locator('#weekDetail article',{hasText:'Salle — Poussée A'});
 await expect(gym.locator('.exercises li')).toHaveCount(7);
 await gym.locator('[data-action=score][data-value="1"]').click();
 await expect(mon).toContainText('20%');
 await expect(page.locator('#checklist .ring span')).toHaveText('20%');
 await expect(page.locator('#weekHome .week-bars > div').first()).toContainText('20%');
 await expect(page.locator('.todo',{hasText:'Salle — Poussée A'}).locator('.checkbox')).toHaveAttribute('aria-pressed','true');
 await mon.click();await expect(page.locator('#weekDetail article')).toHaveCount(0);
 await page.locator('#weekStrip [data-date="2026-11-17"]').click();
 for(const button of await page.locator('#weekDetail [data-action=score]').all()) await expect(button).toBeDisabled();
 await expect(page.locator('#weekHome .week-bars > div').nth(1)).toContainText('—');
});
test('version courte dépliée, décochage direct et état des détails conservé',async({page})=>{
 await open(page);const row=page.locator('.todo',{hasText:'Anglais oral'});
 await row.locator('summary').click();await row.locator('.minbtn').click();
 await expect(page.locator('#checklist .ring span')).toHaveText('10%');
 await expect(row.locator('summary')).toContainText('0,5 pt');
 await expect(row.locator('.minbtn')).toBeVisible();
 await row.locator('.checkbox').click();await expect(page.locator('#checklist .ring span')).toHaveText('0%');
});
test('ajouter, modifier, copier sur plusieurs jours, désactiver et supprimer sans perdre le passé',async({page})=>{
 await open(page);await planning(page);await page.locator('[data-action=addBlock]').click();
 await page.locator('#blockTitle').fill('Marche test');await page.locator('#blockStart').fill('21:00');await page.locator('#blockEnd').fill('21:15');
 await page.locator('#blockStandard').fill('Marcher 15 minutes');await page.locator('#blockMinimum').fill('Marcher 2 minutes');
 await page.locator('#blockDays input[value="0"]').check();await page.locator('#blockDays input[value="1"]').check();
 await page.locator('#blockForm button[type=submit]').click();
 const row=page.locator('.todo',{hasText:'Marche test'});await expect(row).toBeVisible();await row.locator('.checkbox').click();
 const before=await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).records['2026-11-16'],KEY);
 await page.clock.setFixedTime(at('2026-11-17','20:30'));await page.reload();await planning(page);
 let task=page.locator('#agenda article',{hasText:'Marche test'}).first();await task.locator('[data-action=edit]').click();
 await page.locator('#blockTitle').fill('Marche modifiée');await page.locator('#blockEnabled').uncheck();await page.locator('#blockForm button[type=submit]').click();
 await expect(page.locator('.todo',{hasText:'Marche modifiée'})).toHaveCount(0);
 task=page.locator('#agenda article',{hasText:'Marche modifiée'}).first();await expect(task).toContainText('désactivé');await task.locator('[data-action=edit]').click();
 await page.locator('#blockEnabled').check();await page.locator('#blockForm button[type=submit]').click();await expect(page.locator('.todo',{hasText:'Marche modifiée'})).toHaveCount(1);
 await task.locator('[data-action=edit]').click();page.once('dialog',d=>d.accept());await page.locator('[data-action=delete]').click();
 await expect(page.locator('.todo',{hasText:'Marche modifiée'})).toHaveCount(0);
 expect(await page.evaluate(k=>JSON.parse(localStorage.getItem(k)).records['2026-11-16'],KEY)).toEqual(before);
 await page.reload();await expect(page.locator('.todo',{hasText:'Marche modifiée'})).toHaveCount(0);
});
for(const width of [375,390,1366]) test(`lisibilité et largeur ${width}px sur accueil, jour déplié et planning`,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page);
 const fits=async()=>expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 await fits();await page.locator('#weekStrip button').first().click();await fits();await planning(page);await fits();
 await page.locator('[data-action=addBlock]').click();await fits();
 await expect(page.locator('#editor')).toBeVisible();
});
test('Maintenant change automatiquement et ne propose pas le réveil le soir',async({page})=>{
 await open(page);await expect(page.locator('#now h3')).toHaveText('Salle — Poussée A');
 await page.clock.runFor(30*1000);
 await page.clock.setFixedTime(at(monday,'22:20'));await page.clock.runFor(30*1000);
 await expect(page.locator('#now h3')).toContainText('Anglais oral');
 await expect(page.locator('#now button')).toHaveCount(1);
 await page.clock.setFixedTime(at(monday,'23:50'));await page.clock.runFor(30*1000);
 await expect(page.locator('#now')).not.toContainText('Réveil');
});

test('contraste du texte et taille sur accueil et outils dépliés',async({page})=>{
 await open(page);await planning(page);
 for(const summary of await page.locator('.tool-panel > summary').all()) await summary.click();
 const issues=await page.evaluate(()=>{
  const rgb=s=>(s.match(/[\d.]+/g)||[]).map(Number);
  const lum=c=>c.slice(0,3).map(v=>v/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
  return [...document.querySelectorAll('body *')].filter(e=>e.checkVisibility()&&[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim())).map(e=>{
   const c=getComputedStyle(e);let bg=[16,17,22];
   for(let p=e;p;p=p.parentElement){const b=rgb(getComputedStyle(p).backgroundColor);if(b.length===3||b[3]===1){bg=b;break;}}
   const a=lum(rgb(c.color)),b=lum(bg),ratio=(Math.max(a,b)+.05)/(Math.min(a,b)+.05);
   return {text:e.textContent.trim().slice(0,50),ratio:+ratio.toFixed(2),size:c.fontSize,opacity:c.opacity};
  }).filter(e=>e.ratio<4.5||parseFloat(e.size)<16||e.opacity!=='1');
 });
 expect(issues).toEqual([]);
});
