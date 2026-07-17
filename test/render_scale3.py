import fitz, os, sys

SRC = r"C:/Users/caolg/Downloads/2.船舶证书-古弗尼尔.pdf"
OUT = r"D:/workbuddy/2026-07-16-18-55-51/ship-cert-web/test/ocr-scan"
os.makedirs(OUT, exist_ok=True)
# scale=3 -> dpi = 3*72 = 216, 与 engine.js OCR_SCALE 对齐
doc = fitz.open(SRC)
for i, page in enumerate(doc):
    pix = page.get_pixmap(dpi=216)
    pix.save(os.path.join(OUT, f"page_{i+1:02d}.png"))
print(f"RENDERED {doc.page_count} pages @ dpi=216 -> {OUT}")
