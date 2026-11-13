/*
 * Headless check for Notepad: loads the page in Chrome via CDP and exercises typing,
 * menus, word wrap, time/date, find, font and the about box.
 *
 *   node tools/notepad-check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9334;
const URL_BASE = process.env.NOTEPAD_URL || 'http://localhost:8135/apps/notepad/index.html';
const outDir = path.join(root, '.check');
fs.mkdirSync(outDir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'notepad-check-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=900,640',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

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
  return send(ws, 'Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }).then((r) => {
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || 'eval failed: ' + expr);
    return r.result.value;
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
  await send(ws, 'Page.enable');
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 900, height: 640, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(1200);

  const layout = await evaluate(ws, `(() => {
    const q = (s) => document.querySelector(s);
    const ed = q('#editor');
    return {
      title: q('#tbTitle').textContent,
      docTitle: document.title,
      menus: [...q('#menubar').children].map((e) => e.textContent),
      hasEditor: !!ed,
      editorFont: getComputedStyle(ed).fontFamily,
      wrapAttr: ed.getAttribute('wrap'),
      wrapClass: ed.classList.contains('nowrap'),
      bg: getComputedStyle(q('.window')).backgroundColor,
    };
  })()`);
  check('title is "Untitled - Notepad"', layout.title === 'Untitled - Notepad', layout.title);
  check('menus are File/Edit/Search/Help', layout.menus.join(',') === 'File,Edit,Search,Help', layout.menus.join(','));
  check('edit area exists', layout.hasEditor === true);
  check('word wrap on by default', layout.wrapAttr === 'soft' && layout.wrapClass === false, layout.wrapAttr);
  check('edit area uses a monospace face', /Fixedsys|Lucida|Courier/i.test(layout.editorFont), layout.editorFont);
  check('window face is the 95 grey', layout.bg === 'rgb(192, 192, 192)', layout.bg);

  // --- typing -----------------------------------------------------------
  const typed = await evaluate(ws, `(async () => {
    const ed = document.getElementById('editor');
    ed.focus();
    ed.value = '';
    for (const ch of 'The quick brown fox') {
      ed.dispatchEvent(new KeyboardEvent('keydown', { key: ch, bubbles: true }));
      ed.value += ch;
      ed.dispatchEvent(new Event('input', { bubbles: true }));
    }
    await new Promise((r) => setTimeout(r, 30));
    return { text: ed.value, dirty: window.notepad.dirty, title: document.getElementById('tbTitle').textContent };
  })()`);
  check('typing fills the edit area', typed.text === 'The quick brown fox', typed.text);
  check('title keeps the Win98 form', typed.title === 'Untitled - Notepad', typed.title);

  // --- word wrap toggle via the Edit menu -------------------------------
  const wrapToggle = await evaluate(ws, `(async () => {
    document.querySelectorAll('#menubar .menu-item')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 60));
    const items = [...document.querySelectorAll('.dd-item')];
    const item = items.find((e) => e.textContent.includes('Word Wrap'));
    const mark = item ? item.querySelector('.dd-mark').textContent : '';
    item.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
    await new Promise((r) => setTimeout(r, 60));
    const ed = document.getElementById('editor');
    return { checkedBefore: mark, wrap: ed.getAttribute('wrap'), nowrap: ed.classList.contains('nowrap') };
  })()`);
  check('Word Wrap shows a check mark when on', wrapToggle.checkedBefore === '\u2713', wrapToggle.checkedBefore || '(none)');
  check('turning word wrap off sets nowrap', wrapToggle.wrap === 'off' && wrapToggle.nowrap === true, wrapToggle.wrap);

  await evaluate(ws, `window.notepad && document.querySelectorAll('#menubar .menu-item')[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true, button: 0 }))`);

  // --- time/date --------------------------------------------------------
  const stamp = await evaluate(ws, `(() => {
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    const ed = document.getElementById('editor');
    ed.value = '';
    ed.focus();
    window.notepad.insertTimeDate();
    return ed.value;
  })()`);
  check('Time/Date inserts a Win98 stamp', /^\d{1,2}:\d{2} (AM|PM) \d{1,2}\/\d{1,2}\/\d{4}$/.test(stamp), stamp);

  // --- find -------------------------------------------------------------
  const findResult = await evaluate(ws, `(async () => {
    const ed = document.getElementById('editor');
    ed.value = 'alpha beta gamma beta';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    ed.setSelectionRange(0, 0);
    window.notepad.setFind('beta', false);
    document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    window.notepad.findNext(false);
    await new Promise((r) => setTimeout(r, 30));
    const first = window.notepad.selection();
    window.notepad.findNext(false);
    await new Promise((r) => setTimeout(r, 30));
    return { first, second: window.notepad.selection() };
  })()`);
  check('Find selects the first match', findResult.first.start === 6, JSON.stringify(findResult.first));
  check('Find Next moves to the next match', findResult.second.start === 17, JSON.stringify(findResult.second));

  // --- find dialog ------------------------------------------------------
  const findDlg = await evaluate(ws, `(async () => {
    window.notepad.openFind();
    await new Promise((r) => setTimeout(r, 80));
    const dlg = document.querySelector('.dlg');
    const title = dlg && dlg.querySelector('.dlg-title span').textContent;
    const buttons = dlg ? [...dlg.querySelectorAll('.btn')].map((b) => b.textContent) : [];
    return { title, buttons };
  })()`);
  check('Find dialog opens', findDlg.title === 'Find', JSON.stringify(findDlg.buttons));

  const closed = await evaluate(ws, `(async () => {
    const dlg = document.querySelector('.dlg');
    if (dlg) [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel').click();
    await new Promise((r) => setTimeout(r, 60));
    return document.querySelectorAll('.dlg').length;
  })()`);
  check('Find dialog cancels', closed === 0, String(closed));

  // --- font dialog ------------------------------------------------------
  const fontDlg = await evaluate(ws, `(async () => {
    window.notepad.openFontDialog();
    await new Promise((r) => setTimeout(r, 80));
    const dlg = document.querySelector('.dlg');
    const title = dlg && dlg.querySelector('.dlg-title span').textContent;
    const lists = dlg ? dlg.querySelectorAll('.list').length : 0;
    const items = dlg ? dlg.querySelectorAll('.list-item').length : 0;
    if (dlg) [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel').click();
    await new Promise((r) => setTimeout(r, 60));
    return { title, lists, items };
  })()`);
  check('Font dialog opens with lists', fontDlg.title === 'Font' && fontDlg.lists === 3 && fontDlg.items > 10, fontDlg.items + ' entries');

  // --- about ------------------------------------------------------------
  const about = await evaluate(ws, `(async () => {
    window.notepad.openAbout();
    await new Promise((r) => setTimeout(r, 80));
    const dlg = document.querySelector('.dlg');
    const title = dlg && dlg.querySelector('.dlg-title span').textContent;
    const body = dlg ? dlg.querySelector('.about-text').textContent : '';
    if (dlg) dlg.querySelector('.btn').click();
    await new Promise((r) => setTimeout(r, 60));
    return { title, body };
  })()`);
  check('About Notepad dialog shows version', about.title === 'About Notepad' && /4\.10/.test(about.body), about.body.split('\n')[0]);

  // --- screenshot -------------------------------------------------------
  await evaluate(ws, `(() => {
    const ed = document.getElementById('editor');
    ed.value = 'Dear diary,\\n\\nWindows 98 is installed.\\nThe launcher works.\\n\\n11:35 AM 11/11/2026\\n';
    ed.dispatchEvent(new Event('input', { bubbles: true }));
    ed.setSelectionRange(0, 0);
  })()`);
  await sleep(150);
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'notepad.png'), Buffer.from(shot.data, 'base64'));
  console.log('\nscreenshot -> .check/notepad.png');

  check('no console errors', errors.length === 0, errors.slice(0, 4).join(' | '));

  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  ws.close();
  chrome.kill();
  process.exit(failed.length ? 1 : 0);
};

main().catch((err) => {
  console.error('CHECK ERROR', err);
  try {
    chrome.kill();
  } catch {}
  process.exit(1);
});
