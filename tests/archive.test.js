import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {crc32,makeZip,photoArchive,archiveEntries,photoDay,groupPhotos} from '../archive.js';

const encoder=new TextEncoder();
function photo(id,site='白上川 1K4R',day='20261027') {
  const stem=`${day}__地点__全景__device__${id}`;
  return {id,metadata:{id,site,work:'水位計定期点検',item:'全景',savedAt:'2026-10-27T03:00:00Z',originalFile:`${stem}__original.png`,composedFile:`${stem}__board.jpg`,metadataFile:`${stem}.json`},original:new Blob(['original-'+id]),composed:new Blob(['composed-'+id])};
}
test('CRC matches the standard and can be calculated incrementally',()=>{
  assert.equal(crc32(encoder.encode('123456789')),0xcbf43926);
  assert.equal(crc32(encoder.encode('56789'),crc32(encoder.encode('1234'))),0xcbf43926);
});
test('existing names and new recorded dates group into days and exact site names',()=>{
  assert.equal(photoDay(photo('a').metadata),'20261027');
  assert.equal(photoDay({...photo('a').metadata,recordedDate:'20261026'}),'20261026');
  assert.equal(photoDay({recordedDate:'20260231',composedFile:'broken.jpg'}),'日付不明');
  const groups=groupPhotos([photo('1'),photo('2'),photo('3','白上川 0K8L'),photo('4','白上川 1K4R','20261026')]);
  assert.equal(groups.length,2);assert.equal(groups[0].day,'20261027');assert.equal(groups[0].sites.length,2);
  assert.equal(groups[0].sites.find(site=>site.site==='白上川 1K4R').photos.length,2);
});
test('archive round trips through Python zipfile with Japanese folders and exact original bytes',async()=>{
  const photos=[photo('1'),photo('2'),photo('3','A/B'),photo('4','A\\B')];
  const progress=[];const zip=await photoArchive(photos,{onProgress:(done,total)=>progress.push([done,total])});
  const program=`import sys,io,json,zipfile
z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))
assert z.testzip() is None
assert len(z.namelist())==13
m=json.loads(z.read('書き出し一覧.json'))
assert m['photoCount']==4
for p in m['photos']:
 assert z.read(p['originalPath'])==('original-'+p['id']).encode()
 assert z.read(p['composedPath'])==('composed-'+p['id']).encode()
 metadata=json.loads(z.read(p['metadataPath']))
 assert metadata['site']==p['site']
 assert metadata['work']=='水位計定期点検'
assert len({p['composedPath'].rsplit('/',1)[0] for p in m['photos']})==3
assert all(i.flag_bits & 0x800 for i in z.infolist())
print('ZIP integrity, UTF-8 filenames, original bytes and metadata verified')`;
  const result=spawnSync('python3',['-c',program],{input:Buffer.from(await zip.arrayBuffer()),encoding:'utf8'});
  assert.equal(result.status,0,result.stderr);assert.deepEqual(progress.at(-1),[13,13]);
});
test('site-only exports keep the same folder identity as day exports',()=>{
  const a=photo('a','A/B'),b=photo('b','A\\B');
  const single=archiveEntries([a])[0].path,day=archiveEntries([a,b]);
  assert.ok(day.some(entry=>entry.path===single));
});
test('ZIP refuses unsafe/duplicate paths, missing photos and oversized output',async()=>{
  const blob=new Blob(['abc']);
  for (const path of ['../escape','/root','C:/root','a//b','a/../b','CON/file']) await assert.rejects(makeZip([{path,blob}]),/不正/);
  await assert.rejects(makeZip([{path:'file.jpg',blob},{path:'FILE.jpg',blob}]),/同じ/);
  await assert.rejects(makeZip([{path:'file.jpg',blob}],{maxBytes:1}),/250MB/);
  await assert.rejects(photoArchive([{...photo('x'),original:null}]),/見つかりません/);
  const bad=photo('x');bad.metadata.originalFile='../escape.jpg';assert.throws(()=>archiveEntries([bad]),/不正/);
});
test('all seven ZIP selections include exactly the selected file types',async()=>{
  for (let mask=1;mask<8;mask++) {
    const selection={composed:!!(mask&1),original:!!(mask&2),json:!!(mask&4)},entries=archiveEntries([photo('selection')],undefined,selection);
    assert.equal(entries.filter(e=>e.path.endsWith('__board.jpg')).length,selection.composed?1:0);
    assert.equal(entries.filter(e=>e.path.includes('/原本/')).length,selection.original?1:0);
    assert.equal(entries.filter(e=>e.path.endsWith('.json')).length,selection.json?2:0);
    const zip=await photoArchive([photo('selection')],{selection});assert.ok(zip.size>22);
  }
  await assert.rejects(photoArchive([photo('empty')],{selection:{composed:false,original:false,json:false}}),/1つ以上/);
});
