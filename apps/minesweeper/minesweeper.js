import { createMenuBar } from '../../chrome/menu.js';
import { shell, shellPost, wireTitleBar } from '../../chrome/shell.js';
import { showDialog, ICON_INFO } from '../../chrome/dialog.js';

const $ = (id) => document.getElementById(id);
const field = $('field');
const faceBtn = $('face');
const ledMines = $('mines');
const ledTimer = $('timer');

const CELL = 16;

const LEVELS = {
  beginner: { cols: 9, rows: 9, mines: 10 },
  intermediate: { cols: 16, rows: 16, mines: 40 },
  expert: { cols: 30, rows: 16, mines: 99 },
};

const BEST_KEY = 'minesweeper.best';

function prefs(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function setPref(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {}
}

const state = {
  level: 'beginner',
  cols: 9,
  rows: 9,
  mineCount: 10,
  mine: new Uint8Array(81),
  open: new Uint8Array(81),
  mark: new Uint8Array(81),
  adj: new Uint8Array(81),
  cells: [],
  started: false,
  over: false,
  won: false,
  time: 0,
  timer: null,
  marks: prefs('minesweeper.marks', true),
  color: prefs('minesweeper.color', true),
  dead: -1,
  pressing: -1,
  faceKind: 'normal',
};

/* ---------- icons ---------- */

const MINE = `<svg viewBox="0 0 12 12" width="11" height="11" shape-rendering="crispEdges">
  <g stroke="#000" stroke-width="1"><path d="M6 0v2M6 10v2M0 6h2M10 6h2M2 2l1 1M9 9l1 1M2 10l1-1M9 3l1-1"/></g>
  <rect x="2" y="2" width="8" height="8" fill="#000"/>
  <rect x="4" y="4" width="2" height="2" fill="#fff"/>
</svg>`;

const FLAG = `<svg viewBox="0 0 12 12" width="11" height="11" shape-rendering="crispEdges">
  <rect x="2" y="1" width="1" height="9" fill="#000"/>
  <path d="M3 2l6 2-6 2z" fill="#ff0000"/>
  <rect x="1" y="10" width="8" height="1" fill="#000"/>
</svg>`;

const FACES = {
  normal: `<svg viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="8" fill="#ffff00" stroke="#000"/><rect x="5" y="6" width="2" height="3" fill="#000"/><rect x="11" y="6" width="2" height="3" fill="#000"/><path d="M5 11c1 2 7 2 8 0" stroke="#000" fill="none"/></svg>`,
  press: `<svg viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="8" fill="#ffff00" stroke="#000"/><rect x="5" y="6" width="2" height="3" fill="#000"/><rect x="11" y="6" width="2" height="3" fill="#000"/><circle cx="9" cy="12" r="2" fill="#000"/></svg>`,
  dead: `<svg viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="8" fill="#ffff00" stroke="#000"/><path d="M4 5l3 3M7 5l-3 3M11 5l3 3M14 5l-3 3" stroke="#000" fill="none"/><path d="M5 13c1.5-2 6.5-2 8 0" stroke="#000" fill="none"/></svg>`,
  cool: `<svg viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="8" fill="#ffff00" stroke="#000"/><path d="M3 6h12v1H3z" fill="#000"/><rect x="4" y="7" width="4" height="3" fill="#000"/><rect x="10" y="7" width="4" height="3" fill="#000"/><path d="M6 12c1.5 1.5 4.5 1.5 6 0" stroke="#000" fill="none"/></svg>`,
};

/* ---------- seven-segment LEDs ---------- */

const SEGMENTS = {
  a: [3, 1, 7, 2],
  b: [9, 2, 2, 8],
  c: [9, 13, 2, 8],
  d: [3, 20, 7, 2],
  e: [1, 13, 2, 8],
  f: [1, 2, 2, 8],
  g: [3, 11, 7, 2],
};

const DIGIT_SEGS = {
  0: 'abcdef',
  1: 'bc',
  2: 'abged',
  3: 'abgcd',
  4: 'fgbc',
  5: 'afgcd',
  6: 'afgedc',
  7: 'abc',
  8: 'abcdefg',
  9: 'abcfgd',
  '-': 'g',
  ' ': '',
};

function digitSvg(ch) {
  const on = DIGIT_SEGS[ch] || '';
  const rects = Object.keys(SEGMENTS)
    .map((key) => {
      const [x, y, w, h] = SEGMENTS[key];
      const fill = on.indexOf(key) >= 0 ? '#ff0000' : '#320000';
      return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
    })
    .join('');
  return `<svg class="digit" viewBox="0 0 13 23" width="13" height="23" shape-rendering="crispEdges">${rects}</svg>`;
}

function ledText(value) {
  const n = Math.max(-99, Math.min(999, value));
  if (n < 0) return '-' + String(Math.min(99, -n)).padStart(2, '0');
  return String(n).padStart(3, '0');
}

function paintLed(el, value) {
  el.innerHTML = ledText(value)
    .split('')
    .map(digitSvg)
    .join('');
}

/* ---------- board ---------- */

function neighbors(i) {
  const x = i % state.cols;
  const y = (i - x) / state.cols;
  const out = [];
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= state.cols || ny >= state.rows) continue;
      out.push(ny * state.cols + nx);
    }
  }
  return out;
}

function computeAdj() {
  for (let i = 0; i < state.adj.length; i++) {
    state.adj[i] = neighbors(i).reduce((n, j) => n + state.mine[j], 0);
  }
}

function placeMines(safe) {
  const spots = [];
  for (let i = 0; i < state.mine.length; i++) if (i !== safe) spots.push(i);
  for (let i = spots.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const tmp = spots[i];
    spots[i] = spots[j];
    spots[j] = tmp;
  }
  for (let i = 0; i < state.mineCount && i < spots.length; i++) state.mine[spots[i]] = 1;
  computeAdj();
}

function build() {
  field.style.gridTemplateColumns = `repeat(${state.cols}, ${CELL}px)`;
  field.textContent = '';
  state.cells = [];
  for (let i = 0; i < state.cols * state.rows; i++) {
    const el = document.createElement('div');
    el.className = 'cell';
    el.dataset.i = String(i);
    field.appendChild(el);
    state.cells.push(el);
  }
}

function paint(i) {
  const el = state.cells[i];
  let cls = 'cell';
  let html = '';

  if (state.open[i]) {
    cls += ' open';
    if (state.mine[i]) {
      cls += i === state.dead ? ' boom' : ' mine';
      html = MINE;
    } else if (state.adj[i]) {
      cls += ' n' + state.adj[i];
      html = String(state.adj[i]);
    }
  } else if (state.over && state.mine[i]) {
    cls += ' open mine';
    html = MINE;
    if (state.mark[i] === 1) cls += ' bad';
  } else if (state.mark[i] === 1) {
    cls += ' flag';
    html = FLAG;
  } else if (state.mark[i] === 2) {
    cls += ' ques';
    html = '?';
  }

  const stamp = cls + '|' + html;
  if (el.dataset.stamp !== stamp) {
    el.className = cls;
    el.innerHTML = html;
    el.dataset.stamp = stamp;
  }
}

function paintAll() {
  for (let i = 0; i < state.cells.length; i++) paint(i);
  updateLeds();
}

function updateLeds() {
  let flags = 0;
  for (let i = 0; i < state.mark.length; i++) if (state.mark[i] === 1) flags++;
  paintLed(ledMines, state.mineCount - flags);
  paintLed(ledTimer, state.time);
}

function setFace(kind) {
  state.faceKind = kind;
  faceBtn.innerHTML = FACES[kind];
}

/* ---------- clock ---------- */

function stopClock() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
}

function startClock() {
  stopClock();
  state.timer = setInterval(() => {
    if (state.over || state.time >= 999) return;
    state.time++;
    paintLed(ledTimer, state.time);
  }, 1000);
}

/* ---------- play ---------- */

function start(i) {
  placeMines(i);
  state.started = true;
  startClock();
}

function flood(i) {
  const stack = [i];
  while (stack.length) {
    const j = stack.pop();
    if (state.open[j] || state.mark[j] === 1) continue;
    state.open[j] = 1;
    if (state.adj[j] === 0) {
      for (const n of neighbors(j)) if (!state.open[n]) stack.push(n);
    }
  }
}

function reveal(i) {
  if (state.over || i < 0 || i >= state.open.length || state.open[i] || state.mark[i] === 1) return;
  if (!state.started) start(i);
  if (state.mine[i]) return lose(i);
  flood(i);
  paintAll();
  checkWin();
}

function chord(i) {
  if (state.over || !state.open[i] || !state.adj[i]) return;
  const around = neighbors(i);
  const flags = around.filter((n) => state.mark[n] === 1).length;
  if (flags !== state.adj[i]) return;
  for (const n of around) {
    if (!state.open[n] && state.mark[n] !== 1) reveal(n);
  }
}

function mark(i) {
  if (state.over || state.open[i]) return;
  const m = state.mark[i];
  if (m === 0) state.mark[i] = 1;
  else if (m === 1) state.mark[i] = state.marks ? 2 : 0;
  else state.mark[i] = 0;
  paint(i);
  updateLeds();
}

function lose(i) {
  state.over = true;
  state.won = false;
  state.dead = i;
  state.open[i] = 1;
  stopClock();
  setFace('dead');
  paintAll();
}

function checkWin() {
  const safe = state.mine.length - state.mineCount;
  let opened = 0;
  for (let i = 0; i < state.open.length; i++) opened += state.open[i];
  if (opened < safe) return;

  state.over = true;
  state.won = true;
  stopClock();
  for (let i = 0; i < state.mine.length; i++) if (state.mine[i]) state.mark[i] = 1;
  setFace('cool');
  paintAll();
  recordTime();
}

/* ---------- best times ---------- */

function bestTimes() {
  try {
    return JSON.parse(localStorage.getItem(BEST_KEY)) || {};
  } catch {
    return {};
  }
}

function saveBest(all) {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(all));
  } catch {}
}

function recordTime() {
  if (!LEVELS[state.level]) return;
  const all = bestTimes();
  const best = all[state.level];
  if (best && state.time >= best.time) return;

  const body = document.createElement('div');
  body.innerHTML = `<div class="best-line">You have the fastest time<br>for ${state.level} level.</div>
    <div class="row"><span>Please enter your name:</span></div>
    <input class="field" id="bestName" maxlength="20">`;
  const input = body.querySelector('#bestName');
  input.value = prefs('minesweeper.name', 'Player');

  showDialog({
    title: 'New Best Time',
    body,
    width: 330,
    buttons: [
      { label: 'OK', value: 'ok', default: true },
      { label: 'Cancel', value: null },
    ],
  }).then((answer) => {
    if (answer !== 'ok') return;
    const name = (input.value || 'Player').trim() || 'Player';
    setPref('minesweeper.name', name);
    const list = bestTimes();
    list[state.level] = { time: state.time, name };
    saveBest(list);
    bestDialog();
  });
}

function bestDialog() {
  const all = bestTimes();
  const body = document.createElement('div');
  const rows = Object.keys(LEVELS)
    .map((key) => {
      const b = all[key];
      const time = b ? String(b.time).padStart(3, '0') + ' seconds' : '999 seconds';
      const name = b ? b.name : 'Anonymous';
      return `<div class="best-row"><span>1</span><span class="best-level">${key}</span><span>${time}</span><span>${name.replace(/[<>&]/g, '')}</span></div>`;
    })
    .join('');
  body.innerHTML = `<div class="best-head"><span></span><span>Level</span><span>Time</span><span>Name</span></div>${rows}`;
  return showDialog({
    title: 'Fastest Mine Sweepers',
    body,
    width: 350,
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
}

/* ---------- new game ---------- */

function applySize() {
  if (!shell) return;
  const frame = $('frame');
  const tb = $('titlebar').offsetHeight;
  const mb = $('menubar').offsetHeight;
  const style = getComputedStyle($('game'));
  const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
  const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
  const chrome = 6; // window border + padding on both sides
  shellPost({
    t: 'resize',
    w: Math.ceil(frame.offsetWidth + padX + chrome),
    h: Math.ceil(tb + mb + frame.offsetHeight + padY + chrome),
  });
}

function newGame(level = state.level, custom = null) {
  const cfg = custom || LEVELS[level] || LEVELS.beginner;
  const total = cfg.cols * cfg.rows;

  state.level = level;
  state.cols = cfg.cols;
  state.rows = cfg.rows;
  state.mineCount = cfg.mines;
  state.mine = new Uint8Array(total);
  state.open = new Uint8Array(total);
  state.mark = new Uint8Array(total);
  state.adj = new Uint8Array(total);
  state.started = false;
  state.over = false;
  state.won = false;
  state.dead = -1;
  state.pressing = -1;
  state.time = 0;

  stopClock();
  build();
  paintAll();
  setFace('normal');
  applySize();
}

/* ---------- dialogs ---------- */

function customDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="row"><span>Height:</span><input class="field field-input" id="cHeight" value="${state.rows}"></div>
    <div class="row"><span>Width:</span><input class="field field-input" id="cWidth" value="${state.cols}"></div>
    <div class="row"><span>Mines:</span><input class="field field-input" id="cMines" value="${state.mineCount}"></div>`;
  const read = (id, fallback) => {
    const n = parseInt(body.querySelector(id).value, 10);
    return isFinite(n) ? n : fallback;
  };
  return showDialog({
    title: 'Custom Field',
    body,
    width: 240,
    buttons: [
      { label: 'OK', value: 'ok', default: true },
      { label: 'Cancel', value: null },
    ],
  }).then((answer) => {
    if (answer !== 'ok') return;
    const rows = Math.max(9, Math.min(24, read('#cHeight', 9)));
    const cols = Math.max(9, Math.min(30, read('#cWidth', 9)));
    const mines = Math.max(10, Math.min(rows * cols - 1, read('#cMines', 10)));
    newGame('custom', { cols, rows, mines });
  });
}

function aboutDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="about-text"><b>Minesweeper</b>Windows 98<br>Version 4.10<br><br>
    Left-click to clear a square.<br>Right-click to flag a mine.</div>`;
  return showDialog({
    title: 'About Minesweeper',
    body,
    width: 330,
    icon: ICON_INFO,
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
}

function helpDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="about-text"><b>How to play</b>
    Click a square to clear it. Numbers count the mines touching it.<br>
    Right-click to place a flag, again for a question mark.<br>
    Click both buttons on a number to clear its neighbours once flagged.</div>`;
  return showDialog({
    title: 'Minesweeper Help',
    body,
    width: 340,
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
}

/* ---------- menus ---------- */

function setColor(on) {
  state.color = on;
  setPref('minesweeper.color', on);
  document.body.classList.toggle('mono', !on);
}

createMenuBar(
  $('menubar'),
  [
    {
      label: 'Game',
      items: [
        { label: 'New', accel: 'F2', action: 'new' },
        { sep: true },
        { label: 'Beginner', action: 'beginner', checked: () => state.level === 'beginner' },
        { label: 'Intermediate', action: 'intermediate', checked: () => state.level === 'intermediate' },
        { label: 'Expert', action: 'expert', checked: () => state.level === 'expert' },
        { label: 'Custom...', action: 'custom' },
        { sep: true },
        { label: 'Marks (?)', action: 'marks', checked: () => state.marks },
        { label: 'Color', action: 'color', checked: () => state.color },
        { sep: true },
        { label: 'Best Times...', action: 'best' },
        { sep: true },
        { label: 'Exit', action: 'exit' },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Contents', accel: 'F1', action: 'help' },
        { sep: true },
        { label: 'About Minesweeper', action: 'about' },
      ],
    },
  ],
  (action) => {
    if (action === 'new') newGame();
    if (action === 'beginner' || action === 'intermediate' || action === 'expert') newGame(action);
    if (action === 'custom') customDialog();
    if (action === 'marks') {
      state.marks = !state.marks;
      setPref('minesweeper.marks', state.marks);
    }
    if (action === 'color') setColor(!state.color);
    if (action === 'best') bestDialog();
    if (action === 'help') helpDialog();
    if (action === 'about') aboutDialog();
    if (action === 'exit') (shell ? shellPost('close') : window.close());
  }
);

/* ---------- mouse ---------- */

function clearPress() {
  for (const el of state.cells) el.classList.remove('press');
  state.pressing = -1;
  if (!state.over) setFace('normal');
}

function pressAround(i) {
  state.cells[i].classList.add('press');
  for (const n of neighbors(i)) if (!state.open[n] && state.mark[n] !== 1) state.cells[n].classList.add('press');
}

field.addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const el = ev.target.closest('.cell');
  if (!el || state.over) return;
  const i = Number(el.dataset.i);

  if (ev.button === 1 || ev.buttons === 3) {
    pressAround(i);
    setFace('press');
    return chord(i);
  }
  if (ev.button !== 0) return;

  state.pressing = i;
  setFace('press');
  if (!state.open[i] && state.mark[i] !== 1) el.classList.add('press');
});

field.addEventListener('contextmenu', (ev) => {
  ev.preventDefault();
  const el = ev.target.closest('.cell');
  if (!el || state.over) return;
  mark(Number(el.dataset.i));
});

document.addEventListener('mouseup', (ev) => {
  const el = ev.target.closest ? ev.target.closest('.cell') : null;
  const pressed = state.pressing;
  clearPress();
  if (ev.button !== 0 || pressed < 0 || !el || state.over) return;
  if (Number(el.dataset.i) === pressed) reveal(pressed);
});

faceBtn.addEventListener('mousedown', (ev) => ev.preventDefault());
faceBtn.addEventListener('click', () => newGame());

document.addEventListener('keydown', (ev) => {
  if (document.querySelector('.dlg')) return;
  if (ev.key === 'F2') {
    ev.preventDefault();
    newGame();
  }
  if (ev.key === 'F1') {
    ev.preventDefault();
    helpDialog();
  }
});

/* ---------- window ---------- */

setColor(state.color);
newGame('beginner');

wireTitleBar({
  titlebar: $('titlebar'),
  minimize: $('btnMin'),
  maximize: $('btnMax'),
  close: $('btnClose'),
});

window.minesweeper = {
  state,
  newGame,
  reveal,
  mark,
  chord,
  setLevel: (level) => newGame(level),
  setMines(list) {
    state.mine.fill(0);
    for (const i of list) state.mine[i] = 1;
    computeAdj();
    state.started = true;
    startClock();
  },
  counter: () => state.mineCount - state.mark.reduce((n, m) => n + (m === 1 ? 1 : 0), 0),
  ledMines: () => ledText(state.mineCount - state.mark.reduce((n, m) => n + (m === 1 ? 1 : 0), 0)),
  ledTimer: () => ledText(state.time),
  face: () => state.faceKind,
};
