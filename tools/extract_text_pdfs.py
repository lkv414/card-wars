import os
from pypdf import PdfReader

TEXT_PDFS = [
    "KV_pravila_Finn_protiv_Dzheyka.pdf",
    "KV_pravila_Limonokhvat_protiv_Gantera.pdf",
    "KV_pravila_Printsessa_Bubylgum_protiv_Printsessy_Pupyrki.pdf",
    "KV_pravila_Snezhny_korol_protiv_Marselin.pdf",
    "httpssteamusercontentaakamaihdnetugc108521306567468085104CD2CD662E0646397FCE15CC256DE9DC34D8AC2A.pdf",
    "httpssteamusercontentaakamaihdnetugc138365234799043739574CD2CD662E0646397FCE15CC256DE9DC34D8AC2A.pdf"
]

def extract_text_pdf(pdf_path, txt_path):
    reader = PdfReader(pdf_path)
    lines = []
    lines.append(f"# {os.path.basename(pdf_path)}")
    lines.append(f"Количество страниц: {len(reader.pages)}\n")
    
    total_chars = 0
    for idx, page in enumerate(reader.pages):
        page_num = idx + 1
        text = page.extract_text() or ""
        text = text.strip()
        lines.append(f"=== СТРАНИЦА {page_num} ===")
        if text:
            lines.append(text)
            total_chars += len(text)
        else:
            lines.append("[Пустая страница или обложка / иллюстрация]")
        lines.append("")
    
    content = "\n".join(lines)
    with open(txt_path, "w", encoding="utf-8") as f:
        f.write(content)
    print(f"Extracted {pdf_path} -> {txt_path}: {len(reader.pages)} pages, {total_chars} characters.")

def main():
    pdf_dir = "pdf"
    for filename in TEXT_PDFS:
        pdf_path = os.path.join(pdf_dir, filename)
        if not os.path.exists(pdf_path):
            continue
        base_name = os.path.splitext(filename)[0]
        txt_path = os.path.join(pdf_dir, f"{base_name}.txt")
        extract_text_pdf(pdf_path, txt_path)

if __name__ == "__main__":
    main()
