// 纯文本辅助函数: 日期解析、船级社/类型识别、文本内日期提取。
// 与 Python 版 cert_tool.py 的对应逻辑保持一致, 浏览器与 Node 共用(便于测试)。
import { KB } from "./kb.js";

export const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12,
};
const MONTH_ALT = Object.keys(MONTHS).join("|");
const MONTH_RE = new RegExp(`^(${MONTH_ALT})$`, "i");

// 统一日期模式: ISO / DD Month YYYY / Month DD, YYYY / 中文 YYYY年M月D日
export const DATEPAT =
  `(?:\\d{4}-\\d{2}-\\d{2}` +
  `|\\d{1,2}\\s+(?:${MONTH_ALT})\\s+\\d{4}` +
  `|${MONTH_ALT}\\s+\\d{1,2},?\\s+\\d{4}` +
  `|\\d{4}年\\d{1,2}月\\d{1,2}日)`;

const DATE_RES = [
  /^\d{4}-\d{2}-\d{2}$/,
  new RegExp(`^\\d{1,2}\\s+${MONTH_ALT}\\s+\\d{4}$`, "i"),
  new RegExp(`^${MONTH_ALT}\\s+\\d{1,2},?\\s+\\d{4}$`, "i"),
  /^\d{4}年\d{1,2}月\d{1,2}日$/,
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
  if (m) return `${m[3]}-${String(MONTHS[m[2].title()]).padStart(2, "0")}-${String(parseInt(m[1], 10)).padStart(2, "0")}`;
  m = text.match(new RegExp(`^(${MONTH_ALT})\\s+(\\d{1,2}),?\\s+(\\d{4})$`, "i"));
  if (m) return `${m[3]}-${String(MONTHS[m[1].title()]).padStart(2, "0")}-${String(parseInt(m[2], 10)).padStart(2, "0")}`;
  m = text.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日$/);
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

// 在 text 中, 对每个短语(按优先级)取其后最近日期
export function firstDateAfter(text, phrases) {
  for (const ph of phrases) {
    const re = new RegExp(escapeRegExp(ph) + `\\s*[:：]?\\s*(${DATEPAT})`, "i");
    let m;
    while ((m = re.exec(text)) !== null) {
      const iso = toIso(m[1]);
      if (iso) return iso;
      if (m.index === re.lastIndex) re.lastIndex++;
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
