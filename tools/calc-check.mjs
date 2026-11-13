/*
 * Headless check for Calculator: loads the page in Chrome via CDP and exercises the
 * keypad, arithmetic, memory, the display formatting and the keyboard.
 *
 *   node tools/calc-check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9335;
const URL_BASE = process.env.CALC_URL || 'http://localhost:8135/apps/calc/index.html';
const outDir = path.join(root, '.check');
fs.mkdirSync(outDir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'calc-check-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=520,520',
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 262, height: 264, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(1000);

  const layout = await evaluate(ws, `(() => {
    const q = (s) => document.querySelector(s);
    const keys = [...q('#keys').children];
    const color = (k) => getComputedStyle(keys.find((e) => e.dataset.key === k)).color;
    return {
      title: q('#tbTitle').textContent,
      docTitle: document.title,
      menus: [...q('#menubar').children].map((e) => e.textContent),
      keys: keys.length,
      value: q('#value').textContent,
      mem: q('#mem').classList.contains('on'),
      bg: getComputedStyle(q('.window')).backgroundColor,
      red: color('+'),
      blue: color('sqrt'),
      black: color('7'),
      keyBox: (() => { const b = keys[0].getBoundingClientRect(); return Math.round(b.height); })(),
    };
  })()`);
  check('title is "Calculator"', layout.title === 'Calculator', layout.title);
  check('menus are Edit/View/Help', layout.menus.join(',') === 'Edit,View,Help', layout.menus.join(','));
  check('27 keys on the standard keypad', layout.keys === 27, String(layout.keys));
  check('display starts at "0."', layout.value === '0.', layout.value);
  check('memory box hidden with no value', layout.mem === false);
  check('window face is the 95 grey', layout.bg === 'rgb(192, 192, 192)', layout.bg);
  check('operators are red', layout.red === 'rgb(255, 0, 0)', layout.red);
  check('sqrt / % / 1/x are blue', layout.blue === 'rgb(0, 0, 255)', layout.blue);
  check('digits are black', layout.black === 'rgb(0, 0, 0)', layout.black);

  const run = (keys) =>
    evaluate(ws, `(() => {
      const c = window.calc;
      c.press('c');
      for (const k of ${JSON.stringify(keys)}) c.press(k);
      return { value: c.value(), error: c.state().error, memory: c.memory() };
    })()`);

  const add = await run(['2', '+', '3', '=']);
  check('2 + 3 = 5.', add.value === '5.', add.value);

  const times = await run(['9', '*', '9', '=']);
  check('9 * 9 = 81.', times.value === '81.', times.value);

  const negative = await run(['7', '-', '9', '=']);
  check('7 - 9 = -2.', negative.value === '-2.', negative.value);

  const divide = await run(['8', '/', '0', '=']);
  check('divide by zero shows the classic message', /Cannot divide by zero/.test(divide.value), divide.value);

  const percent = await run(['2', '0', '0', '+', '1', '0', '%']);
  const percentDone = await run(['2', '0', '0', '+', '1', '0', '%', '=']);
  check('200 + 10 % shows 20.', percent.value === '20.', percent.value);
  check('200 + 10 % = 220.', percentDone.value === '220.', percentDone.value);

  const root = await run(['9', 'sqrt']);
  check('sqrt(9) = 3.', root.value === '3.', root.value);

  const inverse = await run(['4', 'recip']);
  check('1/4 = 0.25', inverse.value === '0.25', inverse.value);

  const signed = await run(['5', 'sign']);
  check('+/- negates the entry', signed.value === '-5.', signed.value);

  const grouped = await run(['1', '2', '3', '4', '5', '6', '7']);
  check('typing groups thousands', grouped.value === '1,234,567.', grouped.value);

  const backed = await run(['1', '2', '3', 'back']);
  check('Backspace drops the last digit', backed.value === '12.', backed.value);

  const ce = await run(['1', '2', '+', '5', 'ce', '3', '=']);
  check('CE clears only the entry', ce.value === '15.', ce.value);

  const repeat = await run(['2', '+', '3', '=', '=']);
  check('repeated = repeats the last operation', repeat.value === '8.', repeat.value);

  const memory = await evaluate(ws, `(() => {
    const c = window.calc;
    c.press('c');
    c.press('1'); c.press('2');
    c.press('ms');
    c.press('c');
    const afterMs = document.getElementById('mem').classList.contains('on');
    c.press('mr');
    const recalled = c.value();
    c.press('mc');
    return { afterMs, recalled, off: document.getElementById('mem').classList.contains('on') === false, stored: c.memory() };
  })()`);
  check('MS lights the M indicator', memory.afterMs === true);
  check('MR recalls the stored value', memory.recalled === '12.', memory.recalled);
  check('MC clears memory', memory.off === true && memory.stored === 0, String(memory.stored));

  const keyboard = await evaluate(ws, `(() => {
    const c = window.calc;
    c.press('c');
    for (const key of ['7', '+', '3', 'Enter']) {
      document.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
    }
    return c.value();
  })()`);
  check('keyboard 7 + 3 Enter = 10.', keyboard === '10.', keyboard);

  const escape = await evaluate(ws, `(() => {
    const c = window.calc;
    c.press('9');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    return c.value();
  })()`);
  check('Escape clears the calculator', escape === '0.', escape);

  await evaluate(ws, `(() => { const c = window.calc; c.press('c'); for (const k of ['1','2','3','4','+','5','6']) c.press(k); })()`);
  await sleep(150);
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'calc.png'), Buffer.from(shot.data, 'base64'));
  console.log('\nscreenshot -> .check/calc.png');

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
