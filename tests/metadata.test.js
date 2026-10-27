import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile,mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {embedJpegMetadata,readJpegMetadata} from '../jpeg-metadata.js';
import {exportPhoto} from '../photo-export.js';

const fixture=new Uint8Array(await readFile(new URL('fixtures/pixel.jpg',import.meta.url)));
const metadata={schemaVersion:1,embeddedExifVersion:1,id:'photo-1',site:'白上川 1K4R 🏞',work:'水位計 定期点検',item:'盤面',width:16,height:12,capturedAt:'2026-10-27T03:04:05.123Z',savedAt:'2026-10-27T03:05:00Z',importedAt:'2026-10-27T03:04:05.123Z',boardDate:'2026-10-26T13:14',captureTimeZoneOffsetMinutes:-540,timeZoneOffsetMinutes:-540,gps:{latitude:35.681236,longitude:139.767125,accuracy:7.5,altitude:12.345,recordedAt:'2026-10-27T03:04:06Z'}};
function scan(bytes) {
  let offset=2;const parts=[];
  while (bytes[offset]===255) {
    if (bytes[offset+1]===0xda) return {parts,scan:bytes.slice(offset)};
    const length=bytes[offset+2]*256+bytes[offset+3];parts.push(bytes.slice(offset,offset+length+2));offset+=length+2;
  }
  throw new Error('invalid fixture');
}
test('Japanese metadata lives in the JPEG while encoded image scan and source bytes stay intact',async()=>{
  const source=new Blob([fixture],{type:'image/jpeg'}),output=await embedJpegMetadata(source,metadata);
  assert.deepEqual(await readJpegMetadata(output),metadata);
  assert.deepEqual(new Uint8Array(await source.arrayBuffer()),fixture);
  assert.deepEqual(scan(new Uint8Array(await output.arrayBuffer())).scan,scan(fixture).scan);
});
test('re-embedding replaces Exif once and retains unrelated JPEG segments',async()=>{
  const payload=new TextEncoder().encode('http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>test</x:xmpmeta>'),header=new Uint8Array([255,225,0,payload.length+2]);
  const source=new Blob([fixture.slice(0,2),header,payload,fixture.slice(2)],{type:'image/jpeg'});
  const first=await embedJpegMetadata(source,metadata),second=await embedJpegMetadata(first,{...metadata,site:'変更後'});
  const parsed=scan(new Uint8Array(await second.arrayBuffer()));
  assert.equal(parsed.parts.filter(part=>part[1]===225 && new TextDecoder().decode(part.slice(4,10))==='Exif\0\0').length,1);
  assert.ok(parsed.parts.some(part=>Buffer.from(part.slice(4)).equals(Buffer.from(payload))));
  assert.equal((await readJpegMetadata(second)).site,'変更後');
});
test('old photos receive metadata in exported copies without changing their saved Blob',async()=>{
  const old={metadata:{...metadata,embeddedExifVersion:undefined},composed:new Blob([fixture],{type:'image/jpeg'}),original:new Blob(['original'])};
  const exported=await exportPhoto(old);
  assert.equal(await readJpegMetadata(old.composed),null);
  assert.equal((await readJpegMetadata(exported.composed)).site,metadata.site);
  assert.equal(exported.original,old.original);
});
test('standard-library Python reader extracts metadata from the JPEG alone',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'genba-exif-'));
  try {
    const file=join(directory,'photo.jpg');await writeFile(file,Buffer.from(await (await embedJpegMetadata(new Blob([fixture]),metadata)).arrayBuffer()));
    const result=spawnSync('python3',['tools/read_photo_metadata.py',file,'--json'],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.deepEqual(JSON.parse(result.stdout),metadata);
  } finally {await rm(directory,{recursive:true,force:true});}
});
const pillow=spawnSync('python3',['-c','import PIL'],{stdio:'ignore'}).status===0;
test('independent Pillow reads Windows properties, real capture date, offset and standard GPS tags',{skip:!pillow},async()=>{
  const output=await embedJpegMetadata(new Blob([fixture]),metadata);
  const result=spawnSync('python3',['-c',`import io,sys,json
from PIL import Image
i=Image.open(io.BytesIO(sys.stdin.buffer.read()));i.load()
assert i.size==(16,12)
e=i.getexif()
assert bytes(e[0x9c9b]).decode('utf-16-le').rstrip('\\0')=='白上川 1K4R 🏞'
assert '水位計' in bytes(e[0x9c9f]).decode('utf-16-le')
x=e.get_ifd(0x8769)
assert x[0x9003]=='2026:10:27 12:04:05'
assert x[0x9011]=='+09:00'
m=json.loads(x[0x9286][8:])
assert m['metadata']['boardDate']=='2026-10-26T13:14'
g=e.get_ifd(0x8825)
lat=sum(float(v)/d for v,d in zip(g[2],[1,60,3600]));lon=sum(float(v)/d for v,d in zip(g[4],[1,60,3600]))
assert abs(lat-35.681236)<1e-7 and abs(lon-139.767125)<1e-7
assert g[1]=='N' and g[3]=='E'
assert abs(float(g[0x1f])-7.5)<1e-6
print('Standard Exif interoperability verified')`],{input:Buffer.from(await output.arrayBuffer()),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
test('unknown capture time does not become a fabricated DateTimeOriginal and GPS off has no GPS IFD',{skip:!pillow},async()=>{
  const output=await embedJpegMetadata(new Blob([fixture]),{...metadata,capturedAt:null,gps:null});
  const result=spawnSync('python3',['-c',`import io,sys
from PIL import Image
e=Image.open(io.BytesIO(sys.stdin.buffer.read())).getexif()
assert 0x9003 not in e.get_ifd(0x8769)
assert 0x8825 not in e
assert 0x132 in e`],{input:Buffer.from(await output.arrayBuffer()),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);
});
