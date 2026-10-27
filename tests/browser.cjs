// Requires Playwright in the test runner; no browser dependency is shipped to phones.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844}, acceptDownloads:true});
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.goto('http://127.0.0.1:8080/');
    await page.waitForFunction(() => document.querySelector('#offline').textContent.startsWith('準備済み'));
    await page.getByRole('button', {name:'地点・設定',exact:true}).click();
    await page.locator('#new-site').fill('白上川 1K4R');
    await page.getByRole('button',{name:'追加する',exact:true}).click();
    await page.waitForFunction(() => document.querySelector('#site').options.length === 1);
    await page.getByRole('button',{name:'撮影',exact:true}).click();
    const source = await page.evaluate(() => {
      const c = document.createElement('canvas'); c.width = 1600; c.height = 1200;
      const ctx = c.getContext('2d'); ctx.fillStyle='#d9e7f4';ctx.fillRect(0,0,1600,1200);
      ctx.fillStyle='#77887a';ctx.fillRect(500,200,600,800);ctx.fillStyle='#fff';ctx.font='90px sans-serif';ctx.fillText('TEST 123',520,500);
      return c.toDataURL('image/png').split(',')[1];
    });
    const original = Buffer.from(source,'base64');
    await page.locator('#work').fill('水位計 定期点検');
    await page.locator('#import').setInputFiles({name:'source.png',mimeType:'image/png',buffer:original});
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    await page.locator('#theme').selectOption('white');
    await page.locator('#position').selectOption('top-right');
    await page.locator('#date-mode').selectOption('datetime');
    await page.locator('#manual-date').fill('2026-10-27T14:30');
    await fs.mkdir('test-results',{recursive:true});
    await page.screenshot({path:'test-results/shoot.png',fullPage:true});
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#count').textContent === '1');
    const saved = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r = indexedDB.open('genba-photo',1); r.onsuccess = () => resolve(r.result); });
      const records = await new Promise(resolve => { const r=db.transaction('photos').objectStore('photos').getAll();r.onsuccess=()=>resolve(r.result);});
      const p=records[0];return {metadata:p.metadata,original:Array.from(new Uint8Array(await p.original.arrayBuffer())),type:p.composed.type};
    });
    assert.deepEqual(Buffer.from(saved.original), original, 'original bytes retained');
    assert.equal(saved.metadata.site,'白上川 1K4R');
    assert.equal(saved.metadata.boardDate,'2026-10-27T14:30');
    assert.equal(saved.metadata.width,1600);assert.equal(saved.metadata.height,1200);
    assert.equal(saved.type,'image/jpeg');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#count').textContent === '1');
    await page.getByRole('button',{name:/保存写真/}).click();
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button',{name:'合成JPEGを保存',exact:true}).click();
    const download=await downloadPromise;assert.equal(download.suggestedFilename(),saved.metadata.composedFile);
    await download.saveAs('test-results/composed.jpg');
    await page.screenshot({path:'test-results/library.png',fullPage:true});
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#count').textContent === '1');
    assert.equal(await page.locator('#site option').textContent(), '白上川 1K4R');
    await page.locator('#import').setInputFiles({name:'offline.png',mimeType:'image/png',buffer:original});
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    // Simulate a failed IndexedDB write; no success message or lost in-memory photo.
    await page.evaluate(() => { window.realAdd = IDBObjectStore.prototype.add; IDBObjectStore.prototype.add = function() { throw new DOMException('容量不足の模擬テスト','QuotaExceededError'); }; });
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#status').classList.contains('error'));
    assert.equal(await page.locator('#count').textContent(),'1');
    assert.equal(await page.locator('#save').isEnabled(),true);
    await page.evaluate(() => { IDBObjectStore.prototype.add = window.realAdd; });
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#count').textContent === '2');
    assert.deepEqual(errors,[]);
    console.log('PASS: register, image import, composition, original integrity, metadata, restart, download, offline save, failed-save retry');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exitCode=1; });
