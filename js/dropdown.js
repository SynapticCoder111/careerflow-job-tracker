/* ==========================================================================
   CareerFlow — Dropdown Component
   ==========================================================================
   Accessible, reusable dropdown used for filters, sorting, status changes and
   account menus. Replaces native <select> elements, which cannot be styled
   consistently across platforms.

   Features
   - Full keyboard support (arrows, home/end, enter, escape, type-ahead)
   - Click-outside dismissal
   - Auto-flip upward when there is not enough room below the trigger
   - ARIA listbox semantics (aria-expanded, aria-activedescendant, aria-selected)
   - Positions relative to the trigger, never to the page
   ========================================================================== */

const CARET_ICON = `<svg class="dropdown-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>`;
const CHECK_ICON = `<svg class="dropdown-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6L9 17l-5-5"/></svg>`;

let openInstance = null;

export class Dropdown {
  /**
   * @param {Object} options
   * @param {HTMLElement} options.trigger       Button that opens the menu
   * @param {Array} options.items               [{ value, label, hint?, group?, icon? }]
   * @param {string} [options.value]            Currently selected value
   * @param {Function} [options.onChange]       (value, item) => void
   * @param {string} [options.align]            'start' | 'end'
   * @param {string} [options.minWidth]         e.g. '220px'
   * @param {string} [options.ariaLabel]        Accessible name for the listbox
   */
  constructor({
    trigger,
    items = [],
    value = null,
    onChange = null,
    align = 'start',
    minWidth = null,
    ariaLabel = 'Options',
    portal = false,
  }) {
    this.trigger = trigger;
    this.items = items;
    this.value = value;
    this.onChange = onChange;
    this.align = align;
    this.minWidth = minWidth;
    this.ariaLabel = ariaLabel;
    // Portal mode renders the menu as a fixed-position element on <body>, so
    // it is never clipped by a scrollable ancestor (e.g. a Kanban column).
    this.portal = portal;

    this.menu = this.buildMenu();
    this.activeIndex = -1;
    this.isOpen = false;

    // Wrap the trigger so positioning is anchored to it, not the page.
    // The trigger may still be detached (created before it is inserted into
    // the document) — in that case we only build the wrapper and let the
    // caller insert it, rather than assuming a parent already exists.
    this.wrapper = document.createElement('div');
    this.wrapper.className = 'dropdown';
    if (trigger.parentNode) {
      trigger.parentNode.insertBefore(this.wrapper, trigger);
    }
    this.wrapper.appendChild(trigger);
    this.wrapper.appendChild(this.menu);

    if (this.portal) {
      this.menu.style.position = 'fixed';
      this.menu.style.left = '0px';
      this.menu.style.top = '0px';
      this.menu.style.right = 'auto';
      this.menu.style.bottom = 'auto';
      // min-width:100% would resolve against <body> once the menu is moved
      // there, stretching it across the page.
      this.menu.style.minWidth = '0px';
      this.menu.classList.add('dropdown-portal');
      document.body.appendChild(this.menu);
    }

    this.bindEvents();
    this.setValue(value, { silent: true });
  }

  // ---------- Build ----------

  buildMenu() {
    const menu = document.createElement('div');
    menu.className = 'dropdown-menu' + (this.align === 'end' ? ' align-end' : '');
    menu.setAttribute('role', 'listbox');
    menu.setAttribute('aria-label', this.ariaLabel);
    menu.setAttribute('tabindex', '-1');
    if (this.minWidth) menu.style.minWidth = this.minWidth;

    let lastGroup = null;
    this.itemEls = [];

    this.items.forEach((item, index) => {
      // A group header is rendered as a label, not a selectable option.
      if (item.isLabel) {
        lastGroup = item.group || null;
        const header = document.createElement('div');
        header.className = 'dropdown-label';
        header.textContent = item.label;
        menu.appendChild(header);
        return;
      }

      if (item.group && item.group !== lastGroup) {
        lastGroup = item.group;
        const label = document.createElement('div');
        label.className = 'dropdown-label';
        label.textContent = item.group;
        menu.appendChild(label);
      }

      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'dropdown-item';
      el.setAttribute('role', 'option');
      el.setAttribute('aria-selected', 'false');
      el.dataset.value = item.value;
      el.dataset.index = String(index);

      const text = document.createElement('span');
      text.className = 'dropdown-item-label';
      text.textContent = item.label;
      el.appendChild(text);

      if (item.hint) {
        const hint = document.createElement('span');
        hint.className = 'text-xs text-muted';
        hint.textContent = item.hint;
        el.appendChild(hint);
      }

      const check = document.createElement('span');
      check.innerHTML = CHECK_ICON;
      check.style.visibility = 'hidden';
      el.appendChild(check);

      menu.appendChild(el);
      this.itemEls.push(el);
    });

    if (!this.items.length) {
      const empty = document.createElement('div');
      empty.className = 'dropdown-label';
      empty.textContent = 'No options';
      menu.appendChild(empty);
    }

    return menu;
  }

  // ---------- Events ----------

  bindEvents() {
    this.trigger.setAttribute('aria-haspopup', 'listbox');
    this.trigger.setAttribute('aria-expanded', 'false');
    if (!this.trigger.getAttribute('aria-label') && !this.trigger.textContent.trim()) {
      this.trigger.setAttribute('aria-label', this.ariaLabel);
    }

    this.trigger.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      this.toggle();
    });

    this.trigger.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        this.open();
        if (e.key === 'ArrowDown') this.move(1);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        this.open();
        this.move(-1);
      }
    });

    this.menu.addEventListener('click', (e) => {
      const el = e.target.closest('.dropdown-item');
      if (!el) return;
      e.preventDefault();
      this.select(el.dataset.value);
    });

    this.menu.addEventListener('keydown', (e) => {
      switch (e.key) {
        case 'ArrowDown': e.preventDefault(); this.move(1); break;
        case 'ArrowUp': e.preventDefault(); this.move(-1); break;
        case 'Home': e.preventDefault(); this.focusIndex(0); break;
        case 'End': e.preventDefault(); this.focusIndex(this.itemEls.length - 1); break;
        case 'Enter':
        case ' ': {
          e.preventDefault();
          const el = this.itemEls[this.activeIndex];
          if (el) this.select(el.dataset.value);
          break;
        }
        case 'Escape': e.preventDefault(); this.close(); this.trigger.focus(); break;
        case 'Tab': this.close(); break;
        default: this.typeAhead(e.key);
      }
    });

    this.onDocClick = (e) => {
      if (!this.wrapper.contains(e.target)) this.close();
    };
    document.addEventListener('click', this.onDocClick, true);

    this.onScroll = () => { if (this.isOpen) this.close(); };
    window.addEventListener('resize', this.onScroll);
  }

  // ---------- Behaviour ----------

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  open() {
    if (this.isOpen) return;
    if (openInstance && openInstance !== this) openInstance.close();

    this.isOpen = true;
    this.trigger.setAttribute('aria-expanded', 'true');
    this.menu.classList.add('open');

    // Always open downward. If there is not enough space below, the menu is
    // capped and scrolls internally rather than flipping above the trigger.
    this.menu.classList.remove('drop-up');

    if (this.portal) {
      this.positionFixed();
    } else {
      const rect = this.trigger.getBoundingClientRect();
      const spaceBelow = window.innerHeight - rect.bottom - 22;
      const natural = Math.min(this.menu.scrollHeight || 240, 320);
      this.menu.style.maxHeight = Math.max(Math.min(natural, spaceBelow), 120) + 'px';
    }

    this.setActiveIndex(this.items.findIndex((i) => i.value === this.value));
    this.menu.focus();

    document.addEventListener('keydown', this.onEscClose, true);
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.trigger.setAttribute('aria-expanded', 'false');
    this.menu.classList.remove('open');
    this.activeIndex = -1;
    this.trigger.removeAttribute('aria-activedescendant');
    document.removeEventListener('keydown', this.onEscClose, true);
    if (openInstance === this) openInstance = null;
  }

  /**
   * Position a portal menu against its trigger, kept inside the viewport.
   * Portal menus are fixed to <body>, so they escape scrollable ancestors
   * (e.g. a Kanban column) that would otherwise clip them.
   *
   * The menu always opens DOWNWARD. If there is not enough room below, the
   * menu is capped and scrolls internally rather than flipping above the
   * trigger — a predictable position matters more than always fitting.
   */
  positionFixed() {
    const rect = this.trigger.getBoundingClientRect();
    const menu = this.menu;
    menu.style.visibility = 'hidden';
    menu.style.display = 'block';
    menu.style.maxHeight = '';
    menu.style.minWidth = '0px';

    // parseInt(null) is NaN — always coerce to a number before doing maths.
    const minW = parseInt(this.minWidth, 10) || 0;
    const natural = menu.offsetWidth || 0;
    // Never narrower than the trigger, never wider than 320px.
    const mw = Math.max(natural, minW, Math.min(rect.width, 320)) || 220;
    const naturalH = menu.offsetHeight || 240;
    const gap = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // Room available below the trigger, minus the gap and a small margin.
    const spaceBelow = vh - rect.bottom - gap - 8;
    const maxH = Math.max(Math.min(naturalH, spaceBelow), 120);

    let left = this.align === 'end' ? rect.right - mw : rect.left;
    left = Math.max(8, Math.min(left, vw - mw - 8));
    if (!Number.isFinite(left)) left = 8;

    let top = rect.bottom + gap;
    if (top + maxH > vh - 8) top = Math.max(8, vh - maxH - 8);
    if (!Number.isFinite(top)) top = 8;

    menu.style.left = Math.round(left) + 'px';
    menu.style.top = Math.round(top) + 'px';
    menu.style.right = 'auto';
    menu.style.bottom = 'auto';
    menu.style.minWidth = (minW || mw) + 'px';
    menu.style.maxHeight = maxH + 'px';
    menu.style.visibility = '';
  }

  onEscClose = (e) => {
    if (e.key === 'Escape' && this.isOpen) {
      e.stopPropagation();
      this.close();
      this.trigger.focus();
    }
  };

  setActiveIndex(index) {
    this.itemEls.forEach((el, i) => {
      const active = i === index;
      el.classList.toggle('is-active', active);
      if (active) {
        el.id = el.id || `dd-${Math.random().toString(36).slice(2, 9)}`;
        this.trigger.setAttribute('aria-activedescendant', el.id);
      }
    });
    this.activeIndex = index;
  }

  move(delta) {
    if (!this.itemEls.length) return;
    let next = this.activeIndex + delta;
    if (next < 0) next = this.itemEls.length - 1;
    if (next >= this.itemEls.length) next = 0;
    this.focusIndex(next);
  }

  focusIndex(index) {
    if (index < 0 || index >= this.itemEls.length) return;
    this.setActiveIndex(index);
    const el = this.itemEls[index];
    el.scrollIntoView({ block: 'nearest' });
  }

  typeAhead(char) {
    if (!char || char.length !== 1) return;
    const q = char.toLowerCase();
    const start = (this.activeIndex + 1) % this.itemEls.length;
    for (let i = 0; i < this.itemEls.length; i++) {
      const idx = (start + i) % this.itemEls.length;
      const label = (this.items[idx].label || '').toLowerCase();
      if (label.startsWith(q)) {
        this.focusIndex(idx);
        return;
      }
    }
  }

  select(value) {
    // setValue is silent here so onChange fires exactly once.
    this.setValue(value, { silent: true });
    this.close();
    this.trigger.focus();
    if (this.onChange) this.onChange(value, this.items.find((i) => i.value === value));
  }

  setValue(value, { silent = false } = {}) {
    this.value = value;
    this.itemEls.forEach((el) => {
      const isSel = el.dataset.value === String(value);
      el.setAttribute('aria-selected', isSel ? 'true' : 'false');
      const check = el.querySelector('.dropdown-check');
      if (check) check.style.visibility = isSel ? 'visible' : 'hidden';
    });

    // Keep the trigger's visible label in sync with the selection.
    const label = this.trigger.querySelector('.dropdown-value');
    const item = this.items.find((i) => i.value === value);
    if (label && item && item.label) label.textContent = item.label;

    if (!silent && this.onChange) this.onChange(value, item);
  }

  /** Update the trigger's visible label */
  setLabel(text) {
    const label = this.trigger.querySelector('.dropdown-value');
    if (label) label.textContent = text;
  }

  destroy() {
    this.close();
    document.removeEventListener('click', this.onDocClick, true);
    window.removeEventListener('resize', this.onScroll);
    this.menu.remove();
  }
}
/* --------------------------------------------------------------------------
   Convenience factory — builds the trigger markup for you.
   -------------------------------------------------------------------------- */
export function createDropdown({
  label = 'Select',
  value = null,
  items = [],
  onChange = null,
  align = 'start',
  minWidth = null,
  size = 'md',
  ghost = false,
  ariaLabel = 'Options',
  icon = null,
  portal = false,
  id = null,
} = {}) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dropdown-trigger';
  if (size === 'sm') trigger.classList.add('dropdown-trigger-sm');
  if (ghost) trigger.classList.add('dropdown-trigger-ghost');
  if (id) trigger.id = id;

  if (icon) {
    const wrap = document.createElement('span');
    wrap.innerHTML = icon;
    const svg = wrap.querySelector('svg');
    if (svg) { svg.style.width = '15px'; svg.style.height = '15px'; }
    trigger.appendChild(wrap);
  }

  const valueEl = document.createElement('span');
  valueEl.className = 'dropdown-value';
  const current = items.find((i) => i.value === value);
  valueEl.textContent = current ? current.label : label;
  trigger.appendChild(valueEl);

  const caret = document.createElement('span');
  caret.innerHTML = CARET_ICON;
  trigger.appendChild(caret);

  const dd = new Dropdown({ trigger, items, value, onChange, align, minWidth, ariaLabel, portal });
  dd.setLabel = (text) => { valueEl.textContent = text; };
  return dd;
}

/* --------------------------------------------------------------------------
   Filter chips + popover panel helper (used by the toolbar filter button)
   -------------------------------------------------------------------------- */
export function createPanelDropdown({
  label = 'Filters',
  items = [],
  value = null,
  onChange = null,
  align = 'end',
  minWidth = '240px',
  ariaLabel = 'Filters',
  icon = null,
} = {}) {
  const trigger = document.createElement('button');
  trigger.type = 'button';
  trigger.className = 'dropdown-trigger dropdown-trigger-sm';
  if (icon) {
    const wrap = document.createElement('span');
    wrap.innerHTML = icon;
    const svg = wrap.querySelector('svg');
    if (svg) { svg.style.width = '15px'; svg.style.height = '15px'; }
    trigger.appendChild(wrap);
  }
  const valueEl = document.createElement('span');
  valueEl.className = 'dropdown-value';
  const current = items.find((i) => i.value === value);
  valueEl.textContent = current ? current.label : label;
  trigger.appendChild(valueEl);
  const caret = document.createElement('span');
  caret.innerHTML = CARET_ICON;
  trigger.appendChild(caret);

  const dd = new Dropdown({ trigger, items, value, onChange, align, minWidth, ariaLabel });
  dd.setLabel = (text) => { valueEl.textContent = text; };
  return dd;
}
