import {safeName} from './core.js';

const encoder = new TextEncoder();
const CRC_TABLE = Uint32Array.from({length:256}, (_, n) => {
  for (let bit=0; bit<8; bit++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
export function crc32(bytes, previous = 0) {
  let crc = (previous ^ 0xffffffff) >>> 0;
  for (const byte of bytes) crc = CRC_TABLE[(crc ^ byte) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
export const MAX_ARCHIVE_BYTES = 250 * 1024 * 1024;
function validDay(value) {
  if (typeof value !== 'string' || !/^\d{8}$/.test(value)) return false;
  const date = new Date(`${value.slice(0,4)}-${value.slice(4,6)}-${value.slice(6,8)}T12:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10).replaceAll('-','') === value;
}
export function photoDay(metadata) {
  if (validDay(metadata.recordedDate)) return metadata.recordedDate;
  const prefix = metadata.composedFile?.slice(0,8);
  return validDay(prefix) ? prefix : '日付不明';
}
export function dayLabel(day) {
  return validDay(day) ? `${day.slice(0,4)}/${day.slice(4,6)}/${day.slice(6,8)}` : '日付不明';
}
export function groupPhotos(photos) {
  const days = new Map();
  for (const photo of photos) {
    const day=photoDay(photo.metadata), site=photo.metadata.site || '地点未設定';
    if (!days.has(day)) days.set(day,new Map());
    if (!days.get(day).has(site)) days.get(day).set(site,[]);
    days.get(day).get(site).push(photo);
  }
  return [...days].sort(([a],[b]) => a === b ? 0 : a === '日付不明' ? 1 : b === '日付不明' ? -1 : b.localeCompare(a)).map(([day,sites]) => ({day,sites:[...sites].sort(([a],[b])=>a.localeCompare(b,'ja')).map(([site,photos])=>({site,photos:photos.sort((a,b)=>(b.metadata.savedAt || '').localeCompare(a.metadata.savedAt || ''))}))}));
}
function safeZipPath(path) {
  if (typeof path !== 'string' || !path || /[\\\u0000-\u001f<>:"|?*]/.test(path) || path.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('書き出し先のファイル名が不正です。');
  const bytes=encoder.encode(path);
  if (bytes.length > 65535) throw new Error('書き出し先のパスが長すぎます。');
  return bytes;
}
function header(size) { const bytes=new Uint8Array(size); return {bytes, view:new DataView(bytes.buffer)}; }
function dosTime(date) {
  if (!Number.isFinite(date.getTime()) || date.getFullYear()<1980 || date.getFullYear()>2107) date=new Date(2026,0,1);
  return {time:(date.getHours()<<11)|(date.getMinutes()<<5)|(date.getSeconds()>>1),date:((date.getFullYear()-1980)<<9)|((date.getMonth()+1)<<5)|date.getDate()};
}
// ZIP STORE: photos are already compressed. Stream CRC calculation and retain Blob
// references rather than building one giant in-memory image byte array.
export async function makeZip(entries, {onProgress=()=>{}, maxBytes=MAX_ARCHIVE_BYTES} = {}) {
  if (entries.length > 65535) throw new Error('ファイル数が多すぎます。地点単位で書き出してください。');
  const names=new Set();
  let total=22;
  const normalized=entries.map(entry => {
    const name=safeZipPath(entry.path), key=entry.path.normalize('NFC').toLowerCase();
    if (names.has(key)) throw new Error('同じ書き出しファイル名があります。上書きを避けるため中止しました。');
    names.add(key);
    if (!(entry.blob instanceof Blob)) throw new Error('書き出す写真データが見つかりません。');
    total += entry.blob.size+76+name.length*2;
    return {...entry,name};
  });
  if (total > maxBytes || total >= 0xffffffff) throw new Error('ZIPが250MBを超えるため、地点単位に分けて書き出してください。');
  const parts=[], central=[]; let offset=0;
  for (const [index,entry] of normalized.entries()) {
    let crc=0; const reader=entry.blob.stream().getReader();
    try { while (true) { const {value,done}=await reader.read(); if (done) break; crc=crc32(value,crc); } }
    finally { reader.releaseLock(); }
    const stamp=dosTime(new Date(entry.savedAt || Date.now())), length=entry.blob.size;
    const local=header(30), v=local.view;
    v.setUint32(0,0x04034b50,true);v.setUint16(4,20,true);v.setUint16(6,0x0800,true);
    v.setUint16(10,stamp.time,true);v.setUint16(12,stamp.date,true);v.setUint32(14,crc,true);
    v.setUint32(18,length,true);v.setUint32(22,length,true);v.setUint16(26,entry.name.length,true);
    parts.push(local.bytes,entry.name,entry.blob);
    const directory=header(46), d=directory.view;
    d.setUint32(0,0x02014b50,true);d.setUint16(4,20,true);d.setUint16(6,20,true);d.setUint16(8,0x0800,true);
    d.setUint16(12,stamp.time,true);d.setUint16(14,stamp.date,true);d.setUint32(16,crc,true);
    d.setUint32(20,length,true);d.setUint32(24,length,true);d.setUint16(28,entry.name.length,true);d.setUint32(42,offset,true);
    central.push(directory.bytes,entry.name);offset+=30+entry.name.length+length;
    onProgress(index+1,normalized.length);
    await new Promise(resolve=>setTimeout(resolve,0));
  }
  const centralSize=central.reduce((size,part)=>size+part.byteLength,0), end=header(22), e=end.view;
  e.setUint32(0,0x06054b50,true);e.setUint16(8,normalized.length,true);e.setUint16(10,normalized.length,true);
  e.setUint32(12,centralSize,true);e.setUint32(16,offset,true);
  return new Blob([...parts,...central,end.bytes],{type:'application/zip'});
}
export function archiveEntries(photos, exportedAt=new Date().toISOString()) {
  const entries=[], manifest={schemaVersion:1,exportedAt,photoCount:photos.length,photos:[]}, usedFolders=new Map();
  if (!photos.length) throw new Error('書き出す写真がありません。');
  for (const group of groupPhotos(photos)) for (const {site,photos:sitePhotos} of group.sites) {
    // Stable suffix keeps similarly sanitized names distinct across day/site exports.
    const suffix=crc32(encoder.encode(site)).toString(16).padStart(8,'0');
    const candidate=`${safeName(site)}_${suffix}`;
    let folder=candidate, number=1;
    while (usedFolders.has(folder.toLowerCase()) && usedFolders.get(folder.toLowerCase())!==site) folder=`${candidate}_${++number}`;
    usedFolders.set(folder.toLowerCase(),site);
    for (const photo of sitePhotos) {
      const m=photo.metadata, root=`${group.day}/${folder}`;
      for (const name of [m.composedFile,m.originalFile,m.metadataFile]) {
        if (typeof name !== 'string' || name.includes('/') || name.includes('\\')) throw new Error('写真の管理ファイル名が不正です。');
      }
      const composedPath=`${root}/${m.composedFile}`, originalPath=`${root}/原本/${m.originalFile}`, metadataPath=`${root}/管理情報/${m.metadataFile}`;
      entries.push({path:composedPath,blob:photo.composed,savedAt:m.savedAt},{path:originalPath,blob:photo.original,savedAt:m.savedAt},{path:metadataPath,blob:new Blob([JSON.stringify(m,null,2)],{type:'application/json'}),savedAt:m.savedAt});
      manifest.photos.push({id:m.id,day:group.day,site:m.site,work:m.work,item:m.item,composedPath,originalPath,metadataPath});
    }
  }
  entries.push({path:'書き出し一覧.json',blob:new Blob([JSON.stringify(manifest,null,2)],{type:'application/json'})});
  return entries;
}
export async function photoArchive(photos, options) { return makeZip(archiveEntries(photos),options); }
