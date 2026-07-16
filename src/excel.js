// Excel 汇总: 加载内置模板, 按 序号|证书类型|证书编号|签发日期|有效日期|年检日期|备注 写入数据行。
import ExcelJS from "exceljs";

export async function buildExcelWorkbook(templateBytes, records) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(templateBytes);
  const ws = wb.getWorksheet("船舶证书信息");
  if (!ws) throw new Error("模板缺少 '船舶证书信息' sheet");
  // 清空第 3 行起的旧数据(保留表头/说明行与样式)
  const last = ws.rowCount || 2;
  for (let r = 3; r <= last; r++) {
    const row = ws.getRow(r);
    for (let c = 1; c <= 7; c++) row.getCell(c).value = null;
  }
  records.forEach((rec, i) => {
    const row = ws.getRow(3 + i); // 数据从第 3 行开始
    row.getCell(1).value = i + 1;
    row.getCell(2).value = rec.type;
    row.getCell(3).value = rec.no;
    row.getCell(4).value = rec.issue;
    row.getCell(5).value = rec.expiry;
    row.getCell(6).value = rec.annual;
    row.getCell(7).value = rec.remark;
  });
  const buf = await wb.xlsx.writeBuffer();
  return buf; // ArrayBuffer (浏览器) / Buffer (Node)
}
