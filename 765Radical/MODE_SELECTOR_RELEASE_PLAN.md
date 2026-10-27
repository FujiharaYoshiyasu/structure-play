# 765 Classic / Radical モード選択 — 公開準備計画

**ステータス：開発ブランチのみ。公開サイトへの反映は禁止。**

## 現状（2026-10-27）

- リポジトリは Public: https://github.com/FujiharaYoshiyasu/structure-play
- 現在の公開サイト（Classic）: https://fujiharayoshiyasu.github.io/structure-play/apps/765/
- 現在の公開本体: \`main:apps/765/index.html\`
- Radical開発本体: \`765-radical-dev:765Radical/index.html\`
- **入口画面の試作**: \`765-radical-dev:765Radical/mode-select.html\`
- 公開ホームページに Radical の導線は設置していない。GitHub Pages の公開元も変更しない。
- Publicリポジトリの開発ブランチは誰でも閲覧できる。**ホームページ未公開≠ソースコード非公開**。

## 今回の実装

\`mode-select.html\` は1ページ構成・外部ライブラリなしの静的HTML。Classic/Radicalの2つのカードを表示し、利用者がモードを選んで移動する。

開発時のリンク:
- Classic → https://fujiharayoshiyasu.github.io/structure-play/apps/765/
- Radical → \`./index.html\`（同じ \`765Radical/\` 内のゲーム。**サイトではまだ配信しない**）

注意：GitHubの通常のソース閲覧画面では HTML はゲームとして実行されない。試遊には \`mode-select.html\` と \`index.html\` を同一フォルダへ保存してブラウザで開くか、ローカルサーバーを使用する。

## 将来、正式公開の明示指示があった場合の設計

現行URLを「入口」へ変える予定で、それまでは一切実行しない。

| 項目 | 公開後に想定する配置 |
|---|---|
| 共通入口 | \`main:apps/765/index.html\` → モード選択 |
| Classic | \`main:apps/765/classic/index.html\` → **現在のClassicをそのままコピー** |
| Radical | \`main:apps/765/radical/index.html\` → 安定確認済みRadicalをコピー |
| HP側のリンク | 現行 \`apps/765/index.html\` のまま（入口を指す） |

正式公開時の安全な移行手順:
1. 現在の Classic 本体のSHAを確認・保存し、\`apps/765/classic/index.html\` へバイト単位でコピー。
2. Radicalの最新安定版を検証し、\`apps/765/radical/index.html\` へコピー。
3. 入口画面を本番用に切替え、Classicリンク \`./classic/\`、Radicalリンク \`./radical/\` を設定。
4. 旧Classicの「CPU対戦・2人対戦・2回戦・得点」の回帰テスト、Radicalの能力対象・ヒント・復習・スマホ表示を確認。
5. 旧URLのリンク・QRコードから問題なく入口へ到達できるか確認。
6. **ユーザーの別途明示承認後**に公開用 \`main\` を更新する。いきなり\`main\`へマージしない。

## 禁止事項（ユーザーの明示指示が出るまで）

- \`main\` の\`apps/765/index.html\`を変更しない
- \`main\`にRadicalを追加・マージしない
- 公開HPのカードからRadicalへのリンクを作らない
- GitHub Pagesの公開元・カスタムドメイン・Actionsデプロイ設定を変更しない
- 試作画面を一般公開URLにアップロードしない

## 次の改善候補

- 入口カードのデザインと名称の調整
- Radicalの特殊能力・CPUレベルの説明をプレイヤー向けに洗練
- 将来の公開用プレビューと、実際の本番移行手順のテスト
