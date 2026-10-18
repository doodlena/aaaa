import { chromium, devices } from 'playwright';
const out = process.argv[2], base = process.argv[3];
const b = await chromium.launch();
const ctx = await b.newContext({ ...devices['iPhone 13'] });
const p = await ctx.newPage();
p.on('console', (m) => m.type() === 'error' && console.log('console error:', m.text().slice(0, 200)));
p.on('pageerror', (e) => console.log('page error:', e.message.slice(0, 200)));
p.on('requestfailed', (r) => console.log('failed:', r.url().slice(0, 120), r.failure()?.errorText));
p.on('response', (r) => r.status() >= 400 && console.log('http', r.status(), r.url().slice(0, 120)));
await p.goto(base + '/'); await p.waitForTimeout(2000);
for (const name of ['中文', 'Tiếng Việt', '한국어']) {
  const more = p.getByRole('button', { name: /More languages/i }).first();
  console.log('more visible:', await more.isVisible(), JSON.stringify(await more.boundingBox()));
  await more.tap();
  await p.waitForTimeout(500);
  const opt = p.locator('.lang__menu button', { hasText: name });
  console.log(name, 'option count', await opt.count(), 'visible', await opt.first().isVisible().catch(() => false), JSON.stringify(await opt.first().boundingBox().catch(() => null)));
  const hit = await opt.first().boundingBox().then((bb) => bb && p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? el.outerHTML.slice(0, 120) : null; }, [bb.x + bb.width / 2, bb.y + bb.height / 2])).catch(() => null);
  console.log('  element at tap point:', hit);
  try { await opt.first().tap({ timeout: 3000 }); } catch (e) { console.log('  tap failed:', e.message.split('\n')[0]); }
  await p.waitForTimeout(1500);
  console.log('  html lang:', await p.evaluate(() => document.documentElement.lang), '| h1:', (await p.locator('h1').first().textContent())?.slice(0, 40));
  await p.screenshot({ path: `${out}/lang-${name.length}.png` });
  // back to English for the next round
  await p.getByRole('button', { name: 'English' }).first().tap().catch(() => {});
  await p.waitForTimeout(800);
}
await b.close();
