import os
import subprocess
import shutil
import pymupdf

SCANNED_PDFS = [
    ("KV_pravila_Parny_turnir_ru.pdf", "parny_turnir", "KV_pravila_Parny_turnir_ru.txt"),
    ("KV_pravila_Myatny_Batler_protiv_Volshebnogo_Chela.pdf", "myatny_batler", "KV_pravila_Myatny_Batler_protiv_Volshebnogo_Chela.txt"),
    ("KV_pravila_Printsessa_Plamya_protiv_Fyorna_ru (1).pdf", "plamya_fyorna", "KV_pravila_Printsessa_Plamya_protiv_Fyorna_ru (1).txt"),
    ("KV_pravila_Prizmo_protiv_Licha.pdf", "prizmo_lich", "KV_pravila_Prizmo_protiv_Licha.txt"),
    ("httpssteamusercontentaakamaihdnetugc121192860575437910379BD3104321B052FCA5C95459385C4435F01F2ABF.pdf", "steam_12119", "httpssteamusercontentaakamaihdnetugc121192860575437910379BD3104321B052FCA5C95459385C4435F01F2ABF.txt")
]

COPIES = [
    ("pdf/KV_pravila_Parny_turnir_ru.txt", "pdf/httpssteamusercontentaakamaihdnetugc1039868111602253081882EE43852B736A7EF0C9B6838510762C7516467A.txt"),
    ("pdf/KV_pravila_Printsessa_Plamya_protiv_Fyorna_ru (1).txt", "pdf/httpssteamusercontentaakamaihdnetugc17418243710859230346082EBFBC44E8E74E3B1285C9892427344E089A1A.txt")
]

def render_pages_to_images(pdf_path, prefix, temp_dir):
    os.makedirs(temp_dir, exist_ok=True)
    doc = pymupdf.open(pdf_path)
    print(f"Rendering {pdf_path} ({len(doc)} pages)...")
    rendered_files = []
    for i in range(len(doc)):
        page = doc[i]
        rect = page.rect
        max_dim = max(rect.width, rect.height)
        scale = min(3500.0 / max_dim, 2.5)
        mat = pymupdf.Matrix(scale, scale)
        pix = page.get_pixmap(matrix=mat)
        img_name = f"{prefix}_p{i+1}.png"
        img_path = os.path.join(temp_dir, img_name)
        pix.save(img_path)
        rendered_files.append(img_path)
        print(f"  Page {i+1}: {pix.width}x{pix.height} saved to {img_name}")
    return rendered_files

def run_ocr(prefix, out_path):
    cmd = [
        "powershell",
        "-ExecutionPolicy", "Bypass",
        "-File", "tools/batch_ocr.ps1",
        "-PdfStem", prefix,
        "-OutFile", out_path,
        "-Lang", "ru"
    ]
    print(f"Running OCR for {prefix} -> {out_path}...")
    res = subprocess.run(cmd, capture_output=True, text=True)
    if res.returncode != 0:
        print(f"ERROR running OCR for {prefix}:")
        print(res.stderr)
        raise RuntimeError(f"OCR failed for {prefix}")
    print(res.stdout)

def main():
    temp_dir = "pdf/temp"
    os.makedirs(temp_dir, exist_ok=True)
    
    for pdf_name, prefix, txt_name in SCANNED_PDFS:
        pdf_path = os.path.join("pdf", pdf_name)
        out_txt = os.path.join("pdf", txt_name)
        if not os.path.exists(pdf_path):
            print(f"Skipping {pdf_path}: not found")
            continue
        
        # Render pages
        imgs = render_pages_to_images(pdf_path, prefix, temp_dir)
        
        # Run OCR
        run_ocr(prefix, out_txt)
        
        # Cleanup rendered images
        for img in imgs:
            if os.path.exists(img):
                os.remove(img)
                
    # Copy identical files
    for src, dst in COPIES:
        if os.path.exists(src):
            shutil.copyfile(src, dst)
            print(f"Copied {src} -> {dst}")
            
    # Cleanup temp dir
    if os.path.exists(temp_dir):
        shutil.rmtree(temp_dir)
    print("All scanned PDFs OCR-ed successfully!")

if __name__ == "__main__":
    main()
