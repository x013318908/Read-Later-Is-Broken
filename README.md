# Read Later Is Broken

Chrome 拡張の初期環境です。

「あとで読む」は読まれない。まず聴き、つぎに問う。

この拡張は、閲覧中のページを NotebookLM のノートブックにソースとして追加するための補助ツールです。

This project is not affiliated with Google or NotebookLM.

## Setup

```powershell
npm install
npm run build
```

Chrome で `chrome://extensions` を開き、Developer mode を有効にして、`dist` フォルダを Load unpacked で読み込みます。

開発中は次を実行すると、変更時に `dist` が再生成されます。

```powershell
npm run dev
```

## Current Scope

- 拡張アイコンを押した時だけ、現在のタブ 1 件を対象にします。
- 現在ページは popup 表示時に内部で取得し、選択した NotebookLM ノートブックへ追加します。
- 保存済みの既存ノートブックが空の場合は、popup 表示時に NotebookLM のノートブック一覧を自動取得します。
- popup の一覧更新ボタンから NotebookLM のノートブック一覧を再取得できます。
- popup では、NotebookLM の登録済みノートブック、新規ノートブック、Daily をチェックボックスで複数選択できます。
- 登録済みノートブックのチェックリストはスクロール可能なグループとして表示し、選択した保存先へ NotebookLM タブを裏で最大 3 件ずつ開いて現在ページの URL をソースとして追加します。
- 登録済みノートブックは名前順で表示し、検索ボックスで絞り込めます。チェック中のノートブックは検索条件に関係なく表示します。
- Daily チェック行にはローカル日付の `Daily yyyy-MM-dd` を表示し、そのノートブックにも現在ページの URL を追加します。
- Daily ノートブックは同名があれば再利用し、なければ NotebookLM に新規作成します。Daily と新規のチェック状態は前回値を記録し、未記録時はオフです。
- 複数追加では NotebookLM 側の取り込み結果を拡張側で断定せず、必要に応じて NotebookLM 側のソース一覧で確認します。
- 新規ノートブックでは NotebookLM にノートブックを作成し、現在ページの URL をソースとして追加します。
- 週次/月次プリセット、命名テンプレート編集、URLパターンマッチングは行いません。

## Files

- `public/manifest.json`: Chrome Manifest V3
- `popup.html`, `src/popup/*`: 拡張アイコン押下時の UI
- `src/shared/*`: storage と型定義
- `src/background.ts`: service worker
