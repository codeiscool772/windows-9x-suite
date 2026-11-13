/* A Windows 95 modal dialog: title bar, message body, centred buttons.
   Resolves with the clicked button's value (null for Cancel / Escape). */

export const ICON_WARN = `<svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">
  <path d="M16 2l14 27H2z" fill="#ffff00" stroke="#000"/>
  <rect x="15" y="10" width="3" height="10" fill="#000"/>
  <rect x="15" y="22" width="3" height="3" fill="#000"/>
</svg>`;

export const ICON_INFO = `<svg viewBox="0 0 32 32" width="32" height="32" shape-rendering="crispEdges">
  <circle cx="16" cy="16" r="14" fill="#fff" stroke="#000"/>
  <rect x="15" y="8" width="3" height="3" fill="#000"/>
  <rect x="15" y="13" width="3" height="12" fill="#000"/>
</svg>`;

export function showDialog({ title, body, buttons, width = 320, icon = '' }) {
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
        ev.preventDefault();
        finish(null);
      } else if (ev.key === 'Enter' && !ev.target.closest('textarea')) {
        ev.preventDefault();
        finish((buttons.find((b) => b.default) || buttons[0]).value);
      }
    };
    document.addEventListener('keydown', onKey, true);

    document.body.appendChild(overlay);
    document.body.appendChild(dlg);
    const r = dlg.getBoundingClientRect();
    dlg.style.left = Math.round((window.innerWidth - r.width) / 2) + 'px';
    dlg.style.top = Math.round((window.innerHeight - r.height) / 2 - 20) + 'px';
  });
}
