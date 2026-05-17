# Read Later Is Broken

Chrome 拡張の初期環境です。

「あとで読む」は読まれない。まず聴き、つぎに問う。

この拡張は、閲覧中のページを NotebookLM に保存し、あとで Deep Dive できるソースにするための補助ツールです。Deep Dive の生成は自動実行しません。

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
- 現在ページのタイトルと URL を popup に表示します。
- 既存ノートブックは options 画面で手動登録します。
- 登録済みノートブックでは NotebookLM タブを開き、現在ページの URL をソースとして追加します。
- 新規ノートブックでは URL をクリップボードへコピーし、NotebookLM を開きます。
- ノートブック一覧の自動取得、ノートブック自動作成、Deep Dive 自動生成は行いません。

## Files

- `public/manifest.json`: Chrome Manifest V3
- `popup.html`, `src/popup/*`: 拡張アイコン押下時の UI
- `options.html`, `src/options/*`: 保存先ノートブック管理 UI
- `src/shared/*`: storage と型定義
- `src/background.ts`: service worker
