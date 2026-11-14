# プロファイルを画面から選ぶ (v0.4.0)

状態: **実装済み (v0.4.0-dev、2026-11-14)。**

## 背景

表示中の snapshot に合うプロファイルが複数あるとき (例: mddo-fw の `asis.yaml` と `asis_y.yaml`)、使うものを URL (`?profile=<名前>`) を手で書き換えて選ぶしかなかった。

## 変更

schematic レイアウトのツールバーに、**Profile** の選択を追加した。仕様は [design/profile_format.md](../../design/profile_format.md) の「選択 (画面から)」。

- `profileSource.ts`: `profileChoices(network, source, snapshot)` を追加。ファイルごとに、名前で指定したときと同じ検査 (`loadProfiles`) をして、`applies` (いずれかの文書が network / snapshot に合う) と `error` を返す。
- `ForceView.vue`: ツールバーに `<select data-testid="profile-select">` を追加 (schematic のときだけ。候補が無く名前の指定も無いときは出さない)。選ぶと `update:profile` を出す。
  - 合うファイルだけを候補にする。URL で名前を指定したファイルが合わないときは、理由付きで候補に残す。
  - プロファイルのファイル一覧は、最初の取得を覚えて、プロファイルの読み込みと候補で共有する (backend への問い合わせは 1 回)。
- `TopologyView.vue`: `update:profile` で `?profile=` を設定する (自動は外す)。`?layout=` と同じ流儀 (`router.replace`)。
- テスト: `profileSource.test.ts` (`profileChoices`)、`ForceView.test.ts` (選択の表示・イベント・問い合わせ回数)、`views.test.ts` (URL への反映)。

## 互換性

追加のみ。`?profile=` の動作、自動選択、既存のイベント・prop は変えない。

## 今後の課題

- 選択は、ファイル単位。文書 (view) 単位で選ぶ (1 つのファイルの中の複数の view から選ぶ) ことはできない。
- ファイル一覧は、ビューを開いている間は再取得しない (プロファイルを直したら、ブラウザを再読み込みする: 従来どおり)。
