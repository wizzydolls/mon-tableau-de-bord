const {test,expect}=require('@playwright/test');
async function open(page,date='2026-11-15') {await page.clock.install({time:new Date(`${date}T12:00:00+01:00`)});await page.goto('/');}
let errors;
test.beforeEach(({page})=>{errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text())});});
test.afterEach(()=>expect(errors).toEqual([]));
test('demain depuis dimanche ouvre lundi, sans modifier les données',async({page})=>{
 await open(page);const before=await page.evaluate(()=>localStorage.getItem('mon-rythme-v1'));
 await page.getByRole('button',{name:'Demain',exact:true}).click();
 await expect(page.locator('#weekDetail h3')).toContainText('lundi 16 novembre 2026');
 await expect(page.locator('#weekDetail')).toContainText('Salle — Poussée A');
 for(const b of await page.locator('#weekDetail [data-action=score]').all())await expect(b).toBeDisabled();
 await page.getByRole('button',{name:'Jour suivant',exact:true}).first().click();
 await expect(page.locator('#weekDetail')).toContainText('Salle — Tirage A');
 await page.getByRole('button',{name:'Revenir à aujourd’hui',exact:true}).click();
 await expect(page.locator('#weekDetail h3')).toContainText('dimanche 15 novembre 2026');
 expect(await page.evaluate(()=>localStorage.getItem('mon-rythme-v1'))).toBe(before);
});
test('semaines et calendrier passent le nouvel an et février bissextile',async({page})=>{
 await open(page,'2026-12-31');
 await page.locator('[data-action=browseNextWeek]').click();
 await expect(page.locator('#browseRange')).toContainText('janvier 2027');
 await page.locator('#calendarPanel > summary').click();
 await page.locator('#calendarMonth').fill('2028-02');await page.locator('#calendarMonth').dispatchEvent('change');
 await expect(page.locator('#calendarGrid [data-date="2028-02-29"]')).toHaveCount(1);
 await page.locator('#calendarGrid [data-date="2028-02-29"]').click();
 await expect(page.locator('#weekDetail h3')).toContainText('mardi 29 février 2028');
 await expect(page.locator('#weekDetail')).toContainText('Salle — Tirage A');
 await page.locator('[data-action=browseNextMonth]').click();
 await expect(page.locator('#calendarMonth')).toHaveValue('2028-03');
 await page.locator('[data-action=browsePrevMonth]').click();
 await expect(page.locator('#calendarMonth')).toHaveValue('2028-02');
 await page.clock.runFor(30000);
 await expect(page.locator('#weekDetail h3')).toContainText('février 2028');
 await expect(page.locator('#weekHomeHeading')).toHaveText('Ma semaine');
});
for(const width of [375,390,1366])test(`calendrier complet sans débordement à ${width}px`,async({page})=>{
 await page.setViewportSize({width,height:900});await open(page);
 await page.locator('#calendarPanel > summary').click();
 await page.locator('#calendarMonth').fill('2027-08');await page.locator('#calendarMonth').dispatchEvent('change');
 await expect(page.locator('#calendarGrid button')).toHaveCount(31);
 await page.locator('#calendarGrid [data-date="2027-08-31"]').click();
 expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
 for(const b of await page.locator('#calendarGrid button').all()){const box=await b.boundingBox();expect(box.height).toBeGreaterThanOrEqual(44);expect(box.width).toBeGreaterThanOrEqual(44);}
});
