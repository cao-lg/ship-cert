// 验证去重 + 强化幽灵过滤 + 短代码词边界, 覆盖用户截图里的场景
import { detectSociety } from "../src/helpers.js";

// 模拟 buildRecord 内部的去重(同 engine.js 逻辑, 独立可测)
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

let pass = 0, fail = 0;
function check(name, cond, extra = "") {
  if (cond) { pass++; console.log(`✓ ${name}`); }
  else { fail++; console.log(`✗ ${name}  ${extra}`); }
}

// 1. SC: 1有日期 + 1空 → 合并
const sc = [
  { type: "2205-货船构造安全证书", no: "2170691", issue: "2026-06-02", expiry: "2031-06-01", annual: "2031-06-01", remark: "签发机构:LR；来源:SC.pdf", _ghost: false },
  { type: "2205-货船构造安全证书", no: "2170691", issue: "", expiry: "", annual: "", remark: "签发机构:LR；来源:SC.pdf", _ghost: false },
];
const scDedup = dedupRecords(sc);
check("SC 去重后剩 1 条", scDedup.length === 1, `实际 ${scDedup.length}`);
check("SC 保留有日期那条", scDedup[0]?.expiry === "2031-06-01" && scDedup[0]?.issue === "2026-06-02");

// 2. IOPP: 1有日期 + 1空 → 合并
const iopp = [
  { type: "1205-海上船舶防止油污证书", no: "2170691", issue: "2026-06-02", expiry: "2031-06-01", annual: "", remark: "签发机构:LR", _ghost: false },
  { type: "1205-海上船舶防止油污证书", no: "2170691", issue: "", expiry: "", annual: "", remark: "签发机构:LR", _ghost: false },
];
const ioppDedup = dedupRecords(iopp);
check("IOPP 去重后剩 1 条", ioppDedup.length === 1);

// 3. COF: 1有日期(LR) + 1空(误判RS) + 1空 → 合并为1条(LR胜出)
const cof = [
  { type: "1210-液化气体适装证书", no: "2170691", issue: "2026-06-02", expiry: "2026-11-01", annual: "", remark: "签发机构:LR", _ghost: false },
  { type: "1210-液化气体适装证书", no: "2170691", issue: "", expiry: "", annual: "", remark: "签发机构:RS", _ghost: false },
  { type: "1210-液化气体适装证书", no: "2170691", issue: "", expiry: "", annual: "", remark: "签发机构:LR", _ghost: false },
];
const cofDedup = dedupRecords(cof);
check("COF 去重后剩 1 条", cofDedup.length === 1);
check("COF 保留 LR 机构(丢弃误判 RS)", cofDedup[0]?.remark.includes("签发机构:LR"));

// 4. 强化幽灵过滤
function isGhost(r) { return !r.no && !r.issue && !r.expiry && !r.annual; }
check("只类型没编号没日期 → 幽灵", isGhost({ type: "1101", no: "", issue: "", expiry: "", annual: "" }));
check("有编号没日期 → 保留", !isGhost({ type: "1101", no: "1186445", issue: "", expiry: "", annual: "" }));

// 5. detectSociety 词边界
const t1 = "thiscertificateshowedthatyearsaftertheSurveyorsigned";
check("'years' 不再误判 RS", detectSociety(t1) !== "RS", `实际: ${detectSociety(t1)}`);
check("Lloyd 仍能识别 LR", detectSociety("Lloyd'sRegisterGroupLimited") === "LR", `实际: ${detectSociety("Lloyd'sRegisterGroupLimited")}`);
check("真 RS 仍能识别", detectSociety("RussianMaritimeRegisterofShipping") === "RS", `实际: ${detectSociety("RussianMaritimeRegisterofShipping")}`);

console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
