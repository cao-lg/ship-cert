// 纯文本辅助函数: 日期解析、船级社/类型识别、文本内日期提取。
// 与 Python 版 cert_tool.py 的对应逻辑保持一致, 浏览器与 Node 共用(便于测试)。
import { KB } from "./kb.js";

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
  let t = tok.replace(/[.,;:)\]]+$/, "").replace(/^[.]+/, "");
  return t;
}

export function toIso(text) {
  text = (text || "").trim();
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
  const low = text.toLowerCase();
  for (const [kw, code] of SOCIETY_MAP) {
    if (low.includes(kw.toLowerCase())) return code;
  }
  return "";
}

// 类型识别(列表顺序即匹配优先级)
const TYPE_BY_CODE = Object.fromEntries(KB.cert_types.map((ct) => [ct.code, `${ct.code}-${ct.name}`]));
export const TYPE_MAP = KB.cert_types.flatMap((ct) => ct.keywords.map((kw) => [kw, TYPE_BY_CODE[ct.code]]));
export const TITLE_HEADS = KB.title_heads.map((th) => [th.text, TYPE_BY_CODE[th.code]]);
export const UNIQUE_TITLES = KB.unique_titles.map((ut) => [ut.text, TYPE_BY_CODE[ut.code]]);

export const EXPIRY_PHRASES = KB.phrases.expiry;
export const ANNUAL_PHRASES = KB.phrases.annual_survey;
export const ISSUE_PHRASES = [...KB.phrases.issue_priority, ...KB.phrases.issue_fallback];
export const NUMBER_PHRASES = KB.phrases.number;

export function detectType(fullRaw) {
  const fullUpper = fullRaw.toUpperCase();
  // 1) 唯一短语(大小写不敏感)
  for (const [kw, name] of UNIQUE_TITLES) {
    if (fullRaw.toLowerCase().includes(kw.toLowerCase())) return name;
  }
  // 2) 全文关键词(英文转 upper; 中文直接匹配)
  for (const [kw, name] of TYPE_MAP) {
    const ascii = /^[\x00-\x7F]+$/.test(kw);
    if (ascii) {
      if (fullUpper.includes(kw.toUpperCase())) return name;
    } else if (fullRaw.includes(kw)) {
      return name;
    }
  }
  return "";
}

// 在 text 中找出所有候选日期(位置 + ISO)。
// 关键: DATE_RES 是带 ^...$ 锚点的"整 token 校验"式正则(供 matchDateToken 用),
// 不能用于在长文本里挖日期子串。这里改用【未锚定】的 DATEPAT 全局正则逐段扫描,
// 用 lastIndex 手动推进(标准 exec 循环), 既不会无限循环, 也不会因拼接 phrase+DATEPAT 巨型正则而原生崩溃。
const DATE_SCAN = new RegExp(DATEPAT, "gi");
export function extractAllDates(text) {
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

// 在 text 中, 对每个短语(按优先级)取其后最近的日期。
// 改为"先定位短语、再在其后窗口内取最近日期", 不再拼接 phrase+DATEPAT 巨型正则, 规避原生崩溃。
export function firstDateAfter(text, phrases) {
  const dates = extractAllDates(text);
  if (!dates.length) return "";
  const low = text.toLowerCase();
  for (const ph of phrases) {
    let idx = low.indexOf(ph.toLowerCase());
    while (idx >= 0) {
      let best = null, bestDist = Infinity;
      for (const d of dates) {
        const dist = d.index - idx;
        if (dist >= 0 && dist < bestDist) { bestDist = dist; best = d.iso; }
      }
      if (best) return best;
      idx = low.indexOf(ph.toLowerCase(), idx + 1);
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
export function extractNumber(text) {
  const t = String(text);
  const lines = t.split(/\r?\n/);
  // 第 1 遍: Certificate No(全文, 取含数字且非 Form 的编号)
  const certRe = /certificate\s+no\.?\s*[:：]?\s*(\S+)/gi;
  let m;
  while ((m = certRe.exec(t))) {
    const tok = m[1].replace(/[;:]$/, "");
    if (/\d/.test(tok) && !/^form$/i.test(tok)) return tok;
  }
  // 第 2 遍: Distinctive Number or Letters(吨位证标识)
  for (const line of lines) {
    const dm = line.match(/distinctive\s+number\s+or\s+letters\s*[:：]?\s*(\S+)/i);
    if (dm) return dm[1].replace(/[;:]$/, "");
  }
  // 第 3 遍: 中文 编号
  for (const line of lines) {
    const nm = line.match(/编号\s*(?:no\.?\s*)?[:：]?\s*(\S+)/i);
    if (nm) return nm[1].replace(/[;:]$/, "");
  }
  return "";
}
