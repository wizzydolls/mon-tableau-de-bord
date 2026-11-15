// Tests de bout en bout du tableau de bord « Mon rythme ».
// Horloge simulée : les tests se jouent le lundi 16 novembre 2026 (planning de référence du lundi :
// Réveil 07:30 · Lecture 08:50–09:30 · Podcast 17:00–17:40 · Démarreur 18:20 · Salle 20:00–21:15 · Anglais oral 22:15–22:45).
// Règle testée : validation après « fin du bloc + marge (30 min) » = points × 0,5.
const { test, expect } = require('@playwright/test');
const fs = require('fs');

const KEY = 'mon-rythme-v1';
const MONDAY = '2026-11-16';
const at = (date, time) => new Date(`${date}T${time}:00+01:00`); // heure de Paris en novembre

/** Ouvre la page à une date/heure simulée, avec éventuellement un état pré-rempli dans localStorage. */
async function open(page, time, state) {
  await page.clock.install({ time });
  if (state) await page.addInitScript(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(state)]);
  await page.goto('/');
  await expect(page.locator('#checklist .ring span')).toBeVisible();
}

const stored = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const ring = (page) => page.locator('#checklist .ring span');
const todo = (page, title) => page.locator('.todo', { hasText: title });
const timelineBlock = (page, title) => page.locator('#timeline article', { hasText: title });

/** Transforme un état enregistré par la page en sauvegarde « version 1 » (valeurs numériques nues). */
function toV1(state) {
  const v1 = JSON.parse(JSON.stringify(state));
  v1.version = 1;
  delete v1.settings.graceMinutes;
  delete v1.settings.latePenalty;
  for (const r of Object.values(v1.records)) {
    for (const [id, v] of Object.entries(r.values)) if (v && typeof v === 'object') r.values[id] = v.p;
  }
  return v1;
}

test.describe('Pénalité de retard', () => {
  let errors;
  test.beforeEach(({ page }) => {
    errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  });
  test.afterEach(() => expect(errors, 'aucune erreur console').toEqual([]));

  test('à l’heure : Standard vaut 1 et Minimum vaut 0,5', async ({ page }) => {
    await open(page, at(MONDAY, '20:30'));
    await expect(ring(page)).toHaveText('0%');
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    await expect(ring(page)).toHaveText('20%'); // 1 / 5 tâches
    await todo(page, 'Anglais oral').locator('.minbtn').click(); // avant le début du bloc : à l’heure
    await expect(ring(page)).toHaveText('30%'); // 1,5 / 5
    await expect(todo(page, 'Salle — Poussée A')).not.toHaveClass(/late/);
    const s = await stored(page);
    expect(s.version).toBe(2);
    const values = s.records[MONDAY].values;
    const salle = Object.values(values).find((v) => v.p === 1);
    expect(salle).toMatchObject({ p: 1, late: false });
    expect(typeof salle.at).toBe('string');
  });

  test('en retard : Standard vaut 0,5 et Minimum vaut 0,25', async ({ page }) => {
    await open(page, at(MONDAY, '22:00')); // Salle finit 21:15, marge 30 min → échéance 21:45 dépassée
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    await expect(ring(page)).toHaveText('10%'); // 0,5 / 5
    await expect(todo(page, 'Salle — Poussée A')).toHaveClass(/late/);
    await expect(todo(page, 'Salle — Poussée A').locator('.late-mark')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('50 %');
    await expect(page.locator('#toast')).not.toContainText('culpab');
    await todo(page, 'Podcast').locator('.minbtn').click(); // Podcast finit 17:40 → en retard aussi
    await expect(ring(page)).toHaveText('15%'); // 0,5 + 0,25 = 0,75 / 5
    // La frise affiche la vraie valeur du bouton.
    await expect(timelineBlock(page, 'Salle — Poussée A').locator('[data-action=score][data-value="1"]')).toContainText('0,5');
    // La série « jamais deux jours à zéro » compte une validation en retard comme > 0.
    await expect(page.locator('#weekly h3')).toContainText('1 jour');
    const s = await stored(page);
    expect(Object.values(s.records[MONDAY].values).every((v) => v.late === true)).toBe(true);
  });

  test('100 % exige toutes les tâches en Standard et à l’heure', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    for (const t of ['Réveil', 'Lecture', 'Podcast', 'Salle — Poussée A']) await todo(page, t).locator('.checkbox').click();
    await todo(page, 'Anglais oral').locator('.checkbox').click(); // seule tâche à l’heure
    await expect(ring(page)).toHaveText('60%'); // 4 × 0,5 + 1 = 3 / 5
    await expect(page.locator('.perfect-banner')).toHaveCount(0);
  });

  test('100 % : toutes les tâches en Standard et à l’heure → bannière verte', async ({ page }) => {
    await open(page, at(MONDAY, '07:00'));
    for (const t of ['Réveil', 'Lecture', 'Podcast', 'Salle — Poussée A', 'Anglais oral']) await todo(page, t).locator('.checkbox').click();
    await expect(ring(page)).toHaveText('100%');
    await expect(page.locator('.perfect-banner')).toBeVisible();
    await expect(page.locator('#toast')).toContainText('100 %');
  });

  test('carte Maintenant : met en avant la tâche dont l’échéance approche', async ({ page }) => {
    await open(page, at(MONDAY, '21:35')); // Salle finie à 21:15, échéance 21:45 ; Réveil, Lecture, Podcast déjà en retard
    await expect(page.locator('#now h2')).toHaveText('Salle — Poussée A');
    await expect(page.locator('#now .tag')).toContainText('plus que 10 min pour 100 %');
  });

  test('affichage : échéance, compte à rebours, badge En retard', async ({ page }) => {
    await open(page, at(MONDAY, '20:30'));
    await expect(todo(page, 'Salle — Poussée A')).toContainText('à valider avant 21:45');
    await expect(todo(page, 'Anglais oral')).toContainText('à valider avant 23:15'); // 22:15–22:45 + 30 min
    await expect(todo(page, 'Lecture')).toContainText('En retard · vaut 50 %');
    await page.clock.setFixedTime(at(MONDAY, '21:35'));
    await page.reload();
    await expect(todo(page, 'Salle — Poussée A')).toContainText('plus que 10 min');
    await page.clock.setFixedTime(at(MONDAY, '21:50'));
    await page.reload();
    await expect(todo(page, 'Salle — Poussée A')).toContainText('En retard · vaut 50 %');
    // La carte « Maintenant » signale la valeur de la tâche à rattraper.
    await expect(page.locator('#now')).toContainText('vaut 50 %');
  });

  test('marge réglable dans Réglages (0–120 min)', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await page.locator('[data-action=settings]').first().click();
    const grace = page.locator('#graceInput');
    await expect(grace).toHaveValue('30');
    await expect(grace).toHaveAttribute('max', '120');
    await grace.fill('60');
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(todo(page, 'Salle — Poussée A')).toContainText('à valider avant 22:15');
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    await expect(ring(page)).toHaveText('20%'); // à l’heure grâce à la marge de 60 min
    expect((await stored(page)).settings.graceMinutes).toBe(60);
  });

  test('interrupteur « Pénalité de retard » : désactivé, une validation en retard vaut 100 %', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    await expect(ring(page)).toHaveText('10%');
    await page.locator('[data-action=settings]').first().click();
    await expect(page.locator('#penaltyInput')).toBeChecked();
    await page.locator('#penaltyInput').uncheck();
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(ring(page)).toHaveText('20%'); // le retard est mémorisé mais ne pénalise plus
    await expect(todo(page, 'Lecture')).not.toContainText('vaut 50 %');
    expect((await stored(page)).settings.latePenalty).toBe(false);
  });

  test('jour sans pénalité : Standard et Minimum gardent leurs points après réactivation le lendemain', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await page.locator('[data-action=settings]').first().click();
    await page.locator('#penaltyInput').uncheck();
    await page.locator('#settingsForm button[type=submit]').click();
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    await todo(page, 'Podcast').locator('.minbtn').click();
    await expect(ring(page)).toHaveText('30%');

    await page.clock.setFixedTime(at('2026-11-17', '10:00'));
    await page.reload();
    await page.locator('[data-action=settings]').first().click();
    await page.locator('#penaltyInput').check();
    await page.locator('#settingsForm button[type=submit]').click();
    const mondayPct = page.locator('#tracker tfoot td').first();
    await expect(mondayPct).toContainText('30%');
    await expect(page.locator('#tracker button[aria-label^="Salle, Lundi"]')).not.toHaveClass(/late/);
    await expect(page.locator('#tracker button[aria-label^="Podcast, Lundi"]')).not.toHaveClass(/late/);
    const saved = await stored(page);
    expect(Object.values(saved.records[MONDAY].values).every((v) => v.penaltyExempt === true)).toBe(true);

    // L’exemption survit au rechargement et à un export/import.
    await page.reload();
    await expect(mondayPct).toContainText('30%');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('footer [data-action=export]').click()]);
    const backup = fs.readFileSync(await download.path());
    page.on('dialog', (d) => d.accept());
    await page.locator('#importFile').setInputFiles({ name: 'jour-sans-penalite.json', mimeType: 'application/json', buffer: backup });
    await expect(page.locator('#toast')).toContainText('importée');
    await expect(mondayPct).toContainText('30%');

    // Une nouvelle validation, après effacement, reprend la règle courante.
    await page.locator('#dayDate').fill(MONDAY);
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=clear]').click();
    await page.locator('#toast [data-action=undo]').click();
    await expect(mondayPct).toContainText('30%');
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=clear]').click();
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=score][data-value="1"]').click();
    await expect(mondayPct).toContainText('20%'); // Standard tardif 0,5 + Minimum exempté 0,5
  });

  test('import : exemption de pénalité strictement booléenne, sans champ inconnu', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    const saved = await stored(page), alerts = [];
    page.on('dialog', (d) => { if (d.type() === 'alert') alerts.push(d.message()); d.accept(); });
    for (const fields of [{ penaltyExempt: 'true' }, { penaltyExempt: true, unknown: 1 }]) {
      const bad = JSON.parse(JSON.stringify(saved));
      Object.assign(Object.values(bad.records[MONDAY].values)[0], fields);
      await page.locator('#importFile').setInputFiles({ name: 'invalide.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(bad)) });
    }
    await expect.poll(() => alerts.length).toBe(2);
    expect(alerts.every((s) => s.includes('Import impossible'))).toBe(true);
    await expect(ring(page)).toHaveText('10%');
  });

  test('changer de niveau garde le meilleur des deux ; décocher puis recocher = nouvelle validation', async ({ page }) => {
    await open(page, at(MONDAY, '20:30'));
    await todo(page, 'Salle — Poussée A').locator('.minbtn').click(); // Minimum à l’heure = 0,5
    await expect(ring(page)).toHaveText('10%');
    await page.clock.setFixedTime(at(MONDAY, '22:00'));
    await page.reload();
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=score][data-value="1"]').click(); // Standard en retard = 0,5
    await expect(ring(page)).toHaveText('10%');
    await expect(todo(page, 'Salle — Poussée A')).not.toHaveClass(/late/); // on garde le Minimum à l’heure
    await todo(page, 'Salle — Poussée A').locator('.minbtn').click(); // décoche
    await expect(ring(page)).toHaveText('0%');
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click(); // nouvelle validation, en retard
    await expect(ring(page)).toHaveText('10%');
    await expect(todo(page, 'Salle — Poussée A')).toHaveClass(/late/);
  });

  test('passer de Standard à Minimum conserve le meilleur score et la validation originale', async ({ page }) => {
    await open(page, at(MONDAY, '20:30'));
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    const original = (await stored(page)).records[MONDAY].values;
    await page.clock.setFixedTime(at(MONDAY, '22:00'));
    await page.reload();
    await todo(page, 'Salle — Poussée A').locator('.minbtn').click();
    await expect(ring(page)).toHaveText('20%');
    await expect(todo(page, 'Salle — Poussée A')).not.toHaveClass(/late/);
    expect((await stored(page)).records[MONDAY].values).toEqual(original);
    await expect(page.locator('#toast')).toContainText('meilleur score');
    await expect(page.locator('#tracker tfoot td').first()).toContainText('20%');
    await page.reload();
    await expect(ring(page)).toHaveText('20%');
    // Une correction volontaire reste possible en effaçant puis en revalidant.
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=clear]').click();
    await todo(page, 'Salle — Poussée A').locator('.minbtn').click();
    await expect(ring(page)).toHaveText('5%');
    await expect(todo(page, 'Salle — Poussée A')).toHaveClass(/late/);
  });

  test('recliquer le niveau déjà validé après l’échéance ne change rien', async ({ page }) => {
    await open(page, at(MONDAY, '20:30'));
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=score][data-value="1"]').click(); // Standard à l’heure
    await expect(ring(page)).toHaveText('20%');
    await page.clock.setFixedTime(at(MONDAY, '22:00'));
    await page.reload();
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=score][data-value="1"]').click(); // reclic tardif
    await expect(ring(page)).toHaveText('20%');
    await expect(todo(page, 'Salle — Poussée A')).not.toHaveClass(/late/);
    await expect(page.locator('#toast')).toContainText('Déjà validé');
  });

  test('import : une clé __proto__ dans une sauvegarde v2 est rejetée', async ({ page }) => {
    await open(page, at(MONDAY, '20:30'));
    const alerts = [];
    page.on('dialog', (d) => { if (d.type() === 'alert') alerts.push(d.message()); d.accept(); });
    const s = await stored(page);
    const text = JSON.stringify(s).replace('"priorities":{}', '"priorities":{},"settings2":{"__proto__":{"polluted":true}}');
    await page.locator('#importFile').setInputFiles({ name: 'proto.json', mimeType: 'application/json', buffer: Buffer.from(text) });
    await expect.poll(() => alerts.length).toBe(1);
    expect(alerts[0]).toContain('Import impossible');
    expect(await page.evaluate(() => ({}).polluted)).toBeUndefined();
  });

  test('bouton Annuler dans le toast après un décochage', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    await expect(ring(page)).toHaveText('10%');
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click(); // décoche
    await expect(ring(page)).toHaveText('0%');
    await page.locator('#toast [data-action=undo]').click();
    await expect(ring(page)).toHaveText('10%');
    await expect(todo(page, 'Salle — Poussée A')).toHaveClass(/late/); // statut « en retard » restauré
  });

  test('démarreur de 18h20 : valide le Minimum à l’heure, puis disparaît après 18:25 + marge', async ({ page }) => {
    await open(page, at(MONDAY, '18:22'));
    const starter = page.locator('#now [data-action=starter]');
    await expect(starter).toBeVisible();
    await starter.click();
    await expect(ring(page)).toHaveText('10%'); // Anglais oral en Minimum, à l’heure
    await expect(todo(page, 'Anglais oral')).not.toHaveClass(/late/);
    await page.clock.setFixedTime(at(MONDAY, '19:00'));
    await page.addInitScript((k) => localStorage.removeItem(k), KEY);
    await page.reload(); // 18:55 dépassé : plus de bouton de démarreur nulle part
    await expect(page.locator('[data-action=starter]')).toHaveCount(0);
    await expect(timelineBlock(page, 'Démarreur')).toContainText('passé');
  });

  test('correction d’un jour passé dans le tableau : compte en retard', async ({ page }) => {
    await open(page, at('2026-11-17', '10:00')); // mardi
    const cell = page.locator('#tracker button[aria-label^="Salle, Lundi"]');
    await cell.click(); // 1 appui = fait
    await expect(cell).toHaveClass(/late/);
    await expect(cell).toHaveAttribute('aria-label', /retard/);
    const mondayPct = page.locator('#tracker tfoot td').first();
    await expect(mondayPct).toContainText('10%'); // 0,5 / 5
    const s = await stored(page);
    expect(Object.values(s.records[MONDAY].values)[0]).toMatchObject({ p: 1, late: true });
    await cell.click(); // tentative de Minimum : le meilleur score reste acquis
    await expect(mondayPct).toContainText('10%');
    await page.locator('#dayDate').fill(MONDAY);
    await timelineBlock(page, 'Salle — Poussée A').locator('[data-action=clear]').click();
    await expect(mondayPct).toContainText('0%');
  });

  test('migration automatique v1 → v2 sans perte', async ({ page }) => {
    await open(page, at(MONDAY, '08:00')); // Réveil (échéance 08:05) et Lecture (08:50) encore à l’heure
    await todo(page, 'Réveil').locator('.checkbox').click();
    await todo(page, 'Lecture').locator('.minbtn').click();
    await expect(ring(page)).toHaveText('30%');
    const v1 = toV1(await stored(page));
    expect(v1.version).toBe(1);
    await page.evaluate(([k, s]) => localStorage.setItem(k, s), [KEY, JSON.stringify(v1)]);
    await page.reload();
    await expect(ring(page)).toHaveText('30%');
    const s = await stored(page);
    expect(s.version).toBe(2);
    expect(s.settings.graceMinutes).toBe(30);
    expect(s.settings.latePenalty).toBe(true);
    const vals = Object.values(s.records[MONDAY].values).sort((a, b) => b.p - a.p);
    expect(vals).toEqual([{ p: 1, late: false, at: null }, { p: 0.5, late: false, at: null }]);
    expect(await page.evaluate((k) => Object.keys(localStorage).filter((x) => x.startsWith('mon-rythme')), KEY)).toEqual([KEY]);
  });

  test('export en v2, import d’une sauvegarde v1 et v2, rejet d’un fichier invalide', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click(); // en retard
    await expect(ring(page)).toHaveText('10%');
    const [download] = await Promise.all([page.waitForEvent('download'), page.locator('footer [data-action=export]').click()]);
    const exported = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    expect(exported.version).toBe(2);
    expect(Object.values(exported.records[MONDAY].values)[0]).toMatchObject({ p: 1, late: true });

    page.on('dialog', (d) => d.accept());
    const importFile = async (obj, name) => page.locator('#importFile').setInputFiles({ name, mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(obj)) });

    await importFile(toV1(exported), 'v1.json'); // v1 : la validation redevient « à l’heure » (pas d’horodatage en v1)
    await expect(page.locator('#toast')).toContainText('importée');
    await expect(ring(page)).toHaveText('20%');
    expect((await stored(page)).version).toBe(2);

    await importFile(exported, 'v2.json');
    await expect(ring(page)).toHaveText('10%'); // le statut « en retard » est conservé

    const bad = JSON.parse(JSON.stringify(exported));
    Object.values(bad.records[MONDAY].values)[0].p = 2;
    const alerts = [];
    page.on('dialog', (d) => { if (d.type() === 'alert') alerts.push(d.message()); });
    await importFile(bad, 'bad.json');
    await expect.poll(() => alerts.length).toBe(1);
    expect(alerts[0]).toContain('Import impossible');
    await expect(ring(page)).toHaveText('10%');

    const bad2 = JSON.parse(JSON.stringify(exported));
    bad2.settings.graceMinutes = 500;
    await importFile(bad2, 'bad2.json');
    await expect.poll(() => alerts.length).toBe(2);
  });

  for (const [level, points, percentage] of [['Standard', 1, '20%'], ['Minimum', 0.5, '10%']]) {
    test(`marge après minuit : ${level} sans pénalité à 00:10 et 00:45, pénalisé à 00:46`, async ({ page }) => {
      await open(page, at(MONDAY, '22:00'));
      await page.locator('[data-action=settings]').first().click();
      await page.locator('#graceInput').fill('120');
      await page.locator('#settingsForm button[type=submit]').click();
      await page.clock.setFixedTime(at('2026-11-17', '00:10'));
      await page.reload();
      await page.locator('#dayDate').fill(MONDAY);
      const block = timelineBlock(page, 'Anglais oral');
      const button = block.locator(`[data-action=score][data-value="${points}"]`);
      const mondayPct = page.locator('#tracker tfoot td').first();
      await button.click();
      await expect(mondayPct).toContainText(percentage);
      let value = Object.values((await stored(page)).records[MONDAY].values)[0];
      expect(value).toMatchObject({ p: points, late: false });
      await block.locator('[data-action=clear]').click();
      await page.clock.setFixedTime(at('2026-11-17', '00:45'));
      await button.click();
      await expect(mondayPct).toContainText(percentage);
      await block.locator('[data-action=clear]').click();
      await page.clock.setFixedTime(at('2026-11-17', '00:46'));
      await button.click();
      value = Object.values((await stored(page)).records[MONDAY].values)[0];
      expect(value).toMatchObject({ p: points, late: true });
      await expect(mondayPct).toContainText(points === 1 ? '10%' : '5%');
    });
  }

  test('échéance après minuit : affiche 00:45 le lendemain', async ({ page }) => {
    await open(page, at(MONDAY, '22:00'));
    await page.locator('[data-action=settings]').first().click();
    await page.locator('#graceInput').fill('120');
    await page.locator('#settingsForm button[type=submit]').click();
    await expect(todo(page, 'Anglais oral')).toContainText('à valider avant 00:45 (lendemain)');
  });

  test('375 px : pas de défilement horizontal, zones de toucher ≥ 44 px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page, at(MONDAY, '22:00'));
    await todo(page, 'Salle — Poussée A').locator('.checkbox').click();
    const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
    expect(scrollWidth).toBeLessThanOrEqual(375);
    for (const sel of ['.todo .checkbox', '.todo .minbtn', '.tracker-nav button', '#now .buttons button']) {
      const boxes = await page.locator(sel).evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
      for (const h of boxes) expect(h, sel).toBeGreaterThanOrEqual(44);
    }
    await expect(page.locator('link[rel="apple-touch-icon"]')).toHaveAttribute('href', /^data:image\/png;base64,/);
  });
});
