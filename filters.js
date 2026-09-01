// filters.js — FSD-X shared multi-select filter
//
// One checkbox-dropdown component used by every filter bar on the site, so the
// dashboard, journal and backtest all behave the same way.
//
//   const f = FSDXFilter.create({
//     mount: '#my-slot',            // element or selector to render into
//     label: 'Accounts',            // shown when nothing is narrowed down
//     options: [{ value, label, hint }],
//     selected: ['Apex Funded #1'], // optional starting selection
//     storageKey: 'fsdx_dash_accounts',  // optional; remembers the choice
//     onChange: values => { ... }   // values = [] means "all"
//   });
//   f.setOptions([...]);   // repopulate (keeps any still-valid selection)
//   f.getSelected();       // [] = all
//
// Pass mode:'single' for a one-of-many picker (date ranges, timezones). It
// looks identical — same button, same panel — but shows radio dots, picks one
// option, closes on choose, and exposes getValue()/setValue() so it can stand
// in for a native <select>.
//
// Selection semantics: an EMPTY array means "everything". Checking every box
// normalizes back to empty, so "all boxes ticked" and "no boxes ticked" are the
// same state and the button always reads "All <label>" in that case. Callers
// only ever have to handle "empty = no filtering".

(function () {
  'use strict';

  var openPanel = null;   // only one dropdown open at a time
  var seq = 0;

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function readStore(key) {
    if (!key) return null;
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return null;
      var v = JSON.parse(raw);
      return Array.isArray(v) ? v : null;
    } catch (e) { return null; }
  }

  function writeStore(key, values) {
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify(values)); } catch (e) {}
  }

  function create(cfg) {
    var host = typeof cfg.mount === 'string' ? document.querySelector(cfg.mount) : cfg.mount;
    if (!host) {
      // Same failure shape as the blank-sidebar bug: a missing mount used to
      // return null in silence, so the control simply never appeared and every
      // caller's `if (!filter)` guard quietly did nothing. Callers still get
      // null — say so, so a renamed id or a page script moved into <head>
      // shows up in the console instead of as a missing dropdown.
      console.warn('[filters] mount not found, filter not created:', cfg.mount);
      return null;
    }

    var id = 'fsdxf-' + (++seq);
    var label = cfg.label || 'All';
    var options = (cfg.options || []).slice();
    var selected = new Set(readStore(cfg.storageKey) || cfg.selected || []);
    var onChange = typeof cfg.onChange === 'function' ? cfg.onChange : function () {};
    var align = cfg.align === 'right' ? 'right' : 'left';
    var single = cfg.mode === 'single';
    if (single) {
      // A single picker always has exactly one value.
      var start = cfg.value != null ? cfg.value
                : (readStore(cfg.storageKey) || [])[0];
      if (start == null && options.length) start = options[0].value;
      selected = new Set(start == null ? [] : [start]);
    }

    host.innerHTML =
      '<div class="relative inline-block" id="' + id + '">' +
        '<button type="button" data-role="btn" aria-haspopup="true" aria-expanded="false" ' +
          'class="flex items-center gap-1.5 bg-zinc-900 border border-white/10 hover:border-white/20 ' +
          'text-zinc-400 hover:text-zinc-200 text-xs px-3 py-1.5 rounded-lg transition focus:outline-none ' +
          'focus:border-green-500/50 whitespace-nowrap">' +
          '<span data-role="text">' + esc(label) + '</span>' +
          '<svg data-role="chev" class="w-3 h-3 shrink-0 transition-transform" fill="none" stroke="currentColor" ' +
            'stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" ' +
            'd="M19.5 8.25l-7.5 7.5-7.5-7.5"/></svg>' +
        '</button>' +
        '<div data-role="panel" class="hidden absolute z-50 mt-1 min-w-[190px] max-w-[280px] ' +
          'bg-zinc-950 border border-white/10 rounded-xl shadow-2xl shadow-black/60 overflow-hidden ' +
          (align === 'right' ? 'right-0' : 'left-0') + '">' +
          '<div data-role="all" class="' + (single ? 'hidden' : 'px-3 py-2 border-b border-white/5 cursor-pointer hover:bg-white/5 transition') + '"></div>' +
          '<div data-role="list" class="max-h-64 overflow-y-auto py-1"></div>' +
        '</div>' +
      '</div>';

    var root = host.querySelector('#' + id);
    var btn = root.querySelector('[data-role=btn]');
    var chev = root.querySelector('[data-role=chev]');
    var text = root.querySelector('[data-role=text]');
    var panel = root.querySelector('[data-role=panel]');
    var allRow = root.querySelector('[data-role=all]');
    var list = root.querySelector('[data-role=list]');

    function normalize() {
      if (single) return;
      // Every option ticked is the same as none ticked: "all".
      if (options.length && selected.size === options.length) selected.clear();
    }

    function values() { return Array.from(selected); }

    function row(checked, labelHtml, hintHtml) {
      var box = single
        ? '<span class="w-3.5 h-3.5 shrink-0 rounded-full border flex items-center justify-center transition ' +
            (checked ? 'border-green-500' : 'border-white/20') + '">' +
            (checked ? '<span class="w-1.5 h-1.5 rounded-full bg-green-500"></span>' : '') + '</span>'
        : '<span class="w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center transition ' +
            (checked ? 'bg-green-500 border-green-500' : 'border-white/20') + '">' +
            (checked ? '<svg class="w-2.5 h-2.5 text-black" fill="none" stroke="currentColor" stroke-width="3.5" ' +
              'viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M4.5 12.75l6 6 9-13.5"/></svg>' : '') +
          '</span>';
      return box +
        '<span class="min-w-0 flex-1 truncate">' + labelHtml + '</span>' +
        (hintHtml ? '<span class="shrink-0 text-[10px] text-zinc-600">' + hintHtml + '</span>' : '');
    }

    function paint() {
      normalize();

      // Button label
      if (single) {
        var pick = options.find(function (o) { return selected.has(o.value); });
        text.textContent = pick ? pick.label : (label || '');
        // Highlight only when it differs from the default (first) option.
        var isDefault = !pick || (options.length && options[0].value === pick.value);
        btn.classList.toggle('text-green-400', !isDefault);
        btn.classList.toggle('border-green-500/30', !isDefault);
        btn.classList.toggle('text-zinc-400', isDefault);
      } else if (!selected.size) {
        text.textContent = 'All ' + label;
        btn.classList.remove('text-green-400', 'border-green-500/30');
        btn.classList.add('text-zinc-400');
      } else if (selected.size === 1) {
        var only = options.find(function (o) { return selected.has(o.value); });
        text.textContent = only ? only.label : '1 selected';
        btn.classList.add('text-green-400', 'border-green-500/30');
        btn.classList.remove('text-zinc-400');
      } else {
        text.textContent = selected.size + ' selected';
        btn.classList.add('text-green-400', 'border-green-500/30');
        btn.classList.remove('text-zinc-400');
      }

      // "All" row — ticked when nothing is narrowed down. Single pickers
      // don't have one; paint() must not resurrect it.
      if (single) {
        allRow.className = 'hidden';
      } else {
        allRow.className = 'px-3 py-2 border-b border-white/5 cursor-pointer hover:bg-white/5 transition ' +
          'flex items-center gap-2 text-xs ' + (selected.size ? 'text-zinc-400' : 'text-white font-bold');
        allRow.innerHTML = row(!selected.size, 'All ' + esc(label), '');
      }

      if (!options.length) {
        list.innerHTML = '<div class="px-3 py-3 text-xs text-zinc-600">Nothing to filter yet.</div>';
        return;
      }
      list.innerHTML = options.map(function (o) {
        var on = selected.has(o.value);
        return '<div data-val="' + esc(o.value) + '" class="px-3 py-2 cursor-pointer hover:bg-white/5 transition ' +
          'flex items-center gap-2 text-xs ' + (on ? 'text-white' : 'text-zinc-400') + '">' +
          row(on, esc(o.label), o.hint ? esc(o.hint) : '') + '</div>';
      }).join('');
    }

    function commit() {
      normalize();
      writeStore(cfg.storageKey, values());
      paint();
      onChange(values());
    }

    function open() {
      if (openPanel && openPanel !== close) openPanel();
      panel.classList.remove('hidden');
      chev.style.transform = 'rotate(180deg)';
      btn.setAttribute('aria-expanded', 'true');
      // Keep the panel on screen on narrow viewports.
      panel.classList.remove('right-0', 'left-0');
      panel.classList.add(align === 'right' ? 'right-0' : 'left-0');
      var box = panel.getBoundingClientRect();
      if (box.right > window.innerWidth - 8) {
        panel.classList.remove('left-0');
        panel.classList.add('right-0');
      }
      openPanel = close;
    }

    function close() {
      panel.classList.add('hidden');
      chev.style.transform = '';
      btn.setAttribute('aria-expanded', 'false');
      if (openPanel === close) openPanel = null;
    }

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      if (panel.classList.contains('hidden')) open(); else close();
    });

    allRow.addEventListener('click', function (e) {
      e.stopPropagation();
      selected.clear();
      commit();
    });

    list.addEventListener('click', function (e) {
      e.stopPropagation();
      var target = e.target.closest('[data-val]');
      if (!target) return;
      var v = target.getAttribute('data-val');
      if (single) {
        // One value at a time, and the panel closes on choose.
        if (selected.has(v)) { close(); return; }
        selected = new Set([v]);
        commit();
        close();
        return;
      }
      if (selected.has(v)) selected.delete(v);
      else selected.add(v);
      commit();
    });

    panel.addEventListener('click', function (e) { e.stopPropagation(); });

    document.addEventListener('click', close);
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') close(); });

    paint();

    return {
      el: root,
      getSelected: values,
      isAll: function () { return selected.size === 0; },
      // True when `value` passes the filter — the check every caller needs.
      matches: function (value) { return selected.size === 0 || selected.has(value); },
      setSelected: function (vals) { selected = new Set(vals || []); commit(); },
      // <select>-style accessors for single mode.
      getValue: function () { return values()[0] != null ? values()[0] : ''; },
      setValue: function (v, opts) {
        selected = new Set(v == null || v === '' ? [] : [v]);
        normalize();
        writeStore(cfg.storageKey, values());
        paint();
        if (!opts || opts.silent !== true) onChange(values());
      },
      setOptions: function (next, opts) {
        options = (next || []).slice();
        // Drop selections that no longer exist (e.g. a deleted account).
        var valid = new Set(options.map(function (o) { return o.value; }));
        Array.from(selected).forEach(function (v) { if (!valid.has(v)) selected.delete(v); });
        normalize();
        writeStore(cfg.storageKey, values());
        paint();
        if (!opts || opts.silent !== true) onChange(values());
      },
      destroy: function () { document.removeEventListener('click', close); host.innerHTML = ''; }
    };
  }

  window.FSDXFilter = { create: create };
})();
