import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
// Input is a Figma CSS export passed as the first argument (not stored in the repo).
const SRC = process.argv[2] ?? resolve(HERE, 'source.txt');
const OUT = process.env.SPEC_OUT ?? resolve(HERE, 'spec.json');
const lines = readFileSync(SRC, 'utf8').split(/\r?\n/);

// ---- tokenizer ----
// Comments split the file. Meta comments are transparent separators: declaration
// lines are always attributed to the last real (named) block, which matches the
// Figma CSS export order: node props, then its "Inside auto layout" role props.
const isMeta = (n) =>
  n === 'Auto layout' || n === 'Inside auto layout' ||
  /^identical to box height/.test(n) || /^or [\d.]+px$/.test(n) ||
  /^Card Game\/(Display|Body|Heading|Title|Caption|Small|Chip|Shadow)\/\d+/.test(n);

const blocks = [];
for (let i = 0; i < lines.length; i++) {
  const m = lines[i].match(/^\/\* (.+?) \*\/\s*$/);
  if (!m) continue;
  if (isMeta(m[1])) continue;
  blocks.push({ name: m[1], line: i + 1, props: {}, styles: [] });
}
for (let b = 0; b < blocks.length; b++) {
  const bEnd = b + 1 < blocks.length ? blocks[b + 1].line - 1 : lines.length;
  const p = blocks[b].props;
  for (let i = blocks[b].line - 1; i < bEnd; i++) {
    const t = lines[i] && lines[i].trim();
    if (!t) continue;
    let m;
    if (/^display: flex;$/.test(t)) p.flex = true;
    else if ((m = t.match(/^flex-direction: (\w+);$/))) p.dir = m[1];
    else if ((m = t.match(/^padding: ([\d\wpx\s]+);$/))) p.padding = m[1].trim();
    else if ((m = t.match(/^gap: ([\d.\wpx\s]+);$/))) p.gap = m[1].trim();
    else if (/^position: absolute;$/.test(t)) p.abs = true;
    else if ((m = t.match(/^left: ([\d.\w%px\-]+);$/))) p.left = m[1];
    else if ((m = t.match(/^right: ([\d.\w%px\-]+);$/))) p.right = m[1];
    else if ((m = t.match(/^top: ([\d.\w%px\-]+);$/))) p.top = m[1];
    else if ((m = t.match(/^bottom: ([\d.\w%px\-]+);$/))) p.bottom = m[1];
    else if ((m = t.match(/^width: ([\d.]+)px;$/)) && p.w == null) p.w = parseFloat(m[1]);
    else if ((m = t.match(/^min-width: ([\d.]+)px;$/))) p.minW = parseFloat(m[1]);
    else if ((m = t.match(/^height: ([\d.]+)px;$/)) && p.h == null) p.h = parseFloat(m[1]);
    else if ((m = t.match(/^min-height: ([\d.]+)px;$/)) && p.minH == null) p.minH = parseFloat(m[1]);
    else if ((m = t.match(/^background: ((#[0-9A-Fa-f]{3,8}|\w+|rgba\([^)]+\)));$/))) p.bg = m[1];
    else if ((m = t.match(/^opacity: ([\d.]+);$/))) p.opacity = parseFloat(m[1]);
    else if ((m = t.match(/^border[^\n:]*:\s*([\d.]+)px (solid|dashed) (#[0-9A-Fa-f]+);$/))) {
      if (p.borderW == null) { p.borderW = parseFloat(m[1]); p.borderStyle = m[2]; p.borderC = m[3]; }
    }
    else if ((m = t.match(/^border-radius: (.+?);$/))) p.radius = m[1].trim();
    else if ((m = t.match(/^box-shadow: (.*);$/)) && p.shadow == null) p.shadow = m[1].trim();
    else if (/^flex: none;$/.test(t)) p.flexNone = true;
    else if ((m = t.match(/^flex-grow: ([\d.]+);$/))) p.grow = parseFloat(m[1]);
    else if (/^align-self: stretch;$/.test(t)) p.stretch = true;
    else if ((m = t.match(/^order: (\d+);$/))) p.order = parseInt(m[1]);
    else if ((m = t.match(/^font-family: '(.+?)';$/))) p.ff = m[1];
    else if ((m = t.match(/^font-style: (.+);$/))) p.fs = m[1];
    else if ((m = t.match(/^font-weight: (\d+);$/))) p.fw = parseInt(m[1]);
    else if ((m = t.match(/^font-size: ([\d.]+)px;$/))) p.fsz = parseFloat(m[1]);
    else if ((m = t.match(/^line-height: (\d+(?:\.\d+)?%);$/))) p.lh = parseFloat(m[1]) / 100;
    else if ((m = t.match(/^line-height: ([\d.]+)px;$/))) p.lh = parseFloat(m[1]);
    else if ((m = t.match(/^color: (#[0-9A-Fa-f]+);$/))) p.color = m[1];
    else if ((m = t.match(/^letter-spacing: ([\d.-]+)px;$/))) p.ls = parseFloat(m[1]);
    else if ((m = t.match(/^text-align: (\w+);$/))) p.align = m[1];
    else if ((m = t.match(/^justify-content: (\w+);$/))) p.just = m[1];
    else if ((m = t.match(/^align-items: (\w+);$/))) p.ai = m[1];
    else if ((m = t.match(/^align-content: (\w+);$/))) p.ac = m[1];
    else if (/^flex-wrap: wrap;$/.test(t)) p.wrap = true;
    else if (/^isolation: isolate;$/.test(t)) p.iso = true;
    else if ((m = t.match(/^z-index: (\d+);$/))) p.z = parseInt(m[1]);
    else if ((m = t.match(/^transform: rotate\((-?[\d.]+)deg\);$/))) p.rot = parseFloat(m[1]);
    else if (/^box-sizing: border-box;$/.test(t)) p.bb = true;
  }
}

for (const b of blocks) {
  const p = b.props;
  b.isText = !!(p.ff && p.fsz && !p.flex);
}

function pad(p) {
  if (!p.padding) return [0, 0, 0, 0];
  const parts = p.padding.trim().split(/\s+/).map(s => parseFloat(s) || 0);
  if (parts.length === 1) return [parts[0], parts[0], parts[0], parts[0]];
  if (parts.length === 2) return [parts[0], parts[1], parts[0], parts[1]];
  return [parts[0], parts[1], parts[2], parts[3]];
}
function parseGap(p) { return p.gap ? (parseFloat(p.gap) || 0) : 0; }

// ---- builder: DFS reconstruction with strict flex-order continuity ----
const root = { name: '__ROOT__', props: {}, children: [], depth: 0, isText: false };
const stack = [root];
const fallbacks = [];
let fallbackCount = 0;

function maxOrder(c) {
  let mx = -1;
  for (const ch of c.children) if (ch.props.order != null) mx = Math.max(mx, ch.props.order);
  return mx;
}

function fits(c, b) {
  const cp = c.props, p = b.props;
  if (!cp.flex) return false;
  const pd = pad(cp);
  const cw = cp.w != null ? cp.w - pd[1] - pd[3] : Infinity;
  const cH = cp.h != null ? cp.h : (cp.minH != null ? cp.minH : Infinity);
  const chAvail = cH === Infinity ? Infinity : cH - pd[0] - pd[2];
  const childW = p.w != null ? p.w : (p.minW != null ? p.minW : 0);
  const childH = p.h != null ? p.h : (p.minH != null ? p.minH : 0);
  const col = !cp.dir || cp.dir === 'column';
  if (p.stretch && col) {
    // align-self: stretch in a column: child width equals the parent's inner width
    if (cw !== Infinity && (childW > cw + 29 || childW === 0)) return false;
    if (cw !== Infinity && childW < cw - 29) return false;
  } else {
    if (childW === 0 && !p.stretch) return false;
    if (!p.stretch && cw !== Infinity && childW > cw + 29) return false;
  }
  // absolutely positioned containers (section canvases) clip nothing: their flow
  // content may legitimately overflow the declared height, so no height gate
  if (chAvail !== Infinity && !cp.abs) {
    const g = parseGap(cp);
    if (col) {
      let used = 0, count = 0;
      for (const c2 of c.children) {
        if (c2.props.abs) continue;
        used += c2.props.h != null ? c2.props.h : (c2.props.minH || 0);
        count++;
      }
      if (used + childH + (count ? g * count : 0) > chAvail + 24) return false;
    } else {
  // row (possibly wrapped): simulate greedy line packing by known child widths
      const innerW = cw === Infinity ? Infinity : cw;
      let rows = 0, rowW = 0, rowH = 0, usedH = 0;
      const flush = () => { if (rowW) { rows++; usedH += (rows > 1 ? g : 0) + rowH; rowW = 0; rowH = 0; } };
      for (const c2 of c.children) {
        if (c2.props.abs) continue;
        const w2 = c2.props.w != null ? c2.props.w : (c2.props.minW != null ? c2.props.minW : 0);
        const h2 = c2.props.h != null ? c2.props.h : (c2.props.minH || c2.props.w || 0);
        if (cp.wrap) {
          if (rowW && innerW !== Infinity && rowW + g + w2 > innerW + 2) flush();
          rowW = rowW ? rowW + g + w2 : w2;
          rowH = Math.max(rowH, h2);
        } else {
          usedH = Math.max(usedH, h2);
        }
      }
      if (cp.wrap) {
        // add the new child
        if (rowW && innerW !== Infinity && rowW + g + childW > innerW + 2) flush();
        rowW = rowW ? rowW + g + childW : childW;
        rowH = Math.max(rowH, childH);
        flush();
        if (usedH > chAvail + 24) return false;
      } else {
        if (Math.max(usedH, childH) > chAvail + 30) return false;
      }
    }
  }
  return true;
}

function val(v, base) {
  if (v == null) return 0;
  const m = String(v).match(/^([\d.-]+)%$/);
  if (m) return (parseFloat(m[1]) / 100) * base;
  const x = parseFloat(v);
  return Number.isFinite(x) ? x : 0;
}

function contains(c, b) {
  const cp = c.props, p = b.props;
  const pd = pad(cp);
  const x0 = pd[3], y0 = pd[0];
  const wIn = cp.w != null ? cp.w - pd[1] - pd[3] : Infinity;
  const hIn = cp.h != null ? cp.h - pd[0] - pd[2] : Infinity;
  const bl = val(p.left, wIn), bt = val(p.top, hIn);
  return bl >= x0 - 4 && bt >= y0 - 4;
}

function containsFull(c, b) {
  const cp = c.props, p = b.props;
  const pd = pad(cp);
  const x0 = pd[3], y0 = pd[0];
  const wIn = cp.w != null ? cp.w - pd[1] - pd[3] : Infinity;
  const hIn = cp.h != null ? cp.h - pd[0] - pd[2] : Infinity;
  const bl = val(p.left, wIn), bt = val(p.top, hIn);
  const bw = p.w != null ? p.w : (p.right != null && wIn !== Infinity ? wIn - bl - val(p.right, wIn) : 0);
  const bh = p.h != null ? p.h : (p.bottom != null && hIn !== Infinity ? hIn - bt - val(p.bottom, hIn) : 0);
  if (bl < x0 - 4 || bt < y0 - 4) return false;
  if (wIn !== Infinity && bl + bw > x0 + wIn + 4) return false;
  if (hIn !== Infinity && bt + bh > y0 + hIn + 4) return false;
  return true;
}

for (const b of blocks) if (b.props.flex) b.children = [];

function attach(idx, b, _why) {
  const parent = stack[idx];
  if (parent.children == null) parent.children = [];
  parent.children.push(b);
  b.parentName = parent.name;
  b.parentLine = parent === root ? 0 : parent.line;
  b.depth = idx + 1;
  if (idx + 1 < stack.length && !b.props.abs) { // DFS close of stale open flow containers
    if (DBGABS && idx + 2 < stack.length) console.log(`TRUNC @${b.line} ${b.name}: closing ` + stack.slice(idx + 1).map(s => `${s.name}@${s.line}`).join(', '));
    stack.length = idx + 1;
  }
  // any real container (flex or plain frame) opens a scope for its own abs children
  const opensScope = b.props.flex || (!b.isText && (b.props.w != null || b.props.minH != null));
  if (opensScope) stack.push(b);
}

const DBGABS = process.env.DBGABS === '1';
const FLOWDBG = process.env.FLOWDBG ? (n) => n.line >= 380 && n.line <= 520 : null;
const TRACE = process.env.TRACE ? (f) => console.log(f) : null;
for (const b of blocks) {
  const p = b.props;
  if (!p.abs) {
    // flow child: parent must be flex, fit, and expect exactly this order
    let idx = -1;
    let looseIdx = -1;
    for (let i = stack.length - 1; i > 0; i--) {
      const c = stack[i];
      const fit = fits(c, b);
      if (FLOWDBG && FLOWDBG(b)) console.log(`  fit @${b.line} ${b.name} ord=${p.order} vs ${c.name}@${c.line} fit=${fit} expect=${maxOrder(c) + 1}`);
      if (!fit) continue;
      const expect = maxOrder(c) + 1;
      if (p.order != null && p.order !== expect) continue;
      idx = i; break;
    }
    if (idx === -1) {
      // fallback: deepest fitting container whose max order is below this order
      for (let i = stack.length - 1; i > 0; i--) {
        const c = stack[i];
        if (!fits(c, b)) continue;
        if (p.order != null && p.order <= maxOrder(c)) continue;
        looseIdx = i; break;
      }
    }
    if (idx !== -1) { attach(idx, b, 'exact'); if (TRACE) TRACE(`@${b.line} ${b.name} ord=${p.order} -> EXACT ${stack[idx].name}@${stack[idx].line}`); }
    else if (looseIdx !== -1) { attach(looseIdx, b, 'loose'); fallbackCount++; fallbacks.push({ line: b.line, name: b.name, order: p.order, parent: stack[looseIdx].name + '@' + stack[looseIdx].line, mode: 'loose' }); if (TRACE) TRACE(`@${b.line} ${b.name} ord=${p.order} -> LOOSE ${stack[looseIdx].name}@${stack[looseIdx].line}`); }
    else { attach(0, b, 'root'); fallbackCount++; fallbacks.push({ line: b.line, name: b.name, order: p.order, parent: '__ROOT__', mode: 'root' }); if (TRACE || DBGABS) console.log(`@${b.line} ${b.name} ord=${p.order} -> ROOT | stack: ` + stack.map(s => `${s.name}@${s.line}(max=${s.children ? maxOrder(s) : -1})`).join(' / ')); }  } else {
    // absolutely positioned: parent = deepest open container whose inner box
    // fully contains it; if none, deepest with top-left inside; if the node
    // declares an order, the candidate must expect exactly that order.
    const ord = p.order;
    let idx = 0;
    for (const useName of ['full', 'corner', 'any']) {
      const use = useName === 'full' ? containsFull : useName === 'corner' ? contains : () => true;
      let found = -1;
      for (let i = stack.length - 1; i > 0; i--) {
        const c = stack[i];
        const inBox = use(c, b);
        const mo = c.children ? maxOrder(c) : -1;
        const gateOk = ord == null || mo + 1 === ord;
        if (DBGABS) console.log(`  abs ${b.line} ${useName} cand ${c.name}@${c.line} inBox=${inBox} gate=${gateOk} max=${mo} ord=${ord}`);
        if (inBox && gateOk) { found = i; break; }
      }
    if (found > 0) { idx = found; break; }
    }
    attach(idx, b, 'abs'); if (TRACE) TRACE(`@${b.line} ${b.name} abs -> ${stack[idx].name}@${stack[idx].line} (ord ${ord == null ? 'null' : ord})`);
  }
}

// root pseudo-container receives anything: rewrite contains to accept root implicitly (idx=0 default above)

// ---- validation ----
function count(n) { let c = 1; for (const ch of n.children || []) c += count(ch); return c; }
function realDepth(n, d = 0) { let m = d; for (const c of n.children || []) m = Math.max(m, realDepth(c, d + 1)); return m; }
(function checkCycles() {
  const vis = new Set();
  let bad = null;
  (function walk(n, chain) {
    if (bad) return;
    if (vis.has(n)) { bad = { a: chain.join(' > ').slice(-300) }; return; }
    vis.add(n);
    for (const c of n.children || []) walk(c, [...chain, n.name + '@' + (n.line || 0)]);
  })(root, []);
  if (bad) { console.error('CYCLE DETECTED:', JSON.stringify(bad)); process.exit(2); }
})();

// order-continuity violations in the final tree
let violation = 0;
for (const s of root.children) (function walk(n) {
  let prev = -1;
  for (const c of n.children || []) {
    if (c.props.abs) continue;
    if (c.props.order != null) {
      if (c.props.order <= prev) violation++;
      prev = c.props.order;
    }
    walk(c);
  }
})(s);

const out = JSON.stringify(root, (k, v) => (k === 'parentName' ? undefined : v), 1);mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out);

console.log('TOP LEVEL CHILDREN:');
for (const c of root.children) console.log('-', c.name, '@line', c.line, `${c.props.w}x${c.props.h || c.props.minH || ''}`, 'children', (c.children || []).length, 'total', count(c), 'depth', realDepth(c));
console.log('TOTAL NODES:', count(root), '| non-root top items:', root.children.length, '| maxDepth:', realDepth(root), '| fallbacks:', fallbackCount, '| order violations:', violation);
if (fallbacks.length) {
  const agg = {};
  for (const f of fallbacks) {
    const key = `#${f.mode} ${f.name}@${f.line} ord=${f.order == null ? 'null' : f.order} -> ${f.parent}`;
    agg[key] = (agg[key] || 0) + 1;
  }
  for (const [k, v] of Object.entries(agg).sort((a, b) => b[1] - a[1])) console.log('FALLBACK×' + v, k);
}
