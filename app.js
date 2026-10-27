import {fileStem, localDate, boardRect, displayDate} from './core.js';

const $ = id => document.getElementById(id);
let db, settings, current, busy = false;
let cameraStream = null, cameraOpening = false, cameraRequest = 0, clockTimer = null;
let galleryURLs = [];
const defaults = () => ({sites: [], items: ['全景', '盤面', 'センサー部', '基礎・杭', 'その他'], deviceId: crypto.randomUUID().slice(0, 8), work: '', theme: 'green', position: 'bottom-left', size: '40', dateMode: 'date'});
function status(message, error = false) { $('status').textContent = message; $('status').classList.toggle('error', error); }
function run(fn) { return async (...args) => { try { await fn(...args); } catch (e) { console.error(e.name); status(`処理できませんでした。${e.message} 写真を選択中なら、画面を閉じずに再試行してください。`, true); } }; }
function transaction(store, mode, operation) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const request = operation(tx.objectStore(store));
    tx.oncomplete = () => resolve(request.result);
    tx.onabort = () => reject(tx.error || new Error('端末内への保存に失敗しました。容量・ブラウザ設定を確認してください。'));
    tx.onerror = () => {};
  });
}
const read = (store, key) => transaction(store, 'readonly', s => s.get(key));
const writeSettings = next => transaction('settings', 'readwrite', s => s.put(next, 'main'));
async function updateSettings(next) { await writeSettings(next); settings = next; }

function fillSites() {
  $('site').replaceChildren(...settings.sites.map(site => new Option(site.name, site.id)));
  if (settings.sites.some(s => s.id === settings.selectedSite)) $('site').value = settings.selectedSite;
  $('no-sites').hidden = settings.sites.length > 0;
  $('site-list').replaceChildren();
  for (const site of settings.sites) {
    const li = document.createElement('li'), name = document.createElement('span'); name.textContent = site.name;
    const edit = document.createElement('button'); edit.textContent = '編集';
    edit.onclick = run(async () => {
      const value = prompt('地点名', site.name)?.trim(); if (!value) return;
      if (value.length > 60) throw new Error('地点名は60文字以内です。');
      if (settings.sites.some(s => s.id !== site.id && s.name === value)) throw new Error('同じ地点名が登録されています。');
      await updateSettings({...settings, sites: settings.sites.map(s => s.id === site.id ? {...s, name: value} : s)}); fillSites(); render();
    });
    const del = document.createElement('button'); del.textContent = '削除';
    del.onclick = run(async () => {
      if (!confirm(`「${site.name}」を地点一覧から削除しますか？保存写真は残ります。`)) return;
      await updateSettings({...settings, sites: settings.sites.filter(s => s.id !== site.id)}); fillSites(); render();
    });
    li.append(name, edit, del); $('site-list').append(li);
  }
}
function fillItems() {
  $('item-buttons').replaceChildren(...settings.items.map(item => {
    const button = document.createElement('button'); button.textContent = item;
    button.onclick = () => { $('item').value = item; render(); };
    return button;
  }));
  $('items').value = settings.items.join('\n');
}
function snapshot() {
  const siteId = $('site').value;
  return {siteId, site: settings.sites.find(s => s.id === siteId)?.name || '地点未設定', work: $('work').value.trim(), item: $('item').value.trim(), theme: $('theme').value, position: $('position').value, size: Number($('size').value), dateMode: $('date-mode').value, boardDate: $('manual-date').value || (cameraStream ? localInputDate(new Date()) : current?.selectedAt) || ''};
}
function render() {
  $('size-label').textContent = `${$('size').value}%`;
  for (const button of $('item-buttons').children) button.classList.toggle('selected', button.textContent === $('item').value);
  $('save').disabled = !current || busy || !!cameraStream || cameraOpening;
  $('start-camera').disabled = busy || !!cameraStream || cameraOpening;
  $('capture').disabled = busy || !cameraStream || !$('live-video').videoWidth;
  if (cameraStream) renderLiveBoard();
  if (!current) return;
  const canvas = $('preview'), ctx = canvas.getContext('2d');
  ctx.drawImage(current.image, 0, 0, canvas.width, canvas.height);
  drawBoard(ctx, canvas.width, canvas.height, snapshot());
}
function drawBoard(ctx, width, height, data) {
  const {x, y, w, h} = boardRect(width, height, data.size, data.position);
  ctx.fillStyle = data.theme === 'green' ? '#164a3b' : '#fffdf4'; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = data.theme === 'green' ? '#e3dfc3' : '#4b5551'; ctx.lineWidth = Math.max(1, w / 170); ctx.strokeRect(x + 3, y + 3, w - 6, h - 6);
  const lines = [['地点', data.site], ['工種', data.work || '—'], ['項目', data.item || '—']];
  const date = displayDate(data.dateMode, data.boardDate); if (date) lines.push(['日時', date]);
  const row = (h - w * 0.1) / lines.length, pad = w * 0.05;
  ctx.textBaseline = 'middle';
  lines.forEach(([label, value], i) => {
    const yy = y + w * 0.05 + row * i;
    if (i) { ctx.beginPath(); ctx.moveTo(x + pad, yy); ctx.lineTo(x + w - pad, yy); ctx.stroke(); }
    ctx.fillStyle = data.theme === 'green' ? '#f7f8ed' : '#9a3027';
    ctx.font = `${w * 0.044}px sans-serif`; ctx.fillText(label, x + pad, yy + row * 0.25);
    ctx.fillStyle = data.theme === 'green' ? '#fffef1' : '#1e2926';
    let size = w * 0.065; ctx.font = `600 ${size}px sans-serif`;
    while (ctx.measureText(value).width > w - pad * 2 && size > w * 0.022) { size -= 1; ctx.font = `600 ${size}px sans-serif`; }
    ctx.fillText(value, x + pad, yy + row * 0.66, w - pad * 2);
  });
}
function localInputDate(date) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16); }

function renderLiveBoard() {
  const video = $('live-video'), canvas = $('live-board');
  if (!cameraStream || !video.videoWidth) return;
  // Same aspect ratio and board geometry as capture; CSS never crops the video.
  const scale = Math.min(1, 1280 / video.videoWidth);
  const width = Math.round(video.videoWidth * scale), height = Math.round(video.videoHeight * scale);
  if (canvas.width !== width || canvas.height !== height) { canvas.width = width; canvas.height = height; }
  const ctx = canvas.getContext('2d'); ctx.clearRect(0, 0, width, height);
  drawBoard(ctx, width, height, snapshot());
  $('camera-resolution').textContent = `${video.videoWidth} × ${video.videoHeight}px・ライブ映像から撮影（標準カメラの画質とは異なります）`;
  $('capture').disabled = busy;
}
function stopCamera() {
  cameraRequest += 1; cameraOpening = false;
  clearInterval(clockTimer); clockTimer = null;
  if (cameraStream) for (const track of cameraStream.getTracks()) track.stop();
  cameraStream = null; $('live-video').srcObject = null;
  $('live-view').hidden = true; $('live-controls').hidden = true;
  $('preview').hidden = !current; $('placeholder').hidden = !!current;
  render();
}
async function startCamera() {
  if (busy || cameraOpening || cameraStream) return;
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('この環境ではライブカメラを使えません。HTTPSで開くか「標準カメラ」を使ってください。');
  if (!snapshot().siteId) throw new Error('先に地点を登録・選択してください。');
  if (current && !confirm('未保存の写真があります。ライブ撮影した場合は置き換わります。カメラを開きますか？')) return;
  cameraOpening = true; const request = ++cameraRequest; render();
  status('カメラの使用を許可してください。音声は取得しません。');
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:false, video:{facingMode:{ideal:'environment'}, width:{ideal:4032}, height:{ideal:3024}}});
    if (request !== cameraRequest || document.hidden || $('shoot').hidden) { stream.getTracks().forEach(t => t.stop()); return; }
    cameraStream = stream; const video = $('live-video');
    video.srcObject = stream; $('live-view').hidden = false; $('live-controls').hidden = false;
    $('preview').hidden = true; $('placeholder').hidden = true;
    await video.play();
    if (request !== cameraRequest) return;
    for (const track of stream.getVideoTracks()) track.addEventListener('ended', () => { if (cameraStream === stream) { stopCamera(); status('カメラ映像が停止しました。もう一度起動してください。', true); } });
    clockTimer = setInterval(renderLiveBoard, 1000);
    renderLiveBoard();
    status('黒板の位置を見ながら構図を決め、「この位置で撮影」を押してください。');
    $('viewfinder').scrollIntoView({behavior:'smooth', block:'center'});
  } catch (error) {
    if (request !== cameraRequest) return;
    stopCamera();
    const messages = {NotAllowedError:'カメラの使用が許可されませんでした。ブラウザのカメラ許可を確認するか「標準カメラ」を使ってください。',NotFoundError:'カメラが見つかりません。「写真を選ぶ」から取り込めます。',NotReadableError:'カメラを起動できません。他のカメラアプリを閉じて再試行してください。'};
    throw new Error(messages[error.name] || 'カメラを起動できません。「標準カメラ」でも撮影できます。');
  } finally { if (request === cameraRequest) cameraOpening = false; render(); }
}
async function captureLive() {
  if (busy || !cameraStream) return;
  const video = $('live-video');
  if (video.readyState < 2 || !video.videoWidth) throw new Error('映像の準備ができていません。少し待って再試行してください。');
  busy = true; render();
  try {
    const now = new Date(), canvas = document.createElement('canvas');
    canvas.width = video.videoWidth; canvas.height = video.videoHeight;
    if (canvas.width * canvas.height > 25000000) throw new Error('ライブ画像が大きすぎます。「標準カメラ」で12MP程度の写真を取り込んでください。');
    canvas.getContext('2d').drawImage(video, 0, 0);
    const blob = await new Promise((resolve,reject) => canvas.toBlob(b => b ? resolve(b) : reject(new Error('撮影画像を作成できませんでした。')), 'image/jpeg', 0.95));
    const file = new File([blob], 'live-camera.jpg', {type:'image/jpeg'});
    await setPhoto(file, now, 'live-camera');
    stopCamera();
    status(`${canvas.width} × ${canvas.height}pxで撮影しました。黒板を確認し「黒板を合成して端末内に保存」を押してください。`);
  } finally { busy = false; render(); }
}
async function setPhoto(file, now, source) {
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url;
    try { await image.decode(); } catch { throw new Error('この画像形式は読み込めません。JPEG形式で撮影・選択してください。'); }
    const width = image.naturalWidth, height = image.naturalHeight;
    if (width * height > 25000000) throw new Error('試作版では合成対象は2500万画素までです。カメラの設定を12MP程度にして再撮影してください。');
    if (!width || !height) throw new Error('画像サイズを取得できません。');
    if (current) URL.revokeObjectURL(current.url);
    current = {file, image, url, selectedAt: localInputDate(now), importedAt: now.toISOString(), date: localDate(now), source, capturedAt: source === 'live-camera' ? now.toISOString() : null};
    $('preview').width = width; $('preview').height = height; $('preview').hidden = false; $('placeholder').hidden = true;
  } catch (error) { URL.revokeObjectURL(url); throw error; }
}
async function loadPhoto(event) {
  const file = event.target.files[0]; if (!file) return;
  if (busy) return;
  stopCamera();
  busy = true; render();
  try {
    status('写真を読み込んでいます…');
    await setPhoto(file, new Date(), 'file-import');
    status(`${$('preview').width} × ${$('preview').height}px。地点・写真項目・黒板を確認して保存してください。`);
  }
  finally { busy = false; event.target.value = ''; render(); }
}
async function savePhoto() {
  if (!current || busy || cameraStream || cameraOpening) return;
  const meta = snapshot();
  if (!meta.siteId) throw new Error('先に地点を登録・選択してください。');
  if (!meta.item) throw new Error('写真項目を入力してください。');
  busy = true; render(); status('原本・合成写真・管理情報を端末内に保存中…');
  try {
    render();
    const composed = await new Promise((resolve, reject) => $('preview').toBlob(blob => blob ? resolve(blob) : reject(new Error('画像合成に失敗しました。')), 'image/jpeg', 0.95));
    const id = crypto.randomUUID(), stem = fileStem({date: current.date, site: meta.site, item: meta.item, deviceId: settings.deviceId, id});
    const ext = current.file.name.split('.').pop()?.toLowerCase();
    const originalExtension = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin';
    const metadata = {schemaVersion: 1, id, deviceId: settings.deviceId, ...meta, importedAt: current.importedAt, savedAt: new Date().toISOString(), capturedAt: current.capturedAt, dateSource: current.source === 'live-camera' ? 'device-capture-time' : 'device-import-time', source: current.source, originalIsBrowserFrame: current.source === 'live-camera', originalName: current.file.name, originalType: current.file.type, width: $('preview').width, height: $('preview').height, originalFile: `${stem}__original.${originalExtension}`, composedFile: `${stem}__board.jpg`, metadataFile: `${stem}.json`};
    await transaction('photos', 'readwrite', store => store.add({id, metadata, original: current.file, composed}));
    URL.revokeObjectURL(current.url); current = null; $('preview').hidden = true; $('placeholder').hidden = false;
    await refreshCount(); status('端末内への保存が完了しました。「保存写真」から写真アプリへの共有・PC向け書き出しができます。');
  } finally { busy = false; render(); }
}
function download(blob, name) {
  const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 60000);
}
function filesFor(photo) {
  const m = photo.metadata;
  return [new File([photo.composed], m.composedFile, {type: 'image/jpeg'}), new File([photo.original], m.originalFile, {type: m.originalType || 'application/octet-stream'}), new File([JSON.stringify(m, null, 2)], m.metadataFile, {type: 'application/json'})];
}
async function share(files) {
  if (!navigator.canShare?.({files})) { status('このブラウザではファイル共有に対応していません。下の個別ダウンロードを使用してください。', true); return; }
  try { await navigator.share({files}); status('共有画面を閉じました。保存先にファイルがあることを確認してください。'); }
  catch (error) { if (error.name !== 'AbortError') throw error; }
}
async function refreshCount() { $('count').textContent = await transaction('photos', 'readonly', store => store.count()); }
async function gallery() {
  for (const url of galleryURLs) URL.revokeObjectURL(url); galleryURLs = [];
  const photos = await transaction('photos', 'readonly', store => store.getAll());
  $('photos').replaceChildren();
  if (!photos.length) { $('photos').textContent = 'まだ保存写真はありません。'; return; }
  photos.sort((a,b) => b.metadata.savedAt.localeCompare(a.metadata.savedAt));
  for (const photo of photos) {
    const card = document.createElement('article'); card.className = 'card photo';
    const img = document.createElement('img'), url = URL.createObjectURL(photo.composed); galleryURLs.push(url); img.src = url; img.alt = `${photo.metadata.site} ${photo.metadata.item}`; img.loading = 'lazy';
    const title = document.createElement('h2'); title.textContent = `${photo.metadata.site} / ${photo.metadata.item}`;
    const name = document.createElement('p'); name.className = 'filename'; name.textContent = photo.metadata.composedFile;
    const info = document.createElement('details'); info.className = 'metadata';
    const summary = document.createElement('summary'); summary.textContent = '仕分け用データを確認';
    const list = document.createElement('dl'); list.className = 'metadata-list';
    const m = photo.metadata;
    const dateText = value => value ? new Date(value).toLocaleString('ja-JP') : '未取得（EXIFは読み取りません）';
    for (const [label,value] of [['地点',m.site],['工種',m.work || '未設定'],['写真項目',m.item],['撮影日時',dateText(m.capturedAt)],['取込日時',dateText(m.importedAt)],['黒板表示日時',m.boardDate || '未設定'],['日時表示',m.dateMode === 'none' ? '表示なし' : m.dateMode === 'date' ? '年月日' : '年月日＋時分'],['画像寸法',`${m.width} × ${m.height}px`],['撮影方式',m.source === 'live-camera' ? 'ライブ映像からの撮影' : '標準カメラ・画像取り込み'],['端末ID',m.deviceId]]) {
      const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; list.append(dt,dd);
    }
    const note = document.createElement('p'); note.className = 'note'; note.textContent = 'この情報はアプリ内と管理JSONに保存しています。写真アプリの画像だけでは、工種等のデータは取り出せません。PCへは画像とJSONをセットで渡してください。日時は端末時計による記録です。';
    const raw = document.createElement('pre'); raw.className = 'metadata-json'; raw.textContent = JSON.stringify(m, null, 2);
    info.append(summary,list,note,raw);
    const buttons = document.createElement('div'); buttons.className = 'buttons';
    const add = (label, action) => { const b = document.createElement('button'); b.textContent = label; b.onclick = run(action); buttons.append(b); };
    const files = filesFor(photo);
    add('合成写真を共有', () => share([files[0]])); add('一式を共有', () => share(files));
    for (const [i,label] of ['合成JPEGを保存', '原本を保存', '管理JSONを保存'].entries()) add(label, () => download(files[i], files[i].name));
    add('端末内から削除', async () => {
      if (!confirm('原本・合成写真・管理情報を端末内から削除します。書き出し先で写真を確認しましたか？この操作は元に戻せません。')) return;
      await transaction('photos', 'readwrite', store => store.delete(photo.id)); await refreshCount(); await gallery();
    });
    card.append(title, img, name, info, buttons); $('photos').append(card);
  }
}
async function init() {
  db = await new Promise((resolve, reject) => {
    const req = indexedDB.open('genba-photo', 1);
    req.onupgradeneeded = () => { req.result.createObjectStore('settings'); req.result.createObjectStore('photos', {keyPath: 'id'}); };
    req.onsuccess = () => resolve(req.result); req.onerror = () => reject(new Error('端末内保存が使えません。プライベートブラウズや保存設定を確認してください。'));
  });
  settings = await read('settings', 'main') || defaults(); await writeSettings(settings);
  fillSites(); fillItems(); $('device').textContent = settings.deviceId;
  for (const [id,key] of [['work','work'],['theme','theme'],['position','position'],['size','size'],['date-mode','dateMode']]) $(id).value = settings[key];
  await refreshCount();
  document.querySelectorAll('.tab').forEach(button => button.onclick = run(async () => {
    if (button.dataset.page !== 'shoot') stopCamera();
    document.querySelectorAll('.page').forEach(page => page.hidden = page.id !== button.dataset.page);
    document.querySelectorAll('.tab').forEach(tab => { tab.classList.toggle('active', tab === button); tab.setAttribute('aria-pressed', String(tab === button)); });
    if (button.dataset.page === 'library') await gallery();
  }));
  $('site-form').onsubmit = run(async event => {
    event.preventDefault(); const name = $('new-site').value.trim(); if (!name) return;
    if (settings.sites.some(s => s.name === name)) throw new Error('同じ地点名が登録されています。');
    const id = crypto.randomUUID(); await updateSettings({...settings, sites: [...settings.sites, {id, name}], selectedSite: id}); $('new-site').value = ''; fillSites(); render(); status('地点を登録しました。撮影画面で使用できます。');
  });
  $('update-items').onclick = run(async () => {
    const items = [...new Set($('items').value.split('\n').map(s => s.trim()).filter(Boolean))];
    if (items.some(s => s.length > 60)) throw new Error('写真項目は各60文字以内です。');
    await updateSettings({...settings, items}); fillItems(); render(); status('写真項目を保存しました。');
  });
  for (const id of ['site', 'work', 'item', 'theme', 'position', 'size', 'date-mode', 'manual-date']) $(id).addEventListener('input', render);
  for (const id of ['site','work','theme','position','size','date-mode']) $(id).addEventListener('change', run(async () => {
    await updateSettings({...settings, selectedSite: $('site').value, work: $('work').value, theme: $('theme').value, position: $('position').value, size: $('size').value, dateMode: $('date-mode').value});
  }));
  $('camera').onchange = run(loadPhoto); $('import').onchange = run(loadPhoto); $('save').onclick = run(savePhoto);
  $('start-camera').onclick = run(startCamera); $('capture').onclick = run(captureLive); $('stop-camera').onclick = () => { stopCamera(); status('カメラを閉じました。'); };
  $('live-video').addEventListener('resize', renderLiveBoard);
  document.addEventListener('visibilitychange', () => { if (document.hidden) stopCamera(); });
  window.addEventListener('pagehide', stopCamera);
  $('persist').onclick = run(async () => status(await navigator.storage?.persist?.() ? 'データ保持が許可されました。PCへの書き出しも続けてください。' : '保持の保証はありません。こまめにPCへ書き出してください。'));
  render();
  if ('serviceWorker' in navigator && window.isSecureContext) {
    try {
      const registration = await navigator.serviceWorker.register('./sw.js');
      let updating = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => { if (updating) location.reload(); });
      const showUpdate = () => { if (registration.waiting) $('update-app').hidden = false; };
      showUpdate();
      registration.addEventListener('updatefound', () => { registration.installing?.addEventListener('statechange', showUpdate); });
      $('update-app').onclick = () => {
        if (current || busy || cameraOpening) { status('未保存の写真があります。先に写真を保存してから更新してください。', true); return; }
        if (!registration.waiting) return;
        stopCamera(); updating = true; registration.waiting.postMessage('SKIP_WAITING');
      };
      await navigator.serviceWorker.ready;
      $('offline').textContent = '準備済み（この端末で実機確認してください）';
    } catch { $('offline').textContent = '準備に失敗。通信状態で再読み込みしてください'; }
  } else $('offline').textContent = 'HTTPSでのアクセスが必要です';
}
run(init)();
