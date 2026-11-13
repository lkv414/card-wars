import os
import json
import hashlib
from PIL import Image

CARDS = [
    {
        "stem": "httpssteamusercontentaakamaihdnetugc10201168166216416952D785024910644F73D907647A428CC2E00A0D9005",
        "dir": "исходники/Images/карты/болотные",
        "name": "Синхронизация",
        "name_en": "SYNCHRONIZATION",
        "type": "Болотная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Бесполезные болота",
        "landType": "swamp",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc135636775669062434410F5BFE798093C8961A57D2DAAE883150DA1D627C",
        "dir": "исходники/Images/карты/добрые",
        "name": "Братство",
        "name_en": "Brotherhood",
        "type": "Доброземельная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Милые земли",
        "landType": "nice",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc14505607370258222262421EB8B7C9439E4FF6A53A0200E99937C038A537",
        "dir": "исходники/Images/карты/добрые",
        "name": "Солидарность",
        "name_en": "SOLIDARITY",
        "type": "Доброземельная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Милые земли",
        "landType": "nice",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc1419057091487096657554A04B2665A14717169986E1C2D6C1898C084A73",
        "dir": "исходники/Images/карты/кукурузные",
        "name": "Взаимодействие",
        "name_en": "COOPERATION",
        "type": "Кукурузная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Кукурузные поля",
        "landType": "corn",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc10831945605558748415CBDE6194BB9DCA621E7895BBAAE2EE8D3130792A",
        "dir": "исходники/Images/карты/ледяные",
        "name": "Согласованность",
        "name_en": "COORDINATION",
        "type": "Ледяная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Ледяные земли",
        "landType": "icy",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc15028671562963214796C5FFD202A63DB1C369DE8CEEF4452D6A498E2DE7",
        "dir": "исходники/Images/карты/ледяные",
        "name": "Товарищество",
        "name_en": "CAMARADERIE",
        "type": "Ледяная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Ледяные земли",
        "landType": "icy",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc13523719793463912217A333BCB2F96E0942A7F5761F8F36DAF053C79F06",
        "dir": "исходники/Images/карты/песчаные",
        "name": "Подмога",
        "name_en": "ASSISTANCE",
        "type": "Песчаная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Песчаные земли",
        "landType": "sandy",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc11881964550275791963E87B693496461714AAB6F8B6F35BD14CB589A43B",
        "dir": "исходники/Images/карты/радужные",
        "name": "Коллаборация",
        "name_en": "COLLABORATION",
        "type": "Радужная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Радужные земли",
        "landType": "rainbow",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc12167466702917825435E4343EE006CA846020B944812355F3A97CD49EC4",
        "dir": "исходники/Images/карты/радужные",
        "name": "Коммуникация",
        "name_en": "COMMUNICATION",
        "type": "Радужная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Радужные земли",
        "landType": "rainbow",
    },
    {
        "stem": "httpssteamusercontentaakamaihdnetugc1744716511561633705977441908BEC777C71C3B953B88071F249B3C8AAC",
        "dir": "исходники/Images/карты/синие равнины",
        "name": "Общий вклад",
        "name_en": "SHARED CONTRIBUTION",
        "type": "Равнинная командная работа",
        "typeCategory": "teamwork",
        "land_type": "Синие равнины",
        "landType": "blue",
    }
]

def compute_sha256(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

def clean_description(desc: str, card_type: str) -> str:
    lines = desc.split("\n")
    if lines and ("командная работа" in lines[0].lower() or lines[0].strip() == card_type):
        lines = lines[1:]
    return "\n".join(lines).strip()

def main():
    print(f"Auditing/processing {len(CARDS)} Teamwork cards...")
    for c in CARDS:
        img_path = os.path.join(c["dir"], c["stem"] + ".png")
        json_path = os.path.join(c["dir"], c["stem"] + ".json")

        if not os.path.exists(img_path) or not os.path.exists(json_path):
            continue

        with Image.open(img_path) as im:
            if im.size[0] < im.size[1]:
                rotated = im.transpose(Image.Transpose.ROTATE_90)
                rotated.save(img_path)

        new_hash = compute_sha256(img_path)

        with open(json_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        data["name"] = c["name"]
        data["name_en"] = c["name_en"]
        data["type"] = c["type"]
        data["typeCategory"] = c["typeCategory"]
        data["land_type"] = c["land_type"]
        data["landType"] = c["landType"]
        data["orientation"] = "landscape"
        data["sha256"] = new_hash
        data["description"] = clean_description(data.get("description", ""), c["type"])

        with open(json_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    print("Done.")

if __name__ == "__main__":
    main()
