/* Still — app logic: dial, session engine, settings, stats. */
(function () {
  'use strict';

  const A = window.StillAudio;
  const $ = function (s, r) { return (r || document).querySelector(s); };
  const $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---------- Storage ---------- */

  const store = {
    get: function (k, fallback) {
      try {
        const v = localStorage.getItem('still.' + k);
        return v == null ? fallback : JSON.parse(v);
      } catch (e) { return fallback; }
    },
    set: function (k, v) {
      try { localStorage.setItem('still.' + k, JSON.stringify(v)); } catch (e) { /* storage unavailable */ }
    },
  };

  const DEFAULTS = {
    durationSec: 600,
    startBell: 'bowl',
    endBell: 'bowl',
    endStrikes: 3,
    intervalMin: 0,
    intervalBell: 'tingsha',
    bellVolume: 0.8,
    ambient: 'none',
    ambientVolume: 0.5,
    breath: 'off',
    breathSound: false,
    settle: 10,
    wakeLock: true,
    haptics: true,
    uiSounds: true,
    look: 'auto',
  };
  const settings = Object.assign({}, DEFAULTS, store.get('settings', {}));
  let sessions = store.get('sessions', []);
  if (!Array.isArray(sessions)) sessions = [];

  function saveSettings() { store.set('settings', settings); }
  function saveSessions() { store.set('sessions', sessions); }

  const BREATH = {
    off: { label: 'Off' },
    relax: { label: 'Calm 4·6', phases: [['in', 4], ['out', 6]] },
    coherent: { label: 'Coherent 5.5', phases: [['in', 5.5], ['out', 5.5]] },
    box: { label: 'Box 4·4·4·4', phases: [['in', 4], ['hold', 4], ['out', 4], ['hold', 4]] },
    '478': { label: '4·7·8', phases: [['in', 4], ['hold', 7], ['out', 8]] },
  };
  const BREATH_WORDS = { in: 'Breathe in', hold: 'Hold', out: 'Breathe out' };
  const MOODS = ['Calm', 'Clear', 'Grateful', 'Sleepy', 'Restless'];
  const PRESETS = [5, 10, 15, 20, 30, 60];
  const LOOKAHEAD = 90; // seconds of bells scheduled ahead on the audio clock

  function bellLabel(id) {
    if (id === 'none') return 'None';
    const b = A.bells.find(function (x) { return x.id === id; });
    return b ? b.label : id;
  }
  function ambientLabel(id) {
    if (id === 'none') return 'Silence';
    const a = A.ambience.find(function (x) { return x.id === id; });
    return a ? a.label : id;
  }

  /* ---------- Formatting ---------- */

  const pad = function (n) { return String(n).padStart(2, '0'); };
  function fmtClock(sec) {
    sec = Math.max(0, Math.ceil(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? h + ':' + pad(m) + ':' + pad(s) : m + ':' + pad(s);
  }
  function fmtLen(sec) {
    sec = Math.round(sec);
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    const parts = [];
    if (h) parts.push(h + ' hr');
    if (m) parts.push(m + (h || s ? ' min' : m === 1 ? ' minute' : ' minutes'));
    if (s) parts.push(s + (h || m ? ' sec' : ' seconds'));
    return parts.join(' ') || '0 minutes';
  }
  function fmtMin(min) { return min > 0 && min < 1 ? '<1' : String(Math.round(min)); }
  function dayKey(ts) {
    const d = new Date(ts);
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }

  /* ---------- Feedback ---------- */

  function ui(kind) { if (settings.uiSounds) A.ui(kind); }
  function buzz(pattern) {
    if (settings.haptics && navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) { /* ignore */ } }
  }
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 2600);
  }
  function ripple(btn, ev) {
    const r = btn.getBoundingClientRect();
    btn.style.setProperty('--rx', ((ev.clientX || r.left + r.width / 2) - r.left) + 'px');
    btn.style.setProperty('--ry', ((ev.clientY || r.top + r.height / 2) - r.top) + 'px');
    btn.classList.add('ripple');
    requestAnimationFrame(function () { requestAnimationFrame(function () { btn.classList.remove('ripple'); }); });
  }

  /* ---------- Look ---------- */

  function applyLook() {
    if (settings.look === 'auto') delete document.body.dataset.look;
    else document.body.dataset.look = settings.look;
    const meta = $('meta[name="theme-color"]');
    if (meta) {
      requestAnimationFrame(function () {
        meta.setAttribute('content', getComputedStyle(document.body).getPropertyValue('--bg').trim() || '#0e1320');
      });
    }
  }

  /* ---------- Screens ---------- */

  function show(id) {
    $$('.screen').forEach(function (s) { s.classList.toggle('is-active', s.id === 'screen-' + id); });
  }

  /* ---------- Stats ---------- */

  function stats() {
    const days = new Set(sessions.map(function (s) { return dayKey(s.ts); }));
    const today = dayKey(Date.now());
    let streak = 0;
    const d = new Date();
    if (!days.has(today)) d.setDate(d.getDate() - 1);
    while (days.has(dayKey(d.getTime()))) { streak++; d.setDate(d.getDate() - 1); }

    const sorted = Array.from(days).sort();
    let best = 0, run = 0, prev = null;
    sorted.forEach(function (k) {
      const t = new Date(k + 'T12:00:00').getTime();
      run = prev != null && Math.round((t - prev) / 86400000) === 1 ? run + 1 : 1;
      best = Math.max(best, run);
      prev = t;
    });

    const totalSec = sessions.reduce(function (a, s) { return a + s.sec; }, 0);
    const todaySec = sessions.filter(function (s) { return dayKey(s.ts) === today; })
      .reduce(function (a, s) { return a + s.sec; }, 0);
    return { streak: streak, best: best, totalSec: totalSec, todaySec: todaySec, count: sessions.length, sitToday: days.has(today) };
  }

  /* ---------- Home ---------- */

  function renderGreeting() {
    const h = new Date().getHours();
    const line = h < 5 ? 'A quiet <em>night</em>' : h < 12 ? 'Good <em>morning</em>' : h < 17 ? 'Good <em>afternoon</em>' : h < 22 ? 'Good <em>evening</em>' : 'A quiet <em>night</em>';
    $('#greeting').innerHTML = line;
    const st = stats();
    let sub = 'Take a moment for yourself.';
    if (st.streak && st.sitToday) sub = st.streak + '-day streak · ' + fmtMin(st.todaySec / 60) + ' min today';
    else if (st.streak) sub = 'Sit today to keep your ' + st.streak + '-day streak.';
    else if (st.count) sub = 'Welcome back. Begin again whenever you’re ready.';
    $('#greeting-sub').textContent = sub;
  }

  const ICONS = {
    bell: '<svg viewBox="0 0 24 24"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2 2 0 0 0 4 0"/></svg>',
    wave: '<svg viewBox="0 0 24 24"><path d="M3 12c2-3 4-3 6 0s4 3 6 0 4-3 6 0M3 17c2-3 4-3 6 0s4 3 6 0 4-3 6 0"/></svg>',
    breath: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="8.5" stroke-dasharray="2 3"/></svg>',
    repeat: '<svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 0 1 14-5.3M20 12a8 8 0 0 1-14 5.3M18 3v4h-4M6 21v-4h4"/></svg>',
  };

  function renderSummary() {
    const items = [
      [ICONS.bell, settings.startBell === 'none' && settings.endBell === 'none' ? 'No bells' : bellLabel(settings.startBell !== 'none' ? settings.startBell : settings.endBell)],
      [ICONS.wave, ambientLabel(settings.ambient)],
    ];
    if (settings.intervalMin) items.push([ICONS.repeat, 'Bell every ' + settings.intervalMin + ' min']);
    if (settings.breath !== 'off') items.push([ICONS.breath, BREATH[settings.breath].label]);
    const box = $('#summary');
    box.innerHTML = '';
    items.forEach(function (it) {
      const b = document.createElement('button');
      b.type = 'button';
      b.innerHTML = it[0] + '<span></span>';
      b.lastChild.textContent = it[1];
      b.addEventListener('click', function () { openSheet('settings'); });
      box.appendChild(b);
    });
  }

  function renderPresets() {
    const box = $('#presets');
    box.innerHTML = '';
    PRESETS.forEach(function (m) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.dataset.min = m;
      b.textContent = String(m);
      b.setAttribute('aria-label', m + ' minutes');
      b.addEventListener('click', function () {
        ui('tap');
        setDuration(m * 60, true);
      });
      box.appendChild(b);
    });
    syncPresets();
  }
  function syncPresets() {
    $$('#presets .chip').forEach(function (b) {
      b.setAttribute('aria-pressed', String(+b.dataset.min * 60 === settings.durationSec));
    });
  }

  /* ---------- Dial ---------- */

  const C = 2 * Math.PI * 124;
  let dialMinutes = settings.durationSec / 60; // float, drives the drawing
  let dialAnim = 0;

  function buildTicks() {
    const g = $('#dial-ticks');
    let html = '';
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const major = i % 5 === 0;
      const r1 = major ? 136 : 139, r2 = 144;
      const x1 = 150 + Math.sin(a) * r1, y1 = 150 - Math.cos(a) * r1;
      const x2 = 150 + Math.sin(a) * r2, y2 = 150 - Math.cos(a) * r2;
      html += '<line class="dial-tick' + (major ? ' major' : '') + '" x1="' + x1.toFixed(1) + '" y1="' + y1.toFixed(1) + '" x2="' + x2.toFixed(1) + '" y2="' + y2.toFixed(1) + '"/>';
      if (i % 15 === 0) {
        const rn = 156;
        html += '<text class="dial-num" x="' + (150 + Math.sin(a) * rn).toFixed(1) + '" y="' + (150 - Math.cos(a) * rn).toFixed(1) + '">' + (i || 60) + '</text>';
      }
    }
    g.innerHTML = html;
    const arc = $('#dial-arc');
    arc.style.strokeDasharray = C;
  }

  function drawDial(min) {
    let frac = (min % 60) / 60;
    if (min >= 60 && frac < 0.0001) frac = 1;
    $('#dial-arc').style.strokeDashoffset = C * (1 - frac);
    $('#dial-knob-g').style.transform = 'rotate(' + frac * 360 + 'deg)';
    $('#dial-laps').classList.toggle('on', min > 60);
  }

  function renderDuration() {
    const sec = settings.durationSec;
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    let value, unit;
    if (h) {
      value = s ? h + ':' + pad(m) + ':' + pad(s) : h + ':' + pad(m);
      unit = h === 1 && !m && !s ? 'hour' : 'hours';
    } else if (!m) {
      value = String(s);
      unit = 'seconds';
    } else if (s) {
      value = m + ':' + pad(s);
      unit = 'minutes';
    } else {
      value = String(m);
      unit = m === 1 ? 'minute' : 'minutes';
    }
    $('#dial-value').textContent = value;
    $('#dial-unit').textContent = unit;
    const dial = $('#dial');
    dial.setAttribute('aria-valuenow', String(Math.round(sec / 60)));
    dial.setAttribute('aria-valuetext', fmtLen(sec));
    syncPresets();
  }

  function setDuration(sec, animate) {
    sec = Math.max(10, Math.min(86399, Math.round(sec)));
    settings.durationSec = sec;
    saveSettings();
    renderDuration();
    const target = sec / 60;
    cancelAnimationFrame(dialAnim);
    if (!animate || reducedMotion()) { dialMinutes = target; drawDial(target); return; }
    const from = Math.abs(target - dialMinutes) > 60 ? target - Math.sign(target - dialMinutes) * 60 : dialMinutes;
    const t0 = performance.now(), dur = 650;
    const step = function (now) {
      const p = Math.min(1, (now - t0) / dur);
      const e = 1 - Math.pow(1 - p, 3);
      dialMinutes = from + (target - from) * e;
      drawDial(dialMinutes);
      if (p < 1) dialAnim = requestAnimationFrame(step);
    };
    dialAnim = requestAnimationFrame(step);
  }

  function reducedMotion() { return window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches; }

  function initDial() {
    const dial = $('#dial');
    let dragging = false, lastAngle = 0, acc = 0, lastWhole = 0;

    function angleOf(ev) {
      const r = dial.getBoundingClientRect();
      const x = ev.clientX - (r.left + r.width / 2), y = ev.clientY - (r.top + r.height / 2);
      return { a: (Math.atan2(x, -y) * 180) / Math.PI, d: Math.hypot(x, y) / (r.width / 2) };
    }

    dial.addEventListener('pointerdown', function (ev) {
      const p = angleOf(ev);
      if (p.d < 0.58) return; // centre is the "type a time" button
      A.init();
      dragging = true;
      dial.classList.add('dragging');
      dial.setPointerCapture(ev.pointerId);
      lastAngle = p.a;
      acc = Math.max(1, Math.round(settings.durationSec / 60));
      lastWhole = acc;
      cancelAnimationFrame(dialAnim);
      ev.preventDefault();
    });
    dial.addEventListener('pointermove', function (ev) {
      if (!dragging) return;
      const a = angleOf(ev).a;
      let diff = a - lastAngle;
      if (diff > 180) diff -= 360;
      if (diff < -180) diff += 360;
      lastAngle = a;
      acc = Math.max(1, Math.min(600, acc + diff / 6));
      dialMinutes = acc;
      drawDial(acc);
      const whole = Math.max(1, Math.round(acc));
      if (whole !== lastWhole) {
        lastWhole = whole;
        settings.durationSec = whole * 60;
        renderDuration();
        ui('tick');
        if (whole % 5 === 0) buzz(4);
      }
    });
    const end = function () {
      if (!dragging) return;
      dragging = false;
      dial.classList.remove('dragging');
      setDuration(lastWhole * 60, true);
    };
    dial.addEventListener('pointerup', end);
    dial.addEventListener('pointercancel', end);

    dial.addEventListener('wheel', function (ev) {
      ev.preventDefault();
      const m = Math.round(settings.durationSec / 60) + (ev.deltaY < 0 ? 1 : -1);
      ui('tick');
      setDuration(Math.max(1, Math.min(600, m)) * 60, true);
    }, { passive: false });

    dial.addEventListener('keydown', function (ev) {
      const steps = { ArrowUp: 1, ArrowRight: 1, ArrowDown: -1, ArrowLeft: -1, PageUp: 5, PageDown: -5 };
      if (!(ev.key in steps)) return;
      ev.preventDefault();
      const m = Math.round(settings.durationSec / 60) + steps[ev.key];
      ui('tick');
      setDuration(Math.max(1, Math.min(600, m)) * 60, true);
    });
  }

  /* ---------- Exact time ---------- */

  function openTime() {
    const sec = settings.durationSec;
    $('#t-h').value = Math.floor(sec / 3600);
    $('#t-m').value = Math.floor((sec % 3600) / 60);
    $('#t-s').value = sec % 60;
    openSheet('time');
    setTimeout(function () { $('#t-m').focus(); $('#t-m').select(); }, 350);
  }
  function submitTime(ev) {
    ev.preventDefault();
    const n = function (id, max) { return Math.max(0, Math.min(max, parseInt($(id).value, 10) || 0)); };
    const sec = n('#t-h', 23) * 3600 + n('#t-m', 59) * 60 + n('#t-s', 59);
    if (sec < 10) { toast('Choose at least 10 seconds'); return; }
    closeSheet('time');
    ui('confirm');
    setDuration(sec, true);
  }

  /* ---------- Sheets ---------- */

  let openSheetId = null;
  let lastFocus = null;
  let usingKeyboard = false;
  document.addEventListener('keydown', function (ev) { if (ev.key === 'Tab' || ev.key === 'Enter' || ev.key === ' ') usingKeyboard = true; }, true);
  document.addEventListener('pointerdown', function () { usingKeyboard = false; }, true);
  function openSheet(id) {
    if (openSheetId) closeSheet(openSheetId, true);
    const el = $('#sheet-' + id);
    if (id === 'settings') renderSettings();
    lastFocus = usingKeyboard ? document.activeElement : null;
    el.hidden = false;
    document.body.classList.add('sheet-open');
    requestAnimationFrame(function () { requestAnimationFrame(function () { el.classList.add('open'); }); });
    openSheetId = id;
    if (id === 'stats') renderStats();
    fitSoon();
    ui('open');
    const focusable = el.querySelector('.sheet-head [data-close]');
    if (focusable && usingKeyboard) setTimeout(function () { focusable.focus({ preventScroll: true }); }, 60);
  }
  function closeSheet(id, silent) {
    const el = $('#sheet-' + id);
    if (!el || el.hidden) return;
    el.classList.remove('open');
    setTimeout(function () { if (!el.classList.contains('open')) el.hidden = true; }, 550);
    if (openSheetId === id) openSheetId = null;
    if (!openSheetId) document.body.classList.remove('sheet-open');
    if (!silent) ui('close');
    if (id === 'settings' && S.phase !== 'running') A.stopAmbient(1.2);
    if (lastFocus && lastFocus.focus) lastFocus.focus({ preventScroll: true });
    else if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    lastFocus = null;
  }

  function initSheetDrag() {
    $$('.sheet').forEach(function (sheet) {
      const panel = $('.sheet-panel', sheet);
      const grab = $$('.sheet-handle, .sheet-head', sheet);
      if (!grab.length) return;
      let y0 = null, dy = 0;
      grab.forEach(function (g) {
        g.classList.add('sheet-grab');
        g.addEventListener('pointerdown', function (ev) {
          if (ev.target.closest('button')) return;
          y0 = ev.clientY; dy = 0;
          panel.classList.add('dragging');
          g.setPointerCapture(ev.pointerId);
        });
        g.addEventListener('pointermove', function (ev) {
          if (y0 == null) return;
          dy = Math.max(0, ev.clientY - y0);
          panel.style.transform = 'translateY(' + dy + 'px)';
        });
        const end = function () {
          if (y0 == null) return;
          y0 = null;
          panel.classList.remove('dragging');
          panel.style.transform = '';
          if (dy > 90) closeSheet(sheet.id.replace('sheet-', ''));
        };
        g.addEventListener('pointerup', end);
        g.addEventListener('pointercancel', end);
      });
    });
  }

  /* ---------- Settings ---------- */

  function afterPaint(fn) {
    requestAnimationFrame(function () { setTimeout(fn, 0); });
  }

  function chipGroup(opts, current, onPick) {
    const wrap = document.createElement('div');
    wrap.className = 'chips';
    opts.forEach(function (o) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = o.label;
      b.setAttribute('aria-pressed', String(String(o.id) === String(current)));
      b.addEventListener('click', function () {
        $$('.chip', wrap).forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', 'true');
        // let the new highlight paint before any sound work runs
        afterPaint(function () { onPick(o.id); });
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function field(label, hint, control) {
    const f = document.createElement('div');
    f.className = 'field';
    const l = document.createElement('div');
    l.className = 'field-label';
    l.textContent = label;
    if (hint) { const s = document.createElement('small'); s.textContent = hint; l.appendChild(s); }
    f.appendChild(l);
    f.appendChild(control);
    return f;
  }

  function toggleRow(label, hint, key, onChange) {
    const row = document.createElement('div');
    row.className = 'row';
    const t = document.createElement('div');
    t.className = 'row-text';
    t.textContent = label;
    if (hint) { const s = document.createElement('small'); s.textContent = hint; t.appendChild(s); }
    const sw = document.createElement('button');
    sw.type = 'button';
    sw.className = 'switch';
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-label', label);
    sw.setAttribute('aria-checked', String(!!settings[key]));
    sw.addEventListener('click', function () {
      settings[key] = !settings[key];
      sw.setAttribute('aria-checked', String(settings[key]));
      saveSettings();
      if (key === 'uiSounds' && settings.uiSounds) A.ui('toggle');
      else ui('toggle');
      if (onChange) onChange(settings[key]);
    });
    row.appendChild(t);
    row.appendChild(sw);
    return row;
  }

  function slider(id, key, onInput) {
    const r = document.createElement('input');
    r.type = 'range';
    r.id = id;
    r.min = 0; r.max = 100; r.step = 1;
    r.value = Math.round(settings[key] * 100);
    const paint = function () { r.style.setProperty('--fill', r.value + '%'); };
    paint();
    r.addEventListener('input', function () {
      settings[key] = r.value / 100;
      paint();
      onInput(settings[key]);
    });
    r.addEventListener('change', saveSettings);
    return r;
  }

  function group(title) {
    const g = document.createElement('section');
    g.className = 'group';
    if (title) {
      const h = document.createElement('h3');
      h.className = 'group-title';
      h.textContent = title;
      g.appendChild(h);
    }
    return g;
  }

  const SETTINGS_TABS = [['bells', 'Bells'], ['interval', 'Interval'], ['ambience', 'Ambience'], ['breath', 'Breath'], ['general', 'More']];
  let settingsTab = 'bells';

  function renderSettingsTabs() {
    const bar = $('#settings-tabs');
    bar.innerHTML = '';
    SETTINGS_TABS.forEach(function (t) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'tab';
      b.id = 'tab-' + t[0];
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(t[0] === settingsTab));
      b.textContent = t[1];
      b.addEventListener('click', function () {
        if (settingsTab === t[0]) return;
        settingsTab = t[0];
        ui('tap');
        renderSettings();
      });
      bar.appendChild(b);
    });
  }

  function renderSettings() {
    renderSettingsTabs();
    const body = $('#settings-body');
    body.innerHTML = '';
    body.setAttribute('aria-labelledby', 'tab-' + settingsTab);
    const tab = settingsTab;
    const bellOpts = A.bells.concat([{ id: 'none', label: 'None' }]);
    const pick = function (key, preview) {
      return function (v) {
        settings[key] = v;
        saveSettings();
        renderSummary();
        if (preview) preview(v);
      };
    };
    const previewBell = function (vol) { return function (v) { if (v !== 'none') A.strike(v, 0, vol); }; };

    if (tab === 'bells') {
      const g1 = group(null);
      g1.appendChild(field('Starting bell', null, chipGroup(bellOpts, settings.startBell, pick('startBell', previewBell(1)))));
      g1.appendChild(field('Ending bell', null, chipGroup(bellOpts, settings.endBell, pick('endBell', previewBell(1)))));
      g1.appendChild(field('Ending strikes', null, chipGroup([{ id: 1, label: 'Once' }, { id: 3, label: 'Three times' }], settings.endStrikes, pick('endStrikes'))));
      g1.appendChild(field('Bell volume', null, slider('bell-volume', 'bellVolume', A.setBellVolume)));
      body.appendChild(g1);
    }

    if (tab === 'interval') {
      const gi = group(null);
      const intervalOpts = [{ id: 0, label: 'Off' }].concat([1, 2, 3, 5, 10, 15, 20].map(function (m) { return { id: m, label: m + ' min' }; }));
      gi.appendChild(field('Ring every', 'a softer bell during the sit', chipGroup(intervalOpts, settings.intervalMin, pick('intervalMin'))));
      gi.appendChild(field('Interval sound', null, chipGroup(A.bells, settings.intervalBell, pick('intervalBell', previewBell(0.55)))));
      body.appendChild(gi);
    }

    if (tab === 'ambience') {
      const g2 = group(null);
      const ambOpts = [{ id: 'none', label: 'Silence' }].concat(A.ambience);
      g2.appendChild(field('Background sound', 'tap to preview', chipGroup(ambOpts, settings.ambient, pick('ambient', function (v) {
        if (v === 'none') A.stopAmbient(1);
        else A.startAmbient(v, 1.2);
      }))));
      g2.appendChild(field('Ambience volume', null, slider('ambient-volume', 'ambientVolume', A.setAmbientVolume)));
      body.appendChild(g2);
    }

    if (tab === 'breath') {
      const g3 = group(null);
      const breathOpts = Object.keys(BREATH).map(function (k) { return { id: k, label: BREATH[k].label }; });
      g3.appendChild(field('Pattern', 'the orb paces your breath', chipGroup(breathOpts, settings.breath, pick('breath'))));
      g3.appendChild(toggleRow('Breath tones', 'a faint hum on each inhale and exhale', 'breathSound'));
      const settleOpts = [0, 5, 10, 20, 30].map(function (s) { return { id: s, label: s ? s + ' sec' : 'None' }; });
      g3.appendChild(field('Settle-in time', 'before the first bell', chipGroup(settleOpts, settings.settle, pick('settle'))));
      body.appendChild(g3);
    }

    if (tab === 'general') {
      const g4 = group('Session');
      g4.appendChild(toggleRow('Keep screen awake', 'while a session runs', 'wakeLock'));
      if (navigator.vibrate) g4.appendChild(toggleRow('Vibrate with bells', null, 'haptics'));
      g4.appendChild(toggleRow('Interface sounds', 'soft ticks and taps', 'uiSounds'));
      body.appendChild(g4);

      // Appearance
      const g5 = group('Appearance');
      const lookOpts = [{ id: 'auto', label: 'Match device' }, { id: 'night', label: 'Night' }, { id: 'dawn', label: 'Dawn' }, { id: 'forest', label: 'Forest' }];
      g5.appendChild(field('Theme', null, chipGroup(lookOpts, settings.look, pick('look', applyLook))));
      body.appendChild(g5);

      // Data
      const g6 = group('Your data');
      const note = document.createElement('p');
      note.className = 'row-text';
      note.style.margin = '0';
      note.innerHTML = 'History stays on this device.<small>' + sessions.length + ' session' + (sessions.length === 1 ? '' : 's') + ' saved</small>';
      g6.appendChild(note);
      const clear = document.createElement('button');
      clear.type = 'button';
      clear.className = 'danger';
      clear.textContent = 'Clear history';
      let armed = false, armTimer;
      clear.addEventListener('click', function () {
        if (!armed) {
          armed = true;
          clear.textContent = 'Tap again to clear';
          ui('tap');
          armTimer = setTimeout(function () { armed = false; clear.textContent = 'Clear history'; }, 3000);
          return;
        }
        clearTimeout(armTimer);
        sessions = [];
        saveSessions();
        renderGreeting();
        renderSettings();
        toast('History cleared');
      });
      if (sessions.length) g6.appendChild(clear);
      body.appendChild(g6);
    }
    fitSoon();
  }

  /* ---------- Fit to screen ---------- */

  // Each screen and panel keeps its content in a .fit wrapper. When the content is taller than
  // the space available, the wrapper is scaled down so the app never needs to scroll.
  function fit(el) {
    const box = el.parentElement;
    const cs = getComputedStyle(box);
    const avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const need = el.offsetHeight;
    const scale = avail > 0 && need > avail + 0.5 ? Math.max(0.4, avail / need) : 1;
    el.style.transform = scale < 1 ? 'scale(' + scale.toFixed(4) + ')' : '';
  }

  // Before shrinking the stats panel, drop the oldest rows of the recent list that don't fit.
  function trimStats() {
    if (openSheetId !== 'stats') return;
    const body = $('#stats-body'), box = body.parentElement;
    const cs = getComputedStyle(box);
    const avail = box.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const rows = $$('.recent li', body);
    while (rows.length > 3 && body.offsetHeight > avail + 0.5) rows.pop().remove();
  }

  let fitQueued = false;
  function fitSoon() {
    if (fitQueued) return;
    fitQueued = true;
    requestAnimationFrame(function () {
      fitQueued = false;
      trimStats();
      $$('.fit').forEach(fit);
    });
  }

  function initFit() {
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(fitSoon);
      $$('.fit').forEach(function (el) { ro.observe(el); ro.observe(el.parentElement); });
    }
    window.addEventListener('resize', function () {
      if (openSheetId === 'stats') renderStats();
      fitSoon();
    });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(fitSoon);
    fitSoon();
  }

  /* ---------- Stats sheet ---------- */

  function renderStats() {
    const st = stats();
    const body = $('#stats-body');
    const totalMin = Math.round(st.totalSec / 60);
    const totalText = totalMin >= 120 ? (totalMin / 60).toFixed(1) + '<small>hr</small>' : totalMin + '<small>min</small>';

    // last 7 days
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = dayKey(d.getTime());
      const sec = sessions.filter(function (s) { return dayKey(s.ts) === k; }).reduce(function (a, s) { return a + s.sec; }, 0);
      days.push({ label: d.toLocaleDateString(undefined, { weekday: 'narrow' }), full: d.toLocaleDateString(undefined, { weekday: 'long' }), min: sec / 60, today: i === 0 });
    }
    const weekMin = days.reduce(function (a, d) { return a + d.min; }, 0);
    const max = Math.max(10, Math.max.apply(null, days.map(function (d) { return d.min; })));

    let html = '<div class="tiles">' +
      '<div class="tile"><div class="tile-num">' + st.streak + '<small>' + (st.streak === 1 ? 'day' : 'days') + '</small></div><div class="tile-label">Current streak</div></div>' +
      '<div class="tile"><div class="tile-num">' + st.best + '<small>' + (st.best === 1 ? 'day' : 'days') + '</small></div><div class="tile-label">Longest streak</div></div>' +
      '<div class="tile"><div class="tile-num">' + totalText + '</div><div class="tile-label">Mindful time</div></div>' +
      '<div class="tile"><div class="tile-num">' + st.count + '</div><div class="tile-label">Sessions</div></div>' +
      '</div>';

    html += '<div class="stats-chart"><div class="chart-head"><h3>Last 7 days</h3><span>' + Math.round(weekMin) + ' min total</span></div>';
    html += '<div class="week" role="img" aria-label="Minutes meditated over the last seven days">';
    days.forEach(function (d, i) {
      const h = d.min ? Math.max(4, (d.min / max) * 82) : 0;
      html += '<div class="bar-col' + (d.today ? ' today' : '') + '" title="' + d.full + ': ' + fmtMin(d.min) + ' min">' +
        '<span class="bar-val">' + fmtMin(d.min) + '</span>' +
        '<div class="bar' + (d.min ? '' : ' zero') + '" style="height:' + h + '%;animation-delay:' + i * 60 + 'ms"></div></div>';
    });
    html += '</div><div class="week-labels">';
    days.forEach(function (d) { html += '<span class="' + (d.today ? 'today' : '') + '">' + d.label + '</span>'; });
    html += '</div></div>';

    html += '<div class="recent"><h3>Recent sessions</h3>';
    if (!sessions.length) {
      html += '<p class="empty">Your sessions will appear here after your first sit.</p>';
    } else {
      html += '<ul>';
      sessions.slice().sort(function (a, b) { return b.ts - a.ts; }).slice(0, 12).forEach(function (s) {
        const d = new Date(s.ts);
        const when = d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
        html += '<li><div class="r-main"><div class="r-date">' + when + (s.mood ? ' · <span class="r-mood">' + esc(s.mood) + '</span>' : '') + '</div>' +
          (s.note ? '<div class="r-note">' + esc(s.note) + '</div>' : '') +
          '</div><div class="r-dur">' + fmtClock(s.sec) + '</div></li>';
      });
      html += '</ul>';
    }
    html += '</div>';
    body.innerHTML = html;
    fitSoon();
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; });
  }

  /* ---------- Session engine ---------- */

  const S = {
    phase: 'idle', // idle | running | done
    settle: 0,
    dur: 0,
    total: 0,
    elapsed: 0,
    runStart: 0,
    paused: false,
    events: [],
    pump: 0,
    raf: 0,
    startedAt: 0,
    breathIdx: -1,
    sat: false,
  };

  function elapsedNow() {
    return S.paused ? S.elapsed : S.elapsed + (performance.now() - S.runStart) / 1000;
  }

  function buildEvents() {
    const ev = [];
    if (settings.startBell !== 'none') ev.push({ t: S.settle, kind: 'start', bell: settings.startBell, vol: 1 });
    else ev.push({ t: S.settle, kind: 'start', bell: null });
    if (settings.intervalMin) {
      const step = settings.intervalMin * 60;
      for (let k = 1; k * step < S.dur - 5; k++) {
        ev.push({ t: S.settle + k * step, kind: 'interval', bell: settings.intervalBell, vol: 0.55 });
      }
    }
    if (settings.endBell !== 'none') {
      for (let i = 0; i < settings.endStrikes; i++) {
        ev.push({ t: S.total + i * 4.5, kind: 'end', bell: settings.endBell, vol: 1 - i * 0.18 });
      }
    }
    return ev;
  }

  function buildMarks() {
    const g = $('#progress-marks');
    let html = '';
    S.events.forEach(function (e, i) {
      if (e.kind !== 'interval') return;
      const f = (e.t - S.settle) / S.dur;
      const a = f * Math.PI * 2;
      html += '<circle class="progress-mark" data-i="' + i + '" cx="' + (150 + Math.sin(a) * 140).toFixed(1) + '" cy="' + (150 - Math.cos(a) * 140).toFixed(1) + '" r="3"/>';
    });
    g.innerHTML = html;
  }

  function begin() {
    A.init();
    A.setBellVolume(settings.bellVolume);
    A.setAmbientVolume(settings.ambientVolume);
    S.settle = settings.settle;
    S.dur = settings.durationSec;
    S.total = S.settle + S.dur;
    S.elapsed = 0;
    S.runStart = performance.now();
    S.paused = false;
    S.phase = 'running';
    S.startedAt = Date.now();
    S.breathIdx = -1;
    S.sat = false;
    S.events = buildEvents();
    buildMarks();

    const arc = $('#progress-arc');
    arc.style.strokeDasharray = 2 * Math.PI * 140;
    arc.style.strokeDashoffset = 2 * Math.PI * 140;

    if (settings.settle) ui('begin');
    if (settings.ambient !== 'none') A.startAmbient(settings.ambient, Math.max(3, settings.settle));
    else A.stopAmbient(1);

    const orb = $('#orb');
    orb.classList.toggle('idle', settings.breath === 'off');
    orb.style.transform = '';
    $('#orb-ring').style.transform = '';
    $('#breath-label').classList.remove('show');
    $('#btn-pause').classList.remove('paused');
    $('#btn-pause').setAttribute('aria-label', 'Pause');
    resetEndButton();

    document.body.classList.add('in-session');
    document.body.classList.remove('paused');
    show('session');
    requestWake();
    armImmersive();

    pump();
    S.pump = setInterval(pump, 400);
    cancelAnimationFrame(S.raf);
    S.raf = requestAnimationFrame(frame);
  }

  function pump() {
    if (S.phase !== 'running') return;
    const e = elapsedNow();
    S.events.forEach(function (ev) {
      if (!S.paused && !ev.scheduled && ev.bell) {
        const dt = ev.t - e;
        if (dt <= LOOKAHEAD) {
          ev.scheduled = true;
          // bells missed by more than a couple of seconds (e.g. a frozen tab) are skipped
          if (dt > -2) ev.handle = A.strike(ev.bell, Math.max(0, dt), ev.vol);
        }
      }
      if (!ev.fired && e >= ev.t) {
        ev.fired = true;
        onEvent(ev);
      }
    });
    if (e >= S.total) finish(true);
  }

  function onEvent(ev) {
    if (ev.kind === 'start') {
      S.sat = true;
      bloom();
      buzz([30]);
    } else if (ev.kind === 'interval') {
      bloom();
      buzz([20]);
      const mark = $('#progress-marks [data-i="' + S.events.indexOf(ev) + '"]');
      if (mark) mark.classList.add('passed');
    }
  }

  function bloom() {
    const orb = $('#orb');
    orb.classList.remove('bloom');
    void orb.offsetWidth;
    orb.classList.add('bloom');
  }

  function frame() {
    if (S.phase !== 'running') return;
    const e = elapsedNow();
    const sitE = Math.max(0, e - S.settle);
    const remaining = S.dur - sitE;

    $('#session-time').textContent = fmtClock(remaining);
    const C2 = 2 * Math.PI * 140;
    $('#progress-arc').style.strokeDashoffset = C2 * (1 - Math.min(1, sitE / S.dur));

    let sub;
    if (S.paused) sub = 'Paused';
    else if (e < S.settle) sub = 'Settle in · ' + Math.ceil(S.settle - e);
    else if (settings.intervalMin) {
      const next = S.events.find(function (ev) { return ev.kind === 'interval' && ev.t > e; });
      sub = next ? 'Next bell in ' + fmtClock(next.t - e) : 'Final stretch';
    } else sub = settings.breath === 'off' ? 'Breathe naturally' : BREATH[settings.breath].label;
    const subEl = $('#session-sub');
    if (subEl.textContent !== sub) subEl.textContent = sub;

    drawBreath(e);
    S.raf = requestAnimationFrame(frame);
  }

  const easeInOut = function (x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };

  function drawBreath(e) {
    const pat = BREATH[settings.breath];
    const label = $('#breath-label');
    if (!pat.phases) { label.classList.remove('show'); return; }
    const cycle = pat.phases.reduce(function (a, p) { return a + p[1]; }, 0);
    let t = e % cycle, idx = 0;
    while (idx < pat.phases.length - 1 && t >= pat.phases[idx][1]) { t -= pat.phases[idx][1]; idx++; }
    const ph = pat.phases[idx];
    const p = easeInOut(t / ph[1]);
    const lo = 0.66, hi = 1.3;
    let scale;
    if (ph[0] === 'in') scale = lo + (hi - lo) * p;
    else if (ph[0] === 'out') scale = hi - (hi - lo) * p;
    else scale = pat.phases[idx - 1] && pat.phases[idx - 1][0] === 'in' ? hi : lo;
    $('#orb').style.transform = 'scale(' + scale.toFixed(4) + ')';
    $('#orb-ring').style.transform = 'scale(' + (1 + (scale - lo) * 0.55).toFixed(4) + ')';

    if (idx !== S.breathIdx) {
      S.breathIdx = idx;
      if (!S.paused) {
        label.classList.remove('show');
        setTimeout(function () {
          label.textContent = BREATH_WORDS[ph[0]];
          label.classList.add('show');
        }, 180);
        if (settings.breathSound && !document.hidden) A.breathCue(ph[0], ph[1]);
      }
    }
  }

  function togglePause() {
    if (S.phase !== 'running') return;
    const btn = $('#btn-pause');
    if (!S.paused) {
      S.elapsed = elapsedNow();
      S.paused = true;
      S.events.forEach(function (ev) {
        if (ev.handle && ev.t > S.elapsed) { ev.handle.cancel(); ev.handle = null; ev.scheduled = false; }
        else if (!ev.handle && ev.t > S.elapsed) ev.scheduled = false;
      });
      A.duckAmbient(0.2);
      ui('pause');
      btn.classList.add('paused');
      btn.setAttribute('aria-label', 'Resume');
      document.body.classList.add('paused');
      disarmImmersive();
    } else {
      S.paused = false;
      S.runStart = performance.now();
      A.duckAmbient(1);
      ui('resume');
      btn.classList.remove('paused');
      btn.setAttribute('aria-label', 'Pause');
      document.body.classList.remove('paused');
      S.breathIdx = -1;
      pump();
      armImmersive();
    }
  }

  let endArmed = false, endTimer;
  function resetEndButton() {
    endArmed = false;
    clearTimeout(endTimer);
    const b = $('#btn-end');
    b.textContent = 'End session';
    b.classList.remove('confirming');
  }
  function requestEnd() {
    if (S.phase !== 'running') return;
    const b = $('#btn-end');
    if (!endArmed) {
      endArmed = true;
      b.textContent = 'Tap again to end';
      b.classList.add('confirming');
      ui('tap');
      endTimer = setTimeout(resetEndButton, 3000);
      armImmersive();
      return;
    }
    resetEndButton();
    finish(false);
  }

  function stopEngine() {
    clearInterval(S.pump);
    cancelAnimationFrame(S.raf);
    S.phase = 'done';
    releaseWake();
    disarmImmersive();
    document.body.classList.remove('in-session', 'paused');
  }

  let lastRecord = null;
  function finish(completed) {
    const e = elapsedNow();
    const sat = completed ? S.dur : Math.max(0, Math.min(S.dur, e - S.settle));
    if (!completed) {
      S.events.forEach(function (ev) { if (ev.handle && ev.t > e) ev.handle.cancel(); });
      if (settings.endBell !== 'none') A.strike(settings.endBell, 0, 0.7);
    }
    stopEngine();
    A.stopAmbient(completed ? 9 : 4);
    if (completed) {
      $('#session-time').textContent = fmtClock(0);
      $('#progress-arc').style.strokeDashoffset = 0;
      $('#session-sub').textContent = 'Complete';
      $('#breath-label').classList.remove('show');
    }

    if (!completed && sat < 30) {
      S.phase = 'idle';
      show('home');
      renderGreeting();
      toast('Session ended');
      return;
    }

    lastRecord = { ts: Date.now(), sec: Math.round(sat), planned: S.dur, mood: null, note: '' };
    sessions.push(lastRecord);
    if (sessions.length > 2000) sessions = sessions.slice(-2000);
    saveSessions();

    const st = stats();
    const milestones = { 1: 'Your first sit', 10: 'Ten sessions', 25: '25 sessions', 50: '50 sessions', 100: '100 sessions', 250: '250 sessions', 500: '500 sessions' };
    $('#complete-title').textContent = completed ? (milestones[st.count] || 'Well done') : 'Nicely done';
    $('#complete-summary').textContent = completed
      ? 'You sat for ' + fmtLen(sat) + '.'
      : 'You sat for ' + fmtLen(sat) + ' of ' + fmtLen(S.dur) + '.';
    $('#cs-streak').textContent = st.streak;
    $('#cs-today').textContent = fmtMin(st.todaySec / 60);
    $('#cs-total').textContent = st.count;
    $('#note-input').value = '';
    $$('#mood-options .chip').forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });

    setTimeout(function () { show('complete'); }, completed ? 1400 : 500);
  }

  function done() {
    if (lastRecord) {
      lastRecord.note = $('#note-input').value.trim();
      saveSessions();
      lastRecord = null;
    }
    S.phase = 'idle';
    ui('close');
    renderGreeting();
    show('home');
  }

  function renderMoods() {
    const box = $('#mood-options');
    MOODS.forEach(function (m) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'chip';
      b.textContent = m;
      b.setAttribute('aria-pressed', 'false');
      b.addEventListener('click', function () {
        const on = b.getAttribute('aria-pressed') !== 'true';
        $$('.chip', box).forEach(function (c) { c.setAttribute('aria-pressed', 'false'); });
        b.setAttribute('aria-pressed', String(on));
        if (lastRecord) { lastRecord.mood = on ? m : null; saveSessions(); }
        ui('tap');
      });
      box.appendChild(b);
    });
  }

  /* ---------- Immersive mode: controls fade while you sit ---------- */

  let immTimer;
  function armImmersive() {
    document.body.classList.remove('immersive');
    clearTimeout(immTimer);
    if (S.phase === 'running' && !S.paused) {
      immTimer = setTimeout(function () { document.body.classList.add('immersive'); }, 4500);
    }
  }
  function disarmImmersive() {
    clearTimeout(immTimer);
    document.body.classList.remove('immersive');
  }

  /* ---------- Wake lock ---------- */

  let wake = null;
  function requestWake() {
    if (!settings.wakeLock || !('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (w) { wake = w; }).catch(function () { /* not granted */ });
  }
  function releaseWake() {
    if (wake) { wake.release().catch(function () {}); wake = null; }
  }

  /* ---------- Floating motes ---------- */

  function initMotes() {
    const cv = $('#motes');
    const g = cv.getContext('2d');
    if (!g) return;
    let w, h, dpr, motes = [];
    function size() {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = cv.clientWidth; h = cv.clientHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      const n = Math.round(Math.min(46, (w * h) / 22000));
      motes = [];
      for (let i = 0; i < n; i++) motes.push(spawn(true));
    }
    function spawn(anywhere) {
      return {
        x: Math.random() * w,
        y: anywhere ? Math.random() * h : h + 10,
        r: 0.6 + Math.random() * 1.8,
        vy: 4 + Math.random() * 10,
        sway: Math.random() * Math.PI * 2,
        a: 0.15 + Math.random() * 0.45,
      };
    }
    let color = '240,210,170', last = performance.now(), frameN = 0;
    function loop(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      // hold still under an open panel: its background blur would otherwise redraw every frame
      if (document.body.classList.contains('sheet-open')) { requestAnimationFrame(loop); return; }
      if (frameN++ % 60 === 0) color = getComputedStyle(document.body).getPropertyValue('--mote').trim() || color;
      g.clearRect(0, 0, w, h);
      const slow = document.body.classList.contains('in-session') ? 0.5 : 1;
      motes.forEach(function (m, i) {
        m.y -= m.vy * dt * slow;
        m.sway += dt * 0.4;
        const x = m.x + Math.sin(m.sway) * 12;
        if (m.y < -10) motes[i] = spawn(false);
        const fade = Math.min(1, m.y / (h * 0.25));
        g.beginPath();
        g.fillStyle = 'rgba(' + color + ',' + (m.a * fade).toFixed(3) + ')';
        g.arc(x, m.y, m.r, 0, Math.PI * 2);
        g.fill();
      });
      requestAnimationFrame(loop);
    }
    size();
    window.addEventListener('resize', size);
    if (!reducedMotion()) requestAnimationFrame(loop);
  }

  /* ---------- Wiring ---------- */

  function init() {
    A.setBellVolume(settings.bellVolume);
    A.setAmbientVolume(settings.ambientVolume);
    applyLook();
    buildTicks();
    dialMinutes = settings.durationSec / 60;
    drawDial(dialMinutes);
    renderDuration();
    renderPresets();
    renderSummary();
    renderGreeting();
    renderMoods();
    initDial();
    initSheetDrag();
    initFit();
    initMotes();

    $('#btn-time').addEventListener('click', function () { A.init(); ui('tap'); openTime(); });
    $('#time-form').addEventListener('submit', submitTime);
    $('#btn-begin').addEventListener('click', function (ev) { ripple(ev.currentTarget, ev); begin(); });
    $('#btn-pause').addEventListener('click', togglePause);
    $('#btn-end').addEventListener('click', requestEnd);
    $('#btn-done').addEventListener('click', function (ev) { ripple(ev.currentTarget, ev); done(); });
    $('#btn-settings').addEventListener('click', function () { A.init(); openSheet('settings'); });
    $('#btn-stats').addEventListener('click', function () { A.init(); openSheet('stats'); });
    $$('[data-close]').forEach(function (el) {
      el.addEventListener('click', function () { closeSheet(el.closest('.sheet').id.replace('sheet-', '')); });
    });

    // tap anywhere during a session to bring the controls back
    ['pointerdown', 'pointermove', 'keydown'].forEach(function (t) {
      document.addEventListener(t, function () { if (S.phase === 'running' && !S.paused) armImmersive(); }, { passive: true });
    });

    document.addEventListener('keydown', function (ev) {
      if (ev.key === 'Escape' && openSheetId) { closeSheet(openSheetId); return; }
      if (openSheetId || ev.target.matches('input, textarea')) return;
      if (ev.key === ' ' || ev.code === 'Space') {
        if (ev.target.closest && ev.target.closest('button, [role="slider"]')) return;
        ev.preventDefault();
        if (S.phase === 'running') togglePause();
        else if ($('#screen-home').classList.contains('is-active')) begin();
      }
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && S.phase === 'running') {
        pump();
        if (!wake) requestWake();
      }
    });

    window.addEventListener('pagehide', function () {
      if (lastRecord) { lastRecord.note = $('#note-input').value.trim(); saveSessions(); }
    });

    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js').catch(function () { /* offline support unavailable */ });
      });
    }
  }

  init();
})();
