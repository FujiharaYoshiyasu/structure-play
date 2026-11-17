# FRAME QUIZ — 無料オンラインランキング導入手順

更新: 2026-11-17

## 現在の状態

GitHub Pages の HTML は稼働中。ニックネーム別の連続全問正解は **localStorage（端末ごとの保存）** であり、まだ全端末共有ではありません。片持ちラーメン部門のみ出題できます。単純・3ピン部門は未実装です。

## 推奨構成

GitHub Pages（問題画面） → Cloudflare Workers（問題発行、採点検証、ランキングAPI） → Cloudflare D1（ニックネーム・連続正解記録の保存）。GitHub Pages は移転しない。

Cloudflare Workers Free／D1 Free の現行枠: Workers 100,000 requests/日、D1 5,000,000 rows read/日、100,000 rows written/日、無料ストレージはアカウント合計5GB、1データベース最大500MB。無料枠を使い切るとリクエスト等が失敗する場合があります。最新条件は公式情報を確認してください。

- https://developers.cloudflare.com/workers/platform/limits/
- https://developers.cloudflare.com/d1/platform/pricing/
- https://developers.cloudflare.com/d1/platform/limits/
- https://developers.cloudflare.com/d1/get-started/

## ご本人による初期設定（課金プランへの変更は不要）

1. https://dash.cloudflare.com/sign-up で Cloudflare の無料アカウントを作り、メール認証する。
2. ダッシュボードの **Workers & Pages** から Worker を新規作成。候補名は `frame-quiz-api`。
3. **D1 SQL Database** から新しいデータベースを作成。候補名は `frame-quiz-rankings`。
4. Worker の **Settings → Bindings → Add binding → D1 database** で D1 を接続。変数名 `DB` とし、データベース `frame-quiz-rankings` を指定する。
5. Worker の `workers.dev` URL（公開されるAPIアドレス）を控える。**APIトークン、秘密鍵、アカウントのパスワードは共有しない。**
6. 次の実装段階で、Worker にAPIを配置し、D1 にランキングの表を作成して、GitHub Pages側の接続先を設定する。

画面メニューはサービスの更新により表記が変わる場合があります。

## ランキングの要件

- 3部門: `cantilever`（片持ち）、`simple`（単純）、`threepin`（3ピン）。
- 表示: 各部門上位10名（ニックネーム、自己最高の連続全問正解数）。
- 単純・3ピンは出題実装までランキングを表示のみとし、記録の投稿を受け付けない。
- ニックネームは1～16文字。氏名や個人情報は登録させない。削除・不適切な表示名の対応方法も用意する。
- 同点の場合の順位の決め方（先着など）を固定する。1人あたり最高記録を採用する。

## 必須のセキュリティ設計

**ブラウザが送る「3問正解」「連続○問」という数字を信頼してサーバーに保存しない。** 現行HTMLには正解判定用の情報があるため、自己申告スコアは簡単に偽装できます。

1. Worker が1問の問題ID・設定・正解をサーバー側で生成し、ユーザーには問題と匿名トークンのみ渡す（正解を返さない）。
2. ユーザーの N/Q/M 選択を Worker が採点する。採点結果に従い、サーバーが連続数を更新する。
3. 同じ問題の再送・再採点を拒否する。問題セッションに有効期限を設ける。
4. ランキング登録のなりすまし、書き込み連打、無制限アカウント作成への対策を設ける。ニックネームだけを認証情報にはしない。
5. APIからのCORS許可元は `https://fujiharayoshiyasu.github.io` に限定する（CORSだけでは不正投稿は防げない）。
6. 以前のlocalStorage記録は本人確認・採点検証がないため、オンライン記録にそのまま移行しない。オンライン導入時から新規集計にする。

## 実装順序

- Phase 1: Cloudflareアカウント／Worker／D1の作成（アカウント所有者による操作）。
- Phase 2: 現行の片持ちラーメン問題生成・NQM採点を Worker 内へ移植し、サーバー主導で出題する。
- Phase 3: ニックネーム・匿名トークン・各部門TOP10の記録／取得APIを作成。検証と不正対策を行う。
- Phase 4: GitHub Pages のFRAME QUIZとAPIを接続し、実端末2台以上で更新を検証する。
- Phase 5: 単純・3ピンの問題生成を実装後に部門を開放する。

**注意:** 2026-11-17時点で本リポジトリにはCloudflareへの自動デプロイ設定や公開資格情報はなく、オンラインランキングはまだ稼働していません。
