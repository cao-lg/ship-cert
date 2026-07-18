// 全页 CTM 追踪: 计算每个页面内容流执行结束时的"最终 CTM"(我的附加框将继承该 CTM),
// 以便用逆矩阵归零, 让框落在绝对页面坐标系(与 pdf.js 文字坐标一致)。
import { readFileSync } from "node:fs";
import zlib from "node:zlib";
import { PDFDocument, PDFName, PDFArray } from "pdf-lib";

const FILES = process.argv[2]
  ? [process.argv[2]]
  : [
      "D:/workbuddy/2026-07-16-18-55-51/船舶证书标注合并-测试.pdf",
      "D:/workbuddy/2026-07-16-18-55-51/2.船舶证书-古弗尼尔-标注.pdf",
      "D:/workbuddy/2026-07-16-18-55-51/古弗尼尔-12页-文字层.pdf",
    ];

const dec = new TextDecoder("latin1");

// 完整追踪一段内容流的图形 CTM(只关心 cm 与 q/Q; 文本矩阵不影响路径绘制)
function finalCTMOf(str) {
  const t = str.replace(/\r/g, " ").split(/\s+/).filter(Boolean);
  let a = 1, b = 0, c = 0, d = 1, e = 0, f = 0;
  const stack = [];
  let i = 0;
  while (i < t.length) {
    const op = t[i];
    if (op === "q") { stack.push([a, b, c, d, e, f]); i++; continue; }
    if (op === "Q") { if (stack.length) [a, b, c, d, e, f] = stack.pop(); i++; continue; }
    if (op === "cm") {
      const ma = +t[i - 6], mb = +t[i - 5], mc = +t[i - 4], md = +t[i - 3], me = +t[i - 2], mf = +t[i - 1];
      const na = a * ma + c * mb, nb = b * ma + d * mb;
      const nc = a * mc + c * md, nd = b * mc + d * md;
      const ne = a * me + c * mf + e, nf = b * me + d * mf + f;
      a = na; b = nb; c = nc; d = nd; e = ne; f = nf;
      i++; continue;
    }
    i++;
  }
  return [a, b, c, d, e, f];
}

for (const FILE of FILES) {
  let bytes;
  try { bytes = new Uint8Array(readFileSync(FILE)); } catch { console.log("skip (missing):", FILE); continue; }
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  console.log(`\n########## ${FILE.split("/").pop()}  pages=${pages.length} ##########`);
  for (let p = 0; p < pages.length; p++) {
    const pg = pages[p];
    const pw = pg.getWidth(), ph = pg.getHeight();
    const contents = pg.node.Contents();
    const refs = [];
    if (contents instanceof PDFArray) for (let k = 0; k < contents.size(); k++) refs.push(contents.get(k));
    else if (contents) refs.push(contents);
    let concatenated = "";
    for (const ref of refs) {
      const stream = doc.context.lookup(ref);
      let raw;
      try {
        const comp = stream.getContents();
        try { raw = zlib.inflateSync(Buffer.from(comp)); } catch { raw = comp; }
      } catch { continue; }
      concatenated += " " + dec.decode(raw);
    }
    const fctm = finalCTMOf(concatenated);
    const isIdentity = fctm.every((v, i) => Math.abs(v - [1, 0, 0, 1, 0, 0][i]) < 1e-6);
    const ann = pg.node.lookupMaybe(PDFName.of("Annots"), PDFArray);
    console.log(
      `  p${String(p + 1).padStart(2)} size=${pw.toFixed(1)}x${ph.toFixed(1)} ` +
      `finalCTM=[${fctm.map((x) => +x.toFixed(3)).join(",")}] ${isIdentity ? "IDENTITY" : "<<NON-IDENTITY>>"} ` +
      `annots=${ann ? ann.size() : 0}`
    );
  }
}
