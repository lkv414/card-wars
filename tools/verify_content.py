import os
import sys
import json
import hashlib
import struct

target_dir = sys.argv[1] if len(sys.argv) > 1 else 'content'
print(f'Verifying target: {target_dir}')

sections = [
    ('cards', 'cards/json', 'cards/images'),
    ('heroes', 'heroes/json', 'heroes/images'),
    ('lands', 'lands/json', 'lands/images'),
]

errors = []
total_checked = 0

def is_valid_png(path):
    if not os.path.exists(path) or os.path.getsize(path) < 8:
        return False, 'file too small or missing'
    with open(path, 'rb') as f:
        header = f.read(8)
        if header != b'\x89PNG\r\n\x1a\n':
            return False, 'invalid PNG magic signature'
        f.read(4)
        chunk_type = f.read(4)
        if chunk_type != b'IHDR':
            return False, 'first chunk is not IHDR'
        ihdr_data = f.read(13)
        width, height = struct.unpack('>II', ihdr_data[:8])
        if width <= 0 or height <= 0:
            return False, f'invalid dimensions {width}x{height}'
    return True, f'{width}x{height}'

for section_name, json_rel, img_rel in sections:
    jdir = os.path.join(target_dir, json_rel)
    idir = os.path.join(target_dir, img_rel)
    
    if not os.path.exists(jdir):
        errors.append(f'Missing json dir: {jdir}')
        continue
    if not os.path.exists(idir):
        errors.append(f'Missing img dir: {idir}')
        continue
        
    jfiles = set(f for f in os.listdir(jdir) if f.endswith('.json'))
    ifiles = set(f for f in os.listdir(idir) if f.endswith('.png'))
    
    jstems = set(f[:-5] for f in jfiles)
    istems = set(f[:-4] for f in ifiles)
    
    missing_imgs = jstems - istems
    missing_jsons = istems - jstems
    
    if missing_imgs:
        errors.append(f'{section_name}: JSONs without images ({len(missing_imgs)}): {sorted(list(missing_imgs))[:5]}')
    if missing_jsons:
        errors.append(f'{section_name}: Images without JSON ({len(missing_jsons)}): {sorted(list(missing_jsons))[:5]}')
        
    for jf in sorted(jfiles):
        total_checked += 1
        jpath = os.path.join(jdir, jf)
        stem = jf[:-5]
        ipath = os.path.join(idir, stem + '.png')
        
        try:
            with open(jpath, 'r', encoding='utf-8') as f:
                data = json.load(f)
        except Exception as e:
            errors.append(f'Corrupt JSON {jpath}: {e}')
            continue
            
        if os.path.exists(ipath):
            valid, reason = is_valid_png(ipath)
            if not valid:
                errors.append(f'Corrupt PNG image {ipath}: {reason}')
            else:
                if 'sha256' in data and data['sha256']:
                    actual_sha = hashlib.sha256(open(ipath, 'rb').read()).hexdigest()
                    if data['sha256'] != actual_sha:
                        errors.append(f'SHA256 mismatch in {jpath}: expected {data["sha256"]}, got {actual_sha}')
                
    print(f'Checked {section_name}: {len(jfiles)} JSONs, {len(ifiles)} Images.')

index_path = os.path.join(target_dir, 'index.json')
if not os.path.exists(index_path):
    errors.append(f'Missing {index_path}')
else:
    index_data = json.load(open(index_path, encoding='utf-8'))
    print(f'index.json entries count: {len(index_data)}')
    for item in index_data:
        img_rel = item.get('image', '').lstrip('/')
        check_path = os.path.join(target_dir, img_rel[8:]) if img_rel.startswith('content/') else os.path.join(target_dir, img_rel)
        if not os.path.exists(check_path):
            errors.append(f'index.json references missing image: {check_path} for {item.get("id")}')

print('\n' + '='*50)
if errors:
    print(f'FOUND {len(errors)} ERRORS:')
    for err in errors:
        print('  ERROR:', err)
else:
    print(f'ALL {total_checked} ITEMS IN {target_dir} ARE 100% VALID, COMPATIBLE AND MATCHING!')
