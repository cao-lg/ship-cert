# 船舶证书 PDF 标注与信息汇总（纯前端版）

把原来的 Python 桌面工具（PyMuPDF + openpyxl）完整移植为**纯前端、浏览器本地运行**的网站，
可一键部署到 **Cloudflare Pages**。所有 PDF 解析、画框、Excel 生成都在用户浏览器本地完成，**文件不上传任何服务器**。

## 功能

- 拖拽 / 选择多个带**文本层**的船舶证书 PDF。
- 自动识别每本证书，在**有效日期**处画**红框**，在**年度/中间检验**日期处画**蓝/绿/橙框**。
- 自动汇总证书信息到 Excel（沿用内置 `船舶证书信息模板.xlsx` 的样式）。
- 支持船级社/登记处：DNV、CCS、LR、ABS、BV、NK、RS、RINA、IRS、KR、PRS、CRS 等；覆盖 18 类常见证书。
- 识别规则集中在 `src/kb.js`（知识库），改配置即可扩展，无需动主逻辑。

## 本地开发

```bash
npm install
npm run dev        # 打开提示的本地地址即可使用
```

## 构建（用于部署）

```bash
npm run build      # 产物输出到 dist/
```

`dist/` 是纯静态站点，可直接托管到任意静态服务 / Cloudflare Pages。

## 部署到 Cloudflare Pages

**方式 A：连接 Git 仓库（推荐）**

1. 把本项目推到 GitHub / GitLab。
2. Cloudflare Pages 控制台 → "创建项目" → 连接仓库。
3. 构建设置：
   - **构建命令（Build command）**：`npm run build`
   - **输出目录（Build output directory）**：`dist`
   - **Node 版本**：在仪表盘设置为 `20`（或 `22`）。也可在 `package.json` 加 `"engines": { "node": ">=20" }`。
4. 保存并部署。每次 push 自动重新构建。

**方式 B：Wrangler CLI 本地/CI 部署**

```bash
npm i -g wrangler
wrangler pages deploy dist
```

（已附 `wrangler.toml`，声明了 `pages_build_output_dir = "dist"`。）

> 说明：站点为纯静态、无函数（Functions），不涉及任何服务端代码。
> 浏览器需要加载 pdf.js 的 worker 与标准字体，已随 `dist/` 一并发布，无需额外配置。

## 扩展识别能力

所有证书类型、船级社、双语短语都在 `src/kb.js`：

- `cert_types`：证书类型与中英关键词（按导入模板的 18 类下拉编码）。
- `societies`：船级社关键词。
- `phrases`：`expiry` / `annual_survey` / `issue_*` / `number` 的中英短语。
- 新增证书或船级社时，只改这里、重新 `npm run build` 即可。

## 与原 Python 版的一致性

核心识别逻辑（红/绿框坐标、分组、签发/有效/年检日期、证书编号）与 Python 版 `cert_tool.py` 完全对齐。
已在真实样例上验证：DNV「航海家」多证书 PDF → 红框 4、年检框 12、识别 5 本证书，签发日期（构造/载重线/防止油污 = 2021-12-03）等均一致。

## 本地冒烟测试（可选）

```bash
node test/smoke.mjs        # 用 Node + pdf.js 在样例 PDF 上跑引擎, 核对红/绿框数与识别结果
```

（注：Node 环境的 worker 无法 fetch `file://` 标准字体，个别使用标准 14 字体的 PDF 在 Node 下会报字体警告；
浏览器端走 HTTP 加载标准字体，不受影响。）
