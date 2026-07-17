import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import JSZip from "jszip";
import { processPdf, configurePdfjs, mergePdfs } from "./engine.js";
import { buildExcelWorkbook } from "./excel.js";
import { CERT_ORDER, certOrderKey } from "./kb.js";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;
const STD_FONTS = `${import.meta.env.BASE_URL || "/"}pdfjs-standard-fonts/`;
pdfjsLib.GlobalWorkerOptions.standardFontDataUrl = STD_FONTS;
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
        ocrLang: "eng+chi_sim",
        onWarn: (m) => log(`  ${m}`),
      });
      grandRed += red;
      grandBlue += blue;
      const base = fname.replace(/\.pdf$/i, "");
      entries.push({ outPdf: { name: `${base}-标注.pdf`, bytes: outBytes }, records });

      // 诊断日志
      let diag = "";
      if (textStats.usedOcr) diag = ` 🔍 OCR识别了 ${textStats.ocrPages}/${textStats.numPages} 页`;
      else if (textStats.isLikelyScanned) diag = ` ⚠️ 可能是扫描版PDF(文字极少,${textStats.totalItems}个文本元素) — 勾选"OCR识别"可启用双保险`;
      else if (red === 0 && blue === 0 && textStats.totalLines > 3) diag = ` ⚠️ 有文字(${textStats.totalLines}行)但未匹配到日期短语,可能是非常规格式`;

      log(`  标注完成: 红框=${red}  年检框=${blue}  证书=${records.length}  页数=${textStats.numPages}${diag}`);
      records.forEach((r, i) =>
        log(`    ${i + 1}. ${r.type} | ${r.no || "-"} | 签发 ${r.issue || "-"} | 有效 ${r.expiry || "-"} | 年检 ${r.annual || "-"}`)
      );
    } catch (e) {
      log(`  ✗ 失败: ${e.message}`);
    }
  }

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
        title: `船舶证书标注汇总_${new Date().toISOString().slice(0, 10)}`,
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
    a.download = `船舶证书标注合并_${new Date().toISOString().slice(0, 10)}.pdf`;
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

renderFiles();
