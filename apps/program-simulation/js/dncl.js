/*
 * DNCL（共通テスト用プログラム表記）の小さなインタプリタ。
 * プログラムを最後まで実行し、1手順ごとに「どの行で・何が起きて・変数がどうなったか」を記録する。
 * 画面側はこの記録を前後に動かして表示するだけなので、戻る操作も自由にできる。
 */
(function (root) {
  'use strict';

  const MAX_STEPS = 5000;

  class DnclError extends Error {
    constructor(message, line) {
      super(message);
      this.line = line;
    }
  }

  // ---------- 値の書式 ----------

  function fmtNum(v) {
    if (Number.isInteger(v) || !isFinite(v)) return String(v);
    return String(parseFloat(v.toPrecision(10)));
  }

  function fmtVal(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return fmtNum(v);
    if (typeof v === 'string') return '"' + v + '"';
    if (typeof v === 'boolean') return v ? '真' : '偽';
    if (Array.isArray(v)) return '[' + v.map(fmtVal).join(', ') + ']';
    return String(v);
  }

  // 表示する( ) で画面に出すときの形（文字列に " を付けない）
  function fmtPlain(v) {
    return typeof v === 'string' ? v : fmtVal(v);
  }

  function clone(v) {
    if (!Array.isArray(v)) return v;
    const a = v.map(clone);
    if (v.dflt !== undefined) a.dflt = v.dflt;
    return a;
  }

  function esc(s) {
    return String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  const C = (s) => '<code>' + esc(s) + '</code>';
  const B = (s) => '<b class="val">' + esc(s) + '</b>';
  const TF = (t) => (t ? '<b class="tf t">真</b>' : '<b class="tf f">偽</b>');

  // ---------- 文字の正規化と行の下ごしらえ ----------

  const QUOTES = { '"': '"', "'": "'", '「': '」', '“': '”' };
  const EXTRA = {
    '×': '*', '−': '-', '≧': '>=', '≥': '>=', '≦': '<=', '≤': '<=', '≠': '!=',
    '、': ',', '　': ' ', '←': '=',
  };
  const GUIDES = '│|└⎿┃┗├';

  // 全角の数字・記号を半角にそろえる（文字列の中はそのまま）
  function normalize(s) {
    let out = '';
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (QUOTES[c]) {
        const end = s.indexOf(QUOTES[c], i + 1);
        if (end < 0) return out + s.slice(i);
        out += s.slice(i, end + 1);
        i = end;
        continue;
      }
      const code = c.charCodeAt(0);
      if (code >= 0xff01 && code <= 0xff5e) out += String.fromCharCode(code - 0xfee0);
      else out += EXTRA[c] !== undefined ? EXTRA[c] : c;
    }
    return out;
  }

  function stripComment(s) {
    for (let i = 0; i < s.length; i++) {
      const c = s[i];
      if (QUOTES[c]) {
        const end = s.indexOf(QUOTES[c], i + 1);
        if (end < 0) return s;
        i = end;
      } else if (c === '#') {
        return s.slice(0, i);
      }
    }
    return s;
  }

  // 行頭の空白と │ └ を字下げの深さとして数える
  function measureIndent(raw) {
    let w = 0;
    let i = 0;
    for (; i < raw.length; i++) {
      const c = raw[i];
      if (c === ' ' || GUIDES.includes(c)) w += 1;
      else if (c === '\t') w += 4;
      else if (c === '　') w += 2;
      else break;
    }
    return { indent: w, rest: raw.slice(i) };
  }

  // かっこと文字列の外にある区切り文字で分ける
  function splitTopLevel(text, sep) {
    const parts = [];
    let depth = 0;
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (QUOTES[c]) {
        const end = text.indexOf(QUOTES[c], i + 1);
        if (end < 0) break;
        i = end;
      } else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (depth === 0 && text.startsWith(sep, i)) {
        parts.push(text.slice(start, i));
        start = i + sep.length;
        i += sep.length - 1;
      }
    }
    parts.push(text.slice(start));
    return parts.map((p) => p.trim());
  }

  // 代入の = の位置（==, !=, <=, >= は除く）
  function findAssign(text) {
    let depth = 0;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (QUOTES[c]) {
        const end = text.indexOf(QUOTES[c], i + 1);
        if (end < 0) return -1;
        i = end;
      } else if (c === '(' || c === '[') depth++;
      else if (c === ')' || c === ']') depth--;
      else if (c === '=' && depth === 0) {
        if (text[i + 1] === '=') {
          i++;
          continue;
        }
        if (i > 0 && '<>!='.includes(text[i - 1])) continue;
        return i;
      }
    }
    return -1;
  }

  // ---------- 式の字句解析と構文解析 ----------

  const OPS2 = ['**', '//', '==', '!=', '<=', '>='];
  const OPS1 = '+-*/÷%()[],<>=';
  const WORD_OPS = { and: 'and', or: 'or', not: 'not', かつ: 'and', または: 'or' };
  const BOOLS = { True: true, False: false, 真: true, 偽: false };

  function tokenize(src, line) {
    const toks = [];
    let i = 0;
    const match = (re) => {
      re.lastIndex = i;
      const m = re.exec(src);
      return m ? m[0] : null;
    };
    while (i < src.length) {
      const c = src[i];
      if (c === ' ' || c === '\t') {
        i++;
        continue;
      }
      let m;
      if ((m = match(/\d+(?:\.\d+)?/y))) {
        toks.push({ t: 'num', v: parseFloat(m) });
        i += m.length;
        continue;
      }
      if (QUOTES[c]) {
        const end = src.indexOf(QUOTES[c], i + 1);
        if (end < 0) throw new DnclError(`文字列の終わりの ${QUOTES[c]} がありません`, line);
        toks.push({ t: 'str', v: src.slice(i + 1, end) });
        i = end + 1;
        continue;
      }
      const two = src.substr(i, 2);
      if (OPS2.includes(two)) {
        toks.push({ t: 'op', v: two });
        i += 2;
        continue;
      }
      if (OPS1.includes(c)) {
        toks.push({ t: 'op', v: c });
        i++;
        continue;
      }
      if ((m = match(/[A-Za-z_][A-Za-z0-9_]*/y) || match(/[^\x00-\x7F÷\s]+/y))) {
        if (WORD_OPS[m]) toks.push({ t: 'op', v: WORD_OPS[m] });
        else if (m in BOOLS) toks.push({ t: 'bool', v: BOOLS[m] });
        else toks.push({ t: 'id', v: m });
        i += m.length;
        continue;
      }
      throw new DnclError(`「${c}」は式の中では使えません`, line);
    }
    toks.push({ t: 'eof' });
    return toks;
  }

  function parseExpr(src, line) {
    const toks = tokenize(src, line);
    let p = 0;
    const err = (msg) => new DnclError(`式「${src.trim()}」: ${msg}`, line);
    const isOp = (...vs) => toks[p].t === 'op' && vs.includes(toks[p].v);
    const expect = (v) => {
      if (!isOp(v)) throw err(`「${v}」が足りません`);
      p++;
    };

    function or() {
      let l = and();
      while (isOp('or')) {
        p++;
        l = { k: 'bin', op: 'or', l, r: and() };
      }
      return l;
    }
    function and() {
      let l = not();
      while (isOp('and')) {
        p++;
        l = { k: 'bin', op: 'and', l, r: not() };
      }
      return l;
    }
    function not() {
      if (isOp('not')) {
        p++;
        return { k: 'un', op: 'not', x: not() };
      }
      return cmp();
    }
    function cmp() {
      const l = add();
      if (isOp('==', '=', '!=', '<', '>', '<=', '>=')) {
        const op = toks[p++].v;
        return { k: 'bin', op: op === '=' ? '==' : op, l, r: add() };
      }
      return l;
    }
    function add() {
      let l = mul();
      while (isOp('+', '-')) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: mul() };
      }
      return l;
    }
    function mul() {
      let l = unary();
      while (isOp('*', '/', '÷', '//', '%')) {
        const op = toks[p++].v;
        l = { k: 'bin', op, l, r: unary() };
      }
      return l;
    }
    function unary() {
      if (isOp('-')) {
        p++;
        return { k: 'un', op: '-', x: unary() };
      }
      if (isOp('+')) {
        p++;
        return unary();
      }
      return pow();
    }
    function pow() {
      const base = postfix();
      if (isOp('**')) {
        p++;
        return { k: 'bin', op: '**', l: base, r: unary() };
      }
      return base;
    }
    function list(close) {
      const items = [];
      if (!isOp(close)) {
        items.push(or());
        while (isOp(',')) {
          p++;
          items.push(or());
        }
      }
      expect(close);
      return items;
    }
    function postfix() {
      let n = primary();
      for (;;) {
        if (isOp('[')) {
          p++;
          // Data[i, j] と Data[i][j] のどちらも書ける
          for (const i of list(']')) n = { k: 'idx', obj: n, i };
        } else if (isOp('(') && n.k === 'var' && !n.paren) {
          p++;
          n = { k: 'call', name: n.name, args: list(')') };
        } else return n;
      }
    }
    function primary() {
      const t = toks[p];
      if (t.t === 'num') return p++, { k: 'num', v: t.v };
      if (t.t === 'str') return p++, { k: 'str', v: t.v };
      if (t.t === 'bool') return p++, { k: 'bool', v: t.v };
      if (t.t === 'id') return p++, { k: 'var', name: t.v };
      if (isOp('(')) {
        p++;
        const n = or();
        expect(')');
        n.paren = true;
        return n;
      }
      if (isOp('[')) {
        p++;
        return { k: 'list', items: list(']') };
      }
      if (t.t === 'eof') throw err('式が途中で終わっています');
      throw err(`「${t.v}」の位置がおかしいです`);
    }

    if (toks[0].t === 'eof') throw new DnclError('式がありません', line);
    const n = or();
    if (toks[p].t !== 'eof') throw err(`「${toks[p].v}」より後ろの書き方がおかしいです`);
    return n;
  }

  const OP_DISP = { '>=': '≧', '<=': '≦', '!=': '≠' };

  function toStr(n) {
    let s;
    switch (n.k) {
      case 'num': s = fmtNum(n.v); break;
      case 'str': s = '"' + n.v + '"'; break;
      case 'bool': s = n.v ? '真' : '偽'; break;
      case 'var': s = n.name; break;
      case 'idx': s = toStr(n.obj) + '[' + toStr(n.i) + ']'; break;
      case 'call': s = n.name + '(' + n.args.map(toStr).join(', ') + ')'; break;
      case 'list': s = '[' + n.items.map(toStr).join(', ') + ']'; break;
      case 'un': s = n.op === 'not' ? 'not ' + toStr(n.x) : '-' + toStr(n.x); break;
      case 'bin': s = toStr(n.l) + ' ' + (OP_DISP[n.op] || n.op) + ' ' + toStr(n.r); break;
    }
    return n.paren ? '(' + s + ')' : s;
  }

  function isLiteral(n) {
    if (n.k === 'num' || n.k === 'str' || n.k === 'bool') return true;
    if (n.k === 'un' && n.op === '-') return n.x.k === 'num';
    if (n.k === 'list') return n.items.every(isLiteral);
    return false;
  }

  const isTarget = (n) => !n.paren && (n.k === 'var' || (n.k === 'idx' && isTarget(n.obj)));

  // ---------- 組み込み関数 ----------

  function num(x) {
    if (typeof x !== 'number') throw `${fmtVal(x)} は数ではありません`;
    return x;
  }

  const BUILTINS = {
    要素数: { args: [1], f: (a) => {
      if (Array.isArray(a) || typeof a === 'string') return a.length;
      throw '( ) の中には配列を書きます';
    } },
    整数: { args: [1], f: (x) => Math.floor(num(x)) },
    切り捨て: { args: [1], f: (x) => Math.floor(num(x)) },
    切り上げ: { args: [1], f: (x) => Math.ceil(num(x)) },
    四捨五入: { args: [1], f: (x) => Math.round(num(x)) },
    絶対値: { args: [1], f: (x) => Math.abs(num(x)) },
    平方根: { args: [1], f: (x) => Math.sqrt(num(x)) },
    乱数: { args: [0, 2], f: (a, b) => (a === undefined ? Math.random() : num(a) + Math.floor(Math.random() * (num(b) - a + 1))) },
    二進: { args: [1], f: (x) => Math.floor(num(x)).toString(2) },
    文字列: { args: [1], f: fmtPlain },
    数値: { args: [1], f: (s) => {
      const n = Number(s);
      if (s === '' || isNaN(n)) throw `${fmtVal(s)} は数にできません`;
      return n;
    } },
  };
  BUILTINS.len = BUILTINS.要素数;
  BUILTINS.int = BUILTINS.整数;
  BUILTINS.abs = BUILTINS.絶対値;
  BUILTINS.str = BUILTINS.文字列;

  // ---------- 行の構文解析 ----------

  const RE = {
    if: /^もし\s*(.+?)\s*ならば$/,
    elif: /^そうでなくもし\s*(.+?)\s*ならば$/,
    else: /^そうでなければ$/,
    for: /^(.+?)\s*を\s*(.+?)\s*から\s*(.+?)\s*まで\s*(?:(.+?)\s*ずつ\s*(増やし|減らし)ながら\s*,?\s*)?繰り返す$/,
    while: /^(.+?)\s*の間\s*,?\s*繰り返す$/,
    repeat: /^繰り返(?:す|し)$/,
    until: /^を\s*,?\s*(.+?)\s*になるまで\s*,?\s*(?:実行する|繰り返す)$/,
    print: /^(?:表示する|print)\s*\((.*)\)$/,
    printTo: /^(.+)を\s*表示する$/,
    fill: /^(?:配列\s*)?([A-Za-z_]\w*)\s*のすべての(?:要素|値)\s*(?:に|を)\s*(.+?)\s*(?:を代入する|にする|とする)$/,
    incr: /^(.+?)\s*を\s*(.+?)\s*(増やす|減らす)$/,
  };

  function parseTarget(src, line) {
    const n = parseExpr(src, line);
    if (!isTarget(n)) throw new DnclError(`「${src.trim()}」には値を入れられません（変数か配列の要素を書きます）`, line);
    if (n.k === 'var' && BUILTINS[n.name]) throw new DnclError(`${n.name} は関数の名前なので変数には使えません`, line);
    return n;
  }

  function parseSimple(text, line) {
    let m;
    if ((m = RE.print.exec(text))) {
      const inner = m[1].trim();
      return { type: 'print', line, args: inner ? splitTopLevel(inner, ',').map((a) => parseExpr(a, line)) : [] };
    }
    if ((m = RE.printTo.exec(text))) {
      return { type: 'print', line, args: splitTopLevel(m[1].trim(), 'と').map((a) => parseExpr(a, line)) };
    }
    if ((m = RE.fill.exec(text))) return { type: 'fill', line, name: m[1], expr: parseExpr(m[2], line) };
    if ((m = RE.incr.exec(text))) {
      return { type: 'incr', line, target: parseTarget(m[1], line), expr: parseExpr(m[2], line), dir: m[3] === '増やす' ? 1 : -1 };
    }
    const eq = findAssign(text);
    if (eq > 0) {
      return { type: 'assign', line, target: parseTarget(text.slice(0, eq), line), expr: parseExpr(text.slice(eq + 1), line) };
    }
    if (eq === 0) throw new DnclError('= の左に、値を入れる変数を書きます', line);
    throw new DnclError(`この行の書き方がわかりません: ${text}`, line);
  }

  // 「x = 1, y = 2」のように1行に並んだ代入を分ける
  function parseLine(text, line) {
    const parts = splitTopLevel(text, ',');
    if (parts.length > 1 && parts.every((p) => findAssign(p) > 0 || RE.incr.test(p))) {
      return parts.map((p) => parseSimple(p, line));
    }
    return [parseSimple(text, line)];
  }

  function parseProgram(source) {
    const lines = [];
    source.replace(/\r\n?/g, '\n').split('\n').forEach((raw, no) => {
      const { indent, rest } = measureIndent(raw);
      const text = stripComment(normalize(rest)).trim().replace(/[:,]+$/, '').trim();
      if (text) lines.push({ no, indent, text });
    });
    let pos = 0;

    function block(indent) {
      const out = [];
      while (pos < lines.length) {
        const L = lines[pos];
        if (L.indent < indent || RE.until.test(L.text)) break;
        if (L.indent > indent) throw new DnclError('字下げ（行の始めの空白や │）が上の行とそろっていません', L.no);
        if (RE.elif.test(L.text) || RE.else.test(L.text)) {
          throw new DnclError('「そうでなくもし」「そうでなければ」の前に、同じ字下げの「もし」が必要です', L.no);
        }
        out.push(...statement(L));
      }
      return out;
    }

    function body(header) {
      pos++;
      const L = lines[pos];
      if (!L || L.indent <= header.indent || RE.until.test(L.text)) {
        throw new DnclError('この行の下に、字下げした中身を書いてください', header.no);
      }
      return block(L.indent);
    }

    function statement(L) {
      const t = L.text;
      let m;
      if ((m = RE.if.exec(t))) {
        const s = { type: 'if', branches: [], elseLine: -1, elseBody: null };
        s.branches.push({ line: L.no, cond: parseExpr(m[1], L.no), body: body(L) });
        while (pos < lines.length && lines[pos].indent === L.indent) {
          const E = lines[pos];
          if ((m = RE.elif.exec(E.text))) {
            s.branches.push({ line: E.no, cond: parseExpr(m[1], E.no), body: body(E) });
          } else if (RE.else.test(E.text)) {
            s.elseLine = E.no;
            s.elseBody = body(E);
            break;
          } else break;
        }
        return [s];
      }
      if ((m = RE.for.exec(t))) {
        const s = {
          type: 'for', line: L.no,
          var: parseTarget(m[1], L.no),
          from: parseExpr(m[2], L.no),
          to: parseExpr(m[3], L.no),
          by: m[4] ? parseExpr(m[4], L.no) : { k: 'num', v: 1 },
          dir: m[5] === '減らし' ? -1 : 1,
        };
        s.body = body(L);
        return [s];
      }
      if ((m = RE.while.exec(t))) {
        const s = { type: 'while', line: L.no, cond: parseExpr(m[1], L.no) };
        s.body = body(L);
        return [s];
      }
      if (RE.repeat.test(t)) {
        const s = { type: 'until', line: L.no, body: body(L) };
        const E = lines[pos];
        if (!E || !(m = RE.until.exec(E.text))) {
          throw new DnclError('「繰り返す」に対応する「を, 〜 になるまで実行する」の行がありません', L.no);
        }
        s.endLine = E.no;
        s.cond = parseExpr(m[1], E.no);
        pos++;
        return [s];
      }
      pos++;
      return parseLine(t, L.no);
    }

    const program = block(lines.length ? lines[0].indent : 0);
    if (pos < lines.length) {
      const L = lines[pos];
      if (RE.until.test(L.text)) throw new DnclError('この行に対応する「繰り返す」がありません', L.no);
      throw new DnclError('字下げ（行の始めの空白や │）が上の行とそろっていません', L.no);
    }
    return program;
  }

  // ---------- 実行 ----------

  function run(source) {
    let program;
    try {
      program = parseProgram(source);
    } catch (e) {
      if (e instanceof DnclError) return { parseError: { message: e.message, line: e.line } };
      throw e;
    }

    const env = new Map();
    const output = [];
    const steps = [];
    let ctx = null;

    const newCtx = (line) => (ctx = { line, reads: [], writes: [] });
    const err = (msg) => new DnclError(msg, ctx.line);

    function record(line, kind, title, details, extra) {
      steps.push({
        line, kind, title,
        details: details.filter(Boolean),
        inline: (extra && extra.inline) || '',
        outAdded: !!(extra && extra.outAdded),
        reads: ctx ? ctx.reads : [],
        writes: ctx ? ctx.writes : [],
        vars: Array.from(env, ([k, v]) => [k, clone(v)]),
        out: output.slice(),
      });
    }

    function step(line, kind, title, details, extra) {
      record(line, kind, title, details, extra);
      ctx = null;
      if (steps.length > MAX_STEPS) {
        throw new DnclError(`手順が ${MAX_STEPS} 回を超えたので止めました。繰り返しが終わらない書き方になっていないか確かめてください`, line);
      }
    }

    function lookup(name) {
      if (env.has(name)) return env.get(name);
      if (BUILTINS[name]) throw err(`${name} は関数です。${name}(…) のように ( ) を付けて使います`);
      throw err(`変数 ${name} にはまだ値が入っていません`);
    }

    function truthy(v) {
      return typeof v === 'boolean' ? v : !!v;
    }

    // Data[i][j] のような書き方を、配列の名前と添字の並びにする
    function evalRef(n) {
      const idxNodes = [];
      let r = n;
      while (r.k === 'idx') {
        idxNodes.unshift(r.i);
        r = r.obj;
      }
      if (r.k !== 'var') throw err('[ ] の前には配列の名前を書きます');
      const path = [];
      const labels = [];
      for (const ix of idxNodes) {
        const v = ev(ix).v;
        if (typeof v !== 'number' || !Number.isInteger(v)) {
          throw err(`添字 ${toStr(ix)} の値 ${fmtVal(v)} が整数ではありません`);
        }
        if (v < 0) throw err(`添字 ${toStr(ix)} の値が ${v} です。添字は 0 以上です`);
        path.push(v);
        labels.push(ix.k === 'num' ? null : toStr(ix));
      }
      return { name: r.name, path, labels };
    }

    const refDesc = (name, path) => name + path.map((i) => `[${i}]`).join('');

    function readRef(ref) {
      let a = lookup(ref.name);
      ref.path.forEach((i, k) => {
        const here = refDesc(ref.name, ref.path.slice(0, k));
        if (typeof a === 'string') {
          if (i >= a.length) throw err(`${here}[${i}] はありません（文字数は ${a.length}）`);
          a = a[i];
          return;
        }
        if (!Array.isArray(a)) throw err(`${here} は配列ではないので [ ] は使えません`);
        let v = a[i];
        if (v === undefined || v === null) {
          if (a.dflt !== undefined) v = a.dflt;
          else if (i >= a.length) {
            const range = a.length ? `0 〜 ${a.length - 1}` : 'まだありません';
            throw err(`${here}[${i}] はありません（${here} の添字は ${range}）`);
          } else throw err(`${here}[${i}] にはまだ値が入っていません`);
        }
        a = v;
      });
      return a;
    }

    function extendTo(a, i) {
      while (a.length <= i) a.push(a.dflt !== undefined ? a.dflt : null);
    }

    function assign(target, value) {
      value = clone(value);
      let w;
      if (target.k === 'var') {
        const had = env.has(target.name);
        const old = env.get(target.name);
        env.set(target.name, value);
        w = { name: target.name, path: null, labels: null, isNew: !had, old: fmtVal(old), nu: fmtVal(value), desc: target.name };
      } else {
        const ref = evalRef(target);
        if (!env.has(ref.name)) env.set(ref.name, []);
        let a = env.get(ref.name);
        const last = ref.path.length - 1;
        for (let k = 0; k < last; k++) {
          if (!Array.isArray(a)) throw err(`${refDesc(ref.name, ref.path.slice(0, k))} は配列ではありません`);
          const i = ref.path[k];
          if (a[i] === undefined || a[i] === null) {
            extendTo(a, i);
            a[i] = [];
          }
          a = a[i];
        }
        const here = refDesc(ref.name, ref.path.slice(0, last));
        if (typeof a === 'string') throw err(`文字列 ${here} の1文字だけを書きかえることはできません`);
        if (!Array.isArray(a)) throw err(`${here} は配列ではないので [ ] は使えません`);
        const i = ref.path[last];
        const old = i < a.length ? a[i] : undefined;
        extendTo(a, i);
        a[i] = value;
        w = {
          name: ref.name, path: ref.path, labels: ref.labels,
          isNew: old === undefined || old === null,
          old: fmtVal(old), nu: fmtVal(value), desc: refDesc(ref.name, ref.path),
        };
      }
      ctx.writes.push(w);
      return w;
    }

    function changeText(w) {
      return w.isNew ? `${C(w.desc)} に ${B(w.nu)} が入った` : `${C(w.desc)}: ${B(w.old)} → ${B(w.nu)}`;
    }

    // 「元の式 → 値を当てはめた式 → 結果」
    function chain(node, res) {
      const last = fmtVal(res.v);
      const parts = [];
      for (const s of [toStr(node), res.s]) if (s !== last && parts[parts.length - 1] !== s) parts.push(s);
      const end = typeof res.v === 'boolean' ? TF(res.v) : B(last);
      return parts.map(C).concat(end).join(' → ');
    }

    function needNum(op, a, b) {
      if (typeof a !== 'number' || typeof b !== 'number') {
        throw err(`${fmtVal(a)} ${OP_DISP[op] || op} ${fmtVal(b)} は計算できません（${op} は数どうしで使います）`);
      }
    }

    function needNonZero(b) {
      if (b === 0) throw err('0 で割ることはできません');
    }

    function equal(a, b) {
      return Array.isArray(a) || Array.isArray(b) ? fmtVal(a) === fmtVal(b) : a === b;
    }

    function binop(op, a, b) {
      switch (op) {
        case '+':
          if (typeof a === 'string' || typeof b === 'string') return fmtPlain(a) + fmtPlain(b);
          if (Array.isArray(a) && Array.isArray(b)) return a.concat(b);
          needNum(op, a, b);
          return a + b;
        case '-': needNum(op, a, b); return a - b;
        case '*': needNum(op, a, b); return a * b;
        case '/': needNum(op, a, b); needNonZero(b); return a / b;
        case '÷':
        case '//': needNum(op, a, b); needNonZero(b); return Math.floor(a / b);
        case '%': needNum(op, a, b); needNonZero(b); return a - b * Math.floor(a / b);
        case '**': needNum(op, a, b); return Math.pow(a, b);
        case '==': return equal(a, b);
        case '!=': return !equal(a, b);
        default: {
          const ok = (typeof a === 'number' && typeof b === 'number') || (typeof a === 'string' && typeof b === 'string');
          if (!ok) throw err(`${fmtVal(a)} と ${fmtVal(b)} は大きさを比べられません`);
          if (op === '<') return a < b;
          if (op === '>') return a > b;
          if (op === '<=') return a <= b;
          return a >= b;
        }
      }
    }

    // 式の値と、変数に値を当てはめた形（説明用）を返す
    function ev(n) {
      let r;
      switch (n.k) {
        case 'num':
        case 'str':
        case 'bool':
          r = { v: n.v, s: fmtVal(n.v) };
          break;
        case 'list': {
          const items = n.items.map(ev);
          r = { v: items.map((x) => clone(x.v)), s: '[' + items.map((x) => x.s).join(', ') + ']' };
          break;
        }
        case 'var': {
          const v = lookup(n.name);
          ctx.reads.push({ name: n.name, path: null });
          r = { v, s: Array.isArray(v) ? n.name : fmtVal(v) };
          break;
        }
        case 'idx': {
          const ref = evalRef(n);
          const v = readRef(ref);
          ctx.reads.push({ name: ref.name, path: ref.path, labels: ref.labels });
          r = { v, s: Array.isArray(v) ? refDesc(ref.name, ref.path) : fmtVal(v) };
          break;
        }
        case 'call': {
          const b = BUILTINS[n.name];
          if (!b) throw err(`関数 ${n.name} は使えません（使える関数は「書き方」を見てください）`);
          if (!b.args.includes(n.args.length)) throw err(`${n.name}( ) の中に書く値の個数が違います`);
          const args = n.args.map((a) => ev(a).v);
          let v;
          try {
            v = b.f(...args);
          } catch (m) {
            if (typeof m === 'string') throw err(`${n.name}: ${m}`);
            throw m;
          }
          r = { v, s: fmtVal(v) };
          break;
        }
        case 'un': {
          const x = ev(n.x);
          if (n.op === 'not') r = { v: !truthy(x.v), s: 'not ' + x.s };
          else {
            needNum('-', 0, x.v);
            r = { v: -x.v, s: '-' + x.s };
          }
          break;
        }
        case 'bin': {
          const l = ev(n.l);
          if (n.op === 'and' || n.op === 'or') {
            const lt = truthy(l.v);
            if (n.op === 'and' ? !lt : lt) {
              // 左側だけで結果が決まるので右側は計算しない
              r = { v: lt, s: l.s + ' ' + n.op + ' ' + toStr(n.r) };
            } else {
              const rr = ev(n.r);
              r = { v: truthy(rr.v), s: l.s + ' ' + n.op + ' ' + rr.s };
            }
            break;
          }
          const rr = ev(n.r);
          r = { v: binop(n.op, l.v, rr.v), s: l.s + ' ' + (OP_DISP[n.op] || n.op) + ' ' + rr.s };
          break;
        }
      }
      if (n.paren) r.s = '(' + r.s + ')';
      return r;
    }

    function execBlock(list) {
      for (const s of list) exec(s);
    }

    function exec(s) {
      switch (s.type) {
        case 'assign': {
          newCtx(s.line);
          const res = ev(s.expr);
          const w = assign(s.target, res.v);
          const lit = isLiteral(s.expr);
          step(s.line, 'do',
            `${C(toStr(s.target))} に ${lit ? B(w.nu) + ' ' : C(toStr(s.expr)) + ' の値'}を入れる`,
            [lit ? '' : '計算: ' + chain(s.expr, res), lit && w.isNew ? '' : '変化: ' + changeText(w)],
            { inline: `${w.desc} ← ${w.nu}` });
          break;
        }
        case 'incr': {
          newCtx(s.line);
          const cur = ev(s.target);
          const amt = ev(s.expr);
          needNum(s.dir > 0 ? '+' : '-', cur.v, amt.v);
          const w = assign(s.target, cur.v + s.dir * amt.v);
          step(s.line, 'do', `${C(toStr(s.target))} を ${B(fmtVal(amt.v))} ${s.dir > 0 ? '増やす' : '減らす'}`,
            ['変化: ' + changeText(w)], { inline: `${w.desc} ← ${w.nu}` });
          break;
        }
        case 'print': {
          newCtx(s.line);
          const vals = s.args.map((a) => ({ a, r: ev(a) }));
          const text = vals.map((x) => fmtPlain(x.r.v)).join('');
          output.push(text);
          step(s.line, 'out', `画面に「${esc(text)}」を表示する`,
            vals.filter((x) => !isLiteral(x.a)).map((x) => chain(x.a, x.r)),
            { inline: '表示: ' + text, outAdded: true });
          break;
        }
        case 'fill': {
          newCtx(s.line);
          const v = ev(s.expr).v;
          const had = env.has(s.name) && Array.isArray(env.get(s.name));
          if (!had) env.set(s.name, []);
          const fill = (arr) => {
            for (let i = 0; i < arr.length; i++) {
              if (Array.isArray(arr[i])) fill(arr[i]);
              else arr[i] = clone(v);
            }
            arr.dflt = v;
          };
          fill(env.get(s.name));
          ctx.writes.push({ name: s.name, path: null, isNew: !had, old: '', nu: fmtVal(env.get(s.name)), desc: s.name });
          step(s.line, 'do', `${C(s.name)} のすべての要素を ${B(fmtVal(v))} にする`,
            [had ? '' : `${C(s.name)} の要素は、使うときにすべて ${B(fmtVal(v))} から始まる`],
            { inline: `${s.name} の要素 ← ${fmtVal(v)}` });
          break;
        }
        case 'if': {
          for (let k = 0; k < s.branches.length; k++) {
            const br = s.branches[k];
            newCtx(br.line);
            const res = ev(br.cond);
            const t = truthy(res.v);
            let next;
            if (t) next = '→ 真なので、この中を実行する';
            else if (k < s.branches.length - 1) next = '→ 偽なので、次の「そうでなくもし」へ進む';
            else if (s.elseBody) next = '→ 偽なので、「そうでなければ」へ進む';
            else next = '→ 偽なので、この中は実行しないで先へ進む';
            step(br.line, t ? 'true' : 'false', `${k === 0 ? '「もし」' : '「そうでなくもし」'}の条件を調べる`,
              [chain(br.cond, res), next], { inline: '→ ' + (t ? '真' : '偽') });
            if (t) {
              execBlock(br.body);
              return;
            }
          }
          if (s.elseBody) {
            newCtx(s.elseLine);
            step(s.elseLine, 'do', '「そうでなければ」の中を実行する', ['上の条件がどれも偽だったので、ここへ来た']);
            execBlock(s.elseBody);
          }
          break;
        }
        case 'while': {
          let count = 0;
          for (;;) {
            newCtx(s.line);
            const res = ev(s.cond);
            const t = truthy(res.v);
            if (t) count++;
            step(s.line, t ? 'true' : 'false', `繰り返しの条件を調べる（${C(toStr(s.cond))} の間）`,
              [chain(s.cond, res), t ? `→ 真なので、中を実行する（${count}回目）` : '→ 偽なので、繰り返しを終える'],
              { inline: t ? `→ 真（${count}回目）` : '→ 偽（終わり）' });
            if (!t) break;
            execBlock(s.body);
          }
          break;
        }
        case 'for': {
          newCtx(s.line);
          const f = ev(s.from);
          const to = ev(s.to);
          const by = ev(s.by);
          for (const x of [f, to, by]) needNum('+', x.v, 0);
          if (by.v <= 0) throw err('「ずつ」の前の数は 0 より大きくします');
          const name = toStr(s.var);
          const up = s.dir > 0;
          const cmp = up ? '≦' : '≧';
          const test = (v) => (up ? v <= to.v : v >= to.v);
          let count = 0;
          const condLine = (v, ok) => `${C(`${name} ${cmp} ${fmtNum(to.v)}`)} → ${C(`${fmtNum(v)} ${cmp} ${fmtNum(to.v)}`)} → ${TF(ok)}`
            + (ok ? ` なので中を実行する（${count + 1}回目）` : ' なので繰り返しを終える');

          let v = f.v;
          let w = assign(s.var, v);
          let ok = test(v);
          step(s.line, ok ? 'true' : 'false',
            `繰り返しの始め: ${C(name)} を ${B(fmtNum(f.v))} から ${B(fmtNum(to.v))} まで ${B(fmtNum(by.v))} ずつ${up ? '増やし' : '減らし'}ながら`,
            [
              isLiteral(s.from) ? '' : '始め: ' + chain(s.from, f),
              isLiteral(s.to) ? '' : '終わり: ' + chain(s.to, to),
              '変化: ' + changeText(w),
              condLine(v, ok),
            ],
            { inline: `${name} ← ${fmtNum(v)}` + (ok ? '' : '（終わり）') });
          while (ok) {
            count++;
            execBlock(s.body);
            newCtx(s.line);
            const old = ev(s.var).v;
            v = old + s.dir * by.v;
            w = assign(s.var, v);
            ok = test(v);
            step(s.line, ok ? 'true' : 'false',
              `${C(name)} を ${B(fmtNum(by.v))} ${up ? '増やす' : '減らす'}`,
              ['変化: ' + changeText(w), condLine(v, ok)],
              { inline: `${name} ← ${fmtNum(v)}` + (ok ? '' : '（終わり）') });
          }
          break;
        }
        case 'until': {
          let count = 1;
          newCtx(s.line);
          step(s.line, 'do', '繰り返しの始め: ここから下を実行する（1回目）',
            [`${C(toStr(s.cond))} になったら終わる`], { inline: '1回目' });
          for (;;) {
            execBlock(s.body);
            newCtx(s.endLine);
            const res = ev(s.cond);
            const t = truthy(res.v);
            if (!t) count++;
            step(s.endLine, t ? 'true' : 'false', '終わりの条件を調べる',
              [chain(s.cond, res), t ? '→ 真になったので、繰り返しを終える' : `→ まだ偽なので、「繰り返す」の中をもう一度実行する（${count}回目）`],
              { inline: t ? '→ 真（終わり）' : '→ 偽（もう一度）' });
            if (t) break;
          }
          break;
        }
      }
    }

    try {
      newCtx(-1);
      step(-1, 'start', '実行の準備ができました', ['「次へ ▶」を押すと、1行ずつ実行します']);
      execBlock(program);
      newCtx(-1);
      step(-1, 'end', 'プログラムが終わりました', [`全部で ${steps.length - 1} 手順でした`]);
    } catch (e) {
      const line = e instanceof DnclError ? e.line : ctx ? ctx.line : -1;
      const message = e instanceof DnclError ? e.message : '内部エラー: ' + e.message;
      ctx = { line, reads: [], writes: [] };
      record(line, 'error', 'エラーで止まりました', [esc(message)]);
    }
    return { steps };
  }

  const api = { run, fmtVal, fmtPlain, DnclError };
  root.DNCL = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
