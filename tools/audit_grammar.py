#!/usr/bin/env python3
"""
Audit script for grammar, typography, terminology compliance, and Latin-Cyrillic homoglyphs
across all 972 JSON files in исходники/Images/

Generates reports/grammar_audit.md
"""

import os
import sys
import json
import re
from collections import defaultdict
from typing import Dict, List, Tuple, Any

IMAGES_ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'исходники', 'Images'))
REPORT_PATH = os.path.normpath(os.path.join(os.path.dirname(__file__), '..', 'reports', 'grammar_audit.md'))

# Common Latin-Cyrillic homoglyphs
HOMOGLYPH_LATIN_TO_CYR = {
    'a': 'а', 'c': 'с', 'e': 'е', 'o': 'о', 'p': 'р', 'x': 'х', 'y': 'у', 'i': 'і',
    'A': 'А', 'B': 'В', 'C': 'С', 'E': 'Е', 'H': 'Н', 'K': 'К', 'M': 'М', 'O': 'О',
    'P': 'Р', 'T': 'Т', 'X': 'Х'
}

CYRILLIC_CHAR_RE = re.compile(r'[\u0400-\u04FF]')
LATIN_CHAR_RE = re.compile(r'[a-zA-Z]')

KNOWN_ABBREVIATIONS = {'т.е.', 'т.д.', 'т.п.', 'т. к.', 'т.к.'}

class Issue:
    def __init__(self, category: str, file_path: str, field: str, detail: str, snippet: str = '', fix_suggestion: str = ''):
        self.category = category
        self.file_path = file_path
        self.rel_path = os.path.relpath(file_path, IMAGES_ROOT)
        self.field = field
        self.detail = detail
        self.snippet = snippet
        self.fix_suggestion = fix_suggestion

    def to_dict(self):
        return {
            'category': self.category,
            'file': self.rel_path,
            'field': self.field,
            'detail': self.detail,
            'snippet': self.snippet,
            'fix_suggestion': self.fix_suggestion
        }

def audit_file(file_path: str, data: dict) -> List[Issue]:
    issues = []
    
    # 1. Card Name checks
    name = data.get('name', '')
    if isinstance(name, str):
        # Leading / trailing spaces
        if name != name.strip():
            issues.append(Issue('Whitespace', file_path, 'name', 'Leading or trailing whitespace in name', repr(name), name.strip()))
        # Capitalization
        stripped_name = name.strip()
        if stripped_name and stripped_name[0].islower():
            issues.append(Issue('Capitalization', file_path, 'name', 'Name starts with lowercase letter', stripped_name))
        # Mixed Latin-Cyrillic in name
        check_mixed_homoglyphs(file_path, 'name', stripped_name, issues)

    # 2. Card Type checks
    card_type = data.get('type', '')
    if isinstance(card_type, str):
        if card_type != card_type.strip():
            issues.append(Issue('Whitespace', file_path, 'type', 'Leading or trailing whitespace in type', repr(card_type), card_type.strip()))
        stripped_type = card_type.strip()
        if stripped_type and stripped_type[0].islower():
            issues.append(Issue('Capitalization', file_path, 'type', 'Type starts with lowercase letter', stripped_type))
        # English types where Russian is expected
        if stripped_type == 'Card Back':
            issues.append(Issue('Terminology', file_path, 'type', 'English type "Card Back" should be Russian "Рубашка карт"', stripped_type, 'Рубашка карт'))
        check_mixed_homoglyphs(file_path, 'type', stripped_type, issues)

    # 3. Description & Flavor text checks
    for field in ['description', 'flavor', 'ability']:
        val = data.get(field)
        if not isinstance(val, str) or not val:
            continue
        
        # Leading / trailing spaces
        if val != val.strip():
            issues.append(Issue('Whitespace', file_path, field, f'Leading or trailing whitespace in {field}', repr(val[:30]), val.strip()))

        # Double spaces (excluding newlines)
        for line in val.splitlines():
            if '  ' in line:
                issues.append(Issue('Typography', file_path, field, 'Multiple consecutive spaces', repr(line)))
                break

        # Space before punctuation
        space_punct = re.search(r'\s+([,\.!?:;])', val)
        if space_punct:
            issues.append(Issue('Typography', file_path, field, f'Unwanted space before punctuation "{space_punct.group(1)}"', val[max(0, space_punct.start()-10):min(len(val), space_punct.end()+10)]))

        # Missing space after punctuation (e.g. "слово,слово" or "конец.Начало")
        miss_space = re.search(r'([,\.!?:;])([а-яА-ЯёЁ])', val)
        if miss_space:
            match_str = val[max(0, miss_space.start()-5):min(len(val), miss_space.end()+5)]
            if not any(abbr in match_str for abbr in KNOWN_ABBREVIATIONS):
                issues.append(Issue('Typography', file_path, field, f'Missing space after punctuation "{miss_space.group(1)}"', match_str))

        # Check OCR tokens (e.g. (ATK), [d], [f], (symbol_damage), (red_sword))
        ocr_tokens = re.findall(r'(\([A-Za-z_]+\)|\[[A-Za-z_]+\])', val)
        for token in ocr_tokens:
            issues.append(Issue('OCR Artifact', file_path, field, f'Unconverted OCR token/icon placeholder "{token}"', val[max(0, val.find(token)-15):min(len(val), val.find(token)+len(token)+15)]))

        # Arrow formatting
        arrows = re.findall(r'>+', val)
        for arrow in arrows:
            if arrow != '>>>':
                issues.append(Issue('Terminology', file_path, field, f'Non-standard arrow "{arrow}", should be ">>>"', arrow, '>>>'))

        # Check arrow spacing
        bad_arrow_space = re.search(r'([^\s]>+|>+[^\s])', val)
        if bad_arrow_space:
            # Check if arrow is part of >>> without proper surrounding space
            sub = val[max(0, bad_arrow_space.start()-5):min(len(val), bad_arrow_space.end()+5)]
            if '>>>' in sub and not re.search(r'\s>>>\s', sub):
                issues.append(Issue('Typography', file_path, field, f'Missing space around arrow ">>>"', sub, ' >>> '))

        # Terminology: ФЛЮП / Флюп
        flyup_matches = re.finditer(r'\b(флюп|Флюп)\b', val)
        for fm in flyup_matches:
            # When standalone or before >>>, it should usually be uppercase ФЛЮП
            surr = val[max(0, fm.start()-10):min(len(val), fm.end()+15)]
            issues.append(Issue('Terminology', file_path, field, f'Keyword action "{fm.group(1)}" should be uppercase "ФЛЮП"', surr, 'ФЛЮП'))

        # Terminology: ПРИЕМ / ПРИЁМ
        priem_matches = re.finditer(r'\b(прием|Прием|приём|Приём)\b', val)
        for pm in priem_matches:
            surr = val[max(0, pm.start()-10):min(len(val), pm.end()+15)]
            # If used as keyword trigger, should be ПРИЁМ / ПРИЕМ
            if '>>>' in surr or ':' in surr:
                issues.append(Issue('Terminology', file_path, field, f'Keyword "{pm.group(1)}" may need uppercase "ПРИЁМ"', surr, 'ПРИЁМ'))

        # Terminal punctuation for complete sentences in description
        if field == 'description' and len(val.strip()) > 5:
            stripped_desc = val.strip()
            last_char = stripped_desc[-1]
            if last_char not in ('.', '!', '?', ')', '»', '"'):
                issues.append(Issue('Punctuation', file_path, field, f'Description does not end with terminal punctuation (ends with "{last_char}")', stripped_desc[-30:]))

        # Unbalanced quotes
        if val.count('«') != val.count('»'):
            issues.append(Issue('Punctuation', file_path, field, 'Mismatched Russian guillemets « »', val[:60]))
        if val.count('(') != val.count(')'):
            issues.append(Issue('Punctuation', file_path, field, 'Mismatched parentheses ( )', val[:60]))

        # Mixed homoglyphs inside words
        check_mixed_homoglyphs(file_path, field, val, issues)

        # Common typos
        check_common_typos(file_path, field, val, issues)

    return issues

def check_mixed_homoglyphs(file_path: str, field: str, text: str, issues: List[Issue]):
    # Find tokens with words
    words = re.findall(r'[a-zA-Z\u0400-\u04FF0-9_\-]+', text)
    for word in words:
        has_cyr = bool(CYRILLIC_CHAR_RE.search(word))
        has_lat = bool(LATIN_CHAR_RE.search(word))
        
        if has_cyr and has_lat:
            # Token mixes Latin and Cyrillic
            # Identify which Latin chars are present
            lat_chars = LATIN_CHAR_RE.findall(word)
            issues.append(Issue('Homoglyph', file_path, field, f'Mixed Latin/Cyrillic word "{word}" (contains Latin {lat_chars})', word))
        elif not has_cyr and has_lat:
            # Entire word in Latin, but if surrounded by Cyrillic words, is it an accidental Latin word like "c" or "o" or "a"?
            if word in ('c', 'o', 'a', 'e', 'p', 'x', 'y', 'k', 'C', 'O', 'A', 'E', 'P', 'X', 'T', 'H', 'M', 'B'):
                # Check context in text
                m = re.search(r'(^|\s)' + re.escape(word) + r'(\s|$)', text)
                if m:
                    issues.append(Issue('Homoglyph', file_path, field, f'Single Latin letter "{word}" used as Russian preposition/conjunction', word, HOMOGLYPH_LATIN_TO_CYR.get(word, word)))

def check_common_typos(file_path: str, field: str, text: str, issues: List[Issue]):
    typo_patterns = [
        (r'\bПоложий\b', 'Положий -> Положи'),
        (r'\bсоперика\b', 'соперика -> соперника'),
        (r'\bдейтсвие\b', 'дейтсвие -> действие'),
        (r'\bдейтсвия\b', 'дейтсвия -> действия'),
        (r'\bсущетсво\b', 'сущетсво -> существо'),
        (r'\bсущетсва\b', 'сущетсва -> существа'),
        (r'\bкартутвоей\b', 'картутвоей -> карту твоей'),
        (r'\bвэтой\b', 'вэтой -> в этой'),
        (r'\bзаклинанийза\b', 'заклинанийза -> заклинаний за'),
    ]
    for pat, desc in typo_patterns:
        m = re.search(pat, text, re.IGNORECASE)
        if m:
            issues.append(Issue('Typo', file_path, field, f'Typographical error: {desc}', m.group(0)))

def run_audit(root: str = IMAGES_ROOT) -> Tuple[List[Issue], Dict[str, Any]]:
    all_issues = []
    stats = {
        'total_files': 0,
        'clean_files': 0,
        'flagged_files': 0,
        'by_category': defaultdict(int),
        'by_folder': defaultdict(lambda: {'total': 0, 'issues': 0, 'clean': 0})
    }

    for dirpath, _, filenames in os.walk(root):
        folder = os.path.relpath(dirpath, root)
        if folder == '.':
            continue
        json_files = [f for f in filenames if f.endswith('.json')]
        for f in json_files:
            stats['total_files'] += 1
            stats['by_folder'][folder]['total'] += 1
            
            p = os.path.join(dirpath, f)
            try:
                with open(p, 'r', encoding='utf-8') as jf:
                    data = json.load(jf)
            except Exception as e:
                all_issues.append(Issue('Syntax', p, 'root', f'JSON load error: {e}'))
                continue

            file_issues = audit_file(p, data)
            if file_issues:
                stats['flagged_files'] += 1
                stats['by_folder'][folder]['issues'] += len(file_issues)
                all_issues.extend(file_issues)
                for iss in file_issues:
                    stats['by_category'][iss.category] += 1
            else:
                stats['clean_files'] += 1
                stats['by_folder'][folder]['clean'] += 1

    return all_issues, stats

def generate_markdown_report(issues: List[Issue], stats: Dict[str, Any], output_path: str = REPORT_PATH):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    
    lines = []
    lines.append('# Comprehensive Grammar, Typography, and Terminology Audit Report')
    lines.append('')
    lines.append(f'**Scope:** All {stats["total_files"]} JSON files across `исходники/Images/`  ')
    lines.append(f'**Date:** 2026-11-13  ')
    lines.append(f'**Tool:** `tools/audit_grammar.py`  ')
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## 1. Executive Summary')
    lines.append('')
    lines.append('| Metric | Value |')
    lines.append('|---|---|')
    lines.append(f'| **Total JSON Files Audited** | **{stats["total_files"]}** |')
    lines.append(f'| **100% Clean Files** | **{stats["clean_files"]}** ({(stats["clean_files"]/stats["total_files"]*100) if stats["total_files"] else 0:.1f}%) |')
    lines.append(f'| **Files with Flagged Issues** | **{stats["flagged_files"]}** ({(stats["flagged_files"]/stats["total_files"]*100) if stats["total_files"] else 0:.1f}%) |')
    lines.append(f'| **Total Issues Identified** | **{len(issues)}** |')
    lines.append('')
    lines.append('### Issues Breakdown by Category')
    lines.append('')
    lines.append('| Category | Count | Description |')
    lines.append('|---|---|---|')
    for cat, count in sorted(stats['by_category'].items(), key=lambda x: -x[1]):
        desc_map = {
            'OCR Artifact': 'Unconverted raw OCR tokens/placeholders like `[d]`, `[f]`, `(ATK)`, `(symbol_damage)`',
            'Typography': 'Punctuation spacing, missing space after comma/dot, or multiple spaces',
            'Punctuation': 'Missing terminal period at end of description, unmatched quotes/parens',
            'Terminology': 'Non-standard keyword casing (`Флюп` instead of `ФЛЮП`, non-standard types)',
            'Homoglyph': 'Latin characters mixed inside Russian words or standalone Latin homoglyphs',
            'Typo': 'Spelling mistakes and letter transpositions (e.g. `Положий`, `соперика`)',
            'Capitalization': 'Lowercase start of card name or card type',
            'Whitespace': 'Leading or trailing spaces in strings',
            'Syntax': 'JSON syntax errors'
        }
        lines.append(f'| **{cat}** | {count} | {desc_map.get(cat, "")} |')
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## 2. Breakdown by Section / Directory')
    lines.append('')
    lines.append('| Folder / Section | Total Files | Clean Files | Flagged Files | Total Issues | Clean Rate |')
    lines.append('|---|---|---|---|---|---|')
    for folder, data in sorted(stats['by_folder'].items()):
        clean_pct = (data['clean'] / data['total'] * 100) if data['total'] else 0
        flagged = data['total'] - data['clean']
        lines.append(f'| `{folder}` | {data["total"]} | {data["clean"]} | {flagged} | {data["issues"]} | {clean_pct:.1f}% |')
    lines.append('')
    lines.append('---')
    lines.append('')
    lines.append('## 3. High-Priority Action Items')
    lines.append('')
    
    # Group issues by category for actionable review
    by_cat_issues = defaultdict(list)
    for iss in issues:
        by_cat_issues[iss.category].append(iss)

    # 3.1 OCR Artifacts
    if 'OCR Artifact' in by_cat_issues:
        lines.append('### 3.1 Unconverted OCR Artifact Tokens')
        lines.append('These entries contain raw placeholders from icon substitution that should be mapped to Russian card terminology:')
        lines.append('')
        lines.append('| File | Field | Found Token / Snippet | Recommended Fix |')
        lines.append('|---|---|---|---|')
        for iss in by_cat_issues['OCR Artifact']:
            lines.append(f'| `{iss.rel_path}` | `{iss.field}` | `{iss.snippet}` | Replace placeholder with standard game term / icon |')
        lines.append('')

    # 3.2 Common Typos
    if 'Typo' in by_cat_issues:
        lines.append('### 3.2 Spelling & Typographical Errors')
        lines.append('')
        lines.append('| File | Field | Error Detail | Snippet |')
        lines.append('|---|---|---|---|')
        for iss in by_cat_issues['Typo']:
            lines.append(f'| `{iss.rel_path}` | `{iss.field}` | {iss.detail} | `{iss.snippet}` |')
        lines.append('')

    # 3.3 Homoglyphs
    if 'Homoglyph' in by_cat_issues:
        lines.append('### 3.3 Latin-Cyrillic Homoglyphs & Mixed Script Tokens')
        lines.append('')
        lines.append('| File | Field | Detail | Snippet |')
        lines.append('|---|---|---|---|')
        for iss in by_cat_issues['Homoglyph']:
            lines.append(f'| `{iss.rel_path}` | `{iss.field}` | {iss.detail} | `{iss.snippet}` |')
        lines.append('')

    # 3.4 Terminology & Casing
    if 'Terminology' in by_cat_issues:
        lines.append('### 3.4 Terminology & Keyword Compliance')
        lines.append('')
        lines.append('| File | Field | Detail | Snippet |')
        lines.append('|---|---|---|---|')
        for iss in by_cat_issues['Terminology']:
            lines.append(f'| `{iss.rel_path}` | `{iss.field}` | {iss.detail} | `{iss.snippet}` |')
        lines.append('')

    # 3.5 Punctuation & Typography
    if 'Typography' in by_cat_issues or 'Punctuation' in by_cat_issues:
        lines.append('### 3.5 Punctuation & Spacing Samples (First 20)')
        lines.append('')
        lines.append('| File | Field | Category | Detail | Snippet |')
        lines.append('|---|---|---|---|---|')
        sample_punct = (by_cat_issues['Typography'] + by_cat_issues['Punctuation'])[:20]
        for iss in sample_punct:
            lines.append(f'| `{iss.rel_path}` | `{iss.field}` | {iss.category} | {iss.detail} | `{iss.snippet}` |')
        lines.append('')

    lines.append('---')
    lines.append('')
    lines.append('## 4. Full Audit Log by File')
    lines.append('')
    
    file_to_issues = defaultdict(list)
    for iss in issues:
        file_to_issues[iss.rel_path].append(iss)

    for fpath, fissues in sorted(file_to_issues.items()):
        lines.append(f'#### `{fpath}` ({len(fissues)} issues)')
        for fi in fissues:
            sugg = f' -> *Suggestion:* `{fi.fix_suggestion}`' if fi.fix_suggestion else ''
            lines.append(f'- **[{fi.category}]** `{fi.field}`: {fi.detail} (`{fi.snippet}`){sugg}')
        lines.append('')

    content = '\n'.join(lines)
    with open(output_path, 'w', encoding='utf-8') as f:
        f.write(content)
    print(f'Wrote report to {output_path}')

def main():
    print('Starting grammar and terminology audit across исходники/Images/...')
    issues, stats = run_audit()
    print(f'Audited {stats["total_files"]} files.')
    print(f'Clean: {stats["clean_files"]} ({(stats["clean_files"]/stats["total_files"]*100) if stats["total_files"] else 0:.1f}%)')
    print(f'Flagged: {stats["flagged_files"]} ({len(issues)} total issues)')
    print('\nIssues by Category:')
    for cat, count in sorted(stats['by_category'].items(), key=lambda x: -x[1]):
        print(f'  {cat:15}: {count}')
    
    generate_markdown_report(issues, stats)

if __name__ == '__main__':
    main()
