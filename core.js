export function safeName(value) {
  const clean = value.normalize('NFC').replace(/[\u0000-\u001f<>:"/\\|?*]/g, '-').replace(/\s+/g, '').replace(/_+/g, '-');
  let name = '';
  for (const char of clean) {
    if (new TextEncoder().encode(name + char).length > 60 || [...name].length >= 48) break;
    name += char;
  }
  return name.replace(/[. ]+$/g, '') || '未設定';
}

export function localDate(date = new Date()) {
  return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
}

export function fileStem({date, site, item, deviceId, id}) {
  return [date, safeName(site), safeName(item), deviceId, id].join('__');
}

export function boardRect(width, height, percent, position) {
  const w = Math.round(Math.min(width * percent / 100, height * 0.95));
  const h = Math.round(w * 0.64);
  const gap = Math.max(8, Math.round(Math.min(width, height) * 0.018));
  return {x: position.endsWith('right') ? width - w - gap : gap,
    y: position.startsWith('top') ? gap : height - h - gap, w, h};
}

export function displayDate(mode, value) {
  if (mode === 'none') return '';
  return value.replace('T', ' ').slice(0, mode === 'date' ? 10 : 16);
}
