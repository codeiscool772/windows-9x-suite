/* A Windows 95 menu bar: click a title to drop its menu, slide across titles to switch,
   click an item to run it. `checked` / `disabled` may be functions so they stay live. */

const val = (v, item) => (typeof v === 'function' ? v(item) : v);

export function createMenuBar(bar, menus, onAction) {
  const titles = [];
  let open = -1;
  let dd = null;

  function close() {
    if (dd && dd.parentNode) dd.parentNode.removeChild(dd);
    dd = null;
    open = -1;
    titles.forEach((t) => t.classList.remove('open'));
  }

  function openMenu(index) {
    close();
    open = index;
    const title = titles[index];
    title.classList.add('open');

    const menu = document.createElement('div');
    menu.className = 'dropdown';
    menu.dataset.menu = menu.label;

    menus[index].items.forEach((item) => {
      if (item.sep) {
        const sep = document.createElement('div');
        sep.className = 'dd-sep';
        menu.appendChild(sep);
        return;
      }
      const row = document.createElement('div');
      row.className = 'dd-item';
      const disabled = !!val(item.disabled, item);
      if (disabled) row.classList.add('disabled');

      const mark = document.createElement('span');
      mark.className = 'dd-mark';
      mark.textContent = val(item.checked, item) ? '\u2713' : '';
      row.appendChild(mark);

      const label = document.createElement('span');
      label.className = 'dd-label';
      label.textContent = item.label;
      row.appendChild(label);

      if (item.accel) {
        const accel = document.createElement('span');
        accel.className = 'accel';
        accel.textContent = item.accel;
        row.appendChild(accel);
      }

      if (!disabled) {
        row.addEventListener('mouseup', (ev) => {
          ev.stopPropagation();
          close();
          onAction(item.action, item);
        });
      }
      menu.appendChild(row);
    });

    const r = title.getBoundingClientRect();
    menu.style.left = Math.round(r.left) + 'px';
    menu.style.top = Math.round(r.bottom) + 'px';
    document.body.appendChild(menu);
    dd = menu;
  }

  menus.forEach((menu, index) => {
    const el = document.createElement('div');
    el.className = 'menu-item';
    el.textContent = menu.label;
    el.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      ev.stopPropagation();
      if (open === index) close();
      else openMenu(index);
    });
    el.addEventListener('mouseenter', () => {
      if (open >= 0 && open !== index) openMenu(index);
    });
    bar.appendChild(el);
    titles.push(el);
  });

  document.addEventListener('mousedown', (ev) => {
    if (open >= 0 && !bar.contains(ev.target) && !(dd && dd.contains(ev.target))) close();
  });
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') close();
  });

  return { close, isOpen: () => open >= 0 };
}
