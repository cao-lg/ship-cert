// 船舶证书 PDF 标注与信息提取引擎(纯前端)。
// 逻辑对齐 Python 版 cert_tool.py: pdf.js 取文字与坐标, pdf-lib 画红/绿框并保存。
import * as pdfjsDefault from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";
import { KB, ANNUAL_COLORS, RED, RED_FILL } from "./kb.js";
import {
  MONTHS, isMonth, normToken, normSp, toIso, detectType, detectSociety,
  extractNumber, firstDateAfter, EXPIRY_PHRASES, ISSUE_PHRASES,
  UNIQUE_TITLES, TITLE_HEADS, cleanInvisible,
} from "./helpers.js";

// pdf.js 实例可注入(浏览器用主构建, Node 测试用 legacy 构建)
let PDFJS = pdfjsDefault;
export function configurePdfjs(lib) { PDFJS = lib; }

// ---------------------------------------------------------------- OCR 双保险
// 文字层稀疏的页面(扫描版PDF)用 pdf.js 渲染成图 + tesseract.js(OCR)识别,
// 把 OCR 出的词(含坐标)转成与 getTextContent 同构的 items, 喂回同一套画框流水线。
// OCR 引擎运行时从 CDN 动态加载(+/esm 已内联全部依赖), 不进构建产物;
// 加载失败(离线等)则静默降级为"仅文字层", 不影响其他 PDF 处理。
const OCR_SCALE = 3;            // 渲染分辨率倍数: 2~3 已足够清晰证书文字; 4 过于细腻且慢约 2 倍
const OCR_LANG = "eng";        // 默认仅英文(模型~10MB, 加载快); 含中文标签的证书在页面选"中英双语"(~30MB)
const MIN_MEANINGFUL_TOKENS = 12; // 一页若有≥12个"有意义"文字 token, 视为数字版(有可用文字层), 跳过 OCR
// 有意义 token: 去零宽/控制字符后长度≥2, 且含字母/数字/汉字(排除纯标点、孤立符号、乱码断字)
function countMeaningfulTokens(items) {
  let n = 0;
  for (const it of items) {
    const s = cleanInvisible(String(it.str || "")).trim();
    if (s.length >= 2 && /[A-Za-z0-9\u4e00-\u9fff]/.test(s)) n++;
  }
  return n;
}
// 该页是否已有"可用文字层":
//   1) 足够多有意义 token(数字版证书页通常几十~上百个);
//   2) 或已能直接抽到一个日期(说明文字层足以抽取, 无需 OCR);
//   3) 或已含证书标题关键词(如 CERTIFICATE/REGISTRY/证书, 标题页 token 少但有定性信号)。
// 三者皆否 → 视为扫描/无文字层页, 才走 OCR。
function pageHasUsableText(items) {
  if (countMeaningfulTokens(items) >= MIN_MEANINGFUL_TOKENS) return true;
  const joined = items.map((it) => normSp(String(it.str || ""))).join(" ");
  if (UNIQUE_TITLES.some(([kw]) => joined.includes(normSp(kw)))) return true;
  if (TITLE_HEADS.some(([k]) => joined.includes(normSp(k)))) return true;
  for (const it of items) {
    if (toIso(normToken(cleanInvisible(String(it.str || ""))))) return true;
  }
  return false;
}
const TESSERACT_ESM = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/+esm";
// 去掉所有空白(不转小写, 保留大小写供标题识别) — OCR 中文常拆成"有效 日期", 必须并拢。
// 同时做 NFKC(全角→半角) + 去零宽/控制字符, 处理 Tesseract 常见的全角数字/标点与隐藏字符。
const stripWs = (s) => cleanInvisible(String(s).normalize("NFKC")).replace(/\s+/g, "");
let _tesseractMod = null;
async function loadTesseract() {
  if (_tesseractMod) return _tesseractMod;
  const mod = await import(/* @vite-ignore */ TESSERACT_ESM);
  _tesseractMod = mod.default || mod;
  return _tesseractMod;
}

// 持久 OCR worker: 仅创建并初始化一次, 跨页面/跨文件共享; 语言包(wasm + 训练数据)只下载一次。
// 处理全部完成后由 terminateOcr() 释放。相比原先每页调用一次 Tesseract.recognize() 一次性 API
// (每次都重建 worker + 重新下载 ~20MB 中文语言包), 这是 OCR"加载慢/识别慢"的根因修复。
let _ocrWorker = null;
let _ocrWorkerLang = null;
export async function ensureOcrWorker(lang, onWarn) {
  const Tesseract = await loadTesseract();
  if (_ocrWorker && _ocrWorkerLang === lang) return _ocrWorker;
  if (_ocrWorker) { try { await _ocrWorker.terminate(); } catch { /* ignore */ } _ocrWorker = null; }
  if (onWarn) onWarn("  ⏳ OCR引擎初始化中(首次需联网下载语言包, 请稍候)…");
  _ocrWorker = await Tesseract.createWorker(lang, 1, {
    logger: (m) => {
      const pct = m.progress != null ? Math.round(m.progress * 100) : 0;
      if (m.status === "recognizing text") {
        if (onWarn) onWarn(`  OCR识别中 ${pct}%`);
      } else if (onWarn && (m.status === "loading language traineddata" || m.status === "initializing tesseract" || m.status === "loading tesseract core")) {
        if (pct) onWarn(`  OCR引擎加载中 ${pct}%`);
      }
    },
  });
  _ocrWorkerLang = lang;
  return _ocrWorker;
}
export function terminateOcr() {
  if (_ocrWorker) { try { _ocrWorker.terminate(); } catch { /* ignore */ } _ocrWorker = null; _ocrWorkerLang = null; }
}

// 把 tesseract 返回的 words(画布像素坐标)转成与 getTextContent 同构的 device-coord items。
// bbox 来自图像左上角; 除以 OCR_SCALE 得到与 pdf.js 文字层一致的设备坐标(原点左上, y 向下)。
// 关键: 每个词的文本先去空格(如"2026 - 09 - 18" → "2026-09-18", "有效 日期"两词拼接在行里再去空格),
//       这样日期解析与中文短语匹配都能命中。
export function ocrWordsToItems(words, scale) {
  const items = [];
  for (const w of words || []) {
    const b = w.bbox;
    if (!b || !w.text) continue;
    items.push({
      str: stripWs(w.text),
      x0: b.x0 / scale,
      y: b.y1 / scale,                 // 以词框底边近似基线(与 getTextContent transform[5] 同语义)
      width: (b.x1 - b.x0) / scale,
      height: (b.y1 - b.y0) / scale,
    });
  }
  return items;
}

// 浏览器端: 用 pdf.js 把页面渲染到 canvas, 灰度预处理后复用持久 worker 识别, 返回 device-coord items
// scale 可由页面传入(默认 OCR_SCALE), 越高越准但越慢
async function ocrPageItems(page, lang, onWarn, scale = OCR_SCALE) {
  if (typeof document === "undefined") return []; // Node 环境无 canvas, 跳过
  let worker;
  try {
    worker = await ensureOcrWorker(lang, onWarn);
  } catch (e) {
    if (onWarn) onWarn(`  ⚠️ OCR引擎加载失败(需联网首次加载): ${e.message}`);
    return [];
  }
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return [];
  await page.render({ canvasContext: ctx, viewport }).promise;
  // 灰度预处理: 去色降噪, 提升 tesseract 准确率(不阈值化, 避免彩色证书丢内容)
  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = d[i] * 0.299 + d[i + 1] * 0.587 + d[i + 2] * 0.114;
    d[i] = d[i + 1] = d[i + 2] = g;
  }
  ctx.putImageData(img, 0, 0);
  let data;
  try {
    ({ data } = await worker.recognize(canvas, {
      tessedit_pageseg_mode: 6,        // 假定为整齐的文本块(证书版式), 比默认 PSM 3 更稳
      preserve_interword_spaces: 0,   // 不保留词间空格, 配合下方行级去空格归一化
    }));
  } catch (e) {
    if (onWarn) onWarn(`  ⚠️ OCR识别失败: ${e.message}`);
    return [];
  }
  return ocrWordsToItems(data.words, scale);
}

const MONTH_ALT = Object.keys(MONTHS).join("|");

// ---------------------------------------------------------------- 页面解析
export function buildLines(items) {
  const sorted = [...items].sort((a, b) => a.y - b.y || a.x0 - b.x0);
  const lines = [];
  let cur = null, curY = null;
  for (const it of sorted) {
    if (cur === null || Math.abs(it.y - curY) > 4) {
      cur = []; curY = it.y; lines.push(cur);
    }
    cur.push(it);
  }
  const out = lines.map((arr) => {
    arr.sort((a, b) => a.x0 - b.x0);
    return {
      items: arr,
      text: arr.map((i) => i.str).join(" "),
      x0: Math.min(...arr.map((i) => i.x0)),
    };
  });
  return { lines: out, plainText: out.map((l) => l.text).join("\n") };
}

function detectTopHeading(lines, vpHeight) {
  const half = vpHeight * 0.5;
  const EN_HEAD = ["CERTIFICATE", "REGISTRY", "REGISTRATION"];
  const ZH_HEAD = ["证书", "登记", "执照"]; // 中文标题词(仅限页上半部, 避免正文误触发)
  for (const l of lines) {
    const yAvg = l.items.reduce((s, i) => s + i.y, 0) / l.items.length;
    if (yAvg > half) continue;
    const up = l.text.toUpperCase();
    // 英文标题: 含 CERTIFICATE 等且大写占比高
    if (EN_HEAD.some((k) => up.includes(k))) {
      const letters = [...l.text].filter((c) => /[A-Za-z]/.test(c));
      if (letters.length) {
        const upc = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
        if (upc / letters.length >= 0.7) {
          for (const [key, name] of TITLE_HEADS) if (up.includes(key)) return name;
        }
      }
    }
    // 中文/通用标题词: 中文无大小写之分, 直接命中(也覆盖 OCR 识别出的标题行)
    if (ZH_HEAD.some((k) => l.text.includes(k))) {
      const t = detectType(l.text);
      if (t) return t;
      for (const [key, name] of TITLE_HEADS) if (up.includes(key)) return name;
      return "证书";
    }
  }
  return null;
}

// 行内日期分组(支持 ISO / DD Mon YYYY / Mon DD YYYY / 中文)
export function findDateGroups(items) {
  const groups = [];
  const push = (arr) => {
    const combo = arr.map((i) => normToken(i.str)).join(" ");
    const iso = toIso(combo);
    if (!iso) return;
    groups.push({
      x0Dev: Math.min(...arr.map((i) => i.x0)),
      x1Dev: Math.max(...arr.map((i) => i.x0 + i.width)),
      yTopDev: Math.min(...arr.map((i) => i.y - i.height)),
      yBotDev: Math.max(...arr.map((i) => i.y)),
      iso,
    });
  };
  let i = 0;
  while (i < items.length) {
    const it = items[i];
    const nt = normToken(it.str);
    if (/^\d{4}-\d{2}-\d{2}$/.test(nt)) { push([it]); i++; continue; }
    if (/^\d{4}年\d{1,2}月\d{1,2}日$/.test(nt)) { push([it]); i++; continue; }
    // 粘连 token(如 16March2031 / September18,2026): 单个 token 即完整日期
    if (toIso(nt)) { push([it]); i++; continue; }
    const next = items[i + 1], nnext = items[i + 2];
    if (/^\d{1,2}$/.test(nt) && next && isMonth(normToken(next.str)) && nnext && /^\d{4}$/.test(normToken(nnext.str))) {
      push([it, next, nnext]); i += 3; continue;
    }
    if (isMonth(nt) && next && /^\d{1,2}$/.test(normToken(next.str)) && nnext && /^\d{4}$/.test(normToken(nnext.str))) {
      push([it, next, nnext]); i += 3; continue;
    }
    i++;
  }
  return groups;
}

// 将 device-coord 日期组归一化到 [0,1] 范围(基于 pdf.js viewport 尺寸)。
// 归一化后不再依赖 SCALE, drawGroup 只需乘以 libPage 实际尺寸即可正确定位,
// 彻底消除"pdf.js viewport(cropBox+rotation) vs pdf-lib page(mediaBox)"尺寸不一致导致的偏移。
function normalizeGroup(g, vpW, vpH) {
  return {
    x0: g.x0Dev / vpW,
    x1: g.x1Dev / vpW,
    yTop: g.yTopDev / vpH,
    yBot: g.yBotDev / vpH,
    iso: g.iso,
  };
}

// 用归一化坐标画框: (x0,x1,yTop,yBot 均为 0~1), 乘以 libPage 实际尺寸即得 PDF 绘制坐标。
// PDF 坐标系原点在左下角, Y 向上 → y 需翻转: normY → pageHeight * (1 - normY)
function drawGroup(libPage, g, stroke, fill) {
  const padN = 3 / libPage.getWidth();   // 归一化 padding
  const padNH = 3 / libPage.getHeight();
  const x0 = g.x0 - padN;
  const x1 = g.x1 + padN;
  const yTop = libPage.getHeight() * (1 - g.yTop) + padNH;
  const yBot = libPage.getHeight() * (1 - g.yBot) - padNH;
  libPage.drawRectangle({
    x: x0, y: yBot,
    width: x1 - x0,
    height: yTop - yBot,
    borderColor: rgb(stroke[0], stroke[1], stroke[2]),
    borderWidth: 1.6,
    backgroundColor: rgb(fill[0], fill[1], fill[2]),
    opacity: 0.4,
    borderOpacity: 0.9,
  });
}

// 短语与日期常不在同一行(尤其 CCS 等版式), 改为"就近关联":
// 每个过期/年检短语, 在同页限定行窗口内找最近的日期组(优先同行或之后), 再画框。
export function computeBoxes(pages, annualColor) {
  const color = ANNUAL_COLORS[annualColor] || ANNUAL_COLORS.blue;
  // 预提取每页每行的日期组
  for (const p of pages) {
    if (!p.allDates) {
      p.allDates = [];
      p.lines.forEach((line, li) => {
        const dgs = findDateGroups(line.items).map((g) => ({
          ...g,
          li,
          lineY: line.items.reduce((s, i) => s + i.y, 0) / Math.max(1, line.items.length),
        }));
        p.allDates.push(...dgs);
      });
    }
  }
  let red = 0, blue = 0;
  const used = new Set();
  const keyOf = (g) =>
    `${Math.round(g.x0Dev)}-${Math.round(g.yBotDev)}-${Math.round(g.x1Dev)}-${Math.round(g.yTopDev)}`;
  const lineY = (line) =>
    line.items.reduce((s, i) => s + i.y, 0) / Math.max(1, line.items.length);
  const boxes = [];
  for (const p of pages) {
    p.lines.forEach((line, li) => {
      const n = normSp(line.text); // 空格无关: 兼容 OCR 把"有效 日期"拆词的情况
      const isExpiry = EXPIRY_PHRASES.some((ph) => n.includes(normSp(ph)));
      if (isExpiry) {
        const g = nearestDate(p, li, lineY(line), used, keyOf);
        if (g) {
          boxes.push({ libPage: p.libPage, stroke: RED, fill: RED_FILL, group: normalizeGroup(g, p.vpW, p.vpH) });
          red++; used.add(keyOf(g));
        }
        return;
      }
      const hasKind = n.includes("annual") || n.includes("intermediate") ||
        n.includes("年度") || n.includes("期间") || n.includes("中间");
      const hasSurvey = n.includes("survey") || n.includes("检验");
      if (hasKind && hasSurvey) {
        const g = nearestDate(p, li, lineY(line), used, keyOf);
        if (g) {
          boxes.push({ libPage: p.libPage, stroke: color.stroke, fill: color.fill, group: normalizeGroup(g, p.vpW, p.vpH) });
          blue++; used.add(keyOf(g));
        }
      }
    });
  }
  return { boxes, red, blue };
}

function nearestDate(page, li, yPhrase, used, keyOf) {
  const WIN = 12; // 行窗口: 允许短语与日期相隔至多 12 行
  let best = null, bestScore = Infinity;
  for (const g of page.allDates) {
    if (used.has(keyOf(g))) continue;
    if (Math.abs(g.li - li) > WIN) continue;
    // 评分: 同一行 > 之后行 > 之前行(尽量贴合"标签所在行或其紧邻下方"的日期)
    const dy = Math.abs(g.lineY - yPhrase);
    let score;
    if (g.li === li) score = dy;
    else if (g.li > li) score = 30 + dy;
    else score = 80 + dy;
    if (score < bestScore) { bestScore = score; best = g; }
  }
  return best;
}

// ---------------------------------------------------------------- 分组
function hasUnique(p) {
  const n = normSp(p.plainText);
  return UNIQUE_TITLES.some(([kw]) => n.includes(normSp(kw)));
}
function hasExpiryNonAnnual(p) {
  return p.lines.some((l) => {
    const n = normSp(l.text);
    return EXPIRY_PHRASES.some((ph) => n.includes(normSp(ph))) && !/annual|survey/.test(n);
  });
}
function isCertStart(p) {
  return !!p.topHeading || hasUnique(p) || hasExpiryNonAnnual(p);
}

function dnvGroup(pages) {
  const groups = [];
  let cur = null;
  for (let idx = 0; idx < pages.length; idx++) {
    const m = pages[idx].plainText.match(/Form code:\s*([A-Z0-9.]+)/);
    const code = m ? m[1] : null;
    if (code === null) {
      if (cur) cur.pageIndices.push(idx);
      continue;
    }
    if (cur === null || cur.code !== code) {
      cur = { code, pageIndices: [idx] };
      groups.push(cur);
    } else cur.pageIndices.push(idx);
  }
  if (!groups.length) groups.push({ code: "FULL", pageIndices: pages.map((_, i) => i) });
  return groups;
}
function titleGroup(pages) {
  const groups = [];
  let cur = null;
  for (let idx = 0; idx < pages.length; idx++) {
    if (isCertStart(pages[idx])) {
      cur = { code: null, pageIndices: [idx] };
      groups.push(cur);
    } else {
      if (cur === null) { cur = { code: null, pageIndices: [idx] }; groups.push(cur); }
      else cur.pageIndices.push(idx);
    }
  }
  if (!groups.length) groups.push({ code: null, pageIndices: pages.map((_, i) => i) });
  return groups;
}
function finalizeGroups(groups, pages) {
  return groups.map((g) => {
    let type = "";
    for (const idx of g.pageIndices) {
      if (pages[idx].topHeading) { type = pages[idx].topHeading; break; }
    }
    if (!type) {
      const fullRaw = g.pageIndices.map((i) => pages[i].plainText).join("\n");
      type = detectType(fullRaw);
    }
    return { ...g, type: type || `证书(${g.code})`, code: type || `证书(${g.code})` };
  });
}
export function groupCertificates(pages) {
  const dnv = dnvGroup(pages);
  if (!(dnv.length === 1 && dnv[0].code === "FULL")) return finalizeGroups(dnv, pages);
  return finalizeGroups(titleGroup(pages), pages);
}

// ---------------------------------------------------------------- 记录
// 从分组页面的文本中抽取一条证书记录。
// 策略: 日期提取以 firstDateAfter(全文+短语优先级)为主,
//       仅当全文方法返回空时, 降级到逐行扫描(与 computeBoxes 画框逻辑对齐)。
// 返回 { type, no, issue, expiry, annual, remark, _ghost }
function buildRecord(group, pages, fileName) {
  const pg = group.pageIndices.map((i) => pages[i]);
  const fullRaw = pg.map((p) => p.plainText).join("\n");
  const ctype = group.type || "证书";
  const cno = extractNumber(fullRaw);

  // --- 签发日期 / 有效日期: 主=全文 firstDateAfter(有短语优先级), 备选=逐行扫描 ---
  let issue = firstDateAfter(fullRaw, ISSUE_PHRASES);
  let expiry = firstDateAfter(fullRaw, EXPIRY_PHRASES);

  // 全文没找到时, 降级到逐行短语→最近日期(与画框逻辑对齐)
  if (!issue || !expiry) {
    for (const p of pg) {
      for (const l of p.lines) {
        const n = normSp(l.text); // 空格无关匹配(OCR 拆词保护)
        if (!issue && ISSUE_PHRASES.some((ph) => n.includes(normSp(ph)))) {
          let dgs = findDateGroups(l.items);
          if (dgs.length) { issue = dgs[0].iso; }
          if (!issue) { // 同页后续行窗口
            const li = p.lines.indexOf(l);
            for (let w = 1; w <= Math.min(6, p.lines.length - li - 1); w++) {
              dgs = findDateGroups(p.lines[li + w].items);
              if (dgs.length) { issue = dgs[0].iso; break; }
            }
          }
        }
        if (!expiry && EXPIRY_PHRASES.some((ph) => n.includes(normSp(ph)))) {
          let dgs = findDateGroups(l.items);
          if (dgs.length) { expiry = dgs[0].iso; }
          if (!expiry) {
            const li = p.lines.indexOf(l);
            for (let w = 1; w <= Math.min(6, p.lines.length - li - 1); w++) {
              dgs = findDateGroups(p.lines[li + w].items);
              if (dgs.length) { expiry = dgs[0].iso; break; }
            }
          }
        }
        if (issue && expiry) break;
      }
      if (issue && expiry) break;
    }
  }

  // --- 年检日期: 保持原逐行扫描逻辑不变(空格无关匹配) ---
  const annualDates = [];
  for (const p of pg) {
    for (const l of p.lines) {
      const n = normSp(l.text);
      const hasKind = n.includes("annual") || n.includes("intermediate") || n.includes("年度") || n.includes("期间") || n.includes("中间");
      const hasSurvey = n.includes("survey") || n.includes("检验");
      if (hasKind && hasSurvey) {
        for (const g of findDateGroups(l.items)) annualDates.push(g.iso);
      }
    }
  }
  const uniqAnnual = [...new Set(annualDates)].sort();
  const annual = uniqAnnual.length ? uniqAnnual[uniqAnnual.length - 1] : "";
  const society = detectSociety(fullRaw);
  const parts = [];
  if (society) parts.push(`签发机构:${society}`);
  if (uniqAnnual.length) parts.push(`年度/中间检验:${uniqAnnual.join("、")}`);
  if (ctype.includes("保安") && !uniqAnnual.length) parts.push("无年度检验（保安证书按验证周期）");
  if (ctype.includes("吨位") && !uniqAnnual.length) parts.push("国际吨位证书（1969），长期有效，无年度检验");
  if (fileName) parts.push(`来源:${fileName}`);

  // 判断是否为幽灵记录: 无任何有用信息(无编号且无任何日期) — 仅留类型不足以识别具体证书, 写入 Excel 也是垃圾行。
  const _ghost = !cno && !issue && !expiry && !annual;

  return { type: ctype, no: cno, issue, expiry, annual, remark: parts.join("；"), _ghost };
}

// 同一 PDF 内去重: 标题检测在多页都命中时(扫描件/页脚重复)会把一本证书切成多个 group,
// 产生"同 (类型, 编号) 多行 + 一行有日期其余全空"的垃圾。合并策略:
//  - key = (类型, 编号); 多个记录同 key 视为同一证书;
//  - 保留"字段最完整"的那条(按 expiry(4) + issue(2) + annual(2) + no(1) 加权打分);
//  - 丢弃的记录的备注合并进保留记录的备注(用 ｜ 分隔, 保留来源可追溯)。
function dedupRecords(records) {
  const groups = new Map();
  for (const r of records) {
    const key = `${r.type || ""}|${r.no || ""}`;
    const ex = groups.get(key);
    if (!ex) { groups.set(key, r); continue; }
    const score = (x) => (x.expiry ? 4 : 0) + (x.issue ? 2 : 0) + (x.annual ? 2 : 0) + (x.no ? 1 : 0);
    if (score(r) > score(ex)) {
      if (ex.remark && ex.remark !== r.remark) {
        r.remark = r.remark ? `${r.remark} ｜ ${ex.remark}` : ex.remark;
      }
      groups.set(key, r);
    } else {
      if (r.remark && r.remark !== ex.remark) {
        ex.remark = ex.remark ? `${ex.remark} ｜ ${r.remark}` : r.remark;
      }
    }
  }
  return [...groups.values()];
}

// ---------------------------------------------------------------- 主流程
export async function processPdf(bytes, opts = {}) {
  const annualColor = opts.annualColor || "blue";

  const pdfLibDoc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pdfjsDoc = await PDFJS.getDocument({
    data: bytes.slice(0),
    standardFontDataUrl: opts.standardFontDataUrl,
  }).promise;

  const pages = [];
  for (let pno = 0; pno < pdfjsDoc.numPages; pno++) {
    const page = await pdfjsDoc.getPage(pno + 1);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent();
    const libPage = pdfLibDoc.getPages()[pno];
    const SCALE = vp.width / libPage.getWidth();
    const pageHeight = libPage.getHeight();
    const items = tc.items
      .map((it) => ({
        str: it.str,
        x0: it.transform[4],
        y: it.transform[5],
        width: it.width,
        height: it.height,
      }))
      .filter((it) => it.str && it.str.trim().length);

    // 双保险: 仅当该页文字层不可用(扫描版/无文字层)时, 才用 OCR 补充识别该页。
    // 数字版 PDF 直接用 pdf.js 文字层, 不浪费 OCR 时间。
    let ocrUsed = false;
    if (opts.ocr && typeof document !== "undefined" && !pageHasUsableText(items)) {
      try {
        const ocrItems = await ocrPageItems(page, opts.ocrLang || OCR_LANG, opts.onWarn, opts.ocrScale || OCR_SCALE);
        if (ocrItems.length > items.length) { items.length = 0; items.push(...ocrItems); ocrUsed = true; }
      } catch (e) {
        if (opts.onWarn) opts.onWarn(`  ⚠️ OCR 失败: ${e.message}`);
      }
    }

    const { lines, plainText } = buildLines(items);
    // OCR 页: 行文本去空格(保留大小写, 供标题识别), 并重建 plainText,
    // 使分组/类型/编号/日期抽取与画框逻辑一致命中"有效日期"等被拆词的中文标签。
    let pt = plainText;
    if (ocrUsed) {
      for (const l of lines) l.text = stripWs(l.text);
      pt = lines.map((l) => l.text).join("\n");
    }
    const topHeading = detectTopHeading(lines, vp.height);
    pages.push({ pno, items, lines, plainText: pt, topHeading, libPage, SCALE, pageHeight, vpW: vp.width, vpH: vp.height, ocrUsed });
  }
  await pdfjsDoc.destroy();

  // 就近关联画框: 过期日期=红, 年检/中间检验=蓝/绿/橙(归一化坐标, 无 SCALE 依赖)
  const { boxes, red, blue } = computeBoxes(pages, annualColor);
  for (const b of boxes) {
    drawGroup(b.libPage, b.group, b.stroke, b.fill);
  }

  const groups = groupCertificates(pages);
  let records = groups.map((g) => buildRecord(g, pages, opts.fileName));
  // 同 PDF 内去重: 标题检测在多页都命中时(扫描件页脚重复/版式)会把一本证书切成多个 group,
  // 合并"同 (类型, 编号) 的多条记录", 保留字段最完整的那条, 避免 Excel 出现"空行/重复行"。
  records = dedupRecords(records);
  // 过滤幽灵记录: 无编号且无任何日期的空行不写入 Excel
  const validRecords = records.filter((r) => !r._ghost);
  if (validRecords.length !== records.length) {
    // 幽灵组的页内容合并到相邻组(防止丢页), 但不在 Excel 中产生空行
    records = validRecords;
  }
  const outBytes = await pdfLibDoc.save();

  // 诊断信息: 文本提取统计(帮助判断"扫描版PDF" vs "短语不匹配")
  const totalItems = pages.reduce((s, p) => s + p.items.length, 0);
  const totalLines = pages.reduce((s, p) => s + p.lines.length, 0);
  const ocrPages = pages.filter((p) => p.ocrUsed).length;
  const textStats = {
    numPages: pages.length,
    totalItems,
    totalLines,
    isLikelyScanned: totalItems < 5,
    ocrPages,
    usedOcr: ocrPages > 0,
  };

  return { bytes: outBytes, records, red, blue, textStats };
}

// ---------------------------------------------------------------- 合并多个 PDF 为一个
// 将多份已标注的 PDF 按顺序合并成一份(保留所有标注框)。
// pdf-lib 的 copyPages 可跨文档复制页面(含绘制内容)。
export async function mergePdfs(pdfByteArrays, opts = {}) {
  const merged = await PDFDocument.create();
  for (const bytes of pdfByteArrays) {
    const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const indices = await merged.copyPages(src, src.getPageIndices());
    indices.forEach((pg) => merged.addPage(pg));
  }
  // 设置合并后的元数据
  merged.setTitle(opts.title || "船舶证书标注汇总");
  merged.setCreator("ship-cert-tool");
  return merged.save();
}
