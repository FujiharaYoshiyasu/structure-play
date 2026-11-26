// DNCL の色分け。命令・変数・配列・関数・数・文字列・コメントを見分けて <span> で包む
(function (root) {
  'use strict';

  const QUOTES = { '"': '"', "'": "'", '「': '」', '“': '”', '＂': '＂' };
  const GUIDES = /^[ \t　│|└⎿┃┗├]+/;
  const KEYWORDS = [
    'そうでなくもし', 'そうでなければ', 'もし', 'ならば',
    '増やしながら', '減らしながら', '繰り返す', '繰り返し', 'の間', 'から', 'まで', 'ずつ',
    'になるまで', '実行する', '増やす', '減らす',
    'のすべての要素', 'のすべての値', 'を代入する', 'にする', 'とする',
    'かつ', 'または',
  ];
  const WORD_KEYWORDS = new Set(['and', 'or', 'not']);
  const CONSTANTS = new Set(['True', 'False', '真', '偽']);
  const FUNCS = [
    '表示する', '要素数', '整数', '切り捨て', '切り上げ', '四捨五入', '絶対値', '平方根',
    '乱数', '二進', '文字列', '数値',
  ];
  const WORD_FUNCS = new Set(['print', 'len', 'int', 'abs', 'str']);
  const JP_WORD = new RegExp(
    [...KEYWORDS, ...FUNCS, ...CONSTANTS].sort((a, b) => b.length - a.length).join('|'), 'g');

  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const span = (cls, s) => `<span class="hl-${cls}">${esc(s)}</span>`;

  // プログラム全体から、配列として使われている名前を集める
  function arrayNames(source) {
    const names = new Set();
    const res = [
      /([A-Za-z_]\w*)\s*[[［]/g,
      /([A-Za-z_]\w*)\s*[=＝←]\s*[[［]/g,
      /([A-Za-z_]\w*)\s*のすべての/g,
      /要素数\s*[(（]\s*([A-Za-z_]\w*)/g,
    ];
    for (const re of res) for (const m of source.matchAll(re)) names.add(m[1]);
    return names;
  }

  function japanese(text) {
    let out = '';
    let last = 0;
    for (const m of text.matchAll(JP_WORD)) {
      out += esc(text.slice(last, m.index));
      const w = m[0];
      out += span(FUNCS.includes(w) ? 'f' : CONSTANTS.has(w) ? 'n' : 'k', w);
      last = m.index + w.length;
    }
    return out + esc(text.slice(last));
  }

  function line(text, arrays) {
    let out = '';
    const g = GUIDES.exec(text);
    let i = 0;
    if (g) {
      out += span('g', g[0]);
      i = g[0].length;
    }
    while (i < text.length) {
      const c = text[i];
      const rest = text.slice(i);
      let m;
      if (QUOTES[c]) {
        const end = text.indexOf(QUOTES[c], i + 1);
        const stop = end < 0 ? text.length : end + 1;
        out += span('s', text.slice(i, stop));
        i = stop;
      } else if (c === '#' || c === '＃') {
        out += span('c', rest);
        break;
      } else if ((m = /^[0-9０-９]+(?:[.．][0-9０-９]+)?/.exec(rest))) {
        out += span('n', m[0]);
        i += m[0].length;
      } else if ((m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(rest))) {
        const w = m[0];
        let cls = 'v';
        if (WORD_KEYWORDS.has(w)) cls = 'k';
        else if (CONSTANTS.has(w)) cls = 'n';
        else if (WORD_FUNCS.has(w)) cls = 'f';
        else if (arrays.has(w)) cls = 'a';
        out += span(cls, w);
        i += w.length;
      } else if ((m = /^[-+*/÷%=<>!≦≧≠≤≥×＋－＊／％＝＜＞←]+/.exec(rest))) {
        out += span('o', m[0]);
        i += m[0].length;
      } else if ((m = /^[^\x00-\x7F０-９＃"'「“＂÷≦≧≠≤≥×＋－＊／％＝＜＞←]+/.exec(rest))) {
        out += japanese(m[0]);
        i += m[0].length;
      } else {
        out += esc(c);
        i++;
      }
    }
    return out;
  }

  // 1行ずつの HTML の配列を返す
  function highlight(source) {
    const arrays = arrayNames(source);
    return source.replace(/\r\n?/g, '\n').split('\n').map((t) => line(t, arrays));
  }

  root.DNCLHighlight = { highlight };
})(window);
