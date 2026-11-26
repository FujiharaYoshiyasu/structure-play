// 画面の操作。DNCL.run が返す手順の記録を、前後に動かして表示する
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (v) => DNCL.fmtVal(v);

  const KEY_CODE = 'progsim.code';
  const KEY_SCALE = 'progsim.scale';
  const KEY_SPEED = 'progsim.speed';
  const SPEEDS = [2400, 1800, 1300, 1000, 750, 550, 400, 260, 150, 80];
  const TRACE_MAX_ROWS = 2000;

  const store = {
    get(k) {
      try { return localStorage.getItem(k); } catch (e) { return null; }
    },
    set(k, v) {
      try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動かす */ }
    },
  };

  const el = {};
  [
    'sample', 'fontDown', 'fontUp', 'share', 'helpBtn', 'helpDlg', 'modeBadge',
    'editor', 'gutter', 'hlLayer', 'src', 'viewer', 'lines', 'hlBar', 'parseError', 'editHint',
    'explain', 'scalars', 'arrays', 'traceWrap', 'output',
    'editControls', 'runControls', 'runBtn', 'editBtn', 'firstBtn', 'prevBtn', 'playBtn', 'nextBtn', 'lastBtn',
    'scrub', 'counter', 'speed', 'toast',
  ].forEach((id) => { el[id] = $(id); });

  const state = {
    mode: 'edit',
    steps: [],
    cur: 0,
    timer: null,
    scale: 1,
    pointers: new Map(),
    traceSteps: [],
    lineEls: [],
    traceRowEls: [],
    errorLine: -1,
  };

  // ---------- 共有リンク ----------

  function encodeCode(s) {
    let bin = '';
    new TextEncoder().encode(s).forEach((b) => { bin += String.fromCharCode(b); });
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function decodeCode(t) {
    t = t.replace(/-/g, '+').replace(/_/g, '/');
    while (t.length % 4) t += '=';
    return new TextDecoder().decode(Uint8Array.from(atob(t), (c) => c.charCodeAt(0)));
  }

  function codeFromHash() {
    const m = /^#code=(.+)$/.exec(location.hash);
    if (!m) return null;
    try { return decodeCode(m[1]); } catch (e) { return null; }
  }

  function share() {
    const url = location.href.split('#')[0] + '#code=' + encodeCode(el.src.value);
    history.replaceState(null, '', url);
    const done = () => toast('このプログラムを開くリンクをコピーしました');
    if (navigator.clipboard) {
      navigator.clipboard.writeText(url).then(done, () => toast('アドレス欄のURLをコピーして共有してください'));
    } else toast('アドレス欄のURLをコピーして共有してください');
  }

  let toastTimer = null;
  function toast(msg) {
    el.toast.textContent = msg;
    el.toast.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.toast.hidden = true; }, 2600);
  }

  // ---------- 編集 ----------

  function updateGutter() {
    const n = el.src.value.split('\n').length;
    let html = '';
    for (let i = 0; i < n; i++) html += `<div${i === state.errorLine ? ' class="err"' : ''}>${i + 1}</div>`;
    el.gutter.innerHTML = html;
    // 最後の行が改行で終わるときも高さがそろうように空白を足す
    el.hlLayer.innerHTML = DNCLHighlight.highlight(el.src.value).join('\n') + '\n ';
    syncScroll();
  }

  function syncScroll() {
    el.gutter.scrollTop = el.src.scrollTop;
    el.hlLayer.style.transform = `translate(${-el.src.scrollLeft}px, ${-el.src.scrollTop}px)`;
  }

  function onInput() {
    state.errorLine = -1;
    el.parseError.hidden = true;
    updateGutter();
    store.set(KEY_CODE, el.src.value);
  }

  function insertText(text) {
    const ta = el.src;
    ta.focus();
    // execCommand なら Ctrl+Z で元に戻せる
    if (!document.execCommand('insertText', false, text)) {
      ta.setRangeText(text, ta.selectionStart, ta.selectionEnd, 'end');
      onInput();
    }
  }

  function currentLine() {
    const ta = el.src;
    const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    return { start, text: ta.value.slice(start, ta.selectionStart) };
  }

  function onEditorKey(e) {
    if (e.isComposing || e.keyCode === 229) return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      startRun();
    } else if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) outdent();
      else insertText('│ ');
    } else if (e.key === 'Enter') {
      // 上の行と同じ字下げを続ける。「:」で終わる行の次は1段深く、└ の次は1段浅くする
      e.preventDefault();
      const line = currentLine().text;
      let prefix = /^[ \t　│|└⎿┃┗├]*/.exec(line)[0];
      const lastEnd = prefix.lastIndexOf('└');
      if (lastEnd >= 0) prefix = prefix.slice(0, lastEnd);
      prefix = prefix.replace(/[└⎿┗]/g, '│');
      if (/[:：]\s*$/.test(line)) prefix += '│ ';
      insertText('\n' + prefix);
    }
  }

  function outdent() {
    const ta = el.src;
    const start = ta.value.lastIndexOf('\n', ta.selectionStart - 1) + 1;
    const head = ta.value.slice(start, start + 2);
    const len = /^[│|└⎿] /.test(head) || head === '  ' ? 2 : /^[ \t│|└]/.test(head) ? 1 : 0;
    if (!len) return;
    const caret = ta.selectionStart;
    ta.setSelectionRange(start, start + len);
    insertText('');
    const pos = Math.max(start, caret - len);
    ta.setSelectionRange(pos, pos);
  }

  function showParseError(pe) {
    const lines = el.src.value.replace(/\r\n?/g, '\n').split('\n');
    state.errorLine = pe.line;
    el.parseError.innerHTML = `<b>${pe.line + 1} 行目</b>　${esc(pe.message)}`
      + (lines[pe.line] !== undefined ? `<div class="err-src">${esc(lines[pe.line])}</div>` : '');
    el.parseError.hidden = false;
    updateGutter();
    let start = 0;
    for (let i = 0; i < pe.line; i++) start += lines[i].length + 1;
    el.src.focus();
    el.src.setSelectionRange(start, start + (lines[pe.line] || '').length);
  }

  // ---------- 実行モード ----------

  function startRun() {
    const code = el.src.value;
    const res = DNCL.run(code);
    if (res.parseError) {
      showParseError(res.parseError);
      return;
    }
    state.steps = res.steps;
    buildViewer(code);
    computePointers();
    buildTrace();
    setMode('run');
    goTo(0);
  }

  function setMode(mode) {
    stop();
    state.mode = mode;
    const run = mode === 'run';
    document.body.classList.toggle('mode-run', run);
    el.editor.hidden = run;
    el.editHint.hidden = run;
    el.viewer.hidden = !run;
    el.editControls.hidden = run;
    el.runControls.hidden = !run;
    el.modeBadge.textContent = run ? '実行中（編集はできません）' : '編集中';
    if (run) {
      el.parseError.hidden = true;
      el.nextBtn.focus();
    } else {
      el.explain.className = 'panel explain kind-idle';
      el.explain.innerHTML = '<div class="ex-title">「▶ 実行してみる」を押すと、ここに1行ずつの説明が出ます</div>';
      el.src.focus();
    }
  }

  function buildViewer(source) {
    el.lines.innerHTML = '<div id="hlBar" class="hl-bar"></div>' + DNCLHighlight.highlight(source).map((t, i) => (
      `<div class="ln" data-i="${i}"><span class="no">${i + 1}</span><span class="tx">${t || ' '}</span><span class="note"></span></div>`
    )).join('');
    el.hlBar = $('hlBar');
    state.lineEls = Array.from(el.lines.querySelectorAll('.ln'));
  }

  // 配列の添字に使われた変数（Data[i] の i など）を、配列の下に矢印で出す
  function computePointers() {
    const map = new Map();
    for (const s of state.steps) {
      for (const a of s.reads.concat(s.writes)) {
        if (a.path && a.path.length === 1 && a.labels && /^[A-Za-z_]\w*$/.test(a.labels[0] || '')) {
          if (!map.has(a.name)) map.set(a.name, new Set());
          map.get(a.name).add(a.labels[0]);
        }
      }
    }
    state.pointers = map;
  }

  function goTo(i) {
    const n = state.steps.length;
    state.cur = Math.max(0, Math.min(n - 1, i));
    render();
  }

  function render() {
    const step = state.steps[state.cur];
    const next = state.steps[state.cur + 1];
    renderCode(step, next);
    renderExplain(step);
    renderVars(step);
    renderOutput(step);
    renderTraceCursor();
    const n = state.steps.length;
    el.scrub.max = n - 1;
    el.scrub.value = state.cur;
    el.counter.textContent = `手順 ${state.cur} / ${n - 1}`;
    el.prevBtn.disabled = el.firstBtn.disabled = state.cur === 0;
    el.nextBtn.disabled = el.lastBtn.disabled = state.cur === n - 1;
  }

  function renderCode(step, next) {
    for (const ln of el.lines.querySelectorAll('.ln.cur, .ln.next, .ln.error')) ln.classList.remove('cur', 'next', 'error');
    for (const note of el.lines.querySelectorAll('.note.show')) {
      note.classList.remove('show');
      note.textContent = '';
    }
    const cur = state.lineEls[step.line];
    if (!cur) {
      el.hlBar.classList.add('hidden');
      return;
    }
    cur.classList.add(step.kind === 'error' ? 'error' : 'cur');
    if (next && state.lineEls[next.line] && next.line !== step.line) state.lineEls[next.line].classList.add('next');
    if (step.inline) {
      const note = cur.querySelector('.note');
      note.textContent = step.inline;
      note.className = 'note show kind-' + step.kind;
    }
    el.hlBar.classList.remove('hidden');
    el.hlBar.classList.toggle('error', step.kind === 'error');
    el.hlBar.style.top = cur.offsetTop + 'px';
    el.hlBar.style.height = cur.offsetHeight + 'px';
    scrollIntoViewIfNeeded(el.viewer, cur);
  }

  function scrollIntoViewIfNeeded(box, item) {
    const b = box.getBoundingClientRect();
    const r = item.getBoundingClientRect();
    const margin = r.height * 2;
    if (r.top - margin < b.top) box.scrollBy({ top: r.top - margin - b.top, behavior: 'smooth' });
    else if (r.bottom + margin > b.bottom) box.scrollBy({ top: r.bottom + margin - b.bottom, behavior: 'smooth' });
  }

  function renderExplain(step) {
    const chips = [`<span class="chip">手順 ${state.cur}</span>`];
    if (step.line >= 0) chips.push(`<span class="chip line">${step.line + 1} 行目</span>`);
    el.explain.className = 'panel explain kind-' + step.kind;
    el.explain.innerHTML = `<div class="ex-head">${chips.join('')}</div>`
      + `<div class="ex-title">${step.title}</div>`
      + (step.details.length ? `<ul class="ex-details">${step.details.map((d) => `<li>${d}</li>`).join('')}</ul>` : '');
    void el.explain.offsetWidth;
    el.explain.classList.add('anim');
  }

  function renderVars(step) {
    const scalars = [];
    const arrays = [];
    for (const entry of step.vars) (Array.isArray(entry[1]) ? arrays : scalars).push(entry);
    const values = new Map(step.vars);
    const wholeWrites = new Map(step.writes.filter((w) => !w.path).map((w) => [w.name, w]));
    const wholeReads = new Set(step.reads.filter((r) => !r.path).map((r) => r.name));

    el.scalars.innerHTML = scalars.length || arrays.length
      ? scalars.map(([name, v]) => {
        const w = wholeWrites.get(name);
        const cls = w ? ' changed' : wholeReads.has(name) ? ' read' : '';
        const diff = w ? `<div class="vdiff">${w.isNew ? 'できた' : esc(w.old) + ' → ' + esc(w.nu)}</div>` : '';
        return `<div class="var${cls}"><div class="vname">${esc(name)}</div><div class="vbox">${esc(fmt(v))}</div>${diff}</div>`;
      }).join('')
      : '<p class="empty">まだ変数はありません</p>';

    el.arrays.innerHTML = arrays.map(([name, arr]) => {
      const key = (p) => p.join(',');
      const cellW = new Set(step.writes.filter((w) => w.name === name && w.path).map((w) => key(w.path)));
      const cellR = new Set(step.reads.filter((r) => r.name === name && r.path).map((r) => key(r.path)));
      const whole = wholeWrites.has(name) ? ' changed' : wholeReads.has(name) ? ' read' : '';
      const note = arr.dflt !== undefined ? `・まだ使っていない要素は ${esc(fmt(arr.dflt))}` : '';
      const head = `<div class="aname"><span class="vname-l">${esc(name)}</span><small>要素数 ${arr.length}${note}</small></div>`;
      const is2D = arr.length > 0 && arr.every(Array.isArray);
      const body = is2D ? render2D(arr, cellW, cellR, key) : render1D(name, arr, step, values, cellW, cellR);
      return `<div class="arr${whole}">${head}${body}</div>`;
    }).join('');
  }

  function render1D(name, arr, step, values, cellW, cellR) {
    // 添字の位置 → そこを指している変数名
    const ptrs = new Map();
    const add = (i, label, on) => {
      if (!ptrs.has(i)) ptrs.set(i, new Map());
      const m = ptrs.get(i);
      m.set(label, m.get(label) || on);
    };
    for (const v of state.pointers.get(name) || []) {
      const i = values.get(v);
      if (Number.isInteger(i) && i >= 0 && i <= arr.length) add(i, v, false);
    }
    for (const a of step.reads.concat(step.writes)) {
      if (a.name === name && a.path && a.path.length === 1 && a.labels && a.labels[0]) add(a.path[0], a.labels[0], true);
    }
    let html = '<div class="cells">';
    const count = ptrs.has(arr.length) ? arr.length + 1 : arr.length;
    for (let i = 0; i < count; i++) {
      const ghost = i >= arr.length;
      const cls = ghost ? ' ghost' : cellW.has(String(i)) ? ' w' : cellR.has(String(i)) ? ' r' : '';
      const labels = ptrs.has(i) ? Array.from(ptrs.get(i), ([l, on]) => `<span class="ptr${on ? ' on' : ''}">▲ ${esc(l)}</span>`).join('') : '';
      html += `<div class="acol${ghost ? ' ghost' : ''}"><div class="aidx">${i}</div>`
        + `<div class="cell${cls}">${ghost ? '' : esc(fmt(arr[i]))}</div><div class="ptrs">${labels}</div></div>`;
    }
    if (!arr.length && !count) html += '<div class="cell empty-cell">（空）</div>';
    return html + '</div>';
  }

  function render2D(arr, cellW, cellR, key) {
    const cols = Math.max(...arr.map((r) => r.length));
    let html = '<table class="grid"><tr><th></th>';
    for (let j = 0; j < cols; j++) html += `<th>${j}</th>`;
    html += '</tr>';
    arr.forEach((row, i) => {
      const rowRead = cellR.has(key([i]));
      html += `<tr><th>${i}</th>`;
      for (let j = 0; j < cols; j++) {
        const k = key([i, j]);
        const cls = cellW.has(k) ? ' w' : cellR.has(k) || rowRead ? ' r' : '';
        html += `<td class="cell${cls}">${j < row.length ? esc(fmt(row[j])) : ''}</td>`;
      }
      html += '</tr>';
    });
    return html + '</table>';
  }

  function renderOutput(step) {
    if (!step.out.length) {
      el.output.innerHTML = '<p class="empty">（まだ何も表示していません）</p>';
      return;
    }
    el.output.innerHTML = step.out.map((t, i) => (
      `<div class="oline${step.outAdded && i === step.out.length - 1 ? ' new' : ''}">${esc(t) || ' '}</div>`
    )).join('');
    el.output.scrollTop = el.output.scrollHeight;
  }

  // ---------- トレース表 ----------

  function buildTrace() {
    const cols = [];
    const seen = new Set();
    for (const s of state.steps) {
      for (const [n] of s.vars) {
        if (!seen.has(n)) {
          seen.add(n);
          cols.push(n);
        }
      }
    }
    const rows = [];
    state.steps.forEach((s, i) => {
      if (s.writes.length || s.outAdded || s.kind === 'error') rows.push(i);
    });
    state.traceSteps = rows.slice(0, TRACE_MAX_ROWS);
    if (!rows.length) {
      el.traceWrap.innerHTML = '<p class="empty">変数の変化はありません</p>';
      state.traceRowEls = [];
      return;
    }
    let html = '<table class="trace"><thead><tr><th>手順</th><th>行</th>'
      + cols.map((c) => `<th>${esc(c)}</th>`).join('') + '<th>表示</th></tr></thead><tbody>';
    for (const i of state.traceSteps) {
      const s = state.steps[i];
      const vals = new Map(s.vars);
      const changed = new Set(s.writes.map((w) => w.name));
      html += `<tr data-step="${i}"${s.kind === 'error' ? ' class="error"' : ''}><td>${i}</td><td>${s.line >= 0 ? s.line + 1 : ''}</td>`;
      for (const c of cols) {
        const has = vals.has(c);
        html += `<td class="${changed.has(c) ? 'chg' : 'same'}">${has ? esc(fmt(vals.get(c))) : ''}</td>`;
      }
      html += `<td class="${s.outAdded ? 'chg' : ''}">${s.outAdded ? esc(s.out[s.out.length - 1]) : s.kind === 'error' ? 'エラー' : ''}</td></tr>`;
    }
    html += '</tbody></table>';
    if (rows.length > TRACE_MAX_ROWS) html += `<p class="empty">最初の ${TRACE_MAX_ROWS} 行だけを出しています</p>`;
    el.traceWrap.innerHTML = html;
    state.traceRowEls = Array.from(el.traceWrap.querySelectorAll('tbody tr'));
  }

  function renderTraceCursor() {
    for (const tr of el.traceWrap.querySelectorAll('tr.cur')) tr.classList.remove('cur');
    let k = -1;
    for (let j = 0; j < state.traceSteps.length && state.traceSteps[j] <= state.cur; j++) k = j;
    const tr = state.traceRowEls[k];
    if (!tr) return;
    tr.classList.add('cur');
    const box = $('tab-trace');
    if (!box.hidden) scrollIntoViewIfNeeded(box, tr);
  }

  // ---------- 自動再生 ----------

  function play() {
    if (state.cur >= state.steps.length - 1) goTo(0);
    state.timer = setInterval(() => {
      if (state.cur >= state.steps.length - 1) stop();
      else goTo(state.cur + 1);
    }, SPEEDS[el.speed.value - 1]);
    el.playBtn.textContent = '⏸ 止める';
    el.playBtn.classList.add('playing');
  }

  function stop() {
    if (!state.timer) return;
    clearInterval(state.timer);
    state.timer = null;
    el.playBtn.textContent = '▶ 自動';
    el.playBtn.classList.remove('playing');
  }

  const togglePlay = () => (state.timer ? stop() : play());
  const nav = (i) => {
    stop();
    goTo(i);
  };

  // ---------- 文字の大きさ ----------

  function applyScale() {
    document.documentElement.style.setProperty('--scale', state.scale);
    store.set(KEY_SCALE, state.scale);
    if (state.mode === 'run') render();
  }

  function changeScale(d) {
    state.scale = Math.round(Math.max(0.7, Math.min(2.2, state.scale + d)) * 10) / 10;
    applyScale();
  }

  // ---------- はじめに ----------

  function init() {
    el.sample.innerHTML = '<option value="">例題を開く…</option>'
      + SAMPLES.map((s, i) => `<option value="${i}">${esc(s.title)}</option>`).join('');
    el.src.value = codeFromHash() ?? store.get(KEY_CODE) ?? SAMPLES[0].code;
    state.scale = parseFloat(store.get(KEY_SCALE)) || 1;
    document.documentElement.style.setProperty('--scale', state.scale);
    el.speed.value = store.get(KEY_SPEED) || 4;
    updateGutter();

    el.src.addEventListener('input', onInput);
    el.src.addEventListener('keydown', onEditorKey);
    el.src.addEventListener('scroll', syncScroll);

    el.sample.addEventListener('change', () => {
      const s = SAMPLES[el.sample.value];
      el.sample.value = '';
      if (!s) return;
      if (el.src.value.trim() && el.src.value !== s.code && !confirm(`今のプログラムを「${s.title}」に置きかえますか？`)) return;
      if (state.mode === 'run') setMode('edit');
      el.src.value = s.code;
      onInput();
      el.src.scrollTop = 0;
    });

    el.fontDown.addEventListener('click', () => changeScale(-0.1));
    el.fontUp.addEventListener('click', () => changeScale(0.1));
    el.share.addEventListener('click', share);
    el.helpBtn.addEventListener('click', () => el.helpDlg.showModal());

    el.runBtn.addEventListener('click', startRun);
    el.editBtn.addEventListener('click', () => setMode('edit'));
    el.firstBtn.addEventListener('click', () => nav(0));
    el.prevBtn.addEventListener('click', () => nav(state.cur - 1));
    el.nextBtn.addEventListener('click', () => nav(state.cur + 1));
    el.lastBtn.addEventListener('click', () => nav(state.steps.length - 1));
    el.playBtn.addEventListener('click', togglePlay);
    el.scrub.addEventListener('input', () => nav(+el.scrub.value));
    el.speed.addEventListener('input', () => {
      store.set(KEY_SPEED, el.speed.value);
      if (state.timer) {
        stop();
        play();
      }
    });

    // 行をクリックすると、その行を次に実行する手順まで進む
    el.lines.addEventListener('click', (e) => {
      const ln = e.target.closest('.ln');
      if (!ln) return;
      const line = +ln.dataset.i;
      const n = state.steps.length;
      for (let k = 1; k <= n; k++) {
        const j = (state.cur + k) % n;
        if (state.steps[j].line === line) return nav(j);
      }
    });

    el.traceWrap.addEventListener('click', (e) => {
      const tr = e.target.closest('tr[data-step]');
      if (tr) nav(+tr.dataset.step);
    });

    document.querySelectorAll('.tab').forEach((tab) => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t === tab));
        $('tab-vars').hidden = tab.dataset.tab !== 'vars';
        $('tab-trace').hidden = tab.dataset.tab !== 'trace';
        if (state.mode === 'run') renderTraceCursor();
      });
    });

    document.addEventListener('keydown', (e) => {
      if (state.mode !== 'run' || el.helpDlg.open) return;
      if (/^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName) && e.target.type !== 'range') return;
      const keys = {
        ArrowRight: () => nav(state.cur + 1),
        ArrowDown: () => nav(state.cur + 1),
        ' ': () => nav(state.cur + 1),
        Enter: () => nav(state.cur + 1),
        ArrowLeft: () => nav(state.cur - 1),
        ArrowUp: () => nav(state.cur - 1),
        Home: () => nav(0),
        End: () => nav(state.steps.length - 1),
        p: togglePlay,
        P: togglePlay,
        Escape: () => setMode('edit'),
      };
      if (keys[e.key]) {
        e.preventDefault();
        keys[e.key]();
      }
    });

    window.addEventListener('resize', () => { if (state.mode === 'run') render(); });
  }

  init();
})();
