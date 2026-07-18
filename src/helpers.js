// 纯文本辅助函数: 日期解析、船级社/类型识别、文本内日期提取。
// 与 Python 版 cert_tool.py 的对应逻辑保持一致, 浏览器与 Node 共用(便于测试)。
import { KB } from "./kb.js";

// ---------- 文本清洗(文字层 & OCR 双保险共用) ----------
// OCR / 复制粘贴常混入"看不见"的字符, 导致字符串比较、日期解析、关键词命中全部失配。
// 经社区实践 + 本项目扫描件实测, 需处理以下几类:
//  1) 零宽/控制/不可见字符: U+200B 零宽空格、U+200C/200D 连字符、U+FEFF BOM、U+00AD 软连字符、
//     U+2028/2029 行/段分隔符、U+2060 词连接符、LRM/RLM(U+200E/200F)等;
//  2) 全角/半角同形字符: Tesseract 易混入 ２０２４ / ： / － / ． / （ ） 等全角字符,
//     Unicode NFKC 归一化可把它们统一成半角;
//  3) 连字符家族: en/em/figure/horizontal bar/minus 等形似 "-", 统一成半角连字符便于日期正则;
//  4) 形近字符(仅限数字日期语境): O↔0, I/l/|↔1, S↔5, B↔8, Z↔2, G↔6, Q↔0。
// 参考: gennai.io "8 Common OCR Errors"(0/O,1/l,5/S); truegeometry "OCR errors";
//       peasytext/kitlab "invisible characters"(U+200B/U+FEFF/U+00AD); CSDN pytesseract 工业级排查。
const INVISIBLE_RE = /[\u0000-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200D\u200E\u200F\u2028\u2029\u2060\uFEFF]/g;
// 保留常规空白(\t\n\r)的版本: 用于依赖"空白/换行作 token 边界"的场景(如 extractNumber),
// 否则删掉换行会把跨行 token 粘连(如 "2359973" + 换行 + "valid" → "2359973valid")。
const INVISIBLE_KEEP_WS_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F\u00AD\u200B\u200C\u200D\u200E\u200F\u2028\u2029\u2060\uFEFF]/g;

export function cleanInvisible(s) {
  return String(s).replace(INVISIBLE_RE, "");
}
// 去不可见字符但保留 \t\n\r 与普通空格(供 extractNumber 等以空白为边界的解析用)
export function cleanInvisibleKeepWs(s) {
  return String(s).replace(INVISIBLE_KEEP_WS_RE, "");
}
// 日期扫描/短语定位的"准备文本": NFKC 全角→半角 + 去不可见 + 连字符家族统一为 "-" (保留空白, 兼容 "16 March 2031")
const DASH_RE = /[\u2010-\u2015\u2212\uFF0D\u007E\uFF5E]/g;
export function prepDateText(s) {
  return cleanInvisible(String(s).normalize("NFKC")).replace(DASH_RE, "-");
}
// 单个日期串归一化(供 toIso): 全角→半角 + 连字符统一 + 形近字母→数字(仅当串中无 3+ 连续字母, 避免破坏 OCT/Mar 等月份名)
export function normalizeDateString(s) {
  let t = prepDateText(s);
  if (!/[A-Za-z]{3,}/.test(t)) {
    t = t.replace(/[Oo]/g, "0").replace(/[Il|]/g, "1").replace(/[Ss]/g, "5")
         .replace(/[Bb]/g, "8").replace(/[Zz]/g, "2").replace(/[Gg]/g, "6").replace(/[Qq]/g, "0");
  }
  return t;
}
// 空格无关归一化: 去不可见 + NFKC + 转小写 + 去所有空白。用于标签/关键词匹配(OCR 拆词保护)。
export function normSp(s) {
  return cleanInvisible(String(s).normalize("NFKC")).toLowerCase().replace(/\s+/g, "");
}
// 在含空白文本中做"空格无关"短语定位, 返回该短语首字符在原文(保留空白)中的下标。
// 让 firstDateAfter 的"短语位置"与"日期下标"处于同一坐标系, 修正此前去空白导致两者错位的问题。
export function phraseIndex(text, needleNoWs, from = 0) {
  if (!needleNoWs) return -1;
  const clean = [];
  for (let i = from; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) continue;
    clean.push({ ch: c.toLowerCase(), idx: i });
  }
  const flat = clean.map((x) => x.ch).join("");
  const p = flat.indexOf(needleNoWs);
  return p < 0 ? -1 : clean[p].idx;
}

export const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
const MONTH_ABBR = { Jan:1, Feb:2, Mar:3, Apr:4, May:5, Jun:6, Jul:7, Aug:8, Sep:9, Oct:10, Nov:11, Dec:12 };
const MONTH_LOOKUP = {};
for (const [name, num] of Object.entries({ ...MONTHS, ...MONTH_ABBR })) {
  MONTH_LOOKUP[name.toLowerCase()] = num;
}
// 大小写无关、全称/缩写都能查到月份数字
export function monthNum(s) {
  return MONTH_LOOKUP[String(s).toLowerCase()] || null;
}
const MONTH_NAME_ALT = Object.keys(MONTHS).join("|");
const MONTH_ABBR_ALT = Object.keys(MONTH_ABBR).join("|");
const MONTH_ALT = `${MONTH_NAME_ALT}|${MONTH_ABBR_ALT}`;
const MONTH_RE = new RegExp(`^(${MONTH_ALT})$`, "i");

// 统一日期模式: ISO / DD Month YYYY / Month DD, YYYY / 中文 YYYY年M月D日
// 另兼容 pdf.js 把"日月年"提取成无空格粘连 token 的情况(如 16March2031 / September18,2026)
export const DATEPAT =
  `(?:\\d{4}-\\d{2}-\\d{2}` +
  `|\\d{1,2}\\s+(?:${MONTH_ALT})\\s+\\d{4}` +
  `|${MONTH_ALT}\\s+\\d{1,2},?\\s+\\d{4}` +
  `|\\d{4}年\\d{1,2}月\\d{1,2}日` +
  `|\\d{1,2}(?:${MONTH_ALT})\\d{4}` +
  `|(?:${MONTH_ALT})\\d{1,2},?\\d{4}` +
  `|\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}` +
  `|\\d{4}[/.]\\d{1,2}[/.]\\d{1,2})`;

const DATE_RES = [
  /^\d{4}-\d{2}-\d{2}$/,
  new RegExp(`^\\d{1,2}\\s+${MONTH_ALT}\\s+\\d{4}$`, "i"),
  new RegExp(`^${MONTH_ALT}\\s+\\d{1,2},?\\s+\\d{4}$`, "i"),
  /^\d{4}年\d{1,2}月\d{1,2}日$/,
  new RegExp(`^\\d{1,2}${MONTH_ALT}\\d{4}$`, "i"),
  new RegExp(`^${MONTH_ALT}\\d{1,2},?\\d{4}$`, "i"),
  new RegExp(`^\\d{1,2}[/.]\\d{1,2}[/.]\\d{4}$`),       // DD/MM/YYYY (欧式船证惯例)
  new RegExp(`^\\d{4}[/.]\\d{1,2}[/.]\\d{1,2}$`),
];

export function normToken(tok) {
  let t = prepDateText(tok).trim();
  return t.replace(/[.,;:)\]]+$/, "").replace(/^[.]+/, "");
}

export function toIso(text) {
  text = normalizeDateString(text).trim();
  let m = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = text.match(new RegExp(`^(\\d{1,2})\\s+(${MONTH_ALT})\\s+(\\d{4})$`, "i"));
  if (m) return `${m[3]}-${String(monthNum(m[2])).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  m = text.match(new RegExp(`^(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"));
  if (m) return `${m[3]}-${String(monthNum(m[1])).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
  m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
  if (m) return `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[3], 10)).padStart(2, "0")}`;
  // 粘连 token: 16March2031 / 18Mar2027
  m = text.match(new RegExp(`^(\\d{1,2})(${MONTH_ALT})(\\d{4})$`, "i"));
  if (m) return `${m[3]}-${String(monthNum(m[2])).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  // 粘连 token: September18,2026 / March182026
  m = text.match(new RegExp(`^(${MONTH_ALT})(\\d{1,2}),?(\\d{4})$`, "i"));
  if (m) return `${m[3]}-${String(monthNum(m[1])).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
  // 斜杠/点日期: 18/03/2027 或 18.03.2027 (欧式 DD/MM/YYYY); 及 2027/03/18
  m = text.match(/^(\d{1,2})[/.](\d{1,2})[/.](\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  m = text.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/);
  if (m) return `${m[1]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[3], 10)).padStart(2, "0")}`;
  // 空格分隔纯数字日期(欧式 DD MM YYYY, 船证常见): 18 03 2027
  m = text.match(/^(\d{1,2})\s+(\d{1,2})\s+(\d{4})$/);
  if (m) return `${m[3]}-${String(parseInt(m[2], 10)).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  return null;
}

export function isMonth(tok) {
  return MONTH_RE.test(tok);
}

export function matchDateToken(norm) {
  return DATE_RES.some((re) => re.test(norm));
}

// 船级社
const SOCIETY_MAP = KB.societies.flatMap((s) => s.keywords.map((kw) => [kw, s.code]));
export function detectSociety(text) {
  const n = normSp(text);
  for (const [kw, code] of SOCIETY_MAP) {
    const ns = normSp(kw);
    if (ns.length <= 4) {
      // 短代码(2~4字母如 LR/RS/BV/ABS/NK/KR): 用词边界匹配, 避免 "rs" 误命中 "years"、"nk" 误命中 "thanks"
      const re = new RegExp(`(^|[^a-z])${escapeRegExp(ns)}([^a-z]|$)`);
      if (re.test(n)) return code;
    } else {
      if (n.includes(ns)) return code;
    }
  }
  return "";
}

// 类型识别(列表顺序即匹配优先级)
const TYPE_BY_CODE = Object.fromEntries(KB.cert_types.map((ct) => [ct.code, `${ct.code}-${ct.name}`]));
export const TYPE_MAP = KB.cert_types.flatMap((ct) => ct.keywords.map((kw) => [kw, TYPE_BY_CODE[ct.code]]));
export const TITLE_HEADS = KB.title_heads.map((th) => [th.text, TYPE_BY_CODE[th.code]]);
export const UNIQUE_TITLES = KB.unique_titles.map((ut) => [ut.text, TYPE_BY_CODE[ut.code]]);
// LR 表单号 → 类型(强信号, 用于扫描件标题残缺时的兜底)
const FORM_CODE = Object.fromEntries((KB.form_codes || []).map((fc) => [fc.form, TYPE_BY_CODE[fc.code]]));

export const EXPIRY_PHRASES = KB.phrases.expiry;
export const ANNUAL_PHRASES = KB.phrases.annual_survey;
export const ISSUE_PHRASES = [...KB.phrases.issue_priority, ...KB.phrases.issue_fallback];
export const NUMBER_PHRASES = KB.phrases.number;

export function detectType(fullRaw) {
  const n = normSp(fullRaw);
  // 1) 唯一短语(空格无关)
  for (const [kw, name] of UNIQUE_TITLES) {
    if (n.includes(normSp(kw))) return name;
  }
  // 2) LR 表单号(强信号): 扫描件标题残缺时按 "form2221" 等兜底, 早于泛化关键词
  //    (避免正文里"Exemption Certificate has not been issued"误判为免除证书)。
  const formRe = /form(\d{3,4}[a-z]?)/g;
  let fm;
  while ((fm = formRe.exec(n))) {
    const t = FORM_CODE[fm[1]];
    if (t) return t;
  }
  // 3) 全文关键词(空格无关, 中英统一)
  for (const [kw, name] of TYPE_MAP) {
    if (n.includes(normSp(kw))) return name;
  }
  return "";
}

// 在 text 中找出所有候选日期(位置 + ISO)。
// 关键: DATE_RES 是带 ^...$ 锚点的"整 token 校验"式正则(供 matchDateToken 用),
// 不能用于在长文本里挖日期子串。这里改用【未锚定】的 DATEPAT 全局正则逐段扫描,
// 用 lastIndex 手动推进(标准 exec 循环), 既不会无限循环, 也不会因拼接 phrase+DATEPAT 巨型正则而原生崩溃。
const DATE_SCAN = new RegExp(DATEPAT, "gi");
function scanDates(text) {
  const found = [];
  DATE_SCAN.lastIndex = 0;
  let m;
  while ((m = DATE_SCAN.exec(text)) !== null) {
    const iso = toIso(m[0]);
    if (iso) found.push({ index: m.index, iso });
    if (m.index === DATE_SCAN.lastIndex) DATE_SCAN.lastIndex++; // 防零宽匹配死循环
  }
  found.sort((a, b) => a.index - b.index);
  return found;
}
export function extractAllDates(text) {
  return scanDates(prepDateText(text));
}

// 在 text 中, 对每个短语(按优先级)取其后最近的日期。
// 改为"先定位短语、再在其后窗口内取最近日期", 不再拼接 phrase+DATEPAT 巨型正则, 规避原生崩溃。
export function firstDateAfter(text, phrases) {
  const base = prepDateText(text);          // 与日期扫描同一坐标系(保留空白)
  const dates = scanDates(base);
  if (!dates.length) return "";
  for (const ph of phrases) {
    let idx = phraseIndex(base, normSp(ph));
    while (idx >= 0) {
      let best = null, bestDist = Infinity;
      for (const d of dates) {
        const dist = d.index - idx;          // base 与 d.index 同坐标系, 比较有效
        if (dist >= 0 && dist < bestDist) { bestDist = dist; best = d.iso; }
      }
      if (best) return best;
      idx = phraseIndex(base, normSp(ph), idx + 1);
    }
  }
  return "";
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 抽取证书编号: 优先 Certificate No, 其次 Distinctive Number or Letters(吨位证), 再次 编号(中文证)。
// 关键: DNV 的 "Certificate No:" 标签行与编号常不在同一页, 故在全文搜所有匹配,
// 跳过 "Form" 等明显非编号的 token, 只取含数字的真实编号(避免误抓页脚 "Form code")。
// OCR/版式常把编号与后缀粘连(如 "1186445Form"、"2359973https://..."), 用 cleanNum 剥离。
// ★关键(OCR 扫描件): 去空格后编号会与后文英文单词直接粘连(如 "2170691Page1of9Issued..."),
//   此时 (\S+) 会一路吞到整行/整页。sliceGlued 在"首个驼峰英文单词起点"(大写后接小写, 如 Page/Issued)
//   处截断, 把编号从后文正文里切出来; 证书编号只由 数字/大写字母/ / . - 组成, 不含小写。
function sliceGlued(tok) {
  const m = tok.match(/^(.*?)(?=[A-Z][a-z])/); // 截到"首个 大写+小写 单词"之前
  return (m && m[1]) ? m[1] : tok;
}
function cleanNum(tok) {
  return sliceGlued(tok)
    .replace(/https?:\/\/\S*$/i, "")   // 去掉附着的 URL(LR 证书页脚)
    .replace(/form$/i, "")             // 去掉附着的 Form(IOPP Form A / 吨位证 Distinctive Number 行)
    .replace(/[;:)\].,\s]+$/g, "")      // 去尾部标点/空白
    .replace(/^[;:(\].,\s]+/g, "")      // 去头部标点
    .replace(/([0-9])[A-Za-z]{1,4}$/, "$1"); // 去掉数字后残留的 1~4 个尾字母(如 "2170691P")
}
export function extractNumber(text) {
  const t = cleanInvisibleKeepWs(String(text).normalize("NFKC")); // 保留换行, 避免跨行 token 粘连
  const lines = t.split(/\r?\n/);
  const good = (tok) => /\d/.test(tok) && !/^form$/i.test(tok) && tok.length <= 32;
  // \s* 兼容 OCR 去空格后的"certificateno:..."(无空格)与正常"Certificate No: ..."
  // 第 1 遍: Certificate No(全文, 取含数字且非 Form 的编号)
  const certRe = /certificate\s*no\.?\s*[:：]?\s*(\S+)/gi;
  let m;
  while ((m = certRe.exec(t))) {
    const tok = cleanNum(m[1]);
    if (good(tok)) return tok;
  }
  // 第 2 遍: Record No(IOPP Form A 等"记录/构造与设备记录"的编号, 如 2170691/01)
  const recRe = /record\s*no\.?\s*[:：]?\s*(\S+)/gi;
  while ((m = recRe.exec(t))) {
    const tok = cleanNum(m[1]);
    if (good(tok)) return tok;
  }
  // 第 3 遍: Distinctive Number or Letters(吨位证标识)
  for (const line of lines) {
    const dm = line.match(/distinctive\s*number\s*or\s*letters\s*[:：]?\s*(\S+)/i);
    if (dm) { const tok = cleanNum(dm[1]); if (good(tok)) return tok; }
  }
  // 第 4 遍: 中文 编号
  for (const line of lines) {
    const nm = line.match(/编号\s*(?:no\.?\s*)?[:：]?\s*(\S+)/i);
    if (nm) { const tok = cleanNum(nm[1]); if (good(tok)) return tok; }
  }
  // 第 5 遍(兜底): LR 版式页眉 "<证书号> Page 1 of N"(标签缺失的扫描件, 如 ISSC)
  const pm = t.match(/(\d{4,8})\s*page\s*\d+\s*of\s*\d+/i);
  if (pm) return pm[1];
  return "";
}
