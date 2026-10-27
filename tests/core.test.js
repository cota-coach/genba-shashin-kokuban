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
