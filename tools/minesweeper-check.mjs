/*
 * Headless check for Minesweeper: loads the page in Chrome via CDP and exercises the
 * board, first-click safety, flags, the timer, losing, winning and the difficulty levels.
 *
 *   node tools/minesweeper-check.mjs
 */
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, '..');
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const PORT = 9336;
const URL_BASE = process.env.MINESWEEPER_URL || 'http://localhost:8135/apps/minesweeper/index.html';
const outDir = path.join(root, '.check');
fs.mkdirSync(outDir, { recursive: true });

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minesweeper-check-'));
const chrome = spawn(
  CHROME,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=560,560',
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
  await send(ws, 'Emulation.setDeviceMetricsOverride', { width: 200, height: 280, deviceScaleFactor: 1, mobile: false });
  await send(ws, 'Page.navigate', { url: URL_BASE });
  await sleep(1000);

  const layout = await evaluate(ws, `(() => {
    const q = (s) => document.querySelector(s);
    const cells = [...q('#field').children];
    return {
      title: q('#tbTitle').textContent,
      menus: [...q('#menubar').children].map((e) => e.textContent),
      cells: cells.length,
      size: cells.length ? Math.round(cells[0].getBoundingClientRect().width) : 0,
      counter: window.minesweeper.ledMines(),
      timer: window.minesweeper.ledTimer(),
      face: window.minesweeper.face(),
      leds: document.querySelectorAll('.led .digit').length,
      bg: getComputedStyle(q('.window')).backgroundColor,
      cols: window.minesweeper.state.cols,
      rows: window.minesweeper.state.rows,
      mines: window.minesweeper.state.mineCount,
    };
  })()`);
  check('title is "Minesweeper"', layout.title === 'Minesweeper', layout.title);
  check('menus are Game/Help', layout.menus.join(',') === 'Game,Help', layout.menus.join(','));
  check('beginner is a 9x9 board', layout.cells === 81 && layout.cols === 9 && layout.rows === 9, `${layout.cells} cells`);
  check('ten mines on beginner', layout.mines === 10, String(layout.mines));
  check('tiles are 16px', layout.size === 16, `${layout.size}px`);
  check('six LED digits, 010 on the counter', layout.leds === 6 && layout.counter === '010', `${layout.leds} digits, ${layout.counter}`);
  check('timer starts at 000', layout.timer === '000', layout.timer);
  check('face starts normal', layout.face === 'normal', layout.face);
  check('window face is the 95 grey', layout.bg === 'rgb(192, 192, 192)', layout.bg);

  const firstClick = await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.reveal(40);
    let opened = 0;
    for (const v of m.state.open) opened += v;
    return { over: m.state.over, safe: m.state.mine[40] === 0, opened, started: m.state.started };
  })()`);
  check('the first click is never a mine', firstClick.safe === true && firstClick.over === false, JSON.stringify(firstClick));
  check('the first click clears a tile', firstClick.opened >= 1, `${firstClick.opened} cells`);

  const flood = await evaluate(ws, `(async () => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.setMines([80]);
    m.reveal(0);
    let opened = 0;
    for (const v of m.state.open) opened += v;
    await new Promise((r) => setTimeout(r, 120));
    const dlg = document.querySelector('.dlg');
    if (dlg) [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel').click();
    await new Promise((r) => setTimeout(r, 60));
    return { opened, mineOpen: m.state.open[80] };
  })()`);
  check('an empty square floods the blank area', flood.opened === 80 && flood.mineOpen === 0, `${flood.opened} cells`);

  const timer = await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.reveal(40);
    return { before: m.state.time, started: m.state.started };
  })()`);
  await sleep(1250);
  const ticked = await evaluate(ws, `({ time: window.minesweeper.state.time, led: window.minesweeper.ledTimer() })`);
  check('the timer starts on the first click', ticked.time > timer.before, `time ${ticked.time}`);
  check('the timer LED counts up', ticked.led === '001', ticked.led);

  const flags = await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.mark(0);
    const flagged = m.state.mark[0];
    const counter = m.ledMines();
    m.mark(0);
    const question = m.state.mark[0];
    m.mark(0);
    const cleared = m.state.mark[0];
    return { flagged, counter, question, cleared };
  })()`);
  check('right-click flags a tile', flags.flagged === 1, String(flags.flagged));
  check('the counter counts down with flags', flags.counter === '009', flags.counter);
  check('second click makes a question mark', flags.question === 2, String(flags.question));
  check('third click clears the mark', flags.cleared === 0, String(flags.cleared));

  const numbers = await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.setMines([0]);
    m.reveal(1);
    const el = document.querySelector('#field').children[1];
    return { cls: el.className, text: el.textContent, color: getComputedStyle(el).color };
  })()`);
  check('revealed numbers show their count', numbers.text === '1', numbers.text);
  check('1s are blue, as in 98', numbers.color === 'rgb(0, 0, 255)' && /n1/.test(numbers.cls), numbers.color);

  const lose = await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.setMines([0]);
    m.reveal(0);
    const el = document.querySelector('#field').children[0];
    return { over: m.state.over, won: m.state.won, face: m.face(), boom: /boom/.test(el.className), mines: document.querySelectorAll('.cell.mine, .cell.boom').length };
  })()`);
  check('clicking a mine loses the game', lose.over === true && lose.won === false, JSON.stringify(lose));
  check('the dead face appears', lose.face === 'dead', lose.face);
  check('the clicked mine turns red', lose.boom === true);
  check('all mines are shown after losing', lose.mines === 1, String(lose.mines));

  const win = await evaluate(ws, `(async () => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.setMines([0,1,2,3,4,5,6,7,8,9]);
    for (let i = 10; i < 81; i++) m.reveal(i);
    await new Promise((r) => setTimeout(r, 120));
    const dlg = document.querySelector('.dlg');
    const title = dlg && dlg.querySelector('.dlg-title span').textContent;
    if (dlg) [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel').click();
    await new Promise((r) => setTimeout(r, 60));
    return { won: m.state.won, over: m.state.over, face: m.face(), title, flags: m.ledMines() };
  })()`);
  check('clearing every safe tile wins', win.won === true && win.over === true, JSON.stringify(win));
  check('the sunglasses face appears', win.face === 'cool', win.face);
  check('a new record asks for a name', win.title === 'New Best Time', String(win.title));
  check('remaining mines are auto-flagged', win.flags === '000', win.flags);

  const levels = await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('intermediate');
    const mid = { cells: document.querySelectorAll('#field .cell').length, mines: m.state.mineCount, led: m.ledMines() };
    m.newGame('expert');
    const exp = { cells: document.querySelectorAll('#field .cell').length, mines: m.state.mineCount, led: m.ledMines() };
    m.newGame('beginner');
    return { mid, exp };
  })()`);
  check('intermediate is 16x16 with 40 mines', levels.mid.cells === 256 && levels.mid.mines === 40, `${levels.mid.cells} cells`);
  check('expert is 30x16 with 99 mines', levels.exp.cells === 480 && levels.exp.mines === 99, `${levels.exp.cells} cells`);
  check('the mine counter follows the level', levels.mid.led === '040' && levels.exp.led === '099', `${levels.mid.led} / ${levels.exp.led}`);

  const chorded = await evaluate(ws, `(async () => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.setMines([0]);
    m.reveal(1);
    m.mark(0);
    m.chord(1);
    await new Promise((r) => setTimeout(r, 120));
    const dlg = document.querySelector('.dlg');
    if (dlg) [...dlg.querySelectorAll('.btn')].find((b) => b.textContent === 'Cancel').click();
    await new Promise((r) => setTimeout(r, 60));
    let opened = 0;
    for (const v of m.state.open) opened += v;
    return { mineOpen: m.state.open[0], opened };
  })()`);
  check('chording an open number clears its neighbours', chorded.mineOpen === 0 && chorded.opened > 10, `${chorded.opened} cells`);

  const marks = await evaluate(ws, `(async () => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.state.marks = false;
    m.mark(3);
    const first = m.state.mark[3];
    m.mark(3);
    const second = m.state.mark[3];
    m.state.marks = true;
    return { first, second };
  })()`);
  check('with Marks off, flags skip the question mark', marks.first === 1 && marks.second === 0, JSON.stringify(marks));

  await evaluate(ws, `(() => {
    const m = window.minesweeper;
    m.newGame('beginner');
    m.reveal(30);
    m.mark(4);
    m.mark(60);
  })()`);
  await sleep(200);
  const shot = await send(ws, 'Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(outDir, 'minesweeper.png'), Buffer.from(shot.data, 'base64'));
  console.log('\nscreenshot -> .check/minesweeper.png');

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
