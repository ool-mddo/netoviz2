# netoviz2

ool-mddo のマルチレイヤ・ネットワークトポロジ用ビューワー (フロントエンドのみ)。
データの読み込み・加工は netomox-exp の `/topologies/:network/:snapshot/netoviz2/*` API が行い、netoviz2 は REST API 経由でデータを取得して描画・操作に専念する (ローカルファイルは持たない)。

- データ形式・API 仕様: playground の `docs/netoviz2_data_format.md`
- 計画: playground の `docs/work/plans/netoviz2_requirements.md`

## 開発

Node.js 24 以上。

```bash
npm install
npm run dev          # http://localhost:5173/netoviz2/ (API は NETOVIZ2_API_URL (既定 http://localhost:15000) へプロキシ)
npm run typecheck
npm test
npm run lint
npm run build        # dist/ (静的ファイル。/netoviz2/ 配下で配信する)
```

## URL

- `/netoviz2/` : network / snapshot 一覧
- `/netoviz2/:network/:snapshot` : トポロジの表示

## コンテナ

`Dockerfile` は、ビルドした静的ファイルを nginx で `/netoviz2/` 配下に配信するイメージを作る (ランタイムの Node は含まない。volume も持たない)。
playground の `docker-compose.yaml` の `netoviz2` サービスとして起動し、api-proxy (nginx) の `/netoviz2/` から転送される。

```bash
# playground のディレクトリで
docker compose up -d --build netoviz2 api-proxy
# http://localhost:15000/netoviz2/
```

## 構成

```
src/
  api/          netomox-exp の netoviz2 API の型とクライアント (ETag 対応)
  domain/       Viewer に依存しない純粋なロジック (support 索引・トレース、リンクの束ね、グラフ構築、diff data)
  stores/       Pinia: topology (summary・レイヤ・supports・属性、ETag による更新)、selection (選択とトレース)、view (展開状態)
  composables/  選択処理 (useSelect)、ポーリング (usePolling)
  render/       描画 (ForceRenderer: d3-force + SVG。Vue のリアクティブ機構を通さず DOM を直接更新)
  components/   ForceView, AttributePanel, JsonTree, LayerList, SummaryBar
  views/        HomeView (一覧), TopologyView (表示)
```

## URL のクエリ

`/netoviz2/:network/:snapshot?layers=<id,id>&sel=<object id>` : 表示するレイヤと選択中のオブジェクト (リンクで共有できる)。

## 機能 (MVP)

- force-simulation 表示 (ノード単位。ダブルクリックで term-point を展開)
- **レイアウトエンジン**: stress (自前のストレス最小化。既定) と force (d3-force) を切り替えられる (`?layout=<engine>`)。各パネルに所要時間・リンクの交差数・ノードの重なりを表示する。設計と検討の経緯 (ELK を採用しなかった理由を含む) は playground の `docs/design_notes/netoviz2_layout.md`
- **dependency (レイヤ帯) 表示** (副画面): ツールバーの「Dependency view」(`?dependency=1`) でトポロジ表示の隣に出し入れする。**トポロジ表示で選択した node / term-point だけ**について、それを支えるオブジェクト (下位レイヤ) と、それが支えるオブジェクト (上位レイヤ) の依存関係ツリーを、レイヤの帯 (上位が上) に描く。term-point を選ぶと term-point の依存、node を選ぶと node の依存 (「Term-points」で、その node の term-point の依存も加える)。**term-point は必ず所属する node の枠 (箱) の中に表示する** (どの node の term-point かが分かるように、node と分離しない。term-point だけが対象でも、その node を破線の枠で添える。term-point のない node は円)。ツリーの中のオブジェクトをクリックすると、それを選択して辿れる (選択はトポロジ表示と共有)。support 先のないオブジェクトは帯の右端ではなく上位のオブジェクトの下に置く。レイヤをまたぐ関係の設定ミスを見つけるデバッグ用途で、「Mark problems」で次を印付けして一覧する (`problems` ボタン。項目のクリックでオブジェクトを選択。対象は表示中のツリーのオブジェクト): 下位ノードに支えられていないノード (`unsupported`)・上位から使われていないノード (`unused`)・ノードの support がなく term-point の support だけがある (`tp-only`)・同じレイヤ内や上位から下位でない support (`same-layer` / `inverted`)・宣言されていないレイヤ間の support (`undeclared`)・宣言されているのに support がない (`no-support`)
- レイヤの表示切替 (チェックボックス。「Select all / Clear all」で全選択・全解除。1 つのレイヤに着目するときは、全解除してから選ぶ)、networks flags / diff / 警告の表示
- オブジェクトの選択 → support のトレース (上位/下位レイヤ) を強調、右パネルに属性・diff を表示
- 5 秒ごとに ETag を確認し、トポロジが更新されたら自動で再読込

## CI (GitHub Actions)

push で、lint・型検査・テストを実行し、成功したらコンテナイメージ (`ghcr.io/ool-mddo/netoviz2:<ブランチ名>`) を作成する。古い (タグの無い) イメージは、直近 10 件を残して削除する。
**イメージのタグはブランチ名なので、ブランチ名にスラッシュを入れない** (例: `v0.1.0-dev`)。

## ライセンス

MIT ([LICENSE](LICENSE))。

## テーマ

ライト / ダークは、ヘッダー右の「Auto / Light / Dark」で切り替える (Auto はブラウザ・OS の設定に従う。選択はブラウザに保存する)。色は `src/styles/theme.css` の変数で一元管理している (`color-scheme` と `light-dark()`)。
