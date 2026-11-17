# FRAME QUIZ — Cloudflare Worker v2（3形式のランキング対応）

## 現在の構成

- Webゲーム: `apps/frame-quiz/index.html`（GitHub Pages）
- Cloudflare Worker: `frame-quiz-api`（Cloudflare Dashboard）
- D1: `frame-quiz-rankings`（既存の `DB` バインディング）
- Worker更新用ソース: `apps/frame-quiz/cloudflare-worker-v2.js`

## 導入手順（データを保持して更新）

1. [Cloudflare Dashboard](https://dash.cloudflare.com/) → Workers & Pages → `frame-quiz-api` → Edit code。
2. 最新のActiveバージョンを選択する。現在のコードを別のファイルに控えておく。
3. `cloudflare-worker-v2.js` の全コードを `worker.js` に上書き貼付。
4. **Deploy** を押して反映。D1バインディング名 `DB` を維持。
5. [ヘルスチェック](https://frame-quiz-api.y-fujihara.workers.dev/health) を確認。レスポンスに `"version":2` と `"categories":["cantilever","simple","threepin"]` が含まれれば新Workerが有効。
6. `https://fujiharayoshiyasu.github.io/structure-play/apps/frame-quiz/` を再読み込み。

データベースの既存3テーブル `leaderboard_scores`, `quiz_sessions`, `quiz_rounds` は**変更・削除不要**。

## 動作と採点方式

- 片持ち: 固定端1箇所（従来の処理）
- 単純: 左右支点の一方ピン・他方ローラー
- 3ピン: 両端ピン・梁中央Eヒンジ（M(E)=0）
- 各形式を同じD1内で `category` により分け、TOP10表示
- POST `/sessions`: 3形式のカテゴリーに対応
- POST `/rounds`: 1〜3個の荷重を整数位置で生成。正解はD1に保存し、SVG選択肢だけを返す
- POST `/answers`: サーバーで採点し、同じ問題の二重加点を防止

## Worker更新前の制約

Webサイトの**単純・3ピンの問題演習は動作する**が、この2形式のランキングはブラウザ内のみの暫定保存で、別端末と共有されない。
Worker v2 デプロイ後はページが `/health` で対応形式を自動検出し、サーバー採点・共通ランキングに切り替える。

## 注意点

- 端末内の暫定ランキングは自動的にD1へ移行しない（サーバーが検証していない記録を移行させないため）。
- ニックネームはランキングで公開される。
- 学習用解析。実務構造設計には使用しない。
