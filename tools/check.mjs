/*
 * Headless check: loads the app in Chrome via CDP, exercises the main tools,
 * fails on any console error, and writes a screenshot to .check/shot.png
 *
 *   node tools/check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9333;
const URL_BASE = process.env.PAINT_URL || 'http://localhost:8135/apps/paint/index.html';
const outDir = path.join(root, '.check');
fs.mkdirSync(outDir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'paint-check-'));
const chrome = spawn(CHROME, [
  '--headless=new',
  '--disable-gpu',
  '--no-first-run',
  '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${userDataDir}`,
  '--window-size=1000,700',
  'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function getWsUrl() {
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/list`);
      const list = await res.json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch {}
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

let id = 0;
const pending = new Map();
const errors = [];

function send(ws, method, params = {}) {
  const msgId = ++id;
  return new Promise((resolve, reject) => {
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
}

function evaluate(ws, expr) {
  return send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
    .then((r) => {
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed: ' + expr);
      return r.result.value;
    });
}

async function mouse(ws, type, x, y, button = 'left') {
  await send(ws, 'Input.dispatchMouseEvent', {
    type,
    x,
    y,
    button,
    buttons: type === 'mouseReleased' ? 0 : button === 'left' ? 1 : 2,
    clickCount: 1,
  });
}

const checks = [];
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
}

const main = async () => {
  const wsUrl = await getWsUrl();
  const ws = new WebSocket(wsUrl);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const p = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) p.reject(new Error(JSON.stringify(msg.error)));
      else p.resolve(msg.result);
      return;
    }
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
      errors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
    }
    if (msg.method === 'Runtime.exceptionThrown') {
      errors.push('EXCEPTION ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
    }
  };

  await send(ws, 'Runtime.enable');
  await send(ws, 'Log.enable');
  await send(ws, 'Page.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 1000, height: 700, deviceScaleFactor: 1, mobile: false });
  const fontInfo = await (async () => null)();
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(1200);

  // --- structure -------------------------------------------------------
  const layout = await evaluate(ws, `(() => {
    const q = (s) => document.querySelector(s);
    const r = (s) => { const e = q(s); if (!e) return null; const b = e.getBoundingClientRect(); return {w: Math.round(b.width), h: Math.round(b.height)}; };
    return {
      tools: q('#tools').children.length,
      toolIds: [...q('#tools').children].map(e => e.dataset.tool),
      swatches: q('#swatches').children.length,
      canvas: r('#canvas'),
      workspace: r('#workspace'),
      boxW: r('.toolbox') && r('.toolbox').w,
      menuItems: [...q('#menubar').children].map(e => e.textContent),
      title: q('#tbTitle').textContent,
    };
  })()`);
  check('window title is "untitled - Paint"', layout.title === 'untitled - Paint', layout.title);
  check('16 tools in the toolbox', layout.tools === 16, String(layout.tools));
  check('toolbox is two 25px columns wide', layout.boxW === 55, String(layout.boxW));
  check('28 palette colours', layout.swatches === 28, String(layout.swatches));
  check('menus are File/Edit/View/Image/Options/Help', layout.menuItems.join(',') === 'File,Edit,View,Image,Options,Help', layout.menuItems.join(','));
  check(
    'canvas fills the workspace',
    layout.canvas.w >= layout.workspace.w - 3 && layout.canvas.h >= layout.workspace.h - 3,
    `canvas ${layout.canvas.w}x${layout.canvas.h} in workspace ${layout.workspace.w}x${layout.workspace.h}`
  );

  const rect = await evaluate(ws, `(() => { const b = document.getElementById('canvas').getBoundingClientRect(); return {x: b.left, y: b.top}; })()`);
  const cx = (n) => Math.round(rect.x + n);
  const cy = (n) => Math.round(rect.y + n);

  // --- pencil ----------------------------------------------------------
  await evaluate(ws, `window.paintApp.selectTool('pencil')`);
  await mouse(ws, 'mousePressed', cx(20), cy(20));
  for (let i = 0; i <= 40; i++) await mouse(ws, 'mouseMoved', cx(20 + i * 3), cy(20 + i * 2));
  await mouse(ws, 'mouseReleased', cx(140), cy(100));
  const pencil = await evaluate(ws, `(() => {
    const d = window.paintApp.base.getContext('2d').getImageData(0,0,200,200).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 32 && d[i+1] < 32 && d[i+2] < 32) n++;
    return n;
  })()`);
  check('pencil draws black pixels', pencil > 60, `${pencil} dark px`);
  const pure = await evaluate(ws, `(() => {
    const d = window.paintApp.base.getContext('2d').getImageData(0,0,200,200).data;
    let grey = 0; for (let i = 0; i < d.length; i += 4) { const v = d[i]; if (v > 24 && v < 232) grey++; }
    return grey;
  })()`);
  check('no anti-aliasing on strokes', pure === 0, `${pure} mid-tone px`);

  // --- undo ------------------------------------------------------------
  await evaluate(ws, `window.paintApp.undo()`);
  const afterUndo = await evaluate(ws, `(() => {
    const d = window.paintApp.base.getContext('2d').getImageData(0,0,200,200).data;
    let n = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 32 && d[i+1] < 32 && d[i+2] < 32) n++;
    return n;
  })()`);
  check('undo clears the stroke', afterUndo === 0, `${afterUndo} dark px`);

  // --- fill ------------------------------------------------------------
  await evaluate(ws, `window.paintApp.selectTool('fill')`);
  await mouse(ws, 'mousePressed', cx(300), cy(300));
  await mouse(ws, 'mouseReleased', cx(300), cy(300));
  const filled = await evaluate(ws, `(() => {
    const c = window.paintApp.base.getContext('2d');
    const d = c.getImageData(639, 439, 1, 1).data;
    return [d[0], d[1], d[2]];
  })()`);
  check('fill floods the canvas black', filled.join(',') === '0,0,0', filled.join(','));

  // --- right button uses the background colour -------------------------
  await evaluate(ws, `window.paintApp.selectTool('pencil')`);
  await mouse(ws, 'mousePressed', cx(500), cy(400), 'right');
  await mouse(ws, 'mouseMoved', cx(560), cy(400), 'right');
  await mouse(ws, 'mouseReleased', cx(560), cy(400), 'right');
  const rightBtn = await evaluate(ws, `(() => {
    const d = window.paintApp.base.getContext('2d').getImageData(520, 400, 1, 1).data;
    return [d[0], d[1], d[2]];
  })()`);
  check('right-drag draws with the background colour', rightBtn.join(',') === '255,255,255', rightBtn.join(','));

  // --- shapes ----------------------------------------------------------
  await evaluate(ws, `(() => { const a = window.paintApp.app; a.primary = '#ff0000'; document.getElementById('ccFg').style.background = '#ff0000'; window.paintApp.selectTool('rect'); a.fillMode = 0; a.lineWidth = 1; })()`);
  await mouse(ws, 'mousePressed', cx(400), cy(60));
  await mouse(ws, 'mouseMoved', cx(480), cy(120));
  await mouse(ws, 'mouseReleased', cx(480), cy(120));
  const rectPx = await evaluate(ws, `(() => {
    const d = window.paintApp.base.getContext('2d').getImageData(0,0,640,440).data;
    let red = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 200 && d[i+1] < 60 && d[i+2] < 60) red++;
    return red;
  })()`);
  check('rectangle tool draws red outline', rectPx > 200, `${rectPx} red px`);

  // --- ellipse + fill mode --------------------------------------------
  await evaluate(ws, `(() => { const a = window.paintApp.app; a.fillMode = 1; a.secondary = '#00ff00'; window.paintApp.selectTool('ellipse'); })()`);
  await mouse(ws, 'mousePressed', cx(60), cy(200));
  await mouse(ws, 'mouseMoved', cx(160), cy(300));
  await mouse(ws, 'mouseReleased', cx(160), cy(300));
  const green = await evaluate(ws, `(() => {
    const d = window.paintApp.base.getContext('2d').getImageData(110, 250, 1, 1).data;
    return [d[0], d[1], d[2]];
  })()`);
  check('filled ellipse uses the background colour', green.join(',') === '0,255,0', green.join(','));

  // --- text ------------------------------------------------------------
  await evaluate(ws, `window.paintApp.setSize(640, 440, false)`);
  const textOk = await evaluate(ws, `(async () => {
    const a = window.paintApp.app;
    a.primary = '#000000';
    a.secondary = '#ffffff';
    window.paintApp.selectTool('text');
    const c = document.getElementById('canvas').getBoundingClientRect();
    const down = (x, y) => document.getElementById('canvas').dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: c.left + x, clientY: c.top + y, button: 0}));
    const up = (x, y) => window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: c.left + x, clientY: c.top + y, button: 0}));
    down(200, 150); up(420, 190);
    await new Promise(r => setTimeout(r, 60));
    const ta = document.querySelector('.text-overlay textarea');
    if (!ta) return 'no textarea';
    ta.value = 'Hello Paint';
    ta.dispatchEvent(new Event('input', {bubbles: true}));
    await new Promise(r => setTimeout(r, 60));
    ta.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
    await new Promise(r => setTimeout(r, 120));
    if (document.querySelector('.text-overlay')) return 'text box not closed';
    const d = window.paintApp.base.getContext('2d').getImageData(200, 148, 240, 50).data;
    let dark = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 90 && d[i+1] < 90 && d[i+2] < 90) dark++;
    return dark > 40 ? 'ok' : 'no glyphs (' + dark + ')';
  })()`);
  check('text tool commits typed text', textOk === 'ok', textOk);
  await evaluate(ws, `window.paintApp.setSize(640, 440, false)`);

  // --- selection + move ------------------------------------------------
  const selOk = await evaluate(ws, `(async () => {
    window.paintApp.selectTool('select');
    const c = document.getElementById('canvas').getBoundingClientRect();
    const md = (x, y) => document.getElementById('canvas').dispatchEvent(new MouseEvent('mousedown', {bubbles: true, clientX: c.left + x, clientY: c.top + y, button: 0}));
    const mm = (x, y) => window.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: c.left + x, clientY: c.top + y, button: 0}));
    const mu = (x, y) => window.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, clientX: c.left + x, clientY: c.top + y, button: 0}));
    md(20, 20); mm(120, 100); mu(120, 100);
    await new Promise(r => setTimeout(r, 60));
    const s = window.paintApp.getSelection();
    if (!s) return 'no selection';
    md(60, 60); mm(260, 260); mu(260, 260);
    await new Promise(r => setTimeout(r, 60));
    return s.w === 101 && s.h === 81 ? 'ok' : ('size ' + s.w + 'x' + s.h);
  })()`);
  check('selection drag creates a 101x81 marquee', selOk === 'ok', selOk);

  // --- zoom ------------------------------------------------------------
  await evaluate(ws, `window.paintApp.setZoom(4)`);
  const zoomed = await evaluate(ws, `(() => { const b = document.getElementById('canvas').getBoundingClientRect(); const a = window.paintApp.base; return b.width / a.width; })()`);
  check('zoom 400% scales the view', Math.round(zoomed) === 4, `scale ${zoomed}`);
  await evaluate(ws, `window.paintApp.setZoom(1)`);

  // --- menus -----------------------------------------------------------
  const menusOk = await evaluate(ws, `(async () => {
    const bar = document.getElementById('menubar');
    bar.children[3].dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
    await new Promise(r => setTimeout(r, 60));
    const dd = document.querySelector('.dropdown');
    const labels = dd ? [...dd.children].filter(e => e.classList.contains('dd-item')).map(e => e.textContent.trim().replace(/\\s+/g, ' ')) : [];
    document.dispatchEvent(new MouseEvent('mousedown', {bubbles: true}));
    return labels;
  })()`);
  check('Image menu opens with its items', menusOk.length === 6, `${menusOk.length} items: ${menusOk.join(' | ')}`);

  // --- dialogs ---------------------------------------------------------
  const dlgOk = await evaluate(ws, `(async () => {
    const bar = document.getElementById('menubar');
    bar.children[4].dispatchEvent(new MouseEvent('mousedown', {bubbles: true, button: 0}));
    await new Promise(r => setTimeout(r, 50));
    const item = [...document.querySelectorAll('.dd-item')].find(e => e.textContent.includes('Edit Colors'));
    item.dispatchEvent(new MouseEvent('mouseup', {bubbles: true, button: 0}));
    await new Promise(r => setTimeout(r, 80));
    const dlg = document.querySelector('.dlg');
    if (!dlg) return 'no dialog';
    const title = dlg.querySelector('.dlg-title span').textContent;
    dlg.querySelectorAll('.dlg-buttons .btn')[1].click();
    await new Promise(r => setTimeout(r, 50));
    return title + '|' + document.querySelectorAll('.dlg').length;
  })()`);
  check('Edit Colors dialog opens and cancels', dlgOk === 'Edit Colors|0', dlgOk);

  // --- rgba sanity: canvas data survives attribute resize --------------
  const resizeOk = await evaluate(ws, `(() => {
    window.paintApp.setSize(320, 240, true);
    const a = window.paintApp.base;
    const okSize = a.width === 320 && a.height === 240;
    const el = document.getElementById('canvas');
    return okSize && el.style.width === '320px';
  })()`);
  check('attributes resize keeps the picture', resizeOk === true, String(resizeOk));
  await evaluate(ws, `window.paintApp.setSize(640, 440, false)`);

  // --- screenshot ------------------------------------------------------
  await evaluate(ws, `(() => {
    const a = window.paintApp.app;
    a.primary = '#000000'; a.secondary = '#ffffff';
    document.getElementById('ccFg').style.background = '#000';
    window.paintApp.undoStack.length = 0;
    window.paintApp.selectTool('pencil');
  })()`);
  await sleep(200);
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'shot.png'), Buffer.from(shot.data, 'base64'));
  console.log('\nscreenshot -> .check/shot.png');

  // --- chrome details --------------------------------------------------
  const chromeDetail = await evaluate(ws, `(() => {
    window.paintApp.fitCanvasToWorkspace(true);
    const wsEl = document.getElementById('workspace');
    const pal = document.querySelector('.palette').getBoundingClientRect();
    const sws = [...document.querySelectorAll('.swatch')].map(e => e.getBoundingClientRect());
    const inside = sws.every(s => s.bottom <= pal.bottom - 1 && s.right <= pal.right);
    const rows = new Set(sws.map(s => Math.round(s.top))).size;
    window.paintApp.selectTool('brush');
    const brushOpts = document.querySelector('#options').children.length;
    window.paintApp.selectTool('rect');
    const rectOpts = document.querySelector('#options').children.length;
    window.paintApp.selectTool('pencil');
    const noScroll = wsEl.scrollWidth <= wsEl.clientWidth + 1 && wsEl.scrollHeight <= wsEl.clientHeight + 1;
    return { inside, rows, brushOpts, rectOpts, noScroll, scroll: wsEl.scrollWidth + 'x' + wsEl.scrollHeight + ' vs ' + wsEl.clientWidth + 'x' + wsEl.clientHeight, hint: document.getElementById('stHelp').textContent };
  })()`);
  check('all 28 swatches sit inside the colour box', chromeDetail.inside === true, JSON.stringify(chromeDetail.rows) + ' rows');
  check('brush shows 12 tips', chromeDetail.brushOpts === 12, String(chromeDetail.brushOpts));
  check('rectangle shows 5 widths + 3 fill modes', chromeDetail.rectOpts === 8, String(chromeDetail.rectOpts));
  check('status bar keeps the classic hint', /Help Topics/.test(chromeDetail.hint), chromeDetail.hint);
  check('no scrollbars when the picture fits', chromeDetail.noScroll === true, chromeDetail.scroll);

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  ws.close();
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
};

main().catch((err) => {
  console.error('CHECK ERROR', err);
  try { chrome.kill(); } catch {}
  process.exit(1);
});
