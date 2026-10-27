const utf8 = new TextEncoder();
const ascii = text => utf8.encode(text + '\0');
function utf16(text) {
  const bytes=new Uint8Array((text.length+1)*2), view=new DataView(bytes.buffer);
  for (let i=0;i<text.length;i++) view.setUint16(i*2,text.charCodeAt(i),true);
  return bytes;
}
const short = value => {const b=new Uint8Array(2);new DataView(b.buffer).setUint16(0,value,true);return b;};
const long = value => {const b=new Uint8Array(4);new DataView(b.buffer).setUint32(0,value,true);return b;};
function rationals(values) {
  const bytes=new Uint8Array(values.length*8), v=new DataView(bytes.buffer);
  values.forEach(([n,d],i)=>{v.setUint32(i*8,n,true);v.setUint32(i*8+4,d,true);});return bytes;
}
function stamp(iso,offset=0) {
  const date=new Date(iso);if (!Number.isFinite(date.getTime())) return null;
  const validOffset=Number.isFinite(offset) ? offset : 0;
  const shifted=new Date(date.getTime()-validOffset*60000).toISOString();
  const abs=Math.abs(validOffset), zone=`${validOffset>0?'-':'+'}${String(Math.floor(abs/60)).padStart(2,'0')}:${String(abs%60).padStart(2,'0')}`;
  return {date:shifted.slice(0,19).replaceAll('-',':').replace('T',' '),zone,sub:shifted.slice(20,23)};
}
export function validGPS(gps) {
  return !!gps && Number.isFinite(gps.latitude) && Math.abs(gps.latitude)<=90 && Number.isFinite(gps.longitude) && Math.abs(gps.longitude)<=180 && Number.isFinite(gps.accuracy) && gps.accuracy>=0;
}
function degrees(value) {
  const units=Math.round(Math.abs(value)*3600*10000000),d=Math.floor(units/36000000000),remaining=units-d*36000000000,m=Math.floor(remaining/600000000);
  return rationals([[d,1],[m,1],[remaining-m*600000000,10000000]]);
}
function exifPayload(metadata) {
  const root=[], exif=[], gps=[];
  const add=(list,tag,type,data,count)=>list.push({tag,type,data,count:count ?? data.length});
  add(root,0x010e,2,ascii('Genba photo; work metadata is in Exif UserComment and Windows XP properties.'));
  add(root,0x0112,3,short(1),1);
  const saved=stamp(metadata.savedAt,metadata.timeZoneOffsetMinutes);
  const captured=metadata.capturedAt ? stamp(metadata.capturedAt,metadata.captureTimeZoneOffsetMinutes ?? metadata.timeZoneOffsetMinutes) : null;
  if (saved) {add(root,0x0132,2,ascii(saved.date));add(exif,0x9004,2,ascii(saved.date));add(exif,0x9010,2,ascii(saved.zone));add(exif,0x9012,2,ascii(saved.zone));}
  add(root,0x0131,2,ascii('Genba Photo'));
  add(root,0x9c9b,1,utf16(metadata.site || ''));
  add(root,0x9c9f,1,utf16([metadata.work,metadata.item].filter(Boolean).join(' / ')));
  add(root,0x9c9e,1,utf16([metadata.site,metadata.work,metadata.item].filter(Boolean).join(';')));
  const note=[`地点: ${metadata.site || ''}`,`工種: ${metadata.work || ''}`,`写真項目: ${metadata.item || ''}`,`撮影日時: ${metadata.capturedAt || '未取得'}`,`取込日時: ${metadata.importedAt || ''}`,`黒板表示日時: ${metadata.boardDate || ''}`];
  if (validGPS(metadata.gps)) note.push(`GPS: ${metadata.gps.latitude}, ${metadata.gps.longitude} (精度 ${metadata.gps.accuracy}m)`);
  add(root,0x9c9c,1,utf16(note.join('\n')));
  add(exif,0x9000,7,utf8.encode('0232'));
  if (captured) {add(exif,0x9003,2,ascii(captured.date));add(exif,0x9011,2,ascii(captured.zone));add(exif,0x9291,2,ascii(captured.sub));}
  const json=JSON.stringify({application:'genba-photo',embeddedSchemaVersion:1,metadata}).replace(/[\u007f-\uffff]/g,char=>'\\u'+char.charCodeAt(0).toString(16).padStart(4,'0'));
  add(exif,0x9286,7,utf8.encode('ASCII\0\0\0'+json));
  if (Number.isFinite(metadata.width)) add(exif,0xa002,4,long(metadata.width),1);
  if (Number.isFinite(metadata.height)) add(exif,0xa003,4,long(metadata.height),1);
  add(root,0x8769,4,long(0),1); // Exif IFD pointer, patched below.
  if (metadata.gps !== null && metadata.gps !== undefined && !validGPS(metadata.gps)) throw new Error('GPS座標が不正です。');
  if (validGPS(metadata.gps)) {
    const g=metadata.gps;
    add(gps,0,1,new Uint8Array([2,3,0,0]));add(gps,1,2,ascii(g.latitude<0?'S':'N'));add(gps,2,5,degrees(g.latitude),3);
    add(gps,3,2,ascii(g.longitude<0?'W':'E'));add(gps,4,5,degrees(g.longitude),3);
    if (Number.isFinite(g.altitude) && Math.abs(g.altitude)<100000) {add(gps,5,1,new Uint8Array([g.altitude<0?1:0]));add(gps,6,5,rationals([[Math.round(Math.abs(g.altitude)*1000),1000]]),1);}
    if (g.accuracy<1000000) add(gps,0x1f,5,rationals([[Math.round(g.accuracy*1000),1000]]),1);
    const measured=new Date(g.recordedAt);
    if (Number.isFinite(measured.getTime())) {
      add(gps,7,5,rationals([[measured.getUTCHours(),1],[measured.getUTCMinutes(),1],[measured.getUTCSeconds()*1000+measured.getUTCMilliseconds(),1000]]),3);
      add(gps,0x1d,2,ascii(measured.toISOString().slice(0,10).replaceAll('-',':')));
    }
    add(root,0x8825,4,long(0),1);
  }
  const lists=[root,exif,...(gps.length?[gps]:[])];let offset=8;
  const locations=lists.map(list=>{list.sort((a,b)=>a.tag-b.tag);const value=offset;offset+=2+list.length*12+4;return value;});
  root.find(e=>e.tag===0x8769).data=long(locations[1]);
  if (gps.length) root.find(e=>e.tag===0x8825).data=long(locations[2]);
  let dataOffset=offset;
  for (const list of lists) for (const entry of list) if (entry.data.length>4) {entry.offset=dataOffset;dataOffset+=entry.data.length+(entry.data.length%2);}
  if (dataOffset+6>65533) throw new Error('JPEGに入れる管理情報が大きすぎます。');
  const tiff=new Uint8Array(dataOffset), v=new DataView(tiff.buffer);tiff.set([73,73]);v.setUint16(2,42,true);v.setUint32(4,8,true);
  lists.forEach((list,index)=>{const start=locations[index];v.setUint16(start,list.length,true);list.forEach((entry,i)=>{
    const p=start+2+i*12;v.setUint16(p,entry.tag,true);v.setUint16(p+2,entry.type,true);v.setUint32(p+4,entry.count,true);
    if (entry.data.length<=4) tiff.set(entry.data,p+8);else {v.setUint32(p+8,entry.offset,true);tiff.set(entry.data,entry.offset);}
  });});
  return new Blob([new Uint8Array([69,120,105,102,0,0]),tiff]);
}
async function jpegParts(jpeg) {
  const first=new Uint8Array(await jpeg.slice(0,2).arrayBuffer());
  if (first[0]!==255 || first[1]!==216) throw new Error('黒板付き画像がJPEGではありません。');
  const segments=[];let offset=2;
  while (offset<jpeg.size) {
    const bytes=new Uint8Array(await jpeg.slice(offset,offset+10).arrayBuffer());
    if (bytes[0]!==255) throw new Error('JPEGの構造が不正です。');
    if (bytes[1]===255) {segments.push({blob:jpeg.slice(offset,offset+1)});offset++;continue;}
    if (bytes[1]===0xda || bytes[1]===0xd9) {segments.push({blob:jpeg.slice(offset)});return segments;}
    const length=bytes[2]*256+bytes[3];
    if (length<2 || offset+length+2>jpeg.size) throw new Error('JPEGの長さが不正です。');
    const isExif=bytes[1]===0xe1 && length>=8 && bytes.length>=10 && bytes.slice(4,10).every((byte,i)=>byte===[69,120,105,102,0,0][i]);
    segments.push({blob:jpeg.slice(offset,offset+length+2),isExif});offset+=length+2;
  }
  throw new Error('JPEGの画像データがありません。');
}
export async function embedJpegMetadata(jpeg,metadata) {
  const parts=await jpegParts(jpeg), payload=exifPayload(metadata), head=new Uint8Array(4);
  head.set([255,225]);new DataView(head.buffer).setUint16(2,payload.size+2,false);
  // Replace only the composite's Exif. The original file is never passed here.
  return new Blob([jpeg.slice(0,2),head,payload,...parts.filter(part=>!part.isExif).map(part=>part.blob)],{type:'image/jpeg'});
}
export async function readJpegMetadata(jpeg) {
  for (const part of await jpegParts(jpeg)) if (part.isExif) {
    const bytes=new Uint8Array(await part.blob.slice(10).arrayBuffer()), v=new DataView(bytes.buffer);
    const le=bytes[0]===73 && bytes[1]===73;
    if (!le && !(bytes[0]===77 && bytes[1]===77)) continue;
    const find=(start,tag)=>{
      if (start+2>bytes.length) return null;
      const count=v.getUint16(start,le);if (count>1000 || start+2+count*12+4>bytes.length) return null;
      for (let i=0;i<count;i++) {const p=start+2+i*12;if (v.getUint16(p,le)===tag) return p;}return null;
    };
    if (bytes.length<8 || v.getUint16(2,le)!==42) continue;
    const pointer=find(v.getUint32(4,le),0x8769);if (pointer===null) continue;
    const comment=find(v.getUint32(pointer+8,le),0x9286);if (comment===null) continue;
    const count=v.getUint32(comment+4,le), start=count<=4 ? comment+8 : v.getUint32(comment+8,le);
    if (start+count>bytes.length || count<8) continue;
    try {
      const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes.slice(start,start+count));
      if (!text.startsWith('ASCII\0\0\0')) continue;
      const value=JSON.parse(text.slice(8));if (value.application==='genba-photo' && value.embeddedSchemaVersion===1 && value.metadata && typeof value.metadata==='object') return value.metadata;
    } catch {}
  }
  return null;
}
