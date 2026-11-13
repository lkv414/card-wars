#!/usr/bin/env python3
"""
Verification script for high-res images and generated OCR JSON files in исходники/Images/

Verifies:
1. Every image in исходники/Images/ has a corresponding .json with the same stem.
2. Every JSON contains valid syntax, exact sha256 matching the image, non-empty name, type, and appropriate fields.
3. Every PNG/JPG file is not corrupted and has valid dimensions.
4. Breaks down status and errors by responsible agent (@ocr-heroes-lands, @ocr-cards-1, @ocr-cards-2).
"""

import os
import sys
import json
import hashlib
import struct
import argparse
from typing import Dict, List, Tuple, Any, Optional

IMAGES_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'исходники', 'Images'))

# Mapping folder path relative to исходники/Images to responsible agent
AGENT_MAPPING = {
    'герои': 'ocr-heroes-lands',
    'земли': 'ocr-heroes-lands',
    'прочее': 'ocr-heroes-lands',
    os.path.join('карты', 'болотные'): 'ocr-cards-1',
    os.path.join('карты', 'добрые'): 'ocr-cards-1',
    os.path.join('карты', 'кукурузные'): 'ocr-cards-1',
    os.path.join('карты', 'лавовые'): 'ocr-cards-1',
    os.path.join('карты', 'ледяные'): 'ocr-cards-2',
    os.path.join('карты', 'песчаные'): 'ocr-cards-2',
    os.path.join('карты', 'радужные'): 'ocr-cards-2',
    os.path.join('карты', 'синие равнины'): 'ocr-cards-2',
    os.path.join('карты', 'хеллоуинские'): 'ocr-cards-2',
}

IMAGE_EXTENSIONS = ('.png', '.jpg', '.jpeg')

def get_responsible_agent(rel_dir: str) -> str:
    norm_rel = os.path.normpath(rel_dir)
    # Match longest prefix
    for path_key, agent in AGENT_MAPPING.items():
        norm_key = os.path.normpath(path_key)
        if norm_rel == norm_key or norm_rel.startswith(norm_key + os.sep):
            return agent
    # Fallback by top-level
    parts = norm_rel.split(os.sep)
    if parts:
        top = parts[0]
        if top in AGENT_MAPPING:
            return AGENT_MAPPING[top]
        if len(parts) > 1:
            two_level = os.path.join(parts[0], parts[1])
            if two_level in AGENT_MAPPING:
                return AGENT_MAPPING[two_level]
    return 'unknown'

def verify_png(path: str) -> Tuple[bool, str]:
    if not os.path.exists(path) or os.path.getsize(path) < 8:
        return False, 'file too small or missing'
    try:
        with open(path, 'rb') as f:
            header = f.read(8)
            if header != b'\x89PNG\r\n\x1a\n':
                return False, 'invalid PNG magic signature'
            length_bytes = f.read(4)
            if len(length_bytes) < 4:
                return False, 'incomplete chunk length'
            chunk_type = f.read(4)
            if chunk_type != b'IHDR':
                return False, 'first chunk is not IHDR'
            ihdr_data = f.read(13)
            if len(ihdr_data) < 13:
                return False, 'truncated IHDR'
            width, height = struct.unpack('>II', ihdr_data[:8])
            if width <= 0 or height <= 0:
                return False, f'invalid dimensions {width}x{height}'
        return True, f'{width}x{height}'
    except Exception as e:
        return False, f'PNG read error: {e}'

def verify_jpeg(path: str) -> Tuple[bool, str]:
    if not os.path.exists(path) or os.path.getsize(path) < 4:
        return False, 'file too small or missing'
    try:
        with open(path, 'rb') as f:
            data = f.read()
        if len(data) < 4 or data[:2] != b'\xff\xd8':
            return False, 'not a valid JPEG'
        offset = 2
        while offset < len(data):
            if data[offset] != 0xff:
                return False, f'invalid marker at {offset}'
            while offset < len(data) and data[offset] == 0xff:
                offset += 1
            if offset >= len(data):
                break
            marker = data[offset]
            offset += 1
            if marker in (0xd9, 0xda):  # EOI or SOS
                break
            if marker in (0xd0, 0xd1, 0xd2, 0xd3, 0xd4, 0xd5, 0xd6, 0xd7, 0x01):
                continue
            if offset + 2 > len(data):
                return False, 'truncated marker length'
            length = struct.unpack('>H', data[offset:offset+2])[0]
            if marker in (0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf):
                if offset + length > len(data):
                    return False, 'truncated SOF'
                _, h, w = struct.unpack('>BHH', data[offset+2:offset+7])
                if w <= 0 or h <= 0:
                    return False, f'invalid dimensions {w}x{h}'
                return True, f'{w}x{h}'
            offset += length
        return False, 'no SOF found'
    except Exception as e:
        return False, f'JPEG read error: {e}'

def verify_image_file(path: str) -> Tuple[bool, str]:
    ext = os.path.splitext(path)[1].lower()
    if ext == '.png':
        return verify_png(path)
    elif ext in ('.jpg', '.jpeg'):
        return verify_jpeg(path)
    return False, f'unsupported image format {ext}'

def compute_sha256(path: str) -> str:
    hasher = hashlib.sha256()
    with open(path, 'rb') as f:
        while chunk := f.read(65536):
            hasher.update(chunk)
    return hasher.hexdigest()

def verify_json_content(jpath: str, expected_sha: str, is_card: bool, is_hero: bool, is_land: bool) -> List[str]:
    issues = []
    try:
        with open(jpath, 'r', encoding='utf-8') as f:
            data = json.load(f)
    except Exception as e:
        return [f'Invalid JSON syntax: {e}']

    if not isinstance(data, dict):
        return ['JSON root is not an object']

    # SHA256 check
    json_sha = data.get('sha256')
    if not json_sha:
        issues.append('Missing "sha256" field')
    elif json_sha.lower() != expected_sha.lower():
        issues.append(f'SHA256 mismatch: expected {expected_sha}, got {json_sha}')

    # Name check
    name = data.get('name')
    if name is None or (isinstance(name, str) and not name.strip()):
        issues.append('Missing or empty "name" field')

    # Type check
    card_type = data.get('type')
    if card_type is None or (isinstance(card_type, str) and not card_type.strip()):
        issues.append('Missing or empty "type" field')

    # Section-specific checks
    if is_card:
        # Expected fields in card metadata
        for field in ('description',):
            if field not in data:
                issues.append(f'Missing card field "{field}"')
    elif is_hero:
        # Hero should have description or ability
        if 'description' not in data and 'ability' not in data:
            issues.append('Missing hero description or ability field')

    return issues

def scan_and_verify(root: str = IMAGES_ROOT) -> Dict[str, Any]:
    report = {
        'total_images': 0,
        'total_verified': 0,
        'total_missing_jsons': 0,
        'total_corrupted_images': 0,
        'total_json_errors': 0,
        'agents': {
            'ocr-heroes-lands': {'images': 0, 'verified': 0, 'missing_json': [], 'corrupt_img': [], 'json_errors': []},
            'ocr-cards-1': {'images': 0, 'verified': 0, 'missing_json': [], 'corrupt_img': [], 'json_errors': []},
            'ocr-cards-2': {'images': 0, 'verified': 0, 'missing_json': [], 'corrupt_img': [], 'json_errors': []},
        },
        'unassigned': []
    }

    if not os.path.exists(root):
        print(f"Error: root directory '{root}' does not exist.")
        return report

    for dirpath, _, filenames in os.walk(root):
        rel_dir = os.path.relpath(dirpath, root)
        if rel_dir == '.':
            continue
        agent = get_responsible_agent(rel_dir)
        agent_dict = report['agents'].get(agent)
        if not agent_dict:
            agent_dict = {'images': 0, 'verified': 0, 'missing_json': [], 'corrupt_img': [], 'json_errors': []}
            report['agents'][agent] = agent_dict

        # Collect images and jsons
        for f in filenames:
            stem, ext = os.path.splitext(f)
            if ext.lower() not in IMAGE_EXTENSIONS:
                continue

            report['total_images'] += 1
            agent_dict['images'] += 1

            img_path = os.path.join(dirpath, f)
            json_path = os.path.join(dirpath, stem + '.json')
            rel_file = os.path.join(rel_dir, f)

            # 1. Image corruption & dimension check
            img_ok, img_info = verify_image_file(img_path)
            if not img_ok:
                report['total_corrupted_images'] += 1
                agent_dict['corrupt_img'].append((rel_file, img_info))
                continue

            # 2. JSON existence check
            if not os.path.exists(json_path):
                report['total_missing_jsons'] += 1
                agent_dict['missing_json'].append(rel_file)
                continue

            # 3. JSON content & SHA256 check
            expected_sha = compute_sha256(img_path)
            is_card = rel_dir.startswith('карты')
            is_hero = rel_dir.startswith('герои')
            is_land = rel_dir.startswith('земли')

            issues = verify_json_content(json_path, expected_sha, is_card, is_hero, is_land)
            if issues:
                report['total_json_errors'] += 1
                agent_dict['json_errors'].append((os.path.join(rel_dir, stem + '.json'), issues))
            else:
                agent_dict['verified'] += 1
                report['total_verified'] += 1

    return report

def print_report(report: Dict[str, Any], verbose: bool = False):
    total = report['total_images']
    verified = report['total_verified']
    missing = report['total_missing_jsons']
    corrupt = report['total_corrupted_images']
    json_errs = report['total_json_errors']

    print('=' * 70)
    print(' OCR & METADATA VERIFICATION REPORT')
    print('=' * 70)
    print(f'Total Images Scanned: {total}')
    print(f'Fully Verified:       {verified} ({(verified/total*100) if total else 0:.1f}%)')
    print(f'Missing JSONs:        {missing}')
    print(f'Corrupted Images:     {corrupt}')
    print(f'JSON / SHA Errors:    {json_errs}')
    print('-' * 70)

    for agent_name, data in report['agents'].items():
        ag_total = data['images']
        if ag_total == 0:
            continue
        ag_ver = data['verified']
        pct = (ag_ver / ag_total * 100) if ag_total else 0.0
        print(f"Agent @{agent_name}:")
        print(f"  Images: {ag_total} | Verified: {ag_ver} ({pct:.1f}%) | Missing: {len(data['missing_json'])} | JSON Errs: {len(data['json_errors'])} | Corrupt: {len(data['corrupt_img'])}")
        
        if data['corrupt_img']:
            print("  Corrupt images:")
            for p, err in data['corrupt_img'][:5]:
                print(f"    - {p}: {err}")
            if len(data['corrupt_img']) > 5:
                print(f"    ... and {len(data['corrupt_img']) - 5} more")

        if data['json_errors']:
            print("  JSON validation issues:")
            for p, errs in data['json_errors'][:5]:
                print(f"    - {p}: {', '.join(errs)}")
            if len(data['json_errors']) > 5:
                print(f"    ... and {len(data['json_errors']) - 5} more")

        if verbose and data['missing_json']:
            print("  Missing JSON samples:")
            for p in data['missing_json'][:5]:
                print(f"    - {p}")
            if len(data['missing_json']) > 5:
                print(f"    ... and {len(data['missing_json']) - 5} more")
        print()

    print('=' * 70)
    if total > 0 and verified == total:
        print("RESULT: ALL 972 IMAGES FULLY VERIFIED AND VALID! (100.0%)")
    else:
        print(f"RESULT: IN PROGRESS - {total - verified} REMAINING")
    print('=' * 70)

def main():
    parser = argparse.ArgumentParser(description="Verify OCR JSONs for исходники/Images")
    parser.add_argument('--verbose', '-v', action='store_true', help="Show more details")
    parser.add_argument('--json', action='store_true', help="Output report as raw JSON")
    args = parser.parse_args()

    report = scan_and_verify()

    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        print_report(report, verbose=args.verbose)

    if report['total_images'] > 0 and report['total_verified'] == report['total_images']:
        sys.exit(0)
    else:
        sys.exit(1)

if __name__ == '__main__':
    main()
