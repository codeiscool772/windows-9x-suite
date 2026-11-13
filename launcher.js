import { createMenuBar } from './chrome/menu.js';
import { shell, shellPost, listenShell, wireTitleBar } from './chrome/shell.js';

const $ = (id) => document.getElementById(id);

/* 32x32 icons, drawn as pixel art so they stay crisp at any DPI. */
const ICON = {
  paint: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
    <rect x="3" y="6" width="26" height="22" fill="#fff" stroke="#000"/>
    <rect x="4" y="7" width="24" height="7" fill="#0080c0"/>
    <rect x="6" y="17" width="5" height="5" fill="#c00000"/>
    <rect x="11" y="17" width="5" height="5" fill="#00a000"/>
    <rect x="16" y="17" width="5" height="5" fill="#0000c0"/>
    <rect x="6" y="22" width="5" height="5" fill="#c0c000"/>
    <rect x="11" y="22" width="5" height="5" fill="#800080"/>
    <rect x="16" y="22" width="5" height="5" fill="#008080"/>
    <path d="M20 4l7 7-3 3-7-7z" fill="#e0c060" stroke="#000"/>
    <path d="M27 3l2 2-2 2-1 1-3-3 1-1z" fill="#808080" stroke="#000"/>
    <rect x="21" y="11" width="1" height="3" fill="#000"/>
  </svg>`,
  calc: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
    <rect x="7" y="2" width="18" height="28" fill="#c0c0c0" stroke="#000"/>
    <rect x="10" y="5" width="12" height="5" fill="#fff" stroke="#000"/>
    <rect x="17" y="7" width="4" height="1" fill="#000"/>
    <rect x="10" y="13" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="15" y="13" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="20" y="13" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="10" y="17" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="15" y="17" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="20" y="17" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="10" y="21" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="15" y="21" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="20" y="21" width="3" height="3" fill="#a0a0a0" stroke="#000"/>
    <rect x="10" y="25" width="13" height="3" fill="#a0a0a0" stroke="#000"/>
  </svg>`,
  minesweeper: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
    <g stroke="#000" stroke-width="2">
      <path d="M16 2v5M16 25v5M2 16h5M25 16h5M6 6l4 4M22 22l4 4M6 26l4-4M22 10l4-4"/>
    </g>
    <circle cx="16" cy="16" r="9" fill="#000"/>
    <rect x="11" y="11" width="4" height="4" fill="#fff"/>
  </svg>`,
  notepad: `<svg viewBox="0 0 32 32" shape-rendering="crispEdges">
    <rect x="6" y="3" width="20" height="26" fill="#fff" stroke="#000"/>
    <rect x="20" y="3" width="6" height="6" fill="#c0c0c0" stroke="#000"/>
    <rect x="9" y="13" width="14" height="1" fill="#000080"/>
    <rect x="9" y="16" width="14" height="1" fill="#000080"/>
    <rect x="9" y="19" width="14" height="1" fill="#000080"/>
    <rect x="9" y="22" width="9" height="1" fill="#000080"/>
    <rect x="9" y="6" width="8" height="2" fill="#000000"/>
  </svg>`,
};

const APPS = [
  { id: 'paint', label: 'Paint', icon: ICON.paint },
  { id: 'notepad', label: 'Notepad', icon: ICON.notepad },
  { id: 'calc', label: 'Calculator', icon: ICON.calc },
  { id: 'minesweeper', label: 'Minesweeper', icon: ICON.minesweeper },
];

let selected = 0;

function render() {
  const box = $('icons');
  box.textContent = '';
  APPS.forEach((app, index) => {
    const el = document.createElement('div');
    el.className = 'app' + (index === selected ? ' sel' : '');
    el.dataset.app = app.id;
    el.title = app.label;
    el.innerHTML = app.icon;
    const label = document.createElement('div');
    label.className = 'app-label';
    label.textContent = app.label;
    el.appendChild(label);
    el.addEventListener('mousedown', () => {
      selected = index;
      render();
    });
    el.addEventListener('dblclick', () => launch(app.id));
    box.appendChild(el);
  });
  $('groupStatus').textContent = APPS.length + ' object(s)';
}

function launch(app) {
  if (shell) shellPost({ t: 'launch', app });
  else window.open('apps/' + app + '/index.html', '_blank');
}

/* ---------- dialogs ---------- */

function showDialog({ title, body, buttons, width = 300, icon = '' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'overlay';
    const dlg = document.createElement('div');
    dlg.className = 'dlg';
    dlg.style.width = width + 'px';
    dlg.innerHTML = `<div class="dlg-title"><span>${title}</span></div>
      <div class="dlg-body"><div class="dlg-message">${icon}<div class="dlg-content"></div></div></div>
      <div class="dlg-buttons"></div>`;
    dlg.querySelector('.dlg-content').appendChild(body);

    const bar = dlg.querySelector('.dlg-buttons');
    const finish = (value) => {
      document.removeEventListener('keydown', onKey);
      overlay.remove();
      dlg.remove();
      resolve(value);
    };
    buttons.forEach((b) => {
      const el = document.createElement('button');
      el.className = 'btn';
      el.textContent = b.label;
      el.addEventListener('click', () => finish(b.value));
      bar.appendChild(el);
      if (b.default) setTimeout(() => el.focus(), 0);
    });

    const onKey = (ev) => {
      if (ev.key === 'Escape') finish(null);
      if (ev.key === 'Enter') finish((buttons.find((b) => b.default) || buttons[0]).value);
    };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);
    document.body.appendChild(dlg);
    const r = dlg.getBoundingClientRect();
    dlg.style.left = Math.round((window.innerWidth - r.width) / 2) + 'px';
    dlg.style.top = Math.round((window.innerHeight - r.height) / 2 - 20) + 'px';
  });
}

function runDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<div style="margin-bottom:8px">Type the name of a program to open:</div>
    <div class="run-row"><span>Open:</span><select class="select" id="runPick" style="width:100%"></select></div>`;
  const pick = body.querySelector('#runPick');
  APPS.forEach((a) => {
    const opt = document.createElement('option');
    opt.value = a.id;
    opt.textContent = a.label;
    pick.appendChild(opt);
  });
  return showDialog({
    title: 'Run',
    body,
    width: 320,
    buttons: [
      { label: 'OK', value: 'ok', default: true },
      { label: 'Cancel', value: null },
    ],
  }).then((answer) => {
    if (answer === 'ok') launch(pick.value);
  });
}

function aboutDialog() {
  const body = document.createElement('div');
  body.innerHTML = `<div class="about-text"><b>Program Manager</b>Windows 98 Suite<br>a re-creation of the classic desktop</div>`;
  return showDialog({
    title: 'About Program Manager',
    body,
    width: 300,
    buttons: [{ label: 'OK', value: 'ok', default: true }],
  });
}

/* ---------- menus ---------- */

createMenuBar(
  $('menubar'),
  [
    {
      label: 'File',
      items: [
        { label: 'Run...', action: 'run' },
        { sep: true },
        { label: 'Exit', action: 'exit' },
      ],
    },
    {
      label: 'Options',
      items: [{ label: 'Auto Arrange', action: 'ignore', disabled: true }],
    },
    {
      label: 'Help',
      items: [
        { label: 'Contents', action: 'help' },
        { sep: true },
        { label: 'About Program Manager', action: 'about' },
      ],
    },
  ],
  (action) => {
    if (action === 'run') runDialog();
    if (action === 'about') aboutDialog();
    if (action === 'help') {
      const body = document.createElement('div');
      body.innerHTML = '<div>Double-click an icon to start a program.</div>';
      showDialog({ title: 'Help Topics', body, buttons: [{ label: 'OK', value: 'ok', default: true }] });
    }
    if (action === 'exit') shell ? shellPost('close') : window.close();
  }
);

/* ---------- window ---------- */

wireTitleBar({
  titlebar: $('titlebar'),
  minimize: $('btnMin'),
  maximize: $('btnMax'),
  close: $('btnClose'),
});

listenShell((message) => {
  if (message && message.t === 'launch') launch(message.app);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Enter') launch(APPS[selected].id);
  if (ev.key === 'ArrowRight') { selected = Math.min(APPS.length - 1, selected + 1); render(); }
  if (ev.key === 'ArrowLeft') { selected = Math.max(0, selected - 1); render(); }
});

render();
