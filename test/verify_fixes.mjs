// 用日志里真实的 OCR 文本验证: extractNumber 不再吞整页 + detectType 正确归类
import { extractNumber, detectType } from "../src/helpers.js";
import { certOrderKey } from "../src/kb.js";

const cases = [
  {
    name: "COF",
    expectNo: "2170691", expectType: "1210",
    text: "2170691Page1of9IssuedundertheprovisionsoftheInternationalCodefortheConstructionandEquipmentofShipsCarryingLiquefiedGasesinBulk\nCertificateno:2170691Page2of93.Thatthefollowing\nForm2220(2025.10)",
  },
  {
    name: "IOPP",
    expectNo: "2170691", expectType: "1205",
    text: "2170691Page1of3Note:ThiscertificateshallbesupplementedbyaRecordofConstruction\nIssuedundertheprovisionsoftheInternationalConventionforthePreventionofPollutionfromShips,1973\nCertificateno:2170691Page2of3Endorsement\nForm2222(2020.12)",
  },
  {
    name: "IOPP Form A",
    expectNo: "2170691/01", expectType: "1205",
    text: "9HA58681.3PortofregistryVALLETTA1.4Grosstonnage116,581\nRecordno:2170691/01Page2of4X2.2.2Oilfiltering\nForm1478(2025.02)",
  },
  {
    name: "ISSC",
    expectNo: "2354798", expectType: "2222",
    text: "2354798Page1of1.IssuedundertheprovisionsoftheInternationalCodefortheSecurityofShipsandofPortFacilities(ISPSCode)\nForm2226(2015.06)",
  },
  {
    name: "SC",
    expectNo: "2170691", expectType: "2205",
    text: "2170691Page1of4IssuedundertheprovisionsoftheInternationalConventionfortheSafetyofLifeatSea,1974\n4.thatanExemptionCertificatehasnotbeenissued.\nCertificateno:2170691Page2of4Endorsement\nForm2221(2026.03)",
  },
  // 文字层(有空格)证书: 确保不被新逻辑破坏
  { name: "LL(text)", expectNo: "2359973", expectType: "1202", text: "INTERNATIONAL LOAD LINE CERTIFICATE\nCertificate No: 2359973\nvalid until 01 June 2031" },
  { name: "MM(text)", expectNo: "17752", expectType: "1102", text: "MINIMUM SAFE MANNING DOCUMENT\nCertificate No: 17752" },
  { name: "REG(text)", expectNo: "1186445", expectType: "1101", text: "Certificate of Registry\nCertificate No: 1186445 Form" },
  { name: "TON(text)", expectNo: "2170691", expectType: "1201", text: "INTERNATIONAL TONNAGE CERTIFICATE (1969)\nCertificate No: 2170691\nDistinctive number or letters 9HA5868" },
];

let pass = 0, fail = 0;
for (const c of cases) {
  const no = extractNumber(c.text);
  const ty = detectType(c.text);
  const tyCode = String(ty).split("-")[0];
  const okNo = no === c.expectNo;
  const okTy = tyCode === c.expectType;
  if (okNo && okTy) { pass++; console.log(`✓ ${c.name.padEnd(14)} no=${no}  type=${ty}`); }
  else { fail++; console.log(`✗ ${c.name.padEnd(14)} no=${no}(期望${c.expectNo}) type=${ty}(期望${c.expectType})`); }
}

// 验证排序: 期望 REG→MM→LL→SC→ISSC→IOPP→TON, COF 最后
const order = ["1101","1102","1202","2205","2222","1205","1201","1210"];
const sorted = [...order].sort((a,b)=>certOrderKey(a)-certOrderKey(b));
console.log("\n排序键:", order.map(c=>`${c}:${certOrderKey(c)}`).join("  "));
console.log("排序后:", sorted.join(" → "), sorted.slice(0,7).join(",")==="1101,1102,1202,2205,2222,1205,1201"?"✓":"✗");
console.log(`\n结果: ${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
