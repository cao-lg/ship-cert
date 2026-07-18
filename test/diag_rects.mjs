import { readFileSync } from 'fs';
import { inflateSync } from 'zlib';

const path = process.argv[2];
const buf = readFileSync(path);
const s = buf.toString('latin1');

// 扫描所有 stream/endstream 块并 inflate
const reStream = /stream\r?\n([\s\S]*?)\r?\nendstream/g;
let m;
const rects = [];
while ((m = reStream.exec(s))) {
  const raw = Buffer.from(m[1].replace(/^\r?\n/, '').replace(/\r?\n$/, ''), 'latin1');
  let dec;
  try { dec = inflateSync(raw); } catch (e) { continue; }
  const txt = dec.toString('latin1');
  const reOp = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re/g;
  let rm;
  while ((rm = reOp.exec(txt))) {
    rects.push({ x: +rm[1], y: +rm[2], w: +rm[3], h: +rm[4] });
  }
}
console.log('Total rectangles found:', rects.length);
// 按页近似分组: 我不能精确分页数, 但输出全部
const visible = rects.filter(r => r.x >= 0 && r.x <= 620 && r.y >= 0 && r.y <= 860 && r.w > 0 && r.h > 0);
console.log('Visible (A4 range):', visible.length);
visible.forEach((r, i) => console.log('  #' + (i + 1) + ' x=' + r.x.toFixed(1) + ' y=' + r.y.toFixed(1) + ' w=' + r.w.toFixed(1) + ' h=' + r.h.toFixed(1) +
  '  [right=' + (r.x + r.w).toFixed(1) + ' top=' + (r.y + r.h).toFixed(1) + ']'));
if (rects.length !== visible.length) {
  console.log('\nOut-of-range rects:');
  rects.filter(r => !(r.x >= 0 && r.x <= 620 && r.y >= 0 && r.y <= 860 && r.w > 0 && r.h > 0))
    .forEach(r => console.log('  x=' + r.x.toFixed(1) + ' y=' + r.y.toFixed(1) + ' w=' + r.w.toFixed(1) + ' h=' + r.h.toFixed(1)));
}
