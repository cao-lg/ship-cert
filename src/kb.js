// 船舶证书识别知识库 (由 Python 版 cert_kb.json 原样移植, 配置即规则)
// 扩展兼容性只需改这里, 主逻辑不变。

export const KB = {
  version: "1.0",
  description:
    "船舶证书识别知识库: 船级社、双语字段短语、全18类下拉编码(中英关键词)、标题/唯一短语。",
  societies: [
    { code: "DNV", keywords: ["DNV", "DET NORSKE VERITAS", "DNV GL"] },
    { code: "CCS", keywords: ["CHINA CLASSIFICATION SOCIETY", "中国船级社", "CCS"] },
    { code: "LR", keywords: ["LLOYD'S REGISTER", "LLOYD", "LR"] },
    { code: "ABS", keywords: ["AMERICAN BUREAU OF SHIPPING", "AMERICAN BUREAU", "ABS"] },
    { code: "BV", keywords: ["BUREAU VERITAS", "BV"] },
    { code: "NK", keywords: ["CLASSNK", "日本海事協会", "NK"] },
    { code: "RS", keywords: ["RUSSIAN MARITIME REGISTER", "RS"] },
    { code: "RINA", keywords: ["RINA"] },
    { code: "IRS", keywords: ["INDIAN REGISTER OF SHIPPING", "IRS"] },
    { code: "KR", keywords: ["KOREAN REGISTER", "KR"] },
    { code: "PRS", keywords: ["POLISH REGISTER", "PRS"] },
    { code: "CRS", keywords: ["CROATIAN REGISTER", "CRS"] },
  ],
  phrases: {
    expiry: [
      "valid until", "valid till", "expires on", "accepted as valid until",
      "本证书有效期至", "有效期至", "失效日期", "到期", "有效期限", "过期日期",
    ],
    annual_survey: [
      "annual survey", "intermediate survey", "annual/intermediate survey",
      "annual and intermediate survey",
      "年度检验", "期间检验", "中间检验", "年度检验/期间检验",
    ],
    issue_priority: [
      "completion date of survey on which this certificate is based",
      "签发本证书所基于的检验的完成日期", "检验的完成日期",
    ],
    issue_fallback: [
      "date of issue", "issued on", "issued at", "issud",
      "发证日期", "签发日期",
    ],
    number: ["certificate no.", "编号 no.", "no."],
  },
  cert_types: [
    { code: "2205", name: "货船构造安全证书", keywords: ["CONSTRUCTION CERTIFICATE", "货船构造安全证书", "构造安全证书"] },
    { code: "2206", name: "货船设备安全证书", keywords: ["EQUIPMENT CERTIFICATE", "货船设备安全证书", "设备安全证书"] },
    { code: "2207", name: "货船无线电安全证书", keywords: ["RADIO CERTIFICATE", "货船无线电安全证书", "无线电安全证书"] },
    { code: "1209", name: "海上船舶散装运输危险化学品适装证书", keywords: ["DANGEROUS CHEMICALS IN BULK", "危险化学品适装证书", "危险化学品"] },
    { code: "1210", name: "海上船舶散装运输液化气体适装证书", keywords: ["LIQUEFIED GASES IN BULK", "液化气体适装证书", "液化气体"] },
    { code: "2209", name: "国际防止散装运输有毒液体物质污染证书", keywords: ["NOXIOUS LIQUID SUBSTANCES IN BULK", "有毒液体物质污染证书", "有毒液体物质"] },
    { code: "2222", name: "国际船舶保安证书", keywords: ["INTERNATIONAL SHIP SECURITY", "国际船舶保安证书", "船舶保安证书"] },
    { code: "1201", name: "海上船舶吨位证书", keywords: ["INTERNATIONAL TONNAGE", "国际吨位证书", "吨位证书"] },
    { code: "1202", name: "海上船舶载重线证书", keywords: ["INTERNATIONAL LOAD LINE", "国际载重线证书", "载重线证书"] },
    { code: "1205", name: "海上船舶防止油污证书", keywords: ["INTERNATIONAL OIL POLLUTION", "PREVENTION CERTIFICATE", "IOPP", "国际防止油污证书", "防止油污证书"] },
    { code: "1102", name: "船舶最低安全配员证书", keywords: ["MINIMUM SAFE MANNING", "最低安全配员证书", "安全配员证书"] },
    { code: "1104", name: "安全管理证书", keywords: ["SAFETY MANAGEMENT CERTIFICATE", "安全管理证书"] },
    { code: "1105", name: "油污损害民事责任保险或其他财务保证证书", keywords: ["CERTIFICATE OF INSURANCE OR OTHER FINANCIAL SECURITY IN RESPECT OF CIVIL LIABILITY FOR OIL POLLUTION DAMAGE", "CIVIL LIABILITY FOR OIL POLLUTION DAMAGE", "油污损害民事责任保险", "油污损害"] },
    { code: "2103", name: "符合证明副本", keywords: ["DOCUMENT OF COMPLIANCE", "符合证明副本", "符合证明"] },
    { code: "2219", name: "船舶航行安全证书", keywords: ["船舶航行安全证书", "航行安全证书"] },
    { code: "2203", name: "客船/货船安全证书", keywords: ["PASSENGER SHIP SAFETY CERTIFICATE", "CARGO SHIP SAFETY CERTIFICATE", "客船/货船安全证书", "客船安全证书"] },
    { code: "1215", name: "海上船舶免除证书", keywords: ["EXEMPTION CERTIFICATE", "免除证书"] },
    { code: "1101", name: "船舶国籍证书", keywords: ["CERTIFICATE OF REGISTRY", "船舶国籍证书", "国籍证书"] },
  ],
  title_heads: [
    { text: "INTERNATIONAL LOAD LINE", code: "1202" },
    { text: "MINIMUM SAFE MANNING", code: "1102" },
    { text: "INTERNATIONAL SHIP SECURITY", code: "2222" },
    { text: "INTERNATIONAL TONNAGE", code: "1201" },
    { text: "INTERNATIONAL OIL POLLUTION", code: "1205" },
    { text: "CARGO SHIP SAFETY", code: "2205" },
    { text: "CERTIFICATE OF REGISTRY", code: "1101" },
  ],
  unique_titles: [
    { text: "Cargo Ship Safety Construction Certificate", code: "2205" },
    { text: "International oil pollution prevention certificate", code: "1205" },
    { text: "IOPP", code: "1205" },
  ],
};

// 颜色(pdf-lib rgb, 0~1)
export const ANNUAL_COLORS = {
  blue: { stroke: [0.0, 0.0, 0.8], fill: [0.82, 0.9, 1.0] },
  green: { stroke: [0.0, 0.5, 0.0], fill: [0.82, 1.0, 0.85] },
  orange: { stroke: [0.85, 0.45, 0.0], fill: [1.0, 0.9, 0.8] },
};
export const RED = [1.0, 0.0, 0.0];
export const RED_FILL = [1.0, 0.85, 0.85];
