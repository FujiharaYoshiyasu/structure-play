# STRUCTURE & PLAY — 3つのWebアプリの公開サイト

構造力学や数字ゲームを紹介するWebサイトの **第1版（トップページ＋配置用フォルダー）** です。
スマートフォン対応、アプリカテゴリーの絞り込み機能付き。HTML/CSS/JavaScriptのみで動作します。

> **重要**：このZIPには、3つのアプリそのものはまだ入っていません。各 `apps/*/index.html` は「公開準備中」と表示する案内ページです。お手元のアプリを後から差し替えてください。

## まず画面を確認

ZIPを展開し、最上位の `index.html` をダブルクリックしてください。ブラウザでトップページを表示できます。
「アプリのページへ」を選ぶと、各アプリの現在の案内ページに移動できます。

## アプリを組み込む

アプリのHTMLファイルを以下のそれぞれの `index.html` と置き換えます。

| アプリ | 差し替えるファイル |
|---|---|
| 梁モーメント対戦 | `apps/moment-battle/index.html` |
| 765 | `apps/765/index.html` |
| NQM図作成 | `apps/nqm/index.html` |

元アプリが画像・音声・CSS・JavaScript等の別ファイルを使用する場合は、**アプリが元々使用するディレクトリ構成を維持したまま** 同じフォルダにコピーしてください。1ファイル完結型なら `index.html` のみで大丈夫です。

各アプリを組み込んだら、`assets/site.js` の先頭にある `APP_STATUS` の該当項目を `'preparing'` から `'published'` に変更します。トップページのバッジが「公開中」に切り替わります。

```js
const APP_STATUS = {
  'moment-battle': 'published',
  '765': 'published',
  'nqm': 'published',
};
```

## GitHub Pagesでインターネットに公開する（無料）

既存の研究データ用 `Analysis` リポジトリとは分けて、新しく、たとえば `structure-play` という **Public リポジトリ** を作ることを推奨します。

1. GitHubで空のリポジトリ（例：`structure-play`）を新規作成する。
2. 本フォルダの **中身**（`index.html`、`assets/`、`apps/`、`.nojekyll`、`README.md`）をリポジトリ直下にアップロードしてコミットする。
3. リポジトリの **Settings → Pages → Build and deployment → Source** で `Deploy from a branch` を選択する。
4. Branchを `main`、フォルダーを `/(root)` に指定し、**Save** を押す。
5. 公開URLは通常 `https://<GitHubユーザー名>.github.io/structure-play/` です（作成した名前によって変わります）。Settings → Pages に表示される実際のURLを確認してください。

公開に数分かかる場合があります。公開サイトには誰でもアクセスでき、配置したソースコードやデータも公開されるため、個人情報や実験の非公開データを含めないでください。

GitHub公式ガイド：
- https://docs.github.com/ja/pages/getting-started-with-github-pages/creating-a-github-pages-site
- https://docs.github.com/ja/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site

## フォルダ構成

```
structure-play-site/
├── index.html             # トップページ
├── assets/
│   ├── style.css          # 色・レイアウト
│   ├── site.js            # 公開状態・絞り込み
│   ├── favicon.svg
│   ├── moment.svg          # アプリ紹介用イラスト
│   ├── 765.svg
│   └── nqm.svg
├── apps/
│   ├── moment-battle/
│   │   └── index.html      # あとからアプリ本体と差し替える
│   ├── 765/
│   │   └── index.html
│   └── nqm/
│       └── index.html
└── .nojekyll
```

## カスタマイズ

- サイト名・本文：`index.html` を編集
- 配色・サイズ：`assets/style.css` の `:root` を編集
- アプリの公開状況：`assets/site.js` の `APP_STATUS` を編集
- 学校や研究室HPからリンクさせる場合：GitHub Pages公開後のURLを学校HPに設置

NQM図作成ツールは構造計算の正しさ・適用範囲を利用者自身が検証できるよう、今後「前提条件」「利用上の注意」「計算例」を個別アプリ側に追加すると安心です。
