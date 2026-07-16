// 船舶证书 PDF 标注与信息提取引擎(纯前端)。
// 逻辑对齐 Python 版 cert_tool.py: pdf.js 取文字与坐标, pdf-lib 画红/绿框并保存。
import * as pdfjsDefault from "pdfjs-dist";
import { PDFDocument, rgb } from "pdf-lib";
import { KB, ANNUAL_COLORS, RED, RED_FILL } from "./kb.js";
import {
  MONTHS, isMonth, normToken, toIso, detectType, detectSociety,
  extractNumber, firstDateAfter, EXPIRY_PHRASES, ISSUE_PHRASES,
  UNIQUE_TITLES, TITLE_HEADS,
} from "./helpers.js";

// pdf.js 实例可注入(浏览器用主构建, Node 测试用 legacy 构建)
let PDFJS = pdfjsDefault;
export function configurePdfjs(lib) { PDFJS = lib; }

const MONTH_ALT = Object.keys(MONTHS).join("|");

// ---------------------------------------------------------------- 页面解析
function buildLines(items) {
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
  for (const l of lines) {
    const yAvg = l.items.reduce((s, i) => s + i.y, 0) / l.items.length;
    if (yAvg > half) continue;
    const up = l.text.toUpperCase();
    if (!(up.includes("CERTIFICATE") || up.includes("REGISTRY") || up.includes("REGISTRATION"))) continue;
    const letters = [...l.text].filter((c) => /[A-Za-z]/.test(c));
    if (!letters.length) continue;
    const upc = letters.filter((c) => c === c.toUpperCase() && c !== c.toLowerCase()).length;
    if (upc / letters.length < 0.7) continue;
    for (const [key, name] of TITLE_HEADS) {
      if (up.includes(key)) return name;
    }
  }
  return null;
}

// 行内日期分组(支持 ISO / DD Mon YYYY / Mon DD YYYY / 中文)
function findDateGroups(items) {
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

function drawGroup(libPage, g, SCALE, pageHeight, stroke, fill) {
  const pad = 3;
  const x0 = g.x0Dev / SCALE - pad;
  const x1 = g.x1Dev / SCALE + pad;
  const yTop = pageHeight - g.yTopDev / SCALE + pad;
  const yBot = pageHeight - g.yBotDev / SCALE - pad;
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

function pickDateGroup(line, SCALE, pageHeight, libPage, stroke, fill, seen) {
  const dgs = findDateGroups(line.items);
  if (!dgs.length) return false;
  const startX = line.x0 - 8;
  const chosen = dgs.find((g) => g.x0Dev >= startX) || dgs[0];
  const key = `${Math.round(chosen.x0Dev)}-${Math.round(chosen.yBotDev)}-${Math.round(chosen.x1Dev)}-${Math.round(chosen.yTopDev)}`;
  if (seen.has(key)) return false;
  seen.add(key);
  drawGroup(libPage, chosen, SCALE, pageHeight, stroke, fill);
  return true;
}

// ---------------------------------------------------------------- 分组
function hasUnique(p) {
  return UNIQUE_TITLES.some(([kw]) => p.plainText.toLowerCase().includes(kw.toLowerCase()));
}
function hasExpiryNonAnnual(p) {
  return p.lines.some((l) => {
    const low = l.text.toLowerCase();
    return EXPIRY_PHRASES.some((ph) => low.includes(ph.toLowerCase())) && !/annual|survey/i.test(l.text);
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
function groupCertificates(pages) {
  const dnv = dnvGroup(pages);
  if (!(dnv.length === 1 && dnv[0].code === "FULL")) return finalizeGroups(dnv, pages);
  return finalizeGroups(titleGroup(pages), pages);
}

// ---------------------------------------------------------------- 记录
function buildRecord(group, pages, fileName) {
  const pg = group.pageIndices.map((i) => pages[i]);
  const fullRaw = pg.map((p) => p.plainText).join("\n");
  const ctype = group.type || "证书";
  const cno = extractNumber(fullRaw);
  const issue = firstDateAfter(fullRaw, ISSUE_PHRASES);
  const expiry = firstDateAfter(fullRaw, EXPIRY_PHRASES);
  const annualDates = [];
  for (const p of pg) {
    for (const l of p.lines) {
      const low = l.text.toLowerCase();
      const hasKind = low.includes("annual") || low.includes("intermediate") || low.includes("年度") || low.includes("期间") || low.includes("中间");
      const hasSurvey = low.includes("survey") || low.includes("检验");
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
  return { type: ctype, no: cno, issue, expiry, annual, remark: parts.join("；") };
}

// ---------------------------------------------------------------- 主流程
export async function processPdf(bytes, opts = {}) {
  const annualColor = opts.annualColor || "blue";
  const color = ANNUAL_COLORS[annualColor] || ANNUAL_COLORS.blue;

  const pdfLibDoc = await PDFDocument.load(bytes);
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
    const { lines, plainText } = buildLines(items);
    const topHeading = detectTopHeading(lines, vp.height);
    pages.push({ pno, items, lines, plainText, topHeading, libPage, SCALE, pageHeight });
  }
  await pdfjsDoc.destroy();

  let red = 0, blue = 0;
  const seenRed = new Set(), seenBlue = new Set();
  for (const p of pages) {
    for (const line of p.lines) {
      const lower = line.text.toLowerCase();
      const isExpiry = EXPIRY_PHRASES.some((ph) => lower.includes(ph.toLowerCase()));
      if (isExpiry) {
        if (pickDateGroup(line, p.SCALE, p.pageHeight, p.libPage, RED, RED_FILL, seenRed)) red++;
        continue;
      }
      const hasKind = lower.includes("annual") || lower.includes("intermediate") || lower.includes("年度") || lower.includes("期间") || lower.includes("中间");
      const hasSurvey = lower.includes("survey") || lower.includes("检验");
      if (hasKind && hasSurvey) {
        if (pickDateGroup(line, p.SCALE, p.pageHeight, p.libPage, color.stroke, color.fill, seenBlue)) blue++;
      }
    }
  }

  const groups = groupCertificates(pages);
  const records = groups.map((g) => buildRecord(g, pages, opts.fileName));
  const outBytes = await pdfLibDoc.save();
  return { bytes: outBytes, records, red, blue };
}
