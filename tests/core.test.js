import test from 'node:test';
import assert from 'node:assert/strict';
import {safeName, fileStem, localDate, boardRect, displayDate} from '../core.js';

test('Windows filenames cannot introduce paths or delimiter collisions', () => {
  assert.equal(safeName('白上川 1K4R'), '白上川1K4R');
  assert.equal(safeName('A/B\\C:*?"<>|__.'), 'A-B-C--------');
  assert.equal(safeName(''), '未設定');
  const long = fileStem({date:'20261027',site:'現'.repeat(60),item:'景'.repeat(60),deviceId:'12345678',id:'12345678-1234-1234-1234-123456789012'}) + '__original.jpeg';
  assert.ok(new TextEncoder().encode(long).length < 255);
});
test('name includes device and unique photo id to distinguish cameras', () => {
  const photo = {date: '20261027', site:'白上川 1K4R', item:'全景', deviceId:'a', id:'one'};
  assert.equal(fileStem(photo), '20261027__白上川1K4R__全景__a__one');
  assert.notEqual(fileStem(photo), fileStem({...photo, deviceId:'b'}));
  assert.notEqual(fileStem(photo), fileStem({...photo, id:'two'}));
});
test('board fits landscape and portrait in all four corners', () => {
  for (const [w,h] of [[4032,3024],[3024,4032],[4000,1000]]) for (const p of ['top-left','top-right','bottom-left','bottom-right']) {
    const rect = boardRect(w,h,65,p);
    assert.ok(rect.x >= 0 && rect.y >= 0 && rect.x + rect.w <= w && rect.y + rect.h <= h);
  }
});
test('date display respects none and date only', () => {
  assert.equal(localDate(new Date(2026,9,27)), '20261027');
  assert.equal(displayDate('none', '2026-10-27T14:20'), '');
  assert.equal(displayDate('date', '2026-10-27T14:20'), '2026-10-27');
  assert.equal(displayDate('datetime', '2026-10-27T14:20'), '2026-10-27 14:20');
});
test('custom board coordinates stay inside the photo and scale with it', () => {
  for (const [width,height] of [[4032,3024],[3024,4032],[4000,1000]]) for (const percent of [15,40,75]) {
    const rect=boardRect(width,height,percent,'bottom-left',{x:0.46,y:0.38});
    assert.ok(rect.x > 0 && rect.y > 0 && rect.x+rect.w < width && rect.y+rect.h < height);
    const left=boardRect(width,height,percent,'top-left',{x:-5,y:-2});
    const right=boardRect(width,height,percent,'bottom-right',{x:5,y:4});
    assert.equal(left.x,boardRect(width,height,percent,'top-left').x);
    assert.equal(right.x,boardRect(width,height,percent,'bottom-right').x);
    const scaled=boardRect(width/2,height/2,percent,'bottom-left',{x:0.46,y:0.38});
    assert.ok(Math.abs(scaled.x*2-rect.x) <= 2 && Math.abs(scaled.y*2-rect.y) <= 2);
  }
});
