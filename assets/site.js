/* サイトの公開ステータス: アプリを配置したら preparing → published に変更します。 */
const APP_STATUS = {
  'moment-battle': 'preparing',
  '765': 'preparing',
  'nqm': 'preparing',
};

(() => {
  'use strict';
  const cards = [...document.querySelectorAll('.app-card')];
  const filters = [...document.querySelectorAll('.filter-button')];
  const count = document.getElementById('visible-count');
  const message = document.getElementById('app-list-status');
  const descriptions = { all: 'すべて', game: 'ゲーム', study: '学習ツール' };

  for (const card of cards) {
    const status = card.querySelector('.status-tag');
    const published = APP_STATUS[card.dataset.app] === 'published';
    status.textContent = published ? '公開中' : '公開準備中';
    status.classList.toggle('is-ready', published);
  }

  const updateFilter = (selected) => {
    for (const button of filters) {
      const active = button.dataset.filter === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
    let visible = 0;
    for (const card of cards) {
      const show = selected === 'all' || card.dataset.category === selected;
      card.hidden = !show;
      if (show) visible += 1;
    }
    count.textContent = String(visible).padStart(2, '0');
    message.textContent = `${descriptions[selected]}：${visible}つのアプリを表示しています。`;
  };

  for (const button of filters) {
    button.addEventListener('click', () => updateFilter(button.dataset.filter));
  }
  document.getElementById('copyright-year').textContent = new Date().getFullYear();
})();
