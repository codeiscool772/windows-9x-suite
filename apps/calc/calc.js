import { createMenuBar } from '../../chrome/menu.js';
import { shell, shellPost, listenShell, wireTitleBar } from '../../chrome/shell.js';
import { showDialog, ICON_INFO } from '../../chrome/dialog.js';

const $ = (id) => document.getElementById(id);
const valueEl = $('value');
const memEl = $('mem');

const ERR_DIVIDE = 'Cannot divide by zero.';
const ERR_INPUT = 'Invalid function input.';

/* Classic calculator state: one entry string that is either being typed or holds a
   result, a left operand, and a pending operator. */
const s = {
  entry: '0',
  typing: false,
  acc: null,
  op: null,
  lastOp: null,
  lastValue: null,
  memory: 0,
  error: '',
};

/* ---------- display ---------- */

function trim(n) {
  return Number(n.toPrecision(15));
}

function group(text) {
  const neg = text.startsWith('-');
  const body = neg ? text.slice(1) : text;
  const dot = body.indexOf('.');
  const int = dot < 0 ? body : body.slice(0, dot);
  const dec = dot < 0 ? '' : body.slice(dot + 1);
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return (neg ? '-' : '') + grouped + '.' + dec;
}

function resultText(n) {
  if (!isFinite(n)) return ERR_DIVIDE;
  const r = trim(n);
  if (r === 0) return '0.';
  if (Math.abs(r) >= 1e16) return r.toExponential(8).replace(/\.?0+e/, 'e');
  const str = String(r);
  return str.indexOf('e') >= 0 ? str : group(str);
}

function render() {
  if (s.error) valueEl.textContent = s.error;
  else if (s.typing && s.entry === '-') valueEl.textContent = '-';
  else valueEl.textContent = s.typing ? group(s.entry) : resultText(parseFloat(s.entry) || 0);
  memEl.classList.toggle('on', s.memory !== 0);
}

function current() {
  const n = parseFloat(s.entry);
  return isFinite(n) ? n : 0;
}

function setValue(n) {
  s.entry = String(trim(n));
  s.typing = false;
  render();
}

function fail(message) {
  s.error = message;
  s.typing = false;
  render();
}

/* ---------- keys ---------- */

function digit(d) {
  if (s.error) return;
  if (!s.typing) {
    s.entry = d === '.' ? '0.' : d;
    s.typing = true;
  } else if (d === '.') {
    if (s.entry.indexOf('.') >= 0) return;
    s.entry += '.';
  } else {
    if (s.entry.replace(/[-.]/g, '').length >= 15) return;
    s.entry = s.entry === '0' ? d : s.entry + d;
  }
  s.lastOp = null;
  s.lastValue = null;
  render();
}

function apply(a, b, op) {
  if (op === '+') return a + b;
  if (op === '-') return a - b;
  if (op === '*') return a * b;
  if (op === '/') return b === 0 ? null : a / b;
  return b;
}

function operator(op) {
  if (s.error) return;
  const v = current();
  if (s.op && s.typing) {
    const r = apply(s.acc, v, s.op);
    if (r === null) return fail(ERR_DIVIDE);
    s.acc = trim(r);
    s.entry = String(s.acc);
  } else if (s.acc === null || !s.op) {
    s.acc = v;
    s.entry = String(trim(v));
  }
  s.op = op;
  s.typing = false;
  s.lastOp = null;
  s.lastValue = null;
  render();
}

function equals() {
  if (s.error) return;
  const v = current();
  if (s.op) {
    const r = apply(s.acc, v, s.op);
    if (r === null) return fail(ERR_DIVIDE);
    s.lastOp = s.op;
    s.lastValue = v;
    s.acc = trim(r);
    s.entry = String(s.acc);
    s.op = null;
    s.typing = false;
    return render();
  }
  if (s.lastOp && s.lastValue !== null) {
    const r = apply(current(), s.lastValue, s.lastOp);
    if (r === null) return fail(ERR_DIVIDE);
    s.acc = trim(r);
    s.entry = String(s.acc);
    s.typing = false;
  }
  render();
}

function percent() {
  if (s.error) return;
  const v = current();
  if (s.op === '+' || s.op === '-') setValue((s.acc * v) / 100);
  else setValue(v / 100);
}

function sqrt() {
  if (s.error) return;
  const v = current();
  if (v < 0) return fail(ERR_INPUT);
  setValue(Math.sqrt(v));
}

function recip() {
  if (s.error) return;
  const v = current();
  if (v === 0) return fail(ERR_DIVIDE);
  setValue(1 / v);
}

function sign() {
  if (s.error) return;
  if (s.typing) {
    s.entry = s.entry.startsWith('-') ? s.entry.slice(1) : '-' + s.entry;
  } else {
    s.entry = String(trim(-current()));
  }
  render();
}

function backspace() {
  if (s.error) return;
  if (!s.typing) {
    s.entry = String(trim(current()));
    s.typing = true;
  }
  s.entry = s.entry.slice(0, -1);
  if (s.entry === '' || s.entry === '-') s.entry = '0';
  if (s.entry === '0') s.typing = false;
  render();
}

function clearEntry() {
  s.error = '';
  s.entry = '0';
  s.typing = false;
  render();
}

function clearAll() {
  s.entry = '0';
  s.typing = false;
  s.acc = null;
  s.op = null;
  s.lastOp = null;
  s.lastValue = null;
  s.error = '';
  render();
}

function memoryAction(key) {
  if (key === 'mc') {
    s.memory = 0;
    return render();
  }
  if (key === 'mr') {
    s.entry = String(s.memory);
    s.typing = false;
    return render();
  }
  if (key === 'ms') s.memory = trim(current());
  if (key === 'm+') s.memory = trim(s.memory + current());
  render();
}

function press(key) {
  if (s.error && key !== 'c' && key !== 'ce') return;

  if (key >= '0' && key <= '9') return digit(key);
  switch (key) {
    case '.':
      return digit('.');
    case '+':
    case '-':
    case '*':
    case '/':
      return operator(key);
    case '=':
      return equals();
    case 'back':
      return backspace();
    case 'ce':
      return clearEntry();
    case 'c':
      return clearAll();
    case 'mc':
    case 'mr':
    case 'ms':
    case 'm+':
      return memoryAction(key);
    case 'sqrt':
      return sqrt();
    case 'percent':
    case '%':
      return percent();
    case 'recip':
      return recip();
    case 'sign':
      return sign();
  }
}

/* ---------- clipboard ---------- */

function copyValue() {
  const text = s.error ? s.error : String(trim(current()));
  if (shell) shellPost({ t: 'copy', text });
  else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

function insertNumber(text) {
  const n = parseFloat(String(text).replace(/,/g, ''));
  if (!isFinite(n)) return;
  s.error = '';
  s.entry = String(trim(n));
  s.typing = false;
  render();
}

function pasteValue() {
  if (shell) shellPost({ t: 'paste' });
  else if (navigator.clipboard) {
    navigator.clipboard.readText().then(insertNumber).catch(() => {});
  }
}

/* ---------- dialogs ---------- */

function aboutDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="about-text"><b>Microsoft (R) Calculator</b>Windows 98<br>Version 4.10<br><br>
    Copyright (C) Microsoft Corporation 1981-1998</div>`;
  return showDialog({
    title: 'About Calculator',
    body,
    width: 320,
    icon: ICON_INFO,
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
}

function helpDialog() {
  const body = document.createElement('div');
  body.innerHTML = '<div>Enter a number, then choose an operator and a second number.<br>' +
    'Memory keys store and recall one value.</div>';
  return showDialog({
    title: 'Calculator Help',
    body,
    width: 320,
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
}

/* ---------- menus ---------- */

createMenuBar(
  $('menubar'),
  [
    {
      label: 'Edit',
      items: [
        { label: 'Copy', accel: 'Ctrl+C', action: 'copy' },
        { label: 'Paste', accel: 'Ctrl+V', action: 'paste' },
      ],
    },
    {
      label: 'View',
      items: [
        { label: 'Standard', action: 'ignore', checked: true },
        { label: 'Scientific', action: 'ignore', disabled: true },
      ],
    },
    {
      label: 'Help',
      items: [
        { label: 'Help Topics', action: 'help' },
        { sep: true },
        { label: 'About Calculator', action: 'about' },
      ],
    },
  ],
  (action) => {
    if (action === 'copy') copyValue();
    if (action === 'paste') pasteValue();
    if (action === 'help') helpDialog();
    if (action === 'about') aboutDialog();
  }
);

/* ---------- input ---------- */

$('keys').addEventListener('mousedown', (ev) => {
  ev.preventDefault();
  const key = ev.target.closest('.key');
  if (key) press(key.dataset.key);
});

const KEYMAP = {
  Enter: '=',
  '=': '=',
  Escape: 'c',
  Delete: 'ce',
  Backspace: 'back',
  ',': '.',
  '%': 'percent',
  '@': 'sqrt',
  F9: 'sign',
};

document.addEventListener('keydown', (ev) => {
  if (document.querySelector('.dlg')) return;

  if (ev.ctrlKey && !ev.shiftKey) {
    const k = ev.key.toLowerCase();
    if (k === 'c') {
      ev.preventDefault();
      return copyValue();
    }
    if (k === 'v') {
      ev.preventDefault();
      return pasteValue();
    }
    if (k === 'r') {
      ev.preventDefault();
      return press('recip');
    }
  }
  if (ev.ctrlKey || ev.altKey || ev.metaKey) return;

  let key = null;
  if (ev.key >= '0' && ev.key <= '9') key = ev.key;
  else if (ev.key === '.' || ev.key === ',') key = '.';
  else if ('+-*/'.indexOf(ev.key) >= 0) key = ev.key;
  else key = KEYMAP[ev.key] || null;
  if (!key) return;

  ev.preventDefault();
  press(key);
});

wireTitleBar({
  titlebar: $('titlebar'),
  minimize: $('btnMin'),
  maximize: $('btnMax'),
  close: $('btnClose'),
});

listenShell((message) => {
  if (message && message.t === 'clipboard') insertNumber(message.text || '');
});

document.title = 'Calculator';
render();

window.calc = {
  press,
  value: () => valueEl.textContent,
  raw: () => s.entry,
  memory: () => s.memory,
  state: () => ({ entry: s.entry, typing: s.typing, acc: s.acc, op: s.op, error: s.error }),
};
