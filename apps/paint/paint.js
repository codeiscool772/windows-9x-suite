'use strict';
/* ============================================================================
   Classic Paint — a faithful re-creation of Microsoft Paint (Windows 95)
   Everything draws with integer pixels: no anti-aliasing anywhere in the
   bitmap, exactly like the original.
   ========================================================================== */

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/* When the page runs inside the native shell (ClassicPaint.exe) the Win95 title bar *is*
   the window frame, so its buttons drive the real window. In a plain browser they fall
   back to page-level behaviour. */
const shell = (() => {
  try {
    return !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);
  } catch (e) {
    return false;
  }
})();
function shellPost(msg) {
  if (shell) window.chrome.webview.postMessage(msg);
}

/* ---------------------------------------------------------------- colours */

function hexToRgb(hex) {
  const h = hex.replace('#', '');
  const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const v = parseInt(full, 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}
function rgbToHex(r, g, b) {
  return '#' + [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
}

const PALETTE = [
  '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080',
  '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
  '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff',
  '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040',
];

/* ---------------------------------------------------------------- icons */

const svg = (inner) =>
  `<svg viewBox="0 0 16 16" width="16" height="16" shape-rendering="crispEdges">${inner}</svg>`;

const ICONS = {
  freeform: svg(`<path d="M4 4 L5 2 L8 2 L9 4 L12 3 L13 6 L11 8 L12 11 L8 13 L6 11 L3 12 L2 8 Z"
      fill="none" stroke="#000" stroke-dasharray="1 1"/>`),
  select: svg(`<rect x="2.5" y="2.5" width="11" height="11" fill="none" stroke="#000" stroke-dasharray="1 1"/>
      <rect x="2" y="2" width="1" height="3" fill="#000"/><rect x="2" y="2" width="3" height="1" fill="#000"/>`),
  eraser: svg(`<path d="M3 12 L11 4 L14 7 L6 15 Z" fill="#fff" stroke="#000"/>
      <path d="M3 12 L8 16 L4 16 Z" fill="#ff8080" stroke="#000"/>
      <path d="M11 4 L14 7" stroke="#000"/>`),
  fill: svg(`<path d="M2 8 L7 3 L12 8 L7 13 Z" fill="#fff" stroke="#000"/>
      <path d="M9 3 L12 6" stroke="#000"/>
      <path d="M12 9 L13 12 L11 12 Z" fill="#000" stroke="#000"/>`),
  pick: svg(`<path d="M3 13 L4 10 L10 4 L12 6 L6 12 Z" fill="#c0c0c0" stroke="#000"/>
      <path d="M10 2 L14 6" stroke="#000" stroke-width="2"/>`),
  magnify: svg(`<circle cx="6" cy="6" r="4" fill="#fff" stroke="#000" stroke-width="1.5"/>
      <path d="M9 9 L14 14" stroke="#000" stroke-width="2"/>`),
  pencil: svg(`<path d="M2 14 L3 10 L10 3 L13 6 L6 13 Z" fill="#ffff80" stroke="#000"/>
      <path d="M2 14 L3 10 L4 11 Z" fill="#000"/><path d="M10 3 L13 6" stroke="#000"/>`),
  brush: svg(`<path d="M9 2 L14 7 L8 13 L4 15 L2 12 Z" fill="#e0e0e0" stroke="#000"/>
      <path d="M9 2 L14 7 L11 10 L6 5 Z" fill="#000"/>`),
  airbrush: svg(`<rect x="2" y="6" width="7" height="9" fill="#e0e0e0" stroke="#000"/>
      <rect x="3" y="3" width="5" height="3" fill="#808080" stroke="#000"/>
      <rect x="11" y="3" width="1" height="1" fill="#000"/><rect x="13" y="6" width="1" height="1" fill="#000"/>
      <rect x="11" y="8" width="1" height="1" fill="#000"/><rect x="14" y="9" width="1" height="1" fill="#000"/>`),
  text: svg(`<text x="1" y="13" font-family="Georgia, serif" font-size="14" fill="#000">A</text>`),
  line: svg(`<path d="M2 13 L13 2" stroke="#000"/>`),
  curve: svg(`<path d="M2 13 Q 3 3 8 8 T 14 3" fill="none" stroke="#000"/>`),
  rect: svg(`<rect x="2.5" y="3.5" width="11" height="9" fill="none" stroke="#000"/>`),
  polygon: svg(`<path d="M2 8 L7 2 L14 6 L11 14 L4 13 Z" fill="none" stroke="#000"/>`),
  ellipse: svg(`<ellipse cx="8" cy="8" rx="6" ry="4.5" fill="none" stroke="#000"/>`),
  roundrect: svg(`<rect x="2.5" y="3.5" width="11" height="9" rx="2.5" fill="none" stroke="#000"/>`),
};

const TOOLS = [
  ['freeform', 'Free-Form Select'], ['select', 'Select'],
  ['eraser', 'Eraser/Color Eraser'], ['fill', 'Fill With Color'],
  ['pick', 'Pick Color'], ['magnify', 'Magnifier'],
  ['pencil', 'Pencil'], ['brush', 'Brush'],
  ['airbrush', 'Airbrush'], ['text', 'Text'],
  ['line', 'Line'], ['curve', 'Curve'],
  ['rect', 'Rectangle'], ['polygon', 'Polygon'],
  ['ellipse', 'Ellipse'], ['roundrect', 'Rounded Rectangle'],
].map(([id, title]) => ({ id, title, icon: ICONS[id] }));

/* ---------------------------------------------------------------- state */

const app = {
  tool: 'pencil',
  primary: '#000000',
  secondary: '#ffffff',
  zoom: 1,
  zoomOption: 4,
  lineWidth: 1,
  fillMode: 0, // 0 outline, 1 outline+fill, 2 fill only
  brushTip: { shape: 'round', size: 6 },
  eraserSize: 6,
  airbrushSize: 16,
  drawOpaque: true,
  showToolbox: true,
  showColorbox: true,
  showStatus: true,
  showTextbar: false,
  fileName: 'untitled',
  dirty: false,
  margins: { left: 0.75, right: 0.75, top: 0.75, bottom: 0.75 },
};

/* ---------------------------------------------------------------- canvas */

const view = $('canvas');
const vctx = view.getContext('2d');
const base = document.createElement('canvas');
const bctx = base.getContext('2d', { willReadFrequently: true });

let antsOffset = 0;
let needsRedraw = false;
let rafId = 0;

function scheduleRedraw() {
  if (rafId) return;
  rafId = requestAnimationFrame(() => {
    rafId = 0;
    redraw();
  });
}

function redraw() {
  vctx.setTransform(1, 0, 0, 1, 0, 0);
  vctx.imageSmoothingEnabled = false;
  vctx.clearRect(0, 0, view.width, view.height);
  vctx.drawImage(base, 0, 0);
  if (floating) {
    const src = floating.opaque ? floating.canvas : keyed(floating);
    vctx.drawImage(src, Math.round(floating.x), Math.round(floating.y));
  }
  if (preview) preview(vctx);
  if (textState) drawTextOn(vctx, textState);
  drawAnts();
}

function drawAnts() {
  const t = floating
    ? { x: floating.x, y: floating.y, w: floating.w, h: floating.h }
    : sel
      ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h }
      : null;
  if (!t) return;
  const x = Math.round(t.x) + 0.5;
  const y = Math.round(t.y) + 0.5;
  const w = Math.max(0, Math.round(t.w) - 1);
  const h = Math.max(0, Math.round(t.h) - 1);
  vctx.save();
  vctx.lineWidth = 1;
  vctx.setLineDash([4, 4]);
  vctx.strokeStyle = '#000';
  vctx.lineDashOffset = -antsOffset;
  vctx.strokeRect(x, y, w, h);
  vctx.strokeStyle = '#fff';
  vctx.lineDashOffset = -antsOffset + 4;
  vctx.strokeRect(x, y, w, h);
  vctx.restore();
}

setInterval(() => {
  if (!sel && !floating) return;
  antsOffset = (antsOffset + 1) % 8;
  scheduleRedraw();
}, 110);

function applyView() {
  view.width = base.width;
  view.height = base.height;
  view.style.width = base.width * app.zoom + 'px';
  view.style.height = base.height * app.zoom + 'px';
  $('stSize').textContent = base.width + ' x ' + base.height;
  if (textState) positionTextBox();
  updateWorkspaceOverflow();
  scheduleRedraw();
}

function setSize(w, h, keepContent) {
  w = clamp(Math.round(w), 1, 4000);
  h = clamp(Math.round(h), 1, 4000);
  let old = null;
  if (keepContent) {
    old = document.createElement('canvas');
    old.width = base.width;
    old.height = base.height;
    old.getContext('2d').drawImage(base, 0, 0);
  }
  base.width = w;
  base.height = h;
  bctx.imageSmoothingEnabled = false;
  bctx.fillStyle = '#ffffff';
  bctx.fillRect(0, 0, w, h);
  if (old) bctx.drawImage(old, 0, 0);
  sel = null;
  floating = null;
  applyView();
  redraw();
}

/* The picture fills the whole workspace, like Paint did on a fresh start. It never
   shrinks on its own (that would throw pixels away) — it only grows with the window. */
/* The picture must fill the workspace without scrollbars. Measured with the scrollbars
   suppressed, otherwise a picture that is one pixel too big pops scrollbars, which
   shrinks the client area, which shrinks the picture again — and the canvas ends up a
   scrollbar-width short of filling the window. */
function workspaceSize() {
  const ws = $('workspace');
  const prev = ws.style.overflow;
  ws.style.overflow = 'hidden';
  const size = {
    w: Math.max(1, Math.floor(ws.clientWidth)),
    h: Math.max(1, Math.floor(ws.clientHeight)),
    over: ws.scrollWidth > ws.clientWidth || ws.scrollHeight > ws.clientHeight,
  };
  ws.style.overflow = prev;
  return size;
}

function fitCanvasToWorkspace(initial) {
  const size = workspaceSize();
  if (initial) {
    setSize(size.w, size.h, false);
  } else if (size.w > base.width || size.h > base.height) {
    setSize(Math.max(size.w, base.width), Math.max(size.h, base.height), true);
  }
}

/* Scrollbars only exist when the picture is actually bigger than the view (zoomed in).
   Deciding that here — instead of leaving it to `overflow: auto` — is what keeps a
   picture that fits from popping scrollbars over itself at fractional DPI, where the
   canvas can overflow its content box by a fraction of a pixel. */
function updateWorkspaceOverflow() {
  const ws = $('workspace');
  ws.style.overflow = 'hidden';
  const cw = ws.clientWidth;
  const ch = ws.clientHeight;
  ws.style.overflow = base.width * app.zoom > cw || base.height * app.zoom > ch ? 'auto' : 'hidden';
}

let fitTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => fitCanvasToWorkspace(false), 120);
});

/* ---------------------------------------------------------------- undo */

const undoStack = [];
const redoStack = [];
const UNDO_LIMIT = 12;

function snapshot() {
  const c = document.createElement('canvas');
  c.width = base.width;
  c.height = base.height;
  c.getContext('2d').drawImage(base, 0, 0);
  return c;
}

function pushUndo() {
  undoStack.push(snapshot());
  if (undoStack.length > UNDO_LIMIT) undoStack.shift();
  redoStack.length = 0;
  app.dirty = true;
  updateTitle();
}

function restore(snap) {
  base.width = snap.width;
  base.height = snap.height;
  bctx.imageSmoothingEnabled = false;
  bctx.drawImage(snap, 0, 0);
  sel = null;
  floating = null;
  applyView();
  redraw();
}

function undo() {
  if (!undoStack.length) return;
  commitText(true);
  redoStack.push(snapshot());
  restore(undoStack.pop());
  app.dirty = true;
  updateTitle();
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push(snapshot());
  restore(redoStack.pop());
  updateTitle();
}

function updateTitle() {
  const name = app.fileName + (app.dirty ? '*' : '');
  $('tbTitle').textContent = name + ' - Paint';
  document.title = name + ' - Paint';
}

/* ---------------------------------------------------------------- pixels */

function stamp(ctx, x, y, n, color, shapeName) {
  if (n <= 1) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
    return;
  }
  const o = Math.floor((n - 1) / 2);
  ctx.fillStyle = color;
  if (shapeName === 'square') {
    ctx.fillRect(x - o, y - o, n, n);
    return;
  }
  if (shapeName === 'slash' || shapeName === 'backslash') {
    const s = shapeName === 'slash' ? 1 : -1;
    plotLine(x - o, y + o * s, x + o, y - o * s, (px, py) => ctx.fillRect(px, py, 1, 1));
    return;
  }
  const r = n / 2;
  for (let dy = 0; dy < n; dy++) {
    const cy = dy + 0.5 - r;
    const half = Math.sqrt(Math.max(0, r * r - cy * cy));
    const x0 = Math.round(x - o + r - half);
    const x1 = Math.round(x - o + r + half) - 1;
    if (x1 >= x0) ctx.fillRect(x0, y - o + dy, x1 - x0 + 1, 1);
  }
}

function stampTip(ctx, x, y, tip, color) {
  stamp(ctx, x, y, tip.size, color, tip.shape);
}

function plotLine(x0, y0, x1, y1, cb) {
  x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    cb(x0, y0);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

function drawLinePx(ctx, x0, y0, x1, y1, color, width) {
  const w = Math.max(1, width);
  plotLine(x0, y0, x1, y1, (x, y) => stamp(ctx, x, y, w, color, 'square'));
}

function ellipsePoints(x0, y0, x1, y1, cb) {
  let a = Math.abs(x1 - x0);
  let b = Math.abs(y1 - y0);
  let b1 = b & 1;
  let dx = 4 * (1 - a) * b * b;
  let dy = 4 * (b1 + 1) * a * a;
  let err = dx + dy + b1 * a * a;
  let e2;
  if (x0 > x1) { x0 = x1; x1 += a; }
  if (y0 > y1) y0 = y1;
  y0 += (b + 1) >> 1;
  y1 = y0 - b1;
  a = 8 * a * a;
  b1 = 8 * b * b;
  do {
    cb(x1, y0); cb(x0, y0); cb(x0, y1); cb(x1, y1);
    e2 = 2 * err;
    if (e2 <= dy) { y0++; y1--; err += dy += a; }
    if (e2 >= dx || 2 * err > dy) { x0++; x1--; err += dx += b1; }
  } while (x0 <= x1);
  while (y0 - y1 <= b) {
    cb(x0 - 1, y0); cb(x1 + 1, y0++);
    cb(x0 - 1, y1); cb(x1 + 1, y1--);
  }
}

function fillEllipse(ctx, x0, y0, x1, y1, color) {
  const rows = new Map();
  ellipsePoints(x0, y0, x1, y1, (x, y) => {
    const r = rows.get(y);
    if (!r) rows.set(y, [x, x]);
    else {
      if (x < r[0]) r[0] = x;
      if (x > r[1]) r[1] = x;
    }
  });
  ctx.fillStyle = color;
  for (const [y, r] of rows) ctx.fillRect(r[0], y, r[1] - r[0] + 1, 1);
}

function drawEllipsePx(ctx, x0, y0, x1, y1, color, width, fill) {
  if (fill) fillEllipse(ctx, x0, y0, x1, y1, fill);
  const w = Math.max(1, width);
  ellipsePoints(x0, y0, x1, y1, (x, y) => stamp(ctx, x, y, w, color, 'square'));
}

function fillPolygon(ctx, pts, color) {
  if (pts.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    if (p.y < minY) minY = p.y;
    if (p.y > maxY) maxY = p.y;
  }
  ctx.fillStyle = color;
  const xs = [];
  for (let y = Math.ceil(minY); y <= Math.floor(maxY); y++) {
    xs.length = 0;
    const sy = y + 0.5;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if ((a.y <= sy && b.y > sy) || (b.y <= sy && a.y > sy)) {
        xs.push(a.x + ((sy - a.y) / (b.y - a.y)) * (b.x - a.x));
      }
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const xa = Math.round(xs[i]);
      const xb = Math.round(xs[i + 1]);
      if (xb > xa) ctx.fillRect(xa, y, xb - xa, 1);
    }
  }
}

function drawPolygonPx(ctx, pts, color, width, fill) {
  if (pts.length < 2) return;
  if (fill) fillPolygon(ctx, pts, fill);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    drawLinePx(ctx, a.x, a.y, b.x, b.y, color, width);
  }
}

function roundRectPoints(x0, y0, x1, y1, cb) {
  const xa = Math.min(x0, x1);
  const xb = Math.max(x0, x1);
  const ya = Math.min(y0, y1);
  const yb = Math.max(y0, y1);
  const r = Math.max(0, Math.min(6, Math.floor((xb - xa) / 2), Math.floor((yb - ya) / 2)));
  for (let x = xa + r; x <= xb - r; x++) { cb(x, ya); cb(x, yb); }
  for (let y = ya + r; y <= yb - r; y++) { cb(xa, y); cb(xb, y); }
  const corners = [
    [xa + r, ya + r, Math.PI, Math.PI * 1.5],
    [xb - r, ya + r, Math.PI * 1.5, Math.PI * 2],
    [xb - r, yb - r, 0, Math.PI * 0.5],
    [xa + r, yb - r, Math.PI * 0.5, Math.PI],
  ];
  for (const [cx, cy, a0, a1] of corners) {
    for (let a = a0; a <= a1 + 1e-6; a += 0.03) {
      cb(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r));
    }
  }
}

function drawRoundRectPx(ctx, x0, y0, x1, y1, color, width, fill) {
  if (fill) {
    const rows = new Map();
    roundRectPoints(x0, y0, x1, y1, (x, y) => {
      const r = rows.get(y);
      if (!r) rows.set(y, [x, x]);
      else {
        if (x < r[0]) r[0] = x;
        if (x > r[1]) r[1] = x;
      }
    });
    ctx.fillStyle = fill;
    for (const [y, r] of rows) ctx.fillRect(r[0], y, r[1] - r[0] + 1, 1);
  }
  const w = Math.max(1, width);
  roundRectPoints(x0, y0, x1, y1, (x, y) => stamp(ctx, x, y, w, color, 'square'));
}

function bezierPoints(p0, c1, c2, p3, cb, steps = 600) {
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    const x = mt * mt * mt * p0.x + 3 * mt * mt * t * c1.x + 3 * mt * t * t * c2.x + t * t * t * p3.x;
    const y = mt * mt * mt * p0.y + 3 * mt * mt * t * c1.y + 3 * mt * t * t * c2.y + t * t * t * p3.y;
    cb(Math.round(x), Math.round(y));
  }
}

function floodFill(x, y, hex) {
  const w = base.width;
  const h = base.height;
  x = Math.round(x);
  y = Math.round(y);
  if (x < 0 || y < 0 || x >= w || y >= h) return;
  const img = bctx.getImageData(0, 0, w, h);
  const d = img.data;
  const idx = (y * w + x) * 4;
  const tr = d[idx];
  const tg = d[idx + 1];
  const tb = d[idx + 2];
  const ta = d[idx + 3];
  const [r, g, b] = hexToRgb(hex);
  if (tr === r && tg === g && tb === b && ta === 255) return;

  const match = (i) => d[i] === tr && d[i + 1] === tg && d[i + 2] === tb && d[i + 3] === ta;
  const stack = [x, y];
  while (stack.length) {
    const cy = stack.pop();
    const cx = stack.pop();
    let i = (cy * w + cx) * 4;
    if (!match(i)) continue;
    let left = cx;
    while (left > 0 && match((cy * w + left - 1) * 4)) left--;
    let right = cx;
    while (right < w - 1 && match((cy * w + right + 1) * 4)) right++;
    for (let xx = left; xx <= right; xx++) {
      const ii = (cy * w + xx) * 4;
      d[ii] = r;
      d[ii + 1] = g;
      d[ii + 2] = b;
      d[ii + 3] = 255;
      if (cy > 0 && match(((cy - 1) * w + xx) * 4)) { stack.push(xx, cy - 1); }
      if (cy < h - 1 && match(((cy + 1) * w + xx) * 4)) { stack.push(xx, cy + 1); }
    }
  }
  bctx.putImageData(img, 0, 0);
}

/* ---------------------------------------------------------------- selection */

let sel = null;
let floating = null;
let clip = null;

function keyed(f) {
  if (f.keyedSrc === f.canvas && f.keyedColor === app.secondary) return f.keyedCanvas;
  const c = document.createElement('canvas');
  c.width = f.w;
  c.height = f.h;
  const cc = c.getContext('2d');
  cc.drawImage(f.canvas, 0, 0);
  const img = cc.getImageData(0, 0, f.w, f.h);
  const [r, g, b] = hexToRgb(app.secondary);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (d[i] === r && d[i + 1] === g && d[i + 2] === b) d[i + 3] = 0;
  }
  cc.putImageData(img, 0, 0);
  f.keyedSrc = f.canvas;
  f.keyedColor = app.secondary;
  f.keyedCanvas = c;
  return c;
}

function grabSelection() {
  if (floating) return floating.canvas;
  if (!sel) return null;
  const c = document.createElement('canvas');
  c.width = sel.w;
  c.height = sel.h;
  const cc = c.getContext('2d');
  cc.imageSmoothingEnabled = false;
  if (sel.mask) {
    const src = bctx.getImageData(sel.x, sel.y, sel.w, sel.h);
    const m = sel.mask.getContext('2d').getImageData(0, 0, sel.w, sel.h).data;
    const d = src.data;
    for (let i = 0; i < d.length; i += 4) if (!m[i + 3]) d[i + 3] = 0;
    cc.putImageData(src, 0, 0);
  } else {
    cc.drawImage(base, sel.x, sel.y, sel.w, sel.h, 0, 0, sel.w, sel.h);
  }
  return c;
}

function eraseSelectionArea() {
  if (!sel) return;
  if (sel.mask) {
    const img = bctx.getImageData(sel.x, sel.y, sel.w, sel.h);
    const m = sel.mask.getContext('2d').getImageData(0, 0, sel.w, sel.h).data;
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (m[i + 3]) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255; }
    }
    bctx.putImageData(img, sel.x, sel.y);
  } else {
    bctx.fillStyle = '#ffffff';
    bctx.fillRect(sel.x, sel.y, sel.w, sel.h);
  }
}

function liftSelection() {
  if (!sel) return;
  const c = grabSelection();
  pushUndo();
  eraseSelectionArea();
  floating = {
    canvas: c,
    x: sel.x,
    y: sel.y,
    w: sel.w,
    h: sel.h,
    mask: sel.mask || null,
    opaque: app.drawOpaque,
  };
  sel = null;
  updateSelStatus();
  scheduleRedraw();
}

function commitFloating() {
  if (!floating) return;
  const src = floating.opaque ? floating.canvas : keyed(floating);
  bctx.drawImage(src, Math.round(floating.x), Math.round(floating.y));
  sel = { x: Math.round(floating.x), y: Math.round(floating.y), w: floating.w, h: floating.h, mask: floating.mask };
  floating = null;
  updateSelStatus();
  scheduleRedraw();
}

function dropSelection() {
  commitFloating();
  sel = null;
  updateSelStatus();
  scheduleRedraw();
}

function deleteSelection() {
  if (floating) {
    floating = null;
    sel = null;
    updateSelStatus();
    scheduleRedraw();
    return;
  }
  if (!sel) return;
  pushUndo();
  eraseSelectionArea();
  sel = null;
  updateSelStatus();
  scheduleRedraw();
}

function updateSelStatus() {
  const pane = $('stSel');
  if (sel) {
    pane.hidden = false;
    pane.textContent = sel.w + ' x ' + sel.h;
  } else {
    pane.hidden = true;
  }
}

/* ---------------------------------------------------------------- text tool */

const FONTS = ['MS Sans Serif', 'Arial', 'Arial Black', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
const FSIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 28, 36, 48, 72];

const textStyle = { family: 'MS Sans Serif', size: 12, bold: false, italic: false, opaque: false };
let textState = null;

const textFontString = () =>
  `${textStyle.italic ? 'italic ' : ''}${textStyle.bold ? 'bold ' : ''}${textStyle.size}px "${textStyle.family}", "MS Sans Serif", Tahoma, Arial, sans-serif`;
const textLineHeight = () => Math.round(textStyle.size * 1.3);

function drawTextOn(ctx, ts) {
  ctx.save();
  ctx.imageSmoothingEnabled = false;
  ctx.font = textFontString();
  ctx.textBaseline = 'top';
  if (ts.opaque) {
    ctx.fillStyle = ts.bg;
    const lh = textLineHeight();
    const lines = ts.value.length ? ts.value.split('\n').length : 1;
    ctx.fillRect(ts.x, ts.y, Math.max(ts.w, 8), Math.max(ts.h, lines * lh));
  }
  ctx.fillStyle = ts.color;
  const lines = ts.value.split('\n');
  lines.forEach((line, i) => ctx.fillText(line, ts.x, ts.y + i * textLineHeight()));
  ctx.restore();
}

function startText(box, color, bg) {
  textState = { ...box, value: '', color, bg, opaque: textStyle.opaque };
  const div = document.createElement('div');
  div.className = 'text-overlay';
  const ta = document.createElement('textarea');
  ta.spellcheck = false;
  div.appendChild(ta);
  $('canvasWrap').appendChild(div);
  textState.el = div;
  textState.ta = ta;
  positionTextBox();
  ta.addEventListener('input', () => {
    textState.value = ta.value;
    scheduleRedraw();
  });
  ta.addEventListener('copy', (e) => e.stopPropagation());
  ta.addEventListener('cut', (e) => e.stopPropagation());
  ta.addEventListener('paste', (e) => e.stopPropagation());
  ta.focus();
  scheduleRedraw();
}

function positionTextBox() {
  if (!textState) return;
  const z = app.zoom;
  const lh = textLineHeight();
  textState.el.style.left = textState.x * z + 'px';
  textState.el.style.top = textState.y * z + 'px';
  textState.el.style.width = Math.max(textState.w, 8) * z + 'px';
  textState.el.style.height = Math.max(textState.h, lh * 3) * z + 'px';
  const ta = textState.ta;
  ta.style.font = textFontString().replace(/(\d+)px/, (m, n) => n * z + 'px');
  ta.style.lineHeight = lh * z + 'px';
  ta.style.color = 'transparent';
  ta.style.caretColor = textState.color;
}

function commitText(silent) {
  if (!textState) return;
  const ts = textState;
  textState = null;
  if (ts.el && ts.el.parentNode) ts.el.parentNode.removeChild(ts.el);
  if (ts.value.length) {
    pushUndo();
    drawTextOn(bctx, { ...ts, opaque: textStyle.opaque });
  }
  if (!silent) scheduleRedraw();
  else redraw();
}

function textFromEl() {
  return textState ? textState.value : '';
}

function renderTextbar() {
  const bar = $('textbar');
  const show = app.showTextbar && app.tool === 'text';
  bar.hidden = !show;
  if (!show) {
    if (app.tool !== 'text') commitText(true);
    return;
  }
  bar.innerHTML = `
    <select class="font-select" id="fontFamily" title="Font">
      ${FONTS.map((f) => `<option ${f === textStyle.family ? 'selected' : ''}>${f}</option>`).join('')}
    </select>
    <select class="size-select" id="fontSize" title="Size">
      ${FSIZES.map((s) => `<option ${s === textStyle.size ? 'selected' : ''}>${s}</option>`).join('')}
    </select>
    <button class="tbtn ${textStyle.bold ? 'on' : ''}" id="fontBold" title="Bold"><b>B</b></button>
    <button class="tbtn ${textStyle.italic ? 'on' : ''}" id="fontItalic" title="Italic"><i>I</i></button>
    <span class="sep"></span>
    <button class="tbtn ${!textStyle.opaque ? 'on' : ''}" id="fontTrans" title="Transparent">▨</button>
    <button class="tbtn ${textStyle.opaque ? 'on' : ''}" id="fontOpaque" title="Opaque">▧</button>
  `;
  $('fontFamily').addEventListener('change', (e) => {
    textStyle.family = e.target.value;
    refreshText();
  });
  $('fontSize').addEventListener('change', (e) => {
    textStyle.size = parseInt(e.target.value, 10);
    refreshText();
  });
  $('fontBold').addEventListener('click', () => {
    textStyle.bold = !textStyle.bold;
    renderTextbar();
    refreshText();
  });
  $('fontItalic').addEventListener('click', () => {
    textStyle.italic = !textStyle.italic;
    renderTextbar();
    refreshText();
  });
  $('fontTrans').addEventListener('click', () => {
    textStyle.opaque = false;
    if (textState) textState.opaque = false;
    renderTextbar();
    scheduleRedraw();
  });
  $('fontOpaque').addEventListener('click', () => {
    textStyle.opaque = true;
    if (textState) textState.opaque = true;
    renderTextbar();
    scheduleRedraw();
  });
}

function refreshText() {
  renderTextbar();
  if (textState) {
    positionTextBox();
    scheduleRedraw();
  }
}

/* ---------------------------------------------------------------- pointer */

let drag = null;
let preview = null;
let pointer = { x: 0, y: 0 };
let lastPainted = null;

function toImg(e) {
  const r = view.getBoundingClientRect();
  return {
    x: clamp(Math.floor((e.clientX - r.left) / app.zoom), 0, base.width - 1),
    y: clamp(Math.floor((e.clientY - r.top) / app.zoom), 0, base.height - 1),
  };
}

function setStatusPos(p) {
  $('stPos').textContent = p.x + ',' + p.y;
}

function insideSel(p) {
  if (floating) {
    return p.x >= floating.x && p.y >= floating.y && p.x < floating.x + floating.w && p.y < floating.y + floating.h;
  }
  if (sel) return p.x >= sel.x && p.y >= sel.y && p.x < sel.x + sel.w && p.y < sel.y + sel.h;
  return false;
}

function shapeFilled() {
  return app.fillMode !== 0;
}

function shapeFillColor(color, bg) {
  return app.fillMode === 2 ? color : bg;
}

function drawShape(ctx, d) {
  const { shape } = d;
  let { x0, y0, x1, y1 } = d;
  if (d.square) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    x1 = x0 + Math.sign(dx || 1) * m;
    y1 = y0 + Math.sign(dy || 1) * m;
  }
  const fill = shapeFilled() ? shapeFillColor(d.color, d.bg) : null;
  if (shape === 'line') drawLinePx(ctx, x0, y0, x1, y1, d.color, d.width);
  else if (shape === 'rect') {
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fillRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0) + 1, Math.abs(y1 - y0) + 1);
    }
    const w = d.width;
    drawLinePx(ctx, x0, y0, x1, y0, d.color, w);
    drawLinePx(ctx, x1, y0, x1, y1, d.color, w);
    drawLinePx(ctx, x1, y1, x0, y1, d.color, w);
    drawLinePx(ctx, x0, y1, x0, y0, d.color, w);
  } else if (shape === 'ellipse') drawEllipsePx(ctx, x0, y0, x1, y1, d.color, d.width, fill);
  else if (shape === 'roundrect') drawRoundRectPx(ctx, x0, y0, x1, y1, d.color, d.width, fill);
}

function onDown(e) {
  if (e.button !== 0 && e.button !== 2) return;
  e.preventDefault();
  closeMenus();
  const p = toImg(e);
  pointer = p;
  lastPainted = p;
  const rightBtn = e.button === 2;
  const color = rightBtn ? app.secondary : app.primary;
  const bg = rightBtn ? app.primary : app.secondary;

  if (app.tool === 'text') {
    if (textState) {
      const t = textState;
      if (p.x >= t.x && p.y >= t.y && p.x < t.x + Math.max(t.w, 8) && p.y < t.y + Math.max(t.h, textLineHeight() * 3)) {
        return; // clicked inside the text box: keep editing
      }
      commitText();
    }
    drag = { kind: 'textbox', start: p, end: p, color, bg };
    preview = (ctx) => dashRect(ctx, drag.start, drag.end);
    scheduleRedraw();
    return;
  }

  if (app.tool === 'select' || app.tool === 'freeform') {
    if (insideSel(p)) {
      if (!floating) liftSelection();
      drag = { kind: 'move', dx: p.x - floating.x, dy: p.y - floating.y, moved: false };
    } else {
      dropSelection();
      drag = {
        kind: app.tool === 'select' ? 'selrect' : 'selpoly',
        start: p,
        end: p,
        pts: [p],
      };
      preview = (ctx) => {
        if (drag.kind === 'selrect') dashRect(ctx, drag.start, drag.end);
        else dashPoly(ctx, drag.pts, drag.end);
      };
    }
    scheduleRedraw();
    return;
  }

  commitFloating();

  switch (app.tool) {
    case 'pencil':
      pushUndo();
      drag = { kind: 'free', color, tip: { shape: 'square', size: 1 } };
      stampTip(bctx, p.x, p.y, drag.tip, color);
      scheduleRedraw();
      break;
    case 'brush':
      pushUndo();
      drag = { kind: 'free', color, tip: { ...app.brushTip } };
      stampTip(bctx, p.x, p.y, drag.tip, color);
      scheduleRedraw();
      break;
    case 'eraser':
      pushUndo();
      drag = {
        kind: 'free',
        color: app.secondary,
        tip: { shape: 'square', size: app.eraserSize },
        colorEraser: rightBtn,
        from: app.primary,
        to: app.secondary,
      };
      if (!rightBtn) stampTip(bctx, p.x, p.y, drag.tip, drag.color);
      scheduleRedraw();
      break;
    case 'airbrush':
      pushUndo();
      drag = { kind: 'airbrush', color, size: app.airbrushSize };
      spray(p, drag);
      scheduleRedraw();
      break;
    case 'fill':
      pushUndo();
      floodFill(p.x, p.y, color);
      scheduleRedraw();
      break;
    case 'pick': {
      const d = bctx.getImageData(p.x, p.y, 1, 1).data;
      const hex = rgbToHex(d[0], d[1], d[2]);
      if (rightBtn) app.secondary = hex;
      else app.primary = hex;
      paintColorIndicators();
      break;
    }
    case 'magnify':
      setZoom(app.zoomOption);
      break;
    case 'line':
    case 'rect':
    case 'ellipse':
    case 'roundrect':
      pushUndo();
      drag = { kind: 'shape', shape: app.tool, start: p, end: p, color, bg, width: app.lineWidth, square: e.shiftKey };
      preview = (ctx) => drawShape(ctx, { ...drag, x0: drag.start.x, y0: drag.start.y, x1: drag.end.x, y1: drag.end.y });
      scheduleRedraw();
      break;
    case 'curve':
      pushUndo();
      drag = { kind: 'curve', stage: 1, start: p, end: p, c1: null, c2: null, color, bg, width: app.lineWidth };
      preview = (ctx) => curvePreview(ctx, drag);
      scheduleRedraw();
      break;
    case 'polygon': {
      if (!poly) {
        pushUndo();
        poly = { pts: [p], color, bg, width: app.lineWidth };
      } else {
        const first = poly.pts[0];
        poly.pts.push(p);
        if (poly.pts.length > 2 && Math.abs(p.x - first.x) <= 3 && Math.abs(p.y - first.y) <= 3) {
          finishPolygon();
          break;
        }
      }
      preview = () => polyPreview();
      scheduleRedraw();
      break;
    }
    default:
      break;
  }
}

function spray(p, d) {
  const r = d.size / 2;
  const n = Math.max(1, Math.round(d.size * 0.7));
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const rad = Math.random() * r;
    const x = Math.round(p.x + Math.cos(a) * rad);
    const y = Math.round(p.y + Math.sin(a) * rad);
    if (x >= 0 && y >= 0 && x < base.width && y < base.height) {
      bctx.fillStyle = d.color;
      bctx.fillRect(x, y, 1, 1);
    }
  }
}

function curvePreview(ctx, d) {
  const p0 = d.start;
  const p3 = d.end;
  const mid = { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
  const c1 = d.c1 ? { x: 2 * d.c1.x - mid.x, y: 2 * d.c1.y - mid.y } : mid;
  const c2 = d.c2 ? { x: 2 * d.c2.x - mid.x, y: 2 * d.c2.y - mid.y } : mid;
  const pts = [];
  bezierPoints(p0, c1, c2, p3, (x, y) => pts.push({ x, y }));
  for (let i = 0; i < pts.length; i++) {
    if (i) drawLinePx(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, d.color, d.width);
    else stamp(ctx, pts[i].x, pts[i].y, d.width, d.color, 'square');
  }
}

function dashRect(ctx, a, b) {
  const x = Math.min(a.x, b.x) + 0.5;
  const y = Math.min(a.y, b.y) + 0.5;
  const w = Math.abs(b.x - a.x);
  const h = Math.abs(b.y - a.y);
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.strokeRect(x, y, w, h);
  ctx.strokeStyle = '#fff';
  ctx.lineDashOffset = 4;
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function dashPoly(ctx, pts, cur) {
  ctx.save();
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(pts[0].x + 0.5, pts[0].y + 0.5);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x + 0.5, pts[i].y + 0.5);
  if (cur) ctx.lineTo(cur.x + 0.5, cur.y + 0.5);
  ctx.stroke();
  ctx.strokeStyle = '#fff';
  ctx.lineDashOffset = 4;
  ctx.stroke();
  ctx.restore();
}

let airbrushTimer = null;

function onMove(e) {
  const p = toImg(e);
  pointer = p;
  setStatusPos(p);
  if (!drag) return;

  switch (drag.kind) {
    case 'free': {
      if (lastPainted && lastPainted.x === p.x && lastPainted.y === p.y) return;
      if (drag.colorEraser) {
        colorEraseSegment(lastPainted, p, drag);
      } else {
        const a = lastPainted || p;
        plotLine(a.x, a.y, p.x, p.y, (x, y) => stampTip(bctx, x, y, drag.tip, drag.color));
      }
      lastPainted = p;
      scheduleRedraw();
      break;
    }
    case 'airbrush':
      spray(p, drag);
      scheduleRedraw();
      break;
    case 'shape':
      drag.end = p;
      drag.square = e.shiftKey;
      scheduleRedraw();
      break;
    case 'curve':
      if (drag.stage === 2) drag.c1 = p;
      else if (drag.stage === 3) drag.c2 = p;
      else drag.end = p;
      scheduleRedraw();
      break;
    case 'poly':
      scheduleRedraw();
      break;
    case 'selrect':
    case 'textbox':
      drag.end = p;
      scheduleRedraw();
      break;
    case 'selpoly':
      drag.end = p;
      drag.pts.push(p);
      scheduleRedraw();
      break;
    case 'move': {
      floating.x = p.x - drag.dx;
      floating.y = p.y - drag.dy;
      drag.moved = true;
      updateSelStatus();
      scheduleRedraw();
      break;
    }
    default:
      break;
  }
}

function colorEraseSegment(a, b, d) {
  const r = Math.ceil(d.tip.size / 2) + 1;
  const x0 = clamp(Math.min(a.x, b.x) - r, 0, base.width);
  const y0 = clamp(Math.min(a.y, b.y) - r, 0, base.height);
  const x1 = clamp(Math.max(a.x, b.x) + r, 0, base.width);
  const y1 = clamp(Math.max(a.y, b.y) + r, 0, base.height);
  const w = x1 - x0;
  const h = y1 - y0;
  if (w <= 0 || h <= 0) return;
  const img = bctx.getImageData(x0, y0, w, h);
  const dd = img.data;
  const [fr, fg, fb] = hexToRgb(d.from);
  const [tr, tg, tb] = hexToRgb(d.to);
  const o = Math.floor((d.tip.size - 1) / 2);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const px = x0 + x;
      const py = y0 + y;
      if (px < a.x - o - r || px > b.x + o + r) continue;
      const i = (y * w + x) * 4;
      if (dd[i] === fr && dd[i + 1] === fg && dd[i + 2] === fb) {
        dd[i] = tr;
        dd[i + 1] = tg;
        dd[i + 2] = tb;
      }
    }
  }
  bctx.putImageData(img, x0, y0);
}

function onUp(e) {
  if (!drag) return;
  const d = drag;
  const p = toImg(e);

  switch (d.kind) {
    case 'free':
    case 'airbrush':
      drag = null;
      preview = null;
      break;
    case 'shape':
      drag = null;
      preview = null;
      drawShape(bctx, { ...d, x0: d.start.x, y0: d.start.y, x1: d.end.x, y1: d.end.y });
      scheduleRedraw();
      break;
    case 'curve':
      if (d.stage === 1) {
        d.end = p;
        d.stage = 2;
        d.c1 = p;
      } else if (d.stage === 2) {
        d.c1 = p;
        d.stage = 3;
      } else if (d.stage === 3) {
        d.c2 = p;
        const mid = { x: (d.start.x + d.end.x) / 2, y: (d.start.y + d.end.y) / 2 };
        const c1 = { x: 2 * d.c1.x - mid.x, y: 2 * d.c1.y - mid.y };
        const c2 = { x: 2 * d.c2.x - mid.x, y: 2 * d.c2.y - mid.y };
        drawBezierTo(bctx, d.start, c1, c2, d.end, d.color, d.width);
        drag = null;
        preview = null;
        scheduleRedraw();
      }
      break;
    case 'selrect': {
      drag = null;
      preview = null;
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      const w = Math.abs(d.end.x - d.start.x) + 1;
      const h = Math.abs(d.end.y - d.start.y) + 1;
      if (w > 1 || h > 1) sel = { x, y, w, h, mask: null };
      updateSelStatus();
      scheduleRedraw();
      break;
    }
    case 'selpoly': {
      drag = null;
      preview = null;
      finishFreeform(d.pts);
      break;
    }
    case 'textbox': {
      drag = null;
      preview = null;
      const x = Math.min(d.start.x, d.end.x);
      const y = Math.min(d.start.y, d.end.y);
      let w = Math.abs(d.end.x - d.start.x);
      let h = Math.abs(d.end.y - d.start.y);
      if (w < 6 && h < 6) {
        w = 220;
        h = textLineHeight() * 3;
      }
      startText({ x, y, w, h }, d.color, d.bg);
      break;
    }
    case 'move':
      drag = null;
      preview = null;
      updateSelStatus();
      scheduleRedraw();
      break;
    default:
      drag = null;
      preview = null;
  }
  scheduleRedraw();
}

function drawBezierTo(ctx, p0, c1, c2, p3, color, width) {
  const pts = [];
  bezierPoints(p0, c1, c2, p3, (x, y) => pts.push({ x, y }));
  for (let i = 0; i < pts.length; i++) {
    if (i) drawLinePx(ctx, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, color, width);
    else stamp(ctx, pts[i].x, pts[i].y, width, color, 'square');
  }
}

let poly = null;

function polyPreview() {
  if (!poly) return;
  const pts = poly.pts.concat([pointer]);
  vctx.save();
  vctx.setLineDash([4, 4]);
  vctx.lineWidth = 1;
  vctx.strokeStyle = '#000';
  vctx.beginPath();
  vctx.moveTo(pts[0].x + 0.5, pts[0].y + 0.5);
  for (let i = 1; i < pts.length; i++) vctx.lineTo(pts[i].x + 0.5, pts[i].y + 0.5);
  vctx.stroke();
  vctx.strokeStyle = '#fff';
  vctx.lineDashOffset = 4;
  vctx.stroke();
  vctx.restore();
}

function finishPolygon() {
  if (!poly) return;
  const { pts, color, bg, width } = poly;
  poly = null;
  preview = null;
  if (pts.length >= 2) {
    const fill = shapeFilled() ? shapeFillColor(color, bg) : null;
    if (fill && pts.length >= 3) fillPolygon(bctx, pts, fill);
    drawPolygonPx(bctx, pts, color, width, null);
    app.dirty = true;
    updateTitle();
  }
  scheduleRedraw();
}

function finishFreeform(pts) {
  if (pts.length < 3) return;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const w = maxX - minX + 1;
  const h = maxY - minY + 1;
  const mask = document.createElement('canvas');
  mask.width = w;
  mask.height = h;
  const mctx = mask.getContext('2d');
  fillPolygon(mctx, pts.map((p) => ({ x: p.x - minX, y: p.y - minY })), '#000');
  sel = { x: minX, y: minY, w, h, mask };
  updateSelStatus();
  scheduleRedraw();
}

view.addEventListener('mousedown', onDown);
view.addEventListener('dblclick', () => {
  if (app.tool === 'polygon' && poly) finishPolygon();
});
window.addEventListener('mousemove', onMove);
window.addEventListener('mouseup', onUp);
view.addEventListener('contextmenu', (e) => e.preventDefault());
view.addEventListener('mouseleave', () => {
  $('stPos').textContent = '';
});

/* ---------------------------------------------------------------- zoom */

function setZoom(z) {
  commitText();
  app.zoom = z;
  view.classList.toggle('hide-cursor', z > 1);
  applyView();
}

/* ---------------------------------------------------------------- toolbox */

function buildToolbox() {
  const box = $('tools');
  box.innerHTML = '';
  TOOLS.forEach((t) => {
    const b = document.createElement('button');
    b.className = 'tool' + (t.id === app.tool ? ' active' : '');
    b.dataset.tool = t.id;
    b.title = t.title;
    b.innerHTML = t.icon;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      selectTool(t.id);
    });
    box.appendChild(b);
  });
}

function selectTool(id) {
  if (app.tool === 'text' && id !== 'text') commitText();
  if (id !== 'select' && id !== 'freeform') {
    commitFloating();
    if (id !== 'text') {
      sel = null;
      updateSelStatus();
    }
  }
  if (app.tool === id && (id === 'magnify' || id === 'polygon')) {
    // clicking the same tool again is harmless
  }
  if (poly) finishPolygon();
  app.tool = id;
  document.querySelectorAll('.tool').forEach((el) => {
    el.classList.toggle('active', el.dataset.tool === id);
  });
  renderOptions();
  renderTextbar();
  scheduleRedraw();
}

function optCell(html, active, onClick, extra) {
  const b = document.createElement('button');
  b.className = 'opt' + (active ? ' active' : '');
  b.innerHTML = html;
  b.addEventListener('mousedown', (e) => {
    e.preventDefault();
    onClick();
  });
  if (extra) Object.assign(b.style, extra);
  return b;
}

const BRUSH_TIPS = [
  { shape: 'round', size: 2 }, { shape: 'square', size: 2 },
  { shape: 'round', size: 4 }, { shape: 'square', size: 4 },
  { shape: 'round', size: 6 }, { shape: 'square', size: 6 },
  { shape: 'round', size: 9 }, { shape: 'square', size: 9 },
  { shape: 'slash', size: 6 }, { shape: 'backslash', size: 6 },
  { shape: 'slash', size: 9 }, { shape: 'backslash', size: 9 },
];

function renderOptions() {
  const box = $('options');
  box.innerHTML = '';
  box.style.gridTemplateColumns = '';
  const t = app.tool;

  const same = (a, b) => a.shape === b.shape && a.size === b.size;

  if (t === 'brush') {
    BRUSH_TIPS.forEach((tip) => {
      let inner;
      if (tip.shape === 'round') inner = `<div class="dot" style="width:${tip.size}px;height:${tip.size}px"></div>`;
      else if (tip.shape === 'square') inner = `<div class="sq" style="width:${tip.size}px;height:${tip.size}px"></div>`;
      else {
        const rot = tip.shape === 'slash' ? -45 : 45;
        inner = `<div class="bar" style="height:${Math.max(2, Math.round(tip.size / 3))}px;width:${tip.size + 5}px;transform:rotate(${rot}deg)"></div>`;
      }
      box.appendChild(optCell(inner, same(app.brushTip, tip), () => {
        app.brushTip = { ...tip };
        renderOptions();
      }));
    });
  } else if (t === 'eraser') {
    [4, 6, 8, 10].forEach((n) => {
      box.appendChild(optCell(`<div class="sq" style="width:${Math.min(n, 12)}px;height:${Math.min(n, 12)}px;background:#fff;border:1px solid #000"></div>`,
        app.eraserSize === n, () => {
          app.eraserSize = n;
          renderOptions();
        }));
    });
  } else if (t === 'airbrush') {
    [8, 16, 28].forEach((n) => {
      box.appendChild(optCell(`<div class="dot" style="width:${Math.round(n / 3) + 3}px;height:${Math.round(n / 3) + 3}px;background:radial-gradient(#000 30%,#888)"></div>`,
        app.airbrushSize === n, () => {
          app.airbrushSize = n;
          renderOptions();
        }));
    });
  } else if (t === 'magnify') {
    box.style.gridTemplateColumns = 'repeat(2, 23px)';
    [1, 2, 4, 8].forEach((z) => {
      box.appendChild(optCell(`${z * 100}%`, app.zoomOption === z, () => {
        app.zoomOption = z;
        renderOptions();
      }, { fontSize: '8px' }));
    });
  } else if (t === 'line' || t === 'curve' || t === 'rect' || t === 'polygon' || t === 'ellipse' || t === 'roundrect') {
    const shapesTool = t !== 'line' && t !== 'curve';
    box.style.gridTemplateColumns = shapesTool ? '23px 23px' : '23px';
    box.style.gridTemplateRows = 'repeat(5, 21px)';
    for (let w = 1; w <= 5; w++) {
      const cell = optCell(`<div class="bar" style="height:${w}px"></div>`, app.lineWidth === w, () => {
        app.lineWidth = w;
        renderOptions();
      });
      cell.style.gridColumn = '1';
      cell.style.gridRow = String(w);
      box.appendChild(cell);
    }
    if (shapesTool) {
      const modes = [
        '<div style="width:14px;height:11px;border:1px solid #000"></div>',
        '<div style="width:14px;height:11px;border:1px solid #000;background:#808080"></div>',
        '<div style="width:14px;height:11px;background:#000"></div>',
      ];
      modes.forEach((html, idx) => {
        const cell = optCell(html, app.fillMode === idx, () => {
          app.fillMode = idx;
          renderOptions();
        });
        cell.style.gridColumn = '2';
        cell.style.gridRow = String(idx + 1);
        box.appendChild(cell);
      });
    }
  }
}

/* ---------------------------------------------------------------- palette */

function buildPalette() {
  const holder = $('swatches');
  holder.innerHTML = '';
  PALETTE.forEach((c) => {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.style.background = c;
    b.dataset.color = c;
    b.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (e.button === 2) app.secondary = c;
      else app.primary = c;
      paintColorIndicators();
    });
    b.addEventListener('dblclick', (e) => {
      e.preventDefault();
      editColors(c);
    });
    holder.appendChild(b);
  });
  paintColorIndicators();
}

function paintColorIndicators() {
  $('ccFg').style.background = app.primary;
  $('ccBg').style.background = app.secondary;
}

/* ---------------------------------------------------------------- menus */

const MENUS = [
  {
    label: 'File',
    items: [
      { label: 'New', accel: 'Ctrl+N', action: fileNew },
      { label: 'Open...', accel: 'Ctrl+O', action: fileOpen },
      { label: 'Save', accel: 'Ctrl+S', action: () => fileSave(false) },
      { label: 'Save As...', action: () => fileSave(true) },
      '-',
      { label: 'Page Setup...', action: pageSetupDialog },
      { label: 'Print...', accel: 'Ctrl+P', action: doPrint },
      { label: 'Print Preview', action: printPreviewDialog },
      '-',
      { label: 'Set As Wallpaper (Centered)', action: () => setWallpaper('center') },
      { label: 'Set As Wallpaper (Tiled)', action: () => setWallpaper('tile') },
      '-',
      { label: 'Exit', action: () => (shell ? shellPost('close') : window.close()) },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', accel: 'Ctrl+Z', enabled: () => undoStack.length > 0, action: undo },
      { label: 'Repeat', accel: 'Ctrl+Y', enabled: () => redoStack.length > 0, action: redo },
      '-',
      { label: 'Cut', accel: 'Ctrl+X', enabled: () => !!(sel || floating), action: doCut },
      { label: 'Copy', accel: 'Ctrl+C', enabled: () => !!(sel || floating), action: doCopy },
      { label: 'Paste', accel: 'Ctrl+V', enabled: () => !!clip, action: doPaste },
      { label: 'Clear Selection', accel: 'Del', enabled: () => !!(sel || floating), action: deleteSelection },
    ],
  },
  {
    label: 'View',
    items: [
      { label: 'Tool Box', check: () => app.showToolbox, action: () => toggleView('showToolbox') },
      { label: 'Color Box', check: () => app.showColorbox, action: () => toggleView('showColorbox') },
      { label: 'Status Bar', check: () => app.showStatus, action: () => toggleView('showStatus') },
      { label: 'Text Toolbar', enabled: () => app.tool === 'text', check: () => app.showTextbar, action: () => toggleView('showTextbar') },
      '-',
      {
        label: 'Zoom',
        items: [
          { label: 'Normal Size', accel: 'Ctrl+PgUp', action: () => setZoom(1) },
          { label: 'Large Size', accel: 'Ctrl+PgDn', action: () => setZoom(4) },
          { label: 'Custom...', action: customZoomDialog },
        ],
      },
      { label: 'View Bitmap', accel: 'Ctrl+F', action: viewBitmap },
    ],
  },
  {
    label: 'Image',
    items: [
      { label: 'Flip/Rotate...', accel: 'Ctrl+R', action: flipRotateDialog },
      { label: 'Stretch/Skew...', accel: 'Ctrl+W', action: stretchSkewDialog },
      { label: 'Invert Colors', accel: 'Ctrl+I', action: invertColors },
      { label: 'Attributes...', accel: 'Ctrl+E', action: attributesDialog },
      { label: 'Clear Image', accel: 'Ctrl+Shift+N', action: clearImage },
      '-',
      { label: 'Draw Opaque', check: () => app.drawOpaque, action: () => { app.drawOpaque = !app.drawOpaque; } },
    ],
  },
  {
    label: 'Options',
    items: [{ label: 'Edit Colors...', action: () => editColors(app.primary) }],
  },
  {
    label: 'Help',
    items: [
      { label: 'Help Topics', action: helpDialog },
      '-',
      { label: 'About Paint', action: aboutDialog },
    ],
  },
];

let openIndex = -1;
let currentDropdown = null;

function buildMenuBar() {
  const bar = $('menubar');
  bar.innerHTML = '';
  MENUS.forEach((m, i) => {
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.innerHTML = `<u>${m.label[0]}</u>${m.label.slice(1)}`;
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (openIndex === i) closeMenus();
      else openMenu(i);
    });
    el.addEventListener('mouseenter', () => {
      if (openIndex !== -1 && openIndex !== i) openMenu(i);
    });
    bar.appendChild(el);
  });
}

function closeMenus() {
  document.querySelectorAll('.dropdown').forEach((d) => d.remove());
  document.querySelectorAll('.menu-item.open').forEach((d) => d.classList.remove('open'));
  openIndex = -1;
  currentDropdown = null;
}

function buildDropdown(items, level) {
  const dd = document.createElement('div');
  dd.className = 'dropdown';
  dd.dataset.level = level;
  items.forEach((it) => {
    if (it === '-') {
      const sep = document.createElement('div');
      sep.className = 'dd-sep';
      dd.appendChild(sep);
      return;
    }
    const row = document.createElement('div');
    const enabled = it.enabled ? it.enabled() : true;
    row.className = 'dd-item' + (enabled ? '' : ' disabled');
    const checked = it.check && it.check();
    row.innerHTML = `
      <span class="dd-check">${checked ? '✓' : ''}</span>
      <span class="dd-label">${it.label}</span>
      ${it.accel ? `<span class="dd-accel">${it.accel}</span>` : ''}
      ${it.items ? '<span class="dd-arrow">▶</span>' : ''}
    `;
    if (enabled) {
      row.addEventListener('mouseenter', () => {
        document.querySelectorAll('.dd-item.active').forEach((n) => n.classList.remove('active'));
        row.classList.add('active');
        closeSubmenus(level);
        if (it.items) {
          const sub = buildDropdown(it.items, level + 1);
          const r = row.getBoundingClientRect();
          sub.style.left = r.right - 2 + 'px';
          sub.style.top = r.top - 3 + 'px';
          document.body.appendChild(sub);
        }
      });
      row.addEventListener('mouseup', (e) => {
        e.stopPropagation();
        closeMenus();
        it.action();
      });
    } else {
      row.addEventListener('mouseenter', () => {
        document.querySelectorAll('.dd-item.active').forEach((n) => n.classList.remove('active'));
        closeSubmenus(level);
      });
    }
    dd.appendChild(row);
  });
  return dd;
}

function closeSubmenus(level) {
  document.querySelectorAll('.dropdown').forEach((d) => {
    if (Number(d.dataset.level) > level) d.remove();
  });
}

function openMenu(i) {
  closeMenus();
  const btn = $('menubar').children[i];
  const r = btn.getBoundingClientRect();
  openIndex = i;
  btn.classList.add('open');
  const dd = buildDropdown(MENUS[i].items, 0);
  dd.style.left = r.left + 'px';
  dd.style.top = r.bottom + 'px';
  document.body.appendChild(dd);
  currentDropdown = dd;
}

document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (t && typeof t.closest === 'function' && (t.closest('.dropdown') || t.closest('.menu-item'))) return;
  closeMenus();
});

/* ---------------------------------------------------------------- view toggles */

function toggleView(key) {
  app[key] = !app[key];
  $('toolbox').style.display = app.showToolbox ? '' : 'none';
  $('palette').style.display = app.showColorbox ? '' : 'none';
  $('statusbar').style.display = app.showStatus ? '' : 'none';
  renderTextbar();
}

function viewBitmap() {
  const layer = document.createElement('div');
  layer.id = 'bitmapLayer';
  layer.style.cssText =
    'position:fixed;inset:0;background:#000;display:flex;align-items:center;justify-content:center;z-index:800;cursor:pointer';
  const img = document.createElement('img');
  img.src = base.toDataURL();
  img.style.imageRendering = 'pixelated';
  img.style.maxWidth = '100%';
  img.style.maxHeight = '100%';
  layer.appendChild(img);
  layer.addEventListener('mousedown', () => layer.remove());
  document.body.appendChild(layer);
}

/* ---------------------------------------------------------------- dialogs */

const dialogLayer = document.createElement('div');
dialogLayer.id = 'dialogLayer';
document.body.appendChild(dialogLayer);

function openDialog({ title, width = 300, body, buttons, onMount }) {
  return new Promise((resolve) => {
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.style.width = width + 'px';
    dlg.innerHTML = `
      <div class="dlg-title">
        <span>${title}</span>
        <button class="tb-btn" data-close tabindex="-1">
          <svg viewBox="0 0 9 9" width="8" height="7" shape-rendering="crispEdges"><path d="M1 1 L7 7 M7 1 L1 7" stroke="#000" stroke-width="1.2"/></svg>
        </button>
      </div>
      <div class="dlg-body"></div>
      <div class="dlg-buttons"></div>
    `;
    const bodyEl = dlg.querySelector('.dlg-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else bodyEl.appendChild(body);
    const btnRow = dlg.querySelector('.dlg-buttons');
    const list = buttons || [{ label: 'OK', value: true, primary: true }, { label: 'Cancel', value: false }];
    let primaryBtn = null;
    const done = (raw) => {
      const v = typeof raw === 'function' ? raw(dlg) : raw;
      document.removeEventListener('keydown', onKey, true);
      dlg.remove();
      resolve(v);
    };
    list.forEach((b) => {
      const btn = document.createElement('button');
      btn.className = 'btn' + (b.primary ? ' primary' : '');
      btn.textContent = b.label;
      btn.addEventListener('click', () => done(b.value));
      if (b.primary) primaryBtn = btn;
      btnRow.appendChild(btn);
    });
    dlg.querySelector('[data-close]').addEventListener('click', () => done(false));

    const onKey = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        done(false);
      } else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') {
        e.preventDefault();
        e.stopPropagation();
        if (primaryBtn) primaryBtn.click();
      }
    };
    document.addEventListener('keydown', onKey, true);

    dialogLayer.appendChild(dlg);
    const r = dlg.getBoundingClientRect();
    dlg.style.left = Math.max(8, Math.round((window.innerWidth - r.width) / 2)) + 'px';
    dlg.style.top = Math.max(8, Math.round((window.innerHeight - r.height) / 2) - 30) + 'px';

    // drag by title bar
    const titleEl = dlg.querySelector('.dlg-title');
    titleEl.addEventListener('mousedown', (e) => {
      if (e.target.closest('button')) return;
      e.preventDefault();
      const startX = e.clientX;
      const startY = e.clientY;
      const ox = parseFloat(dlg.style.left);
      const oy = parseFloat(dlg.style.top);
      const mv = (ev) => {
        dlg.style.left = ox + ev.clientX - startX + 'px';
        dlg.style.top = oy + ev.clientY - startY + 'px';
      };
      const up = () => {
        window.removeEventListener('mousemove', mv);
        window.removeEventListener('mouseup', up);
      };
      window.addEventListener('mousemove', mv);
      window.addEventListener('mouseup', up);
    });

    if (onMount) onMount(bodyEl, dlg);
    if (primaryBtn) primaryBtn.focus();
  });
}

/* ----- attributes ----- */

function attributesDialog() {
  openDialog({
    title: 'Attributes',
    width: 250,
    body: `
      <div class="row"><span class="label-col">Width:</span><input class="field" id="attrW" value="${base.width}" style="width:70px"></div>
      <div class="row"><span class="label-col">Height:</span><input class="field" id="attrH" value="${base.height}" style="width:70px"></div>
      <div class="row"><span class="label-col">Colors:</span>
        <label class="radio"><input type="radio" checked><span>Colors</span></label>
        <label class="radio"><input type="radio"><span>Black and white</span></label>
      </div>`,
    buttons: [
      { label: 'OK', value: (dlg) => ({ kind: 'ok', w: dlg.querySelector('#attrW').value, h: dlg.querySelector('#attrH').value }), primary: true },
      { label: 'Cancel', value: false },
      { label: 'Default', value: { kind: 'default' } },
    ],
  }).then((v) => {
    if (!v) return;
    commitText();
    pushUndo();
    if (v.kind === 'default') {
      setSize(640, 440, true);
      return;
    }
    setSize(parseInt(v.w, 10) || base.width, parseInt(v.h, 10) || base.height, true);
  });
}

/* ----- flip / rotate ----- */

function flipRotateDialog() {
  openDialog({
    title: 'Flip and Rotate',
    width: 300,
    body: `
      <fieldset class="fset"><legend>Flip</legend>
        <label class="radio"><input type="radio" name="fr" value="h" checked><span>Flip &amp;horizontal</span></label>
        <label class="radio"><input type="radio" name="fr" value="v"><span>Flip &amp;vertical</span></label>
      </fieldset>
      <fieldset class="fset"><legend>Rotate</legend>
        <label class="radio"><input type="radio" name="fr" value="r90"><span>Rotate by 90&deg;</span></label>
        <label class="radio"><input type="radio" name="fr" value="r180"><span>Rotate by 180&deg;</span></label>
        <label class="radio"><input type="radio" name="fr" value="r270"><span>Rotate by 270&deg;</span></label>
      </fieldset>`,
    buttons: [
      { label: 'OK', value: (dlg) => dlg.querySelector('input[name="fr"]:checked').value, primary: true },
      { label: 'Cancel', value: false },
    ],
  }).then((v) => {
    if (!v) return;
    applyFlipRotate(v);
  });
}

function applyFlipRotate(kind) {
  commitText();
  pushUndo();
  const w = base.width;
  const h = base.height;
  const tmp = document.createElement('canvas');
  const tctx = tmp.getContext('2d');
  tmp.width = kind === 'r90' || kind === 'r270' ? h : w;
  tmp.height = kind === 'r90' || kind === 'r270' ? w : h;
  tctx.imageSmoothingEnabled = false;
  tctx.save();
  if (kind === 'h') {
    tctx.translate(w, 0);
    tctx.scale(-1, 1);
  } else if (kind === 'v') {
    tctx.translate(0, h);
    tctx.scale(1, -1);
  } else if (kind === 'r90') {
    tctx.translate(h, 0);
    tctx.rotate(Math.PI / 2);
  } else if (kind === 'r180') {
    tctx.translate(w, h);
    tctx.rotate(Math.PI);
  } else if (kind === 'r270') {
    tctx.translate(0, w);
    tctx.rotate(-Math.PI / 2);
  }
  tctx.drawImage(base, 0, 0);
  tctx.restore();
  restore(tmp);
}

/* ----- stretch / skew ----- */

function stretchSkewDialog() {
  openDialog({
    title: 'Stretch and Skew',
    width: 300,
    body: `
      <fieldset class="fset"><legend>Stretch</legend>
        <div class="row"><span class="label-col">Horizontal:</span><input class="field" id="stH" value="100" style="width:50px"><span>%</span></div>
        <div class="row"><span class="label-col">Vertical:</span><input class="field" id="stV" value="100" style="width:50px"><span>%</span></div>
      </fieldset>
      <fieldset class="fset"><legend>Skew</legend>
        <div class="row"><span class="label-col">Horizontal:</span><input class="field" id="skH" value="0" style="width:50px"><span>Degrees</span></div>
        <div class="row"><span class="label-col">Vertical:</span><input class="field" id="skV" value="0" style="width:50px"><span>Degrees</span></div>
      </fieldset>`,
    buttons: [
      {
        label: 'OK',
        value: (dlg) => ({
          sh: clamp(parseInt(dlg.querySelector('#stH').value, 10) || 100, 1, 500),
          sv: clamp(parseInt(dlg.querySelector('#stV').value, 10) || 100, 1, 500),
          kh: clamp(parseInt(dlg.querySelector('#skH').value, 10) || 0, -89, 89),
          kv: clamp(parseInt(dlg.querySelector('#skV').value, 10) || 0, -89, 89),
        }),
        primary: true,
      },
      { label: 'Cancel', value: false },
    ],
  }).then((v) => {
    if (!v) return;
    applyStretchSkew(v.sh, v.sv, v.kh, v.kv);
  });
}

function applyStretchSkew(sh, sv, kh, kv) {
  commitText();
  pushUndo();
  const w = base.width;
  const h = base.height;
  const tmp = document.createElement('canvas');
  tmp.width = w;
  tmp.height = h;
  const tctx = tmp.getContext('2d');
  tctx.imageSmoothingEnabled = false;
  tctx.save();
  tctx.translate(w / 2, h / 2);
  tctx.transform(1, Math.tan((kv * Math.PI) / 180), Math.tan((kh * Math.PI) / 180), 1, 0, 0);
  tctx.scale(sh / 100, sv / 100);
  tctx.drawImage(base, -w / 2, -h / 2);
  tctx.restore();
  restore(tmp);
}

function invertColors() {
  commitText();
  pushUndo();
  const img = bctx.getImageData(0, 0, base.width, base.height);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    d[i] = 255 - d[i];
    d[i + 1] = 255 - d[i + 1];
    d[i + 2] = 255 - d[i + 2];
  }
  bctx.putImageData(img, 0, 0);
  scheduleRedraw();
}

function clearImage() {
  commitText();
  pushUndo();
  bctx.fillStyle = '#ffffff';
  bctx.fillRect(0, 0, base.width, base.height);
  sel = null;
  floating = null;
  updateSelStatus();
  scheduleRedraw();
}

/* ----- edit colours ----- */

function editColors(initial) {
  const start = initial || app.primary;
  const [sr, sg, sb] = hexToRgb(start);
  const body = `
    <div class="row" style="align-items:flex-start">
      <div>
        <div style="margin-bottom:4px">Basic colors:</div>
        <div class="color-grid" id="cg"></div>
      </div>
      <div style="margin-left:10px">
        <div class="preview-box" id="cprev" style="background:${start}"></div>
        <div class="row" style="margin-top:6px"><span>R:</span><input class="field" id="cr" value="${sr}" style="width:44px"></div>
        <div class="row"><span>G:</span><input class="field" id="cg2" value="${sg}" style="width:44px"></div>
        <div class="row"><span>B:</span><input class="field" id="cb" value="${sb}" style="width:44px"></div>
      </div>
    </div>`;
  openDialog({
    title: 'Edit Colors',
    width: 340,
    body,
    onMount: (el, dlg) => {
      const grid = el.querySelector('#cg');
      const extra = [];
      for (let r = 0; r < 6; r++) {
        for (let c = 0; c < 8; c++) {
          extra.push(rgbToHex((c / 7) * 255, (r / 5) * 255, r < 3 ? 64 * (3 - r) : 255));
        }
      }
      const colors = extra.concat(PALETTE).slice(0, 48);
      colors.forEach((col) => {
        const b = document.createElement('button');
        b.style.background = col;
        b.dataset.color = col;
        b.addEventListener('click', () => {
          const [r, g, b2] = hexToRgb(col);
          el.querySelector('#cr').value = r;
          el.querySelector('#cg2').value = g;
          el.querySelector('#cb').value = b2;
          el.querySelector('#cprev').style.background = col;
        });
        grid.appendChild(b);
      });
      const upd = () => {
        const col = rgbToHex(
          parseInt(el.querySelector('#cr').value, 10) || 0,
          parseInt(el.querySelector('#cg2').value, 10) || 0,
          parseInt(el.querySelector('#cb').value, 10) || 0
        );
        el.querySelector('#cprev').style.background = col;
      };
      ['#cr', '#cg2', '#cb'].forEach((s) => el.querySelector(s).addEventListener('input', upd));
    },
    buttons: [
      {
        label: 'OK',
        value: (dlg) => rgbToHex(
          parseInt(dlg.querySelector('#cr').value, 10) || 0,
          parseInt(dlg.querySelector('#cg2').value, 10) || 0,
          parseInt(dlg.querySelector('#cb').value, 10) || 0
        ),
        primary: true,
      },
      { label: 'Cancel', value: false },
      { label: 'Add to Custom Colors', value: false },
    ],
  }).then((v) => {
    if (!v) return;
    app.primary = v;
    paintColorIndicators();
  });
}

/* ----- page setup / print ----- */

function pageSetupDialog() {
  openDialog({
    title: 'Page Setup',
    width: 280,
    body: `
      <div class="row"><span class="label-col">Left margin:</span><input class="field" id="pmL" value="${app.margins.left}" style="width:50px"><span>in</span></div>
      <div class="row"><span class="label-col">Right margin:</span><input class="field" id="pmR" value="${app.margins.right}" style="width:50px"><span>in</span></div>
      <div class="row"><span class="label-col">Top margin:</span><input class="field" id="pmT" value="${app.margins.top}" style="width:50px"><span>in</span></div>
      <div class="row"><span class="label-col">Bottom margin:</span><input class="field" id="pmB" value="${app.margins.bottom}" style="width:50px"><span>in</span></div>`,
    buttons: [
      {
        label: 'OK',
        value: (dlg) => ({
          left: parseFloat(dlg.querySelector('#pmL').value) || 0,
          right: parseFloat(dlg.querySelector('#pmR').value) || 0,
          top: parseFloat(dlg.querySelector('#pmT').value) || 0,
          bottom: parseFloat(dlg.querySelector('#pmB').value) || 0,
        }),
        primary: true,
      },
      { label: 'Cancel', value: false },
    ],
  }).then((v) => {
    if (!v) return;
    app.margins = v;
  });
}

function printPreviewDialog() {
  commitText();
  const pageW = 816;
  const pageH = 1056;
  const m = app.margins;
  const availW = pageW - (m.left + m.right) * 96;
  const availH = pageH - (m.top + m.bottom) * 96;
  const scale = Math.min(1, availW / base.width, availH / base.height);
  const imgW = Math.round(base.width * scale);
  const imgH = Math.round(base.height * scale);
  const body = `
    <div class="page-preview" style="width:${pageW + 24}px">
      <div class="page-sheet" style="width:${pageW}px;height:${pageH}px">
        <img src="${base.toDataURL()}" style="position:absolute;left:${Math.round(m.left * 96)}px;top:${Math.round(m.top * 96)}px;width:${imgW}px;height:${imgH}px">
      </div>
    </div>`;
  openDialog({
    title: 'Print Preview',
    width: pageW + 60,
    body,
    buttons: [{ label: 'Print', value: 'print', primary: true }, { label: 'Close', value: false }],
  }).then((v) => {
    if (v === 'print') doPrint();
  });
}

function doPrint() {
  commitText();
  const sheet = $('printSheet');
  sheet.innerHTML = '';
  const img = document.createElement('img');
  img.src = base.toDataURL();
  sheet.appendChild(img);
  window.print();
}

function setWallpaper(mode) {
  commitText();
  const url = base.toDataURL();
  const ws = $('workspace');
  ws.style.backgroundImage = `url(${url})`;
  ws.style.backgroundRepeat = mode === 'tile' ? 'repeat' : 'no-repeat';
  ws.style.backgroundPosition = 'center';
  ws.style.backgroundSize = mode === 'tile' ? 'auto' : 'auto auto';
}

/* ----- help / about ----- */

function aboutDialog() {
  openDialog({
    title: 'About Paint',
    width: 380,
    body: `
      <div class="about">
        <div class="about-icon">
          <svg viewBox="0 0 16 16" width="40" height="40" shape-rendering="crispEdges">
            <rect x="1" y="2" width="14" height="12" fill="#fff" stroke="#000"/>
            <rect x="2" y="3" width="12" height="5" fill="#0080ff"/>
            <rect x="2" y="9" width="4" height="4" fill="#ff0000"/>
            <rect x="7" y="9" width="4" height="4" fill="#ffff00"/>
            <rect x="12" y="9" width="2" height="4" fill="#00a000"/>
          </svg>
        </div>
        <div>
          <div class="about-title">Microsoft Paint</div>
          <div>Version 4.00.950</div>
          <div>Copyright &copy; 1981-1995 Microsoft Corp.</div>
        </div>
      </div>
      <div class="about-note">
        A faithful re-creation of the classic Paint that shipped with Windows 95,
        rebuilt for the modern browser. Same toolbox, same palette, same pixel
        behaviour — no anti-aliasing, no layers, no undo history beyond twelve steps.
      </div>`,
  });
}

function helpDialog() {
  const rows = TOOLS.map((t) => `<b>${t.title}</b><span>Left button draws with the foreground colour, right button with the background colour.</span>`);
  openDialog({
    title: 'Paint Help',
    width: 460,
    body: `
      <div style="font-weight:bold;margin-bottom:6px">Tools</div>
      <div class="help-list">${rows.join('')}</div>
      <div style="font-weight:bold;margin:10px 0 6px">Keys</div>
      <div class="help-list">
        <b>Ctrl+Z</b><span>Undo</span>
        <b>Ctrl+Y</b><span>Repeat</span>
        <b>Ctrl+C / X / V</b><span>Copy, Cut, Paste selection</span>
        <b>Del</b><span>Clear selection</span>
        <b>Ctrl+F</b><span>View Bitmap</span>
        <b>Ctrl+PgUp / PgDn</b><span>Normal size / large size</span>
        <b>Shift</b><span>Constrain lines, rectangles, ellipses and polygons</span>
      </div>`,
  });
}

function customZoomDialog() {
  openDialog({
    title: 'Custom Zoom',
    width: 250,
    body: `
      <div class="row"><span class="label-col">Current zoom:</span><span id="czNow">${Math.round(app.zoom * 100)}%</span></div>
      <fieldset class="fset"><legend>Zoom To</legend>
        <label class="radio"><input type="radio" name="z" value="1" ${app.zoom === 1 ? 'checked' : ''}><span>100% (Normal size)</span></label>
        <label class="radio"><input type="radio" name="z" value="2" ${app.zoom === 2 ? 'checked' : ''}><span>200%</span></label>
        <label class="radio"><input type="radio" name="z" value="4" ${app.zoom === 4 ? 'checked' : ''}><span>400% (Large size)</span></label>
        <label class="radio"><input type="radio" name="z" value="8" ${app.zoom === 8 ? 'checked' : ''}><span>800%</span></label>
      </fieldset>`,
    buttons: [
      { label: 'OK', value: (dlg) => parseInt(dlg.querySelector('input[name="z"]:checked').value, 10), primary: true },
      { label: 'Cancel', value: false },
    ],
  }).then((v) => {
    if (!v) return;
    app.zoomOption = v;
    setZoom(v);
    renderOptions();
  });
}

/* ---------------------------------------------------------------- file */

function fileNew() {
  commitText(true);
  if (app.dirty) {
    openDialog({
      title: 'Paint',
      width: 340,
      body: '<div style="line-height:16px">The picture has been changed.<br>Do you want to save it?</div>',
      buttons: [
        { label: 'Yes', value: 'yes', primary: true },
        { label: 'No', value: 'no' },
        { label: 'Cancel', value: false },
      ],
    }).then((v) => {
      if (v === 'yes') fileSave(false);
      else if (v === 'no') resetImage();
    });
    return;
  }
  resetImage();
}

function resetImage() {
  undoStack.length = 0;
  redoStack.length = 0;
  app.fileName = 'untitled';
  app.dirty = false;
  updateTitle();
  fitCanvasToWorkspace(true);
  redraw();
}

function fileOpen() {
  if (app.dirty) app.dirty = false;
  const inp = $('fileInput');
  inp.value = '';
  inp.click();
}

$('fileInput').addEventListener('change', (e) => {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const img = new Image();
  img.onload = () => {
    pushUndo();
    base.width = img.naturalWidth;
    base.height = img.naturalHeight;
    bctx.imageSmoothingEnabled = false;
    bctx.fillStyle = '#fff';
    bctx.fillRect(0, 0, base.width, base.height);
    bctx.drawImage(img, 0, 0);
    app.fileName = file.name.replace(/\.[^.]+$/, '');
    app.dirty = false;
    updateTitle();
    sel = null;
    floating = null;
    updateSelStatus();
    applyView();
    redraw();
    URL.revokeObjectURL(img.src);
  };
  img.onerror = () => alert('Paint cannot read this file.\nIt may be corrupt or in a format Paint does not support.');
  img.src = URL.createObjectURL(file);
});

function fileSave(forceDialog) {
  commitText();
  openDialog({
    title: 'Save As',
    width: 380,
    body: `
      <div class="row"><span style="width:60px">File name:</span>
        <input class="field" id="svName" value="${app.fileName}" style="flex:1"></div>
      <div class="row"><span style="width:60px">Save as type:</span>
        <select class="field" id="svType" style="flex:1;height:19px">
          <option value="png">PNG (*.png)</option>
          <option value="bmp">256 Color Bitmap (*.bmp)</option>
        </select></div>`,
    onMount: (el) => {
      const n = el.querySelector('#svName');
      n.focus();
      n.setSelectionRange(0, n.value.length);
    },
    buttons: [
      {
        label: 'Save',
        value: (dlg) => ({
          name: (dlg.querySelector('#svName').value || 'untitled').trim(),
          type: dlg.querySelector('#svType').value,
        }),
        primary: true,
      },
      { label: 'Cancel', value: false },
    ],
  }).then((v) => {
    if (!v) return;
    downloadCanvas(v.name, v.type);
    app.fileName = v.name.replace(/\.[^.]+$/, '');
    app.dirty = false;
    updateTitle();
  });
}

function downloadCanvas(name, type) {
  let blobP;
  let ext = 'png';
  if (type === 'bmp') {
    ext = 'bmp';
    blobP = Promise.resolve(encodeBMP(base));
  } else {
    blobP = new Promise((res) => base.toBlob((b) => res(b), 'image/png'));
  }
  blobP.then((blob) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name.replace(/\.[^.]+$/, '') + '.' + ext;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(a.href);
      a.remove();
    }, 1000);
  });
}

function encodeBMP(canvas) {
  const w = canvas.width;
  const h = canvas.height;
  const data = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const rowSize = (w * 3 + 3) & ~3;
  const pixelSize = rowSize * h;
  const fileSize = 54 + pixelSize;
  const buf = new ArrayBuffer(fileSize);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setUint8(0, 0x42);
  dv.setUint8(1, 0x4d);
  dv.setUint32(2, fileSize, true);
  dv.setUint32(10, 54, true);
  dv.setUint32(14, 40, true);
  dv.setInt32(18, w, true);
  dv.setInt32(22, h, true);
  dv.setUint16(26, 1, true);
  dv.setUint16(28, 24, true);
  dv.setUint32(34, pixelSize, true);
  dv.setInt32(38, 2835, true);
  dv.setInt32(42, 2835, true);
  for (let y = 0; y < h; y++) {
    const srcRow = (h - 1 - y) * w * 4;
    let o = 54 + y * rowSize;
    for (let x = 0; x < w; x++) {
      const i = srcRow + x * 4;
      u8[o++] = data[i + 2];
      u8[o++] = data[i + 1];
      u8[o++] = data[i];
    }
  }
  return new Blob([buf], { type: 'image/bmp' });
}

/* ---------------------------------------------------------------- clipboard */

function doCopy() {
  const c = grabSelection();
  if (c) clip = c;
}

function doCut() {
  const c = grabSelection();
  if (!c) return;
  clip = c;
  if (floating) {
    floating = null;
    sel = null;
  } else {
    pushUndo();
    eraseSelectionArea();
    sel = null;
  }
  updateSelStatus();
  scheduleRedraw();
}

function doPaste() {
  if (!clip) return;
  commitFloating();
  floating = { canvas: clip, x: 0, y: 0, w: clip.width, h: clip.height, opaque: app.drawOpaque };
  sel = null;
  updateSelStatus();
  scheduleRedraw();
}

/* ---------------------------------------------------------------- keyboard */

document.addEventListener('keydown', (e) => {
  if (dialogLayer.children.length) return;
  const tag = (e.target.tagName || '').toLowerCase();
  const typing = tag === 'input' || tag === 'textarea' || tag === 'select';

  if (e.key === 'Escape') {
    if (poly) {
      finishPolygon();
      return;
    }
    if (textState) {
      commitText();
      return;
    }
    if (typing) return;
    if (drag) {
      drag = null;
      preview = null;
      scheduleRedraw();
      return;
    }
    if (sel || floating) {
      dropSelection();
      return;
    }
    closeMenus();
    return;
  }

  if (typing) return;

  const k = e.key.toLowerCase();
  if (e.ctrlKey && !e.shiftKey && !e.altKey) {
    if (k === 'z') { e.preventDefault(); undo(); return; }
    if (k === 'y') { e.preventDefault(); redo(); return; }
    if (k === 'n') { e.preventDefault(); fileNew(); return; }
    if (k === 'o') { e.preventDefault(); fileOpen(); return; }
    if (k === 's') { e.preventDefault(); fileSave(false); return; }
    if (k === 'p') { e.preventDefault(); doPrint(); return; }
    if (k === 'x') { e.preventDefault(); doCut(); return; }
    if (k === 'c') { e.preventDefault(); doCopy(); return; }
    if (k === 'v') { e.preventDefault(); doPaste(); return; }
    if (k === 'f') { e.preventDefault(); viewBitmap(); return; }
    if (k === 'r') { e.preventDefault(); flipRotateDialog(); return; }
    if (k === 'w') { e.preventDefault(); stretchSkewDialog(); return; }
    if (k === 'i') { e.preventDefault(); invertColors(); return; }
    if (k === 'e') { e.preventDefault(); attributesDialog(); return; }
    if (e.key === 'PageUp') { e.preventDefault(); setZoom(1); return; }
    if (e.key === 'PageDown') { e.preventDefault(); setZoom(4); return; }
  }
  if (e.ctrlKey && e.shiftKey && k === 'n') { e.preventDefault(); clearImage(); return; }
  if (e.key === 'Delete') { e.preventDefault(); deleteSelection(); return; }
});

/* ---------------------------------------------------------------- title bar buttons */

$('btnMin').addEventListener('click', () => {
  if (shell) return shellPost('minimize');
  document.body.classList.toggle('collapsed');
});
$('btnMax').addEventListener('click', () => {
  if (shell) return shellPost('maximize');
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
});
$('btnClose').addEventListener('click', () => {
  if (shell) return shellPost('close');
  window.close();
  setTimeout(() => {
    document.body.innerHTML =
      '<div style="position:fixed;inset:0;background:#008080;color:#fff;font:bold 12px Tahoma;display:flex;align-items:center;justify-content:center">Paint has closed. Reload the page to open it again.</div>';
  }, 150);
});

/* drag / double-click the Win95 title bar = move / maximise the real window */
$('titlebar').addEventListener('mousedown', (e) => {
  if (!shell || e.button !== 0 || (e.target.closest && e.target.closest('button'))) return;
  shellPost('drag');
});
$('titlebar').addEventListener('dblclick', (e) => {
  if (!shell || (e.target.closest && e.target.closest('button'))) return;
  shellPost('maximize');
});

/* ---------------------------------------------------------------- boot */

function boot() {
  buildMenuBar();
  buildToolbox();
  buildPalette();
  renderOptions();
  renderTextbar();
  fitCanvasToWorkspace(true);
  updateTitle();
  $('stHelp').textContent = 'For Help, click Help Topics on the Help Menu.';
  selectTool('pencil');
  redraw();
}

boot();

window.paintApp = {
  app,
  base,
  setSize,
  setZoom,
  selectTool,
  undo,
  undoStack,
  getSelection: () => sel,
  getTool: () => app.tool,
  fitCanvasToWorkspace,
};
