// Requires Playwright in the test runner; no browser dependency is shipped to phones.
const {chromium} = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', args:['--no-sandbox', '--use-fake-device-for-media-stream']});
  try {
    const context = await browser.newContext({viewport:{width:390,height:844}, acceptDownloads:true, permissions:['camera','geolocation'],geolocation:{latitude:35.681236,longitude:139.767125,accuracy:7.5}, isMobile:true, hasTouch:true});
    const page = await context.newPage();
    const touch = await context.newCDPSession(page);
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
    await page.getByText('仕分け用データを確認', {exact:true}).click();
    assert.ok((await page.locator('.metadata-list').textContent()).includes('水位計 定期点検'));
    await page.getByRole('button',{name:'JPEG内のデータを確認',exact:true}).click();
    await page.waitForFunction(()=>document.querySelector('.photo').textContent.includes('JPEG内から読み取り成功'));
    const jsonPromise = page.waitForEvent('download');
    await page.getByRole('button',{name:'管理JSONを保存',exact:true}).click();
    const jsonDownload = await jsonPromise;
    const json = JSON.parse(await fs.readFile(await jsonDownload.path(),'utf8'));
    assert.equal(json.site, saved.metadata.site);
    assert.equal(json.work,'水位計 定期点検');
    assert.equal(json.composedFile, saved.metadata.composedFile);
    assert.equal(json.capturedAt,null);
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

    await page.getByRole('button',{name:'地点・設定',exact:true}).click();
    await page.locator('#gps-enabled').check();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('次のライブ撮影'));
    await page.getByRole('button',{name:'撮影',exact:true}).click();

    // Live camera uses a synthetic device, without uploading any frames.
    await page.locator('#theme').selectOption('white');
    await page.locator('#position').selectOption('top-right');
    await page.locator('#manual-date').fill('');
    await page.locator('#start-camera').click();
    await page.waitForFunction(() => !document.querySelector('#capture').disabled);
    assert.equal(await page.locator('#live-view').isVisible(),true);
    const overlay = await page.evaluate(async () => {
      const c=document.querySelector('#live-board'), video=document.querySelector('#live-video');
      const {boardRect}=await import('/core.js'); const r=boardRect(c.width,c.height,40,'top-right');
      return {pixel:Array.from(c.getContext('2d').getImageData(Math.round(r.x+r.w*.5),Math.round(r.y+r.h*.94),1,1).data),width:video.videoWidth,height:video.videoHeight};
    });
    assert.deepEqual(overlay.pixel,[255,253,244,255], 'board appears on live video in selected corner');
    for (const [width,height] of [[390,844],[320,568],[844,390],[667,375]]) {
      await page.setViewportSize({width,height});
      await page.waitForFunction(() => {
        const screen=document.querySelector('#camera-screen').getBoundingClientRect();
        return Math.abs(screen.height-innerHeight) < 1 && Math.abs(screen.width-innerWidth) < 1;
      });
      for (const selector of ['#capture','#size-up','#size-down','#stop-camera','#edit-board','[data-move=up]','[data-move=down]','[data-move=left]','[data-move=right]']) {
        const box=await page.locator(selector).boundingBox();
        assert.ok(box && box.x >= 0 && box.y >= 0 && box.x+box.width <= width+1 && box.y+box.height <= height+1, `${selector} fits ${width}x${height}`);
      }
      const before=await page.evaluate(() => ({scroll:scrollY,top:document.querySelector('#live-view').getBoundingClientRect().top}));
      await page.mouse.move(width/2,height/2);await page.mouse.wheel(0,500);
      await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:width/2,y:height/2}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:width/2,y:height/2-60}]});
      await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
      const after=await page.evaluate(() => ({scroll:scrollY,top:document.querySelector('#live-view').getBoundingClientRect().top}));
      assert.deepEqual(after,before,'camera does not scroll');
      await page.locator('#camera-screen').screenshot({path:`test-results/fullscreen-${width}x${height}.png`});
    }
    await page.setViewportSize({width:390,height:844});
    await page.getByRole('button',{name:'黒板を左へ',exact:true}).click();
    await page.getByRole('button',{name:'黒板を下へ',exact:true}).click();
    await page.getByRole('button',{name:'黒板を拡大',exact:true}).click();
    assert.equal(await page.locator('#live-size').textContent(),'45%');
    await page.getByRole('button',{name:'黒板の文字を編集',exact:true}).click();
    await page.locator('#editor-work').fill('変更しない');
    await page.locator('#editor-cancel').click();
    assert.equal(await page.locator('#work').inputValue(),'水位計 定期点検');
    await page.getByRole('button',{name:'黒板の文字を編集',exact:true}).click();
    await page.locator('#editor-site-name').fill('白上川 1K4R 確認');
    await page.locator('#editor-work').fill('定期点検（現場で変更）');
    await page.locator('#editor-item').fill('センサー部');
    await page.getByRole('button',{name:'反映する',exact:true}).click();
    await page.waitForFunction(() => !document.querySelector('#board-editor').open);
    assert.equal(await page.locator('#item').inputValue(),'センサー部');
    await page.locator('#camera-screen').screenshot({path:'test-results/live-camera.png'});
    await page.locator('#capture').click();
    await page.waitForFunction(() => !document.querySelector('#save').disabled);
    assert.equal(await page.locator('#live-view').isVisible(),false);
    assert.equal(await page.locator('#live-video').evaluate(video => video.srcObject), null);
    await page.locator('#save').click();
    await page.waitForFunction(() => document.querySelector('#count').textContent === '3');
    const live = await page.evaluate(async () => {
      const db = await new Promise(resolve => { const r=indexedDB.open('genba-photo',1);r.onsuccess=()=>resolve(r.result); });
      const all = await new Promise(resolve => { const r=db.transaction('photos').objectStore('photos').getAll();r.onsuccess=()=>resolve(r.result); });
      const p=all.find(p => p.metadata.source === 'live-camera');
      const {boardRect}=await import('/core.js');
      const pixels=[];
      for (const blob of [p.original,p.composed]) {
        const image=await createImageBitmap(blob), c=document.createElement('canvas');c.width=image.width;c.height=image.height;
        const ctx=c.getContext('2d');ctx.drawImage(image,0,0);image.close();
        const r=boardRect(c.width,c.height,p.metadata.size,p.metadata.position,{x:p.metadata.boardX,y:p.metadata.boardY});
        pixels.push(Array.from(ctx.getImageData(Math.round(r.x+r.w*.5),Math.round(r.y+r.h*.94),1,1).data));
      }
      return {metadata:p.metadata,pixels,oldSite:all.find(p => p.metadata.source === 'file-import').metadata.site};
    });
    assert.equal(live.metadata.originalIsBrowserFrame,true);
    assert.equal(live.metadata.dateSource,'device-capture-time');
    assert.ok(Number.isFinite(Date.parse(live.metadata.capturedAt)));
    assert.equal(live.metadata.width, overlay.width);assert.equal(live.metadata.height, overlay.height);
    assert.equal(live.metadata.boardX,0.96);assert.equal(live.metadata.boardY,0.04);
    assert.equal(live.metadata.size,45);assert.equal(live.metadata.work,'定期点検（現場で変更）');
    assert.equal(live.metadata.gps.latitude,35.681236);assert.equal(live.metadata.gps.longitude,139.767125);
    assert.equal(live.metadata.gpsStatus,'recorded');
    assert.equal(live.metadata.item,'センサー部');assert.equal(live.metadata.site,'白上川 1K4R 確認');
    assert.equal(live.oldSite,'白上川 1K4R','renaming the site does not change old saved records');
    assert.notDeepEqual(live.pixels[0],live.pixels[1], 'original has no composited board');
    assert.ok(live.pixels[1][0] > 245 && live.pixels[1][1] > 245 && live.pixels[1][2] > 235, 'saved board matches live position');
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#count').textContent === '3');
    assert.equal(await page.locator('#size').inputValue(),'45','size retained after reload');
    await page.locator('#start-camera').click();
    await page.waitForFunction(() => !document.querySelector('#capture').disabled);
    await page.locator('#stop-camera').click();
    await page.getByRole('button',{name:/保存写真/}).click();
    assert.equal(await page.locator('#live-video').evaluate(video => video.srcObject),null,'closing camera stops stream');
    await page.getByRole('button',{name:'撮影',exact:true}).click();
    await page.evaluate(() => { window.realGetUserMedia=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async () => { throw new DOMException('denied','NotAllowedError'); }; });
    await page.locator('#start-camera').click();
    await page.waitForFunction(() => document.querySelector('#status').textContent.includes('許可されませんでした'));
    assert.equal(await page.locator('#start-camera').isEnabled(),true);
    assert.equal(await page.locator('#camera-screen').evaluate(dialog => dialog.open),false,'denial unlocks the page');
    assert.equal(await page.locator('html').evaluate(el => el.classList.contains('camera-open')),false);

    // Seed another site and day to exercise real ZIP button selections offline.
    await page.evaluate(async () => {
      const db=await new Promise(resolve=>{const r=indexedDB.open('genba-photo',1);r.onsuccess=()=>resolve(r.result);});
      const all=await new Promise(resolve=>{const r=db.transaction('photos').objectStore('photos').getAll();r.onsuccess=()=>resolve(r.result);});
      const original=all.find(p=>p.metadata.source==='file-import'), day=original.metadata.recordedDate;
      const tx=db.transaction('photos','readwrite');
      for (const [id,site,date] of [['zip-site','別地点',day],['zip-old','前日の地点','20261026']]) {
        const m={...original.metadata,id,site,recordedDate:date};
        delete m.embeddedExifVersion; // Legacy photos must be upgraded on export.
        m.composedFile=`${date}__${id}__board.jpg`;m.originalFile=`${date}__${id}__original.png`;m.metadataFile=`${date}__${id}.json`;
        tx.objectStore('photos').add({id,metadata:m,composed:original.composed,original:original.original});
      }
      await new Promise((resolve,reject)=>{tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});
    });
    await page.reload();await page.waitForFunction(()=>document.querySelector('#count').textContent==='5');
    await page.getByRole('button',{name:/保存写真/}).click();
    await page.waitForFunction(()=>document.querySelectorAll('.day-group').length===2);
    assert.equal(await page.locator('.day-group').count(),2);
    const day=saved.metadata.recordedDate, dayGroup=page.locator(`.day-group[data-day="${day}"]`);
    assert.equal(await dayGroup.locator('.site-group').count(),3);
    const siteGroup=dayGroup.locator('.site-group').filter({has:page.locator('summary').filter({hasText:'白上川 1K4R · 2枚'})});
    if (!await siteGroup.evaluate(el=>el.open)) await siteGroup.locator(':scope > summary').click();
    await siteGroup.locator(':scope > [data-archive]').click();
    await page.waitForFunction(()=>!document.querySelector('#zip-save').disabled);
    let zipDownloadPromise=page.waitForEvent('download');
    await page.locator('#zip-save').click();
    let zipDownload=await zipDownloadPromise;
    await zipDownload.saveAs('test-results/site.zip');
    assert.ok(zipDownload.suggestedFilename().includes('白上川1K4R'));
    await dayGroup.locator(':scope > [data-archive]').click();
    await page.waitForFunction(()=>!document.querySelector('#zip-save').disabled);
    zipDownloadPromise=page.waitForEvent('download');await page.locator('#zip-save').click();zipDownload=await zipDownloadPromise;
    await zipDownload.saveAs('test-results/day.zip');
    assert.ok(zipDownload.suggestedFilename().includes('全地点'));
    await page.screenshot({path:'test-results/grouped-library.png',fullPage:true});
    const {spawnSync}=require('node:child_process');
    const verify=spawnSync('python3',['-c',`import zipfile,json
for path,count,sites in [('test-results/site.zip',2,1),('test-results/day.zip',4,3)]:
 z=zipfile.ZipFile(path)
 assert z.testzip() is None
 m=json.loads(z.read('書き出し一覧.json'))
 assert m['photoCount']==count
 assert len(set(p['site'] for p in m['photos']))==sites
 assert len(z.namelist())==count*3+1
 for p in m['photos']:
  assert p['composedPath'] in z.namelist() and p['originalPath'] in z.namelist()
  assert json.loads(z.read(p['metadataPath']))['site']==p['site']
 assert all(p['site']!='前日の地点' for p in m['photos'])
print('Offline site/day ZIP contents verified')`],{encoding:'utf8'});
    assert.equal(verify.status,0,verify.stderr);
    await page.locator('#zip-include-original').uncheck();await page.locator('#zip-include-json').uncheck();
    assert.equal(await page.locator('#zip-save').isDisabled(),true,'changing options invalidates the prepared ZIP');
    await dayGroup.locator(':scope > [data-archive]').click();
    await page.waitForFunction(()=>!document.querySelector('#zip-save').disabled);
    zipDownloadPromise=page.waitForEvent('download');await page.locator('#zip-save').click();zipDownload=await zipDownloadPromise;
    await zipDownload.saveAs('test-results/images-only.zip');
    const imageCheck=spawnSync('python3',['-c',`import zipfile,json,tempfile,pathlib,subprocess,sys
z=zipfile.ZipFile('test-results/images-only.zip')
assert z.testzip() is None
assert len(z.namelist())==4
assert all(n.endswith('__board.jpg') and '/原本/' not in n for n in z.namelist())
sites=[]
with tempfile.TemporaryDirectory() as d:
 for n in z.namelist():
  p=pathlib.Path(d)/'photo.jpg';p.write_bytes(z.read(n))
  r=subprocess.run([sys.executable,'tools/read_photo_metadata.py',str(p),'--json'],capture_output=True,text=True,check=True)
  m=json.loads(r.stdout);sites.append(m['site']);assert m['work']
assert len(set(sites))==3
print('JPEG-only ZIP has no JSON or originals, and every JPEG independently contains its metadata')`],{encoding:'utf8'});
    assert.equal(imageCheck.status,0,imageCheck.stderr);
    await page.locator('#zip-include-composed').uncheck();
    await dayGroup.locator(':scope > [data-archive]').click();
    await page.waitForFunction(()=>document.querySelector('#zip-message').textContent.includes('1つ以上'));
    assert.equal(await page.locator('#zip-save').isDisabled(),true);
    assert.equal(await page.evaluate(async ()=>{
      const db=await new Promise(resolve=>{const r=indexedDB.open('genba-photo',1);r.onsuccess=()=>resolve(r.result);});
      return new Promise(resolve=>{const r=db.transaction('photos').objectStore('photos').count();r.onsuccess=()=>resolve(r.result);});
    }),5,'export does not delete photos');
    // GPS permission failure must keep the captured photo usable.
    await page.reload();await page.waitForFunction(()=>document.querySelector('#count').textContent==='5');
    await page.evaluate(()=>{
      navigator.geolocation.getCurrentPosition=(_success,failure)=>failure({code:1});
    });
    await page.locator('#start-camera').click();await page.waitForFunction(()=>!document.querySelector('#capture').disabled);
    await page.locator('#capture').click();await page.waitForFunction(()=>!document.querySelector('#save').disabled);
    assert.ok((await page.locator('#status').textContent()).includes('GPSは取得できませんでした'));
    await page.locator('#save').click();await page.waitForFunction(()=>document.querySelector('#count').textContent==='6');
    assert.deepEqual(errors,[]);
    console.log('PASS: JPEG embedded metadata, legacy export upgrade, ZIP selections/no JSON, GPS success/denial, original preservation, offline camera and exports');
    await context.close();
  } finally { await browser.close(); }
})().catch(error => { console.error(error);process.exitCode=1; });
