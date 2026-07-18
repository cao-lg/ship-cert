import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";
import { processPdf, configurePdfjs, mergePdfs, ensureOcrWorker, terminateOcr } from "./engine.js";
import { buildExcelWorkbook } from "./excel.js";
import { CERT_ORDER, certOrderKey } from "./kb.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const STD_FONTS = `${import.meta.env.BASE_URL || "/"}pdfjs-standard-fonts/`;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = STD_FONTS;

// 本地日期(YYYY-MM-DD), 用浏览器时区而非 UTC, 避免 toISOString() 在 GMT+8 凌晨返回昨天导致文件名日期错
function localDateStr(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}
configurePdfjs(pdfjsLib);

// ---------- DOM ----------
const $ = (id) => document.getElementById(id);
const dropzone = $("dropzone");
const fileInput = $("fileInput");
const pickBtn = $("pickBtn");
const fileSection = $("fileSection");
const fileListEl = $("fileList");
const fileCountEl = $("fileCount");
const annualColorSel = $("annualColor");
const mergePdfChk = $("mergePdf");
const ocrChk = $("ocrToggle");
const ocrStatusEl = $("ocrStatus");
const ocrScaleSel = $("ocrScale");
const ocrLangSel = $("ocrLang");
const runBtn = $("runBtn");
const clearBtn = $("clearBtn");
const logWrap = $("logWrap");
const logEl = $("log");
const resultsEl = $("results");
const resultBody = $("resultTable").querySelector("tbody");
const downloadListEl = $("downloadList");
const downloadZipBtn = $("downloadZip");

// ---------- 状态 ----------
let files = []; // { id, file }
let templateBytes = null;
let lastOutputs = null; // { pdfs:[{name, bytes}], excel bytes }

// ---------- 模板(内置) ----------
async function getTemplate() {
  if (templateBytes) return templateBytes;
  const base = import.meta.env.BASE_URL || "/";
  const res = await fetch(`${base}cert-template.xlsx`);
  if (!res.ok) throw new Error("内置模板加载失败");
  templateBytes = new Uint8Array(await res.arrayBuffer());
  return templateBytes;
}

// ---------- 文件管理 ----------
function addFiles(fileArr) {
  for (const f of fileArr) {
    if (!f.name.toLowerCase().endsWith(".pdf")) continue;
    if (files.some((x) => x.file.name === f.name && x.file.size === f.size)) continue;
    files.push({ id: `${f.name}-${f.size}-${Math.random().toString(36).slice(2, 7)}`, file: f });
  }
  renderFiles();
}
function renderFiles() {
  fileListEl.innerHTML = "";
  files.forEach((x) => {
    const li = document.createElement("li");
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = x.file.name;
    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "移除";
    del.onclick = () => {
      files = files.filter((y) => y.id !== x.id);
      renderFiles();
    };
    li.append(name, del);
    fileListEl.appendChild(li);
  });
  fileCountEl.textContent = String(files.length);
  const has = files.length > 0;
  fileSection.hidden = !has;
  runBtn.disabled = !has;
  clearBtn.disabled = !has;
}

// ---------- 日志 ----------
function log(msg) {
  logWrap.hidden = false;
  logEl.textContent += msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

// ---------- 处理 ----------
async function run() {
  if (!files.length) return;
  runBtn.disabled = true;
  clearBtn.disabled = true;
  fileInput.disabled = true;
  logWrap.hidden = false;
  logEl.textContent = "";
  resultsEl.hidden = true;
  resultBody.innerHTML = "";
  downloadListEl.innerHTML = "";

  const annualColor = annualColorSel.value;
  let template;
  try {
    template = await getTemplate();
  } catch (e) {
    log("✗ " + e.message);
    return;
  }

  const entries = []; // { outPdf, records }
  let grandRed = 0, grandBlue = 0;

  for (const x of files) {
    const fname = x.file.name;
    log(`[处理] ${fname}`);
    try {
      const bytes = new Uint8Array(await x.file.arrayBuffer());
      const { bytes: outBytes, records, red, blue, textStats } = await processPdf(bytes, {
        annualColor,
        fileName: fname,
        standardFontDataUrl: STD_FONTS,
        ocr: ocrChk.checked,
        ocrLang: ocrLangSel.value,
        ocrScale: Number(ocrScaleSel.value) || 3,
        onWarn: (m) => log(`  ${m}`),
      });
      grandRed += red;
      grandBlue += blue;
      const base = fname.replace(/\.pdf$/i, "");
      entries.push({ outPdf: { name: `${base}-标注.pdf`, bytes: outBytes }, records });

      // 诊断日志
      let diag = "";
      if (textStats.usedOcr) {
        diag = ` 🔍 OCR识别了 ${textStats.ocrPages}/${textStats.numPages} 页(扫描/无文字层)`;
      } else if (textStats.isLikelyScanned) {
        diag = ` ⚠️ 可能是扫描版PDF(文字极少,${textStats.totalItems}个文本元素) — 勾选"OCR识别"才会自动识别`;
      } else if (red === 0 && blue === 0 && textStats.totalLines > 3) {
        diag = ` ⚠️ 有文字(${textStats.totalLines}行)但未匹配到日期短语, 可能是非常规格式`;
      } else {
        diag = ` ✓ pdf.js文字层可读, 未触发OCR(快)`;
      }

      log(`  标注完成: 红框=${red}  年检框=${blue}  证书=${records.length}  页数=${textStats.numPages}${diag}`);
      records.forEach((r, i) =>
        log(`    ${i + 1}. ${r.type} | ${r.no || "-"} | 签发 ${r.issue || "-"} | 有效 ${r.expiry || "-"} | 年检 ${r.annual || "-"}`)
      );
    } catch (e) {
      log(`  ✗ 失败: ${e.message}`);
    }
  }

  // OCR 引擎已用完, 释放持久 worker(回收 ~20MB 语言包内存)
  terminateOcr();

  // 按证书类型指定顺序排序(国籍→最低配员→载重线→安全构造→保安→防油污→吨位→其它),
  // 多证合一的 PDF 以其"主证书类型"(记录中最小排序键)定位, IOPP 与 IOPP Form A 同属 1205 自然相邻。
  const keyOf = (e) => {
    let k = 999;
    for (const r of e.records) { const kk = certOrderKey(r.type); if (kk < k) k = kk; }
    return k;
  };
  entries.sort((a, b) => keyOf(a) - keyOf(b));
  const outPdfs = entries.map((e) => e.outPdf);
  const allRecords = entries.flatMap((e) => e.records);
  log(`\n[排序] 合并/汇总顺序: ${outPdfs.map((p) => p.name.replace(/-标注\.pdf$/, "")).join(" → ")}`);

  // Excel 汇总
  let excelBytes = null;
  try {
    excelBytes = await buildExcelWorkbook(template, allRecords);
    log(`\n[汇总] 共 ${allRecords.length} 张证书 -> 船舶证书信息汇总.xlsx`);
  } catch (e) {
    log(`\n✗ Excel 汇总失败: ${e.message}`);
  }

  log(`\n完成。红框累计 ${grandRed}，年检框累计 ${grandBlue}。`);

  // 合并 PDF（如果勾选了且有多份）
  let mergedBytes = null;
  if (mergePdfChk.checked && outPdfs.length > 1) {
    try {
      log("\n[合并] 正在合并所有标注PDF为一份...");
      mergedBytes = await mergePdfs(outPdfs.map((p) => p.bytes), {
        title: `船舶证书标注汇总_${localDateStr()}`,
      });
      log(`  合并完成: 共 ${outPdfs.length} 份 → 1份合并PDF`);
    } catch (e) {
      log(`  ✗ 合并失败: ${e.message}`);
    }
  }

  lastOutputs = { pdfs: outPdfs, excel: excelBytes, records: allRecords, mergedPdf: mergedBytes };
  renderResults(outPdfs, excelBytes, allRecords, mergedBytes);
  runBtn.disabled = false;
  clearBtn.disabled = false;
  fileInput.disabled = false;
}

function renderResults(outPdfs, excelBytes, records, mergedBytes) {
  resultsEl.hidden = false;
  resultBody.innerHTML = "";
  records.forEach((r, i) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `<td>${i + 1}</td><td>${r.type}</td><td>${r.no || ""}</td><td>${r.issue || ""}</td><td>${r.expiry || ""}</td><td>${r.annual || ""}</td><td>${r.remark || ""}</td>`;
    resultBody.appendChild(tr);
  });

  downloadListEl.innerHTML = "";
  // 合并PDF（排在最前）
  if (mergedBytes) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([mergedBytes], { type: "application/pdf" }));
    a.download = `船舶证书标注合并_${localDateStr()}.pdf`;
    a.textContent = "⬇ 船舶证书标注合并.pdf（全部合为一份）";
    a.style.fontWeight = "bold";
    li.appendChild(a);
    downloadListEl.appendChild(li);
  }
  // 各文件单独下载
  outPdfs.forEach((p) => {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([p.bytes], { type: "application/pdf" }));
    a.download = p.name;
    a.textContent = `⬇ ${p.name}`;
    li.appendChild(a);
    downloadListEl.appendChild(li);
  });
  if (excelBytes) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([excelBytes], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = "船舶证书信息汇总.xlsx";
    a.textContent = "⬇ 船舶证书信息汇总.xlsx";
    li.appendChild(a);
    downloadListEl.appendChild(li);
  }
}

async function downloadZip() {
  if (!lastOutputs) return;
  const zip = new JSZip();
  lastOutputs.pdfs.forEach((p) => zip.file(p.name, p.bytes));
  if (lastOutputs.excel) zip.file("船舶证书信息汇总.xlsx", lastOutputs.excel);
  if (lastOutputs.mergedPdf) zip.file("船舶证书标注合并.pdf", lastOutputs.mergedPdf);
  const blob = await zip.generateAsync({ type: "blob" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "船舶证书标注与汇总.zip";
  a.click();
}

// ---------- 事件 ----------
pickBtn.onclick = () => fileInput.click();
fileInput.onchange = () => { addFiles([...fileInput.files]); fileInput.value = ""; };
dropzone.onclick = (e) => { if (e.target === dropzone || e.target.classList.contains("dz-inner") || e.target.classList.contains("dz-icon")) fileInput.click(); };
["dragenter", "dragover"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add("drag"); })
);
["dragleave", "drop"].forEach((ev) =>
  dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove("drag"); })
);
dropzone.addEventListener("drop", (e) => {
  if (e.dataTransfer?.files?.length) addFiles([...e.dataTransfer.files]);
});
runBtn.onclick = run;
clearBtn.onclick = () => { files = []; renderFiles(); resultsEl.hidden = true; logWrap.hidden = true; };
downloadZipBtn.onclick = downloadZip;

// OCR 引擎预加载: 勾选时在后台提前下载所选语言包, 避免处理时卡在某页长时间等待
async function preloadOcr() {
  if (!ocrChk.checked) {
    terminateOcr();
    if (ocrStatusEl) ocrStatusEl.textContent = "";
    return;
  }
  const lang = ocrLangSel.value;
  if (ocrStatusEl) ocrStatusEl.textContent = lang === "eng" ? "OCR引擎(英文)加载中…" : "OCR引擎(中英)加载中…";
  try {
    await ensureOcrWorker(lang, (m) => { if (ocrStatusEl && /%/.test(m)) ocrStatusEl.textContent = m.trim(); });
    if (ocrStatusEl) ocrStatusEl.textContent = lang === "eng" ? "✓ OCR引擎已就绪(英文)" : "✓ OCR引擎已就绪(中英)";
  } catch (e) {
    if (ocrStatusEl) ocrStatusEl.textContent = "⚠️ OCR引擎加载失败（离线时扫描件将跳过OCR）";
  }
}
ocrChk.addEventListener("change", preloadOcr);
// 切换语言(英文↔中英)时, 重新加载对应模型(小模型优先, 用中文时再加载大模型)
ocrLangSel.addEventListener("change", preloadOcr);

renderFiles();
// 默认勾选 OCR: 页面加载即在后台预加载引擎(下载语言包), 处理时直接复用、无需等待
preloadOcr();

// 构建信息(写在文件末尾确保在所有变量定义之后, 避免 esbuild 重排导致 TDZ)
$("appVersion").textContent = "1.3.8";
$("appBuildDate").textContent = "2026-07-18 10:30:00";
