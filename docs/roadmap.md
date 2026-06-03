# Roadmap Notes

Read Later Is Broken の実装方針と、リリース前に決めた取捨選択を残すメモです。

## Implemented

- 現在のブラウザタブ 1 件を対象にする。
- NotebookLM の既存ノートブックを一覧取得し、popup 内で検索・選択する。
- popup は「ダイジェスト」と「テーマ別」に分かれている。
- ダイジェストでは Daily、Weekly、Monthly だけを対象にする。
- テーマ別ではチェック済みの既存ノートブックだけを追加対象にする。
- 新規ノートブックは検索欄兼新規名入力欄と作成専用ボタンで作成し、作成後に既存ノートブック一覧へチェック済みで追加する。
- Daily / Weekly / Monthly は固定ISO形式の名前で作成・再利用する。
- 追加処理は background ジョブとして実行し、popup を閉じても処理を続ける。
- 前回の追加結果を popup に残す。
- 新規ノートブックはタイトルと絵文字を省略できる。省略時は NotebookLM 側の自動命名・自動絵文字に任せる。
- 既存ノートブック一覧は、一覧更新・検索・作成後の表示でチェック済みを上に並べる。チェック操作直後とpopup再表示だけでは並び替えない。

## Date Notebooks

日付ノートブック名は、地域差のある日付表記ではなく ISO 形式で固定する。

| Period | Name format | Emoji |
| --- | --- | --- |
| Daily | `Daily yyyy-MM-dd` | `📅` |
| Weekly | `Weekly yyyy-Www` | `📆` |
| Monthly | `Monthly yyyy-MM` | `🗓️` |
| Quarterly | `Quarterly yyyy-Qq` | `🗂️` |
| Yearly | `Yearly yyyy` | `📚` |

Quarterly / Yearly は未実装。追加する場合は上記の名前と絵文字を使う。

## Future Candidates

- URLパターンマッチングで追加先候補を自動チェックする。
- 右クリックメニューから現在ページやリンクを追加する。
- インポート履歴を表示する。
- Chrome Web Store 向けのアイコン、スクリーンショット、説明文、プライバシー説明を整える。

## Deferred / Out Of Scope

- 複数タブ一括追加は外す。現在の実装でも追加先が多いとNotebookLM側の処理待ちや上限で不安定になりやすく、`タブ数 x 追加先数` のRPCにすると扱いづらい。
- 自由な命名テンプレート編集は外す。日付ノートブックは固定ISO形式で運用する。地域差への対応は、日付順序を変えるのではなくローカル日付をISO形式に整形することで扱う。
- Deep Diveや音声解説の自動生成はしない。
- NotebookLM / Google 公式に見える表現は使わない。

## NotebookLM Limits To Keep In Mind

- Google AI Plus では、ノートブック数は200件まで。
- 1ノートブック内のURLソース数は100件まで。
- 上限に達した場合は、NotebookLM側でノートブックやソースを削除しない限り失敗し続ける。
- そのため、前回の失敗結果はpopupに残してユーザーが確認できるようにする。
