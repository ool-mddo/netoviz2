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

## 手動での動作確認

ソースを直しながら画面で確認する方法は 3 つある。**コンテナ (nginx の静的配信) は、ソースを mount しておらず、修正を自動では反映しない** (netoviz のようなホットリロードはない)。修正中は 1 の開発サーバを使う。

前提: playground が起動していて (`docker compose up -d`)、確認したいトポロジが netomox-exp にあること。表示するデータ (API) はいずれも、api-proxy (`http://localhost:15000`) 経由で netomox-exp から取る。

### 1. 開発サーバ (修正中の確認。保存すると自動でブラウザが更新される)

```bash
cd repos/netoviz2
npm install                      # 初回のみ
npm run dev                      # → http://localhost:5173/netoviz2/ (ポートが使用中なら別のポート。起動時の表示を見る)
# api-proxy が別のホスト/ポートのときは、API の転送先を指定する
NETOVIZ2_API_URL=http://<host>:15000 npm run dev
```

- ソースの保存で、ブラウザが自動で更新される (HMR)。API は同じオリジンの `/topologies/...` として、開発サーバから `NETOVIZ2_API_URL` へ転送される。
- 表示の例 (`<network>` / `<snapshot>` は `http://localhost:15000/topologies/index` で確認できる):
  - 一覧: `http://localhost:5173/netoviz2/`
  - トポロジ: `http://localhost:5173/netoviz2/<network>/<snapshot>`
  - 状態は URL で指定できる: `?layers=<レイヤ ID,...>&sel=<オブジェクト ID>&layout=<stress|force>&dependency=1` (ID は URL エンコードする)。

### 2. 手元のソースでコンテナを作って確認する (コンテナで動く状態の確認)

```bash
# リポジトリのルートで、CI と同じタグでイメージを作る (.env の NETOVIZ2_IMAGE_TAG と同じタグ)
docker build -t ghcr.io/ool-mddo/netoviz2:v0.1.0-dev repos/netoviz2
# playground のディレクトリで、pull せずに作り直す (pull すると CI のイメージで上書きされる)
docker compose up -d --force-recreate netoviz2 api-proxy
# → http://localhost:15000/netoviz2/
```

- 修正のたびに `docker build` からやり直す (自動では反映されない)。ブラウザに古い JS が残るときは強制再読み込み (Ctrl+Shift+R)。
- 元に戻す (CI のイメージを使う) ときは `docker compose pull netoviz2 && docker compose up -d netoviz2`。

### 3. CI が作ったイメージで確認する

push すると CI が `ghcr.io/ool-mddo/netoviz2:<ブランチ名>` を作る。`.env` の `NETOVIZ2_IMAGE_TAG` をそのブランチ名にして、`docker compose pull netoviz2 && docker compose up -d netoviz2`。同じタグの間は上書きされるので、更新後は pull が必要。

### 画面を自動で確認するとき

ヘッドレス Chrome の `--screenshot --virtual-time-budget` では `requestAnimationFrame` が進まず、レイアウト (force-simulation) が数ティックしか動かない。実時間で待つこと (DevTools Protocol でページを開き、待って、評価し、撮影する)。

## URL

- `/netoviz2/` : network / snapshot 一覧
- `/netoviz2/:network/:snapshot` : トポロジの表示

## コンテナ

`Dockerfile` は、ビルドした静的ファイルを nginx で `/netoviz2/` 配下に配信するイメージを作る (ランタイムの Node は含まない。volume も持たない)。
playground の `docker-compose.yaml` の `netoviz2` サービスとして起動し、api-proxy (nginx) の `/netoviz2/` から転送される。イメージは CI が作る (`ghcr.io/ool-mddo/netoviz2:<ブランチ名>`)。

```bash
# playground のディレクトリで
docker compose pull netoviz2        # CI が作ったイメージ (.env の NETOVIZ2_IMAGE_TAG)
docker compose up -d netoviz2 api-proxy
# http://localhost:15000/netoviz2/
# 手元のソースでイメージを作って試すときは、docker build -t ghcr.io/ool-mddo/netoviz2:<タグ> repos/netoviz2
```

## 構成

```
src/
  api/          netomox-exp の netoviz2 API の型とクライアント (ETag 対応)
  domain/       Viewer に依存しない純粋なロジック (support 索引・トレース・support のチェック、リンクの束ね、グラフ構築、diff data)
  stores/       Pinia: topology (summary・レイヤ・supports・属性、ETag による更新)、selection (選択とトレース)、view (展開状態)
  composables/  選択処理 (useSelect)、ポーリング (usePolling)
  render/       描画 (ForceRenderer: d3-force + SVG。Vue のリアクティブ機構を通さず DOM を直接更新)
  components/   ForceView (トポロジ), DependencyView (選択したオブジェクトの依存ツリー), AttributePanel, JsonTree, LayerList, SummaryBar, ViewToolbar
  views/        HomeView (一覧), TopologyView (表示)
```

## URL のクエリ

`/netoviz2/:network/:snapshot?layers=<id,id>&sel=<object id>` : 表示するレイヤと選択中のオブジェクト (リンクで共有できる)。

## 機能 (MVP)

- force-simulation 表示 (ノード単位。ダブルクリックで term-point を展開)
- **レイアウトエンジン**: stress (自前のストレス最小化。既定) と force (d3-force) を切り替えられる (`?layout=<engine>`)。各パネルに所要時間・リンクの交差数・ノードの重なりを表示する。設計と検討の経緯 (ELK を採用しなかった理由を含む) は playground の `docs/design_notes/netoviz2_layout.md`
- **dependency (レイヤ帯) 表示** (副画面): ツールバーの「Dependency view」(`?dependency=1`) でトポロジ表示の隣に出し入れする。**トポロジ表示で選択した node / term-point だけ**について、それを支えるオブジェクト (下位レイヤ) と、それが支えるオブジェクト (上位レイヤ) の依存関係ツリーを、レイヤの帯 (上位が上) に描く。term-point を選ぶと term-point の依存、node を選ぶと node の依存 (「Term-points」をオンにすると、その node の term-point を箱の中に表示し、term-point の依存も加える)。レイヤを飛び越える support (A-B, A-C が一直線に重なる場合など) は、間のレイヤのオブジェクトの横を通る曲線で描いて重ならないようにする。**term-point は必ず所属する node の枠 (箱) の中に表示する** (どの node の term-point かが分かるように、node と分離しない。term-point だけが対象でも、その node を破線の枠で添える。term-point のない node は円)。ツリーの中のオブジェクトをクリックすると、それを選択して辿れる (選択はトポロジ表示と共有)。support 先のないオブジェクトは帯の右端ではなく上位のオブジェクトの下に置く。レイヤをまたぐ関係の設定ミスを見つけるデバッグ用途で、「Mark problems」で次を印付けして一覧する (`problems` ボタン。項目のクリックでオブジェクトを選択。対象は表示中のツリーのオブジェクト): 下位ノードに支えられていないノード (`unsupported`)・上位から使われていないノード (`unused`)・ノードの support がなく term-point の support だけがある (`tp-only`)・同じレイヤ内や上位から下位でない support (`same-layer` / `inverted`)・宣言されていないレイヤ間の support (`undeclared`)・宣言されているのに support がない (`no-support`)
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
