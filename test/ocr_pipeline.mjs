// 验证 OCR -> 画框 双保险流水线(不依赖网络):
// 1) ocrWordsToItems 坐标换算单元测试(真实 /scale + y翻转)
// 2) 合成"扫描版证书页"走 buildLines -> computeBoxes, 确认红框(过期)/蓝框(年检)出现
// 3) 尽力尝试真实 tesseract OCR(需联网+CDN), 成功则一并验证
import { ocrWordsToItems } from "../src/engine.js";
import { buildLines, computeBoxes } from "../src/engine.js";

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log(`  ✓ ${m}`); } else { fail++; console.log(`  ✗ ${m}`); } };

// ---- 1) 坐标换算 ----
const scale = 3;
const ws = [{ text: "2026", bbox: { x0: 300, y0: 690, x1: 360, y1: 710 } }];
const its = ocrWordsToItems(ws, scale);
ok(Math.abs(its[0].x0 - 100) < 1e-6, `x0 换算: ${its[0].x0} ≈ 100`);
ok(Math.abs(its[0].y - 710 / 3) < 1e-6, `y 换算(底边近似基线): ${its[0].y} ≈ ${(710/3).toFixed(2)}`);
ok(Math.abs(its[0].width - 20) < 1e-6, `width 换算: ${its[0].width} ≈ 20`);

// ---- 2) 合成扫描页: 构造与 getTextContent 同构的 items ----
function tok(str, x0, y, w = str.length * 7) { return { str, x0, y, width: w, height: 10 }; }
const items = [
  tok("INTERNATIONAL OIL POLLUTION PREVENTION CERTIFICATE", 40, 100, 520),
  tok("This certificate is valid until", 40, 200, 260),
  tok("18", 320, 230), tok("September", 348, 230), tok("2026", 410, 230),
  tok("Annual survey", 40, 400, 120),
  tok("19", 320, 430), tok("March", 348, 430), tok("2031", 400, 430),
];
const { lines } = buildLines(items);
const pages = [{ pno: 0, lines, libPage: null, SCALE: 1, pageHeight: 800 }];
const { boxes, red, blue } = computeBoxes(pages, "blue");
ok(red === 1, `红框(过期): ${red} === 1  ("valid until" -> 18 September 2026)`);
ok(blue === 1, `蓝框(年检): ${blue} === 1  ("Annual survey" -> 19 March 2031)`);
const reds = boxes.filter((b) => Math.abs(b.stroke[0] - 1) < 0.01).map((b) => b.group.iso);
ok(reds.includes("2026-09-18"), `红框日期正确: ${reds.join(", ")}`);

// ---- 3) 尽力真实 OCR(可选, 需联网) ----
console.log("\n[尝试] 真实 tesseract OCR(ocr-scan/page_01.png, 需联网+CDN)...");
try {
  const { readFileSync } = await import("fs");
  const { join } = await import("path");
  const Tesseract = (await import("https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm")).default;
  const buf = readFileSync("D:/workbuddy/2026-07-16-18-55-51/ship-cert-web/test/ocr-scan/page_01.png");
  const { data } = await Tesseract.recognize(buf, "eng+chi_sim", { logger: () => {} });
  const realItems = ocrWordsToItems(data.words, 3);
  const { lines: rl } = buildLines(realItems);
  const rp = [{ pno: 0, lines: rl, libPage: null, SCALE: 1, pageHeight: 1000 }];
  const rr = computeBoxes(rp, "blue");
  console.log(`  真实 OCR 词数=${data.words.length} -> 红框=${rr.red} 蓝框=${rr.blue}`);
  ok(data.words.length > 10, "真实 OCR 返回了有效词");
} catch (e) {
  console.log(`  (跳过真实OCR: ${e.message.slice(0, 80)})`);
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail ? 1 : 0);
