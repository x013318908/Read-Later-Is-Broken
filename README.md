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
- popup は、Daily / Weekly / Monthly へ雑に入れる「ダイジェスト」と、テーマ別の既存ノートブックへ入れる「テーマ別」に分かれています。
- ダイジェスト側の `NotebookLM に追加` は Daily / Weekly / Monthly だけを対象にします。
- テーマ別側の `NotebookLM に追加` はチェック済みの登録済みノートブックだけを対象にします。
- 登録済みノートブックのチェックリストはスクロール可能なグループとして表示し、選択した保存先へ NotebookLM タブを裏で最大 3 件ずつ開いて現在ページの URL をソースとして追加します。
- 登録済みノートブックは検索・新規名入力欄で絞り込めます。チェック中のノートブックは検索条件に関係なく表示し、一覧更新・検索・作成後の表示ではチェック済みを上に並べます。
- 新規ノートブックは `作成` ボタンで作成し、作成後に登録済みノートブック一覧へチェック済みで追加します。検索・新規名入力欄が空の場合は空のまま NotebookLM に渡します。
- Daily / Weekly / Monthly チェック行には、ローカル日付に基づく `Daily yyyy-MM-dd`、`Weekly yyyy-Www`、`Monthly yyyy-MM` を表示し、そのノートブックにも現在ページの URL を追加します。
- Daily / Weekly / Monthly ノートブックは同名があれば再利用し、なければ NotebookLM に新規作成します。各チェック状態は前回値を記録し、未記録時はオフです。
- URL追加は background 側のジョブとして実行し、popup を閉じても処理を続けます。
- 前回の追加結果は popup に表示します。NotebookLM 側の上限などで失敗した場合も、次に popup を開いたときに確認できます。
- 複数追加では NotebookLM 側の取り込み結果を拡張側で断定せず、必要に応じて NotebookLM 側のソース一覧で確認します。
- 命名テンプレート編集、URLパターンマッチング、複数タブ一括追加は行いません。

今後の候補や外した計画は `docs/roadmap.md` に残しています。

## Files

- `public/manifest.json`: Chrome Manifest V3
- `popup.html`, `src/popup/*`: 拡張アイコン押下時の UI
- `src/shared/*`: storage と型定義
- `src/background.ts`: service worker
