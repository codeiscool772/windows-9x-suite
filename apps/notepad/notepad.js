import { createMenuBar } from '../../chrome/menu.js';
import { shell, shellPost, listenShell, wireTitleBar } from '../../chrome/shell.js';

const $ = (id) => document.getElementById(id);
const editor = $('editor');

/* ---------- preferences (Notepad kept these in the registry) ---------- */

const prefs = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

const doc = { name: 'Untitled', path: null, dirty: false };
let wordWrap = prefs.get('notepad.wordwrap', true);
let font = prefs.get('notepad.font', { face: 'Fixedsys', style: 'Regular', size: 10 });
let pageSetup = prefs.get('notepad.page', { header: '', footer: 'Page &p', l: 0.75, t: 0.75, r: 0.75, b: 0.75 });
let findState = { what: '', matchCase: false, up: false };
let undoSnapshot = null;
let pendingSave = null;

/* ---------- document state ---------- */

function updateTitle() {
  const title = doc.name + ' - Notepad';
  $('tbTitle').textContent = title;
  document.title = title;
}

function markChanged() {
  doc.dirty = true;
  updateTitle();
}

function setDocument(name, path, text) {
  doc.name = name;
  doc.path = path;
  doc.dirty = false;
  undoSnapshot = null;
  editor.value = text;
  updateTitle();
  editor.focus();
  editor.setSelectionRange(0, 0);
  editor.scrollTop = 0;
}

function snapshot() {
  undoSnapshot = { value: editor.value, start: editor.selectionStart, end: editor.selectionEnd };
}

function applyWordWrap() {
  editor.wrap = wordWrap ? 'soft' : 'off';
  editor.classList.toggle('nowrap', !wordWrap);
  prefs.set('notepad.wordwrap', wordWrap);
}

function applyFont() {
  editor.style.fontFamily = '"' + font.face + '", "Lucida Console", monospace';
  editor.style.fontSize = font.size + 'pt';
  editor.style.fontWeight = /Bold/.test(font.style) ? 'bold' : 'normal';
  editor.style.fontStyle = /Italic/.test(font.style) ? 'italic' : 'normal';
  prefs.set('notepad.font', font);
}

/* ---------- dialogs ---------- */

const ICON_WARN = `<svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">
  <path d="M16 2l14 27H2z" fill="#ffff00" stroke="#000"/>
  <rect x="15" y="10" width="3" height="10" fill="#000"/>
  <rect x="15" y="22" width="3" height="3" fill="#000"/>
</svg>`;
const ICON_INFO = `<svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">
  <circle cx="16" cy="16" r="14" fill="#fff" stroke="#000"/>
  <circle cx="16" cy="16" r="14" fill="#000080" opacity="0.08"/>
  <rect x="15" y="8" width="3" height="3" fill="#000"/>
  <rect x="15" y="13" width="3" height="12" fill="#000"/>
</svg>`;

function openDialog({ title, body, buttons, width = 320, icon = '' }) {
  return new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.style.width = width + 'px';
    dlg.innerHTML = `<div class="dlg-title"><span>${title}</span></div>
      <div class="dlg-body"><div class="dlg-message">${icon}<div class="dlg-content"></div></div></div>
      <div class="dlg-buttons"></div>`;
    dlg.querySelector('.dlg-content').appendChild(body);

    const finish = (value) => {
      document.removeEventListener('keydown', onKey, true);
      overlay.remove();
      dlg.remove();
      if (previousFocus && previousFocus.focus) previousFocus.focus();
      resolve(value);
    };

    const bar = dlg.querySelector('.dlg-buttons');
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn';
      el.textContent = b.label;
      el.addEventListener('click', () => finish(b.value));
      bar.appendChild(el);
      if (b.default) setTimeout(() => el.focus(), 0);
    });

    const onKey = (ev) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        finish(null);
      }
      if (ev.key === 'Enter' && !ev.target.closest('textarea, .list')) {
        ev.stopPropagation();
        const first = buttons.find((b) => b.default) || buttons[0];
        finish(first.value);
      }
    };
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    document.body.appendChild(dlg);
    const r = dlg.getBoundingClientRect();
    dlg.style.left = Math.round((window.innerWidth - r.width) / 2) + 'px';
    dlg.style.top = Math.round(Math.max(8, (window.innerHeight - r.height) / 2 - 28)) + 'px';
  });
}

function messageBox(title, text, labels) {
  const body = document.createElement('div');
  const p = document.createElement('p');
  p.textContent = text;
  body.appendChild(p);
  return openDialog({
    title,
    body,
    icon: ICON_WARN,
    width: 340,
    buttons: (labels || ['OK']).map((label, i) => ({ label, value: label, default: i === 0 })),
  });
}

/* ---------- files ---------- */

function download(name, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function resolveSave(ok) {
  const resolve = pendingSave;
  pendingSave = null;
  if (resolve) resolve(ok);
}

function save() {
  if (!shell) {
    download(doc.name === 'Untitled' ? 'Untitled.txt' : doc.name, editor.value);
    doc.dirty = false;
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    pendingSave = resolve;
    shellPost(
      doc.path
        ? { t: 'saveTo', path: doc.path, name: doc.name, text: editor.value }
        : { t: 'saveAs', name: doc.name === 'Untitled' ? 'Untitled.txt' : doc.name, text: editor.value }
    );
  });
}

function saveAs() {
  if (!shell) return save();
  return new Promise((resolve) => {
    pendingSave = resolve;
    shellPost({ t: 'saveAs', name: doc.name === 'Untitled' ? 'Untitled.txt' : doc.name, text: editor.value });
  });
}

function openFile() {
  if (shell) {
    shellPost({ t: 'open' });
    return;
  }
  const input = $('openInput');
  input.value = '';
  input.click();
}

$('openInput').addEventListener('change', () => {
  const file = $('openInput').files && $('openInput').files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => setDocument(file.name, null, String(reader.result));
  reader.readAsText(file);
});

async function guardUnsaved() {
  if (!doc.dirty) return true;
  const answer = await messageBox(
    'Notepad',
    'The text in the ' + doc.name + ' file has changed.\n\nDo you want to save the changes?',
    ['Yes', 'No', 'Cancel']
  );
  if (answer === 'Cancel' || answer === null) return false;
  if (answer === 'Yes') return await save();
  return true;
}

async function newFile() {
  if (!(await guardUnsaved())) return;
  setDocument('Untitled', null, '');
}

async function openWithGuard() {
  if (!(await guardUnsaved())) return;
  openFile();
}

async function requestExit() {
  if (!(await guardUnsaved())) return;
  if (shell) shellPost('close');
  else window.close();
}

/* ---------- editing ---------- */

function selectionText() {
  return editor.value.slice(editor.selectionStart, editor.selectionEnd);
}

function insertText(text) {
  snapshot();
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, 'end');
  markChanged();
}

function copySelection() {
  const text = selectionText();
  if (!text) return;
  if (shell) shellPost({ t: 'copy', text });
  else if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

function pasteClipboard() {
  if (shell) shellPost({ t: 'paste' });
  else if (navigator.clipboard) {
    navigator.clipboard.readText().then(insertText).catch(() => {});
  }
}

function cutSelection() {
  const text = selectionText();
  if (!text) return;
  copySelection();
  deleteSelection();
}

function deleteSelection() {
  if (editor.selectionStart === editor.selectionEnd) return;
  snapshot();
  editor.setRangeText('', editor.selectionStart, editor.selectionEnd, 'end');
  markChanged();
}

function undo() {
  if (!undoSnapshot) return;
  editor.value = undoSnapshot.value;
  editor.setSelectionRange(undoSnapshot.start, undoSnapshot.end);
  undoSnapshot = null;
  markChanged();
}

function insertTimeDate() {
  const now = new Date();
  const hours = now.getHours();
  const h12 = hours % 12 === 0 ? 12 : hours % 12;
  const mins = String(now.getMinutes()).padStart(2, '0');
  const stamp =
    h12 +
    ':' +
    mins +
    ' ' +
    (hours < 12 ? 'AM' : 'PM') +
    ' ' +
    (now.getMonth() + 1) +
    '/' +
    now.getDate() +
    '/' +
    now.getFullYear();
  insertText(stamp);
}

/* ---------- find ---------- */

function locate(from, backwards) {
  const haystack = findState.matchCase ? editor.value : editor.value.toLowerCase();
  const needle = findState.matchCase ? findState.what : findState.what.toLowerCase();
  if (!needle) return -1;
  return backwards ? haystack.lastIndexOf(needle, from) : haystack.indexOf(needle, from);
}

function revealMatch(index, length) {
  editor.focus();
  editor.setSelectionRange(index, index + length);
  const lineCount = editor.value.slice(0, index).split('\n').length - 1;
  const lineHeight = parseFloat(getComputedStyle(editor).lineHeight) || 15;
  editor.scrollTop = Math.max(0, lineCount * lineHeight - editor.clientHeight / 2);
}

function findNext(backwards) {
  if (!findState.what) {
    openFind();
    return;
  }

  const length = findState.what.length;
  const backwardsNow = typeof backwards === 'boolean' ? backwards : findState.up;
  let from = backwardsNow ? editor.selectionStart - length : editor.selectionEnd;
  if (from < 0) from = backwardsNow ? editor.value.length - length : 0;

  let index = locate(from, backwardsNow);
  if (index < 0) index = locate(backwardsNow ? editor.value.length - length : 0, backwardsNow);
  if (index < 0) {
    messageBox('Notepad', 'Cannot find "' + findState.what + '"', ['OK']);
    return;
  }

  revealMatch(index, length);
}

function openFind() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="row"><label style="width:70px">Find what:</label><input class="field" id="findWhat" style="flex:1 1 auto"></div>
    <div class="row" style="margin: 2px 0 10px 76px"><div class="check" id="findCase"><i></i><span>Match case</span></div></div>
    <div class="group" style="margin-left:76px; padding:10px 10px 8px; width:118px">
      <span class="group-label">Direction</span>
      <div class="check radio" id="findUp"><i></i><span>Up</span></div>
      <div class="check radio" id="findDown"><i></i><span>Down</span></div>
    </div>`;

  const what = body.querySelector('#findWhat');
  const matchCase = body.querySelector('#findCase');
  const up = body.querySelector('#findUp');
  const down = body.querySelector('#findDown');

  what.value = findState.what;
  matchCase.classList.toggle('on', findState.matchCase);
  up.classList.toggle('on', findState.up);
  down.classList.toggle('on', !findState.up);

  const clickToggle = (el, apply) => el.addEventListener('click', () => { apply(); });
  clickToggle(matchCase, () => {
    findState.matchCase = !findState.matchCase;
    matchCase.classList.toggle('on', findState.matchCase);
  });
  clickToggle(up, () => {
    findState.up = true;
    up.classList.add('on');
    down.classList.remove('on');
  });
  clickToggle(down, () => {
    findState.up = false;
    down.classList.add('on');
    up.classList.remove('on');
  });

  setTimeout(() => {
    what.focus();
    what.select();
  }, 0);

  openDialog({
    title: 'Find',
    body,
    width: 340,
    buttons: [
      { label: 'Find Next', value: 'next', default: true },
      { label: 'Cancel', value: null },
    ],
  }).then((answer) => {
    if (answer !== 'next') return;
    findState.what = what.value;
    if (findState.what) revealFirstMatch();
  });

  function revealFirstMatch() {
    const index = locate(Math.max(0, editor.selectionEnd - findState.what.length), findState.up);
    const found = index >= 0 ? index : locate(findState.up ? editor.value.length : 0, findState.up);
    if (found < 0) {
      messageBox('Notepad', 'Cannot find "' + findState.what + '"', ['OK']);
      return;
    }
    revealMatch(found, findState.what.length);
  }
}

/* ---------- font dialog ---------- */

function openFontDialog() {
  const faces = ['Fixedsys', 'Courier New', 'Lucida Console', 'Terminal', 'MS Sans Serif', 'Arial', 'Times New Roman', 'Verdana'];
  const styles = ['Regular', 'Bold', 'Italic', 'Bold Italic'];
  const sizes = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 36];

  const body = document.createElement('div');
  body.innerHTML = `<div style="display:flex; gap:10px">
      <div style="width:132px"><div style="margin-bottom:3px">Font:</div><div class="list" id="fontList" style="height:118px"></div></div>
      <div style="width:88px"><div style="margin-bottom:3px">Font style:</div><div class="list" id="styleList" style="height:118px"></div></div>
      <div style="width:52px"><div style="margin-bottom:3px">Size:</div><div class="list" id="sizeList" style="height:118px"></div></div>
    </div>
    <div class="group" style="margin-top:10px; padding:8px"><div class="sample" id="fontSample">AaBbYyZz</div></div>`;

  const pick = { face: font.face, style: font.style, size: font.size };
  const lists = {
    face: body.querySelector('#fontList'),
    style: body.querySelector('#styleList'),
    size: body.querySelector('#sizeList'),
  };

  const fill = (key, values) => {
    lists[key].textContent = '';
    values.forEach((value) => {
      const item = document.createElement('div');
      item.className = 'list-item' + (pick[key] === value ? ' sel' : '');
      item.textContent = value;
      item.addEventListener('click', () => {
        pick[key] = value;
        fill(key, values);
        sample();
      });
      lists[key].appendChild(item);
    });
  };

  function sample() {
    const el = body.querySelector('#fontSample');
    el.style.fontFamily = '"' + pick.face + '", monospace';
    el.style.fontSize = pick.size + 'pt';
    el.style.fontWeight = /Bold/.test(pick.style) ? 'bold' : 'normal';
    el.style.fontStyle = /Italic/.test(pick.style) ? 'italic' : 'normal';
  }

  fill('face', faces);
  fill('style', styles);
  fill('size', sizes);
  sample();

  openDialog({
    title: 'Font',
    body,
    width: 380,
    buttons: [
      { label: 'OK', value: 'ok', default: true },
      { label: 'Cancel', value: null },
    ],
  }).then((answer) => {
    if (answer !== 'ok') return;
    font = { face: pick.face, style: pick.style, size: pick.size };
    applyFont();
    editor.focus();
  });
}

/* ---------- page setup ---------- */

function openPageSetup() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="row"><label style="width:56px">Header:</label><input class="field" id="pgHeader" style="width:210px"></div>
    <div class="row"><label style="width:56px">Footer:</label><input class="field" id="pgFooter" style="width:210px"></div>
    <div class="group" style="margin-top:12px; padding:12px 10px 8px">
      <span class="group-label">Margins (inches)</span>
      <div style="display:flex; gap:10px">
        <div><div>Left:</div><input class="field" id="pgL" style="width:46px"></div>
        <div><div>Top:</div><input class="field" id="pgT" style="width:46px"></div>
        <div><div>Right:</div><input class="field" id="pgR" style="width:46px"></div>
        <div><div>Bottom:</div><input class="field" id="pgB" style="width:46px"></div>
      </div>
    </div>`;

  const fields = {
    header: body.querySelector('#pgHeader'),
    footer: body.querySelector('#pgFooter'),
    l: body.querySelector('#pgL'),
    t: body.querySelector('#pgT'),
    r: body.querySelector('#pgR'),
    b: body.querySelector('#pgB'),
  };
  fields.header.value = pageSetup.header;
  fields.footer.value = pageSetup.footer;
  ['l', 't', 'r', 'b'].forEach((k) => (fields[k].value = pageSetup[k]));

  openDialog({
    title: 'Page Setup',
    body,
    width: 340,
    buttons: [
      { label: 'OK', value: 'ok', default: true },
      { label: 'Cancel', value: null },
    ],
  }).then((answer) => {
    if (answer !== 'ok') return;
    pageSetup = {
      header: fields.header.value,
      footer: fields.footer.value,
      l: parseFloat(fields.l.value) || 0,
      t: parseFloat(fields.t.value) || 0,
      r: parseFloat(fields.r.value) || 0,
      b: parseFloat(fields.b.value) || 0,
    };
    prefs.set('notepad.page', pageSetup);
  });
}

function printDocument() {
  if (shell) {
    shellPost({
      t: 'print',
      name: doc.name,
      text: editor.value,
      header: pageSetup.header,
      footer: pageSetup.footer,
      mLeft: pageSetup.l,
      mTop: pageSetup.t,
      mRight: pageSetup.r,
      mBottom: pageSetup.b,
    });
  } else {
    window.print();
  }
}

/* ---------- about ---------- */

function openAbout() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="about-body">
    <svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">
      <rect x="6" y="3" width="20" height="26" fill="#fff" stroke="#000"/>
      <rect x="20" y="3" width="6" height="6" fill="#c0c0c0" stroke="#000"/>
      <rect x="9" y="13" width="14" height="1" fill="#000080"/>
      <rect x="9" y="16" width="14" height="1" fill="#000080"/>
      <rect x="9" y="19" width="14" height="1" fill="#000080"/>
      <rect x="9" y="22" width="9" height="1" fill="#000080"/>
    </svg>
    <div class="about-text"><b>Microsoft Notepad</b>Version 4.10<br><br>Copyright \u00a9 1981-1998<br>Microsoft Corp. All rights reserved.</div>
  </div>`;
  openDialog({ title: 'About Notepad', body, width: 340, buttons: [{ label: 'OK', value: 'ok', default: true }] });
}

/* ---------- menus ---------- */

const menus = [
  {
    label: 'File',
    items: [
      { label: 'New', accel: 'Ctrl+N', action: 'new' },
      { label: 'Open...', accel: 'Ctrl+O', action: 'open' },
      { label: 'Save', accel: 'Ctrl+S', action: 'save' },
      { label: 'Save As...', action: 'saveAs' },
      { sep: true },
      { label: 'Page Setup...', action: 'pageSetup' },
      { label: 'Print...', accel: 'Ctrl+P', action: 'print' },
      { sep: true },
      { label: 'Exit', action: 'exit' },
    ],
  },
  {
    label: 'Edit',
    items: [
      { label: 'Undo', accel: 'Ctrl+Z', action: 'undo' },
      { sep: true },
      { label: 'Cut', accel: 'Ctrl+X', action: 'cut' },
      { label: 'Copy', accel: 'Ctrl+C', action: 'copy' },
      { label: 'Paste', accel: 'Ctrl+V', action: 'paste' },
      { label: 'Delete', accel: 'Del', action: 'delete' },
      { sep: true },
      { label: 'Select All', accel: 'Ctrl+A', action: 'selectAll' },
      { label: 'Time/Date', accel: 'F5', action: 'timeDate' },
      { sep: true },
      { label: 'Word Wrap', checked: () => wordWrap, action: 'wordWrap' },
      { label: 'Set Font...', action: 'font' },
    ],
  },
  {
    label: 'Search',
    items: [
      { label: 'Find...', accel: 'Ctrl+F', action: 'find' },
      { label: 'Find Next', accel: 'F3', action: 'findNext' },
      { label: 'Find Previous', accel: 'Shift+F3', action: 'findPrev' },
    ],
  },
  {
    label: 'Help',
    items: [
      { label: 'Help Topics', action: 'help' },
      { sep: true },
      { label: 'About Notepad', action: 'about' },
    ],
  },
];

const actions = {
  new: newFile,
  open: openWithGuard,
  save,
  saveAs,
  pageSetup: openPageSetup,
  print: printDocument,
  exit: requestExit,
  undo,
  cut: cutSelection,
  copy: copySelection,
  paste: pasteClipboard,
  delete: deleteSelection,
  selectAll: () => {
    editor.focus();
    editor.select();
  },
  timeDate: () => {
    editor.focus();
    insertTimeDate();
  },
  wordWrap: () => {
    wordWrap = !wordWrap;
    applyWordWrap();
  },
  font: openFontDialog,
  find: openFind,
  findNext: () => findNext(false),
  findPrev: () => findNext(true),
  help: () =>
    messageBox('Notepad Help', 'Notepad is a basic text editor you can use for simple documents.', ['OK']),
  about: openAbout,
};

createMenuBar($('menubar'), menus, (action) => {
  const fn = actions[action];
  if (fn) fn();
});

/* ---------- text events ---------- */

editor.addEventListener('beforeinput', snapshot);
editor.addEventListener('input', markChanged);

document.addEventListener('keydown', (ev) => {
  if (document.querySelector('.dlg')) return;
  const ctrl = ev.ctrlKey || ev.metaKey;
  const key = ev.key.toLowerCase();

  if (key === 'f3') {
    ev.preventDefault();
    findNext(ev.shiftKey);
    return;
  }
  if (ev.key === 'F5') {
    ev.preventDefault();
    insertTimeDate();
    return;
  }
  if (!ctrl) return;

  const map = {
    n: () => newFile(),
    o: () => openWithGuard(),
    s: () => (ev.shiftKey ? saveAs() : save()),
    p: () => printDocument(),
    z: () => undo(),
    x: () => cutSelection(),
    c: () => copySelection(),
    v: () => pasteClipboard(),
    a: () => {
      editor.focus();
      editor.select();
    },
    f: () => openFind(),
  };
  if (map[key]) {
    ev.preventDefault();
    map[key]();
  }
});

/* ---------- native window ---------- */

wireTitleBar({
  titlebar: $('titlebar'),
  minimize: $('btnMin'),
  maximize: $('btnMax'),
  close: $('btnClose'),
  onClose: requestExit,
});

listenShell((message) => {
  if (!message || typeof message !== 'object') return;
  if (message.t === 'opened') {
    setDocument(message.name, message.path, message.text || '');
  } else if (message.t === 'savedAs') {
    doc.name = message.name;
    doc.path = message.path;
    doc.dirty = false;
    updateTitle();
    resolveSave(true);
  } else if (message.t === 'cancelled') {
    resolveSave(false);
  } else if (message.t === 'clipboard') {
    editor.focus();
    insertText(message.text || '');
  }
});

applyWordWrap();
applyFont();
updateTitle();
editor.focus();

window.notepad = {
  get text() {
    return editor.value;
  },
  get dirty() {
    return doc.dirty;
  },
  get name() {
    return doc.name;
  },
  setText(text) {
    editor.value = text;
    markChanged();
  },
  insertTimeDate,
  findNext,
  openFind,
  openFontDialog,
  openPageSetup,
  openAbout,
  setFind(what, matchCase) {
    findState.what = what;
    if (typeof matchCase === 'boolean') findState.matchCase = matchCase;
  },
  selection: () => ({ start: editor.selectionStart, end: editor.selectionEnd }),
};
