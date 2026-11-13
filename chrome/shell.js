/* Native-window glue shared by the launcher and the apps.

   Inside the Win9x shell the page *is* the window: the title bar drawn on screen is the
   real window frame, so dragging it and the min/max/close buttons talk to the host.
   Opened in a browser instead, the same page falls back to ordinary browser behaviour. */

export const shell = !!(window.chrome && window.chrome.webview && window.chrome.webview.postMessage);

export function shellPost(message) {
  if (!shell) return;
  window.chrome.webview.postMessage(typeof message === 'string' ? message : JSON.stringify(message));
}

export function listenShell(handler) {
  if (!shell) return;
  window.chrome.webview.addEventListener('message', (ev) => handler(ev.data));
}

export function wireTitleBar({ titlebar, minimize, maximize, close, onClose }) {
  const requestClose = onClose || (() => (shell ? shellPost('close') : window.close()));

  if (titlebar) {
    titlebar.addEventListener('mousedown', (ev) => {
      if (ev.button !== 0 || ev.target.closest('button')) return;
      if (shell) shellPost('drag');
    });
    titlebar.addEventListener('dblclick', (ev) => {
      if (ev.target.closest('button')) return;
      if (shell) shellPost('maximize');
    });
  }

  if (minimize) minimize.onclick = () => (shell ? shellPost('minimize') : null);
  if (maximize) maximize.onclick = () => (shell ? shellPost('maximize') : null);
  if (close) close.onclick = () => requestClose();

  return requestClose;
}
