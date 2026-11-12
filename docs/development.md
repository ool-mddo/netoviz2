# 開発手順

netoviz2 の開発・動作確認の手順です。構成は [architecture.md](architecture.md)、AI エージェント向けのルールは [agent_guide.md](agent_guide.md) を参照してください。

## 準備

- Node.js 24 以上。
- 動作確認には、playground が起動していて (`docker compose up -d`)、確認したいトポロジが netomox-exp にあることが必要です。表示するデータ (API) は、api-proxy (`http://localhost:15000`) 経由で netomox-exp から取得します。

## コマンド

```bash
npm install
npm run dev          # 開発サーバ http://localhost:5173/netoviz2/ ( /topologies は NETOVIZ2_API_URL (既定 http://localhost:15000) へ転送)
npm run typecheck    # 型検査 (vue-tsc)
npm test             # テスト (vitest)
npm run lint         # eslint
npm run build        # dist/ (静的ファイル。/netoviz2/ 配下で配信する)
npm run format       # prettier
```

**コミット前に、`typecheck` / `test` / `lint` / `build` の 4 つを通してください。**

## 動作確認の方法

ソースを直しながら画面で確認する方法は 3 つあります。**コンテナ (nginx の静的配信) は、ソースを mount しておらず、修正を自動では反映しません** (ホットリロードはない)。修正中は 1 の開発サーバを使います。

### 1. 開発サーバ (修正中の確認)

```bash
cd repos/netoviz2
npm install                      # 初回のみ
npm run dev                      # → http://localhost:5173/netoviz2/ (ポートが使用中なら別のポート。起動時の表示を見る)
# api-proxy が別のホスト/ポートのときは、API の転送先を指定する
NETOVIZ2_API_URL=http://<host>:15000 npm run dev
```

- ソースの保存で、ブラウザが自動で更新される (HMR)。API は、同じオリジンの `/topologies/...` として、開発サーバから `NETOVIZ2_API_URL` へ転送される。
- 表示の例 (`<network>` / `<snapshot>` は `http://localhost:15000/topologies/index` で確認できる):
  - 一覧: `http://localhost:5173/netoviz2/`
  - トポロジ: `http://localhost:5173/netoviz2/<network>/<snapshot>`
  - 状態は URL で指定できる (ID は URL エンコードする): `?layers=<レイヤ ID,...>&sel=<オブジェクト ID>&layout=<stress|force|schematic>&layerlayout=<column|grid>&profile=<名前>&dependency=1`

### 2. 手元のソースでコンテナを作って確認する

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

push すると、CI が `ghcr.io/ool-mddo/netoviz2:<ブランチ名>` を作ります。`.env` の `NETOVIZ2_IMAGE_TAG` をそのブランチ名にして、`docker compose pull netoviz2 && docker compose up -d netoviz2` します。
同じタグの間は上書きされるので、更新後は pull が必要です。

## 画面を自動で確認するとき

ヘッドレス Chrome の `--screenshot --virtual-time-budget` では、`requestAnimationFrame` が進まず、レイアウト (force-simulation) が数ティックしか動きません。
**実時間で待ってください** (DevTools Protocol でページを開き、待って、評価し、撮影する)。

## コンテナ

`Dockerfile` は、ビルドした静的ファイルを nginx で `/netoviz2/` 配下に配信するイメージを作ります (ランタイムの Node は含まない。volume も持たない)。
playground の `docker-compose.yaml` の `netoviz2` サービスとして起動し、api-proxy (nginx) の `/netoviz2/` から転送されます。

## CI と ブランチ名

push で、lint・型検査・テストを実行し、成功したらコンテナイメージ (`ghcr.io/ool-mddo/netoviz2:<ブランチ名>`) を作ります。古い (タグの無い) イメージは、直近 10 件を残して削除します。
**イメージのタグはブランチ名なので、ブランチ名にスラッシュを入れないでください** (例: `v0.1.0-dev`)。

## テーマ

ライト / ダークは、ヘッダー右の「Auto / Light / Dark」で切り替えます (Auto はブラウザ・OS の設定に従う。選択はブラウザに保存する)。色は `src/styles/theme.css` の変数で一元管理しています (`color-scheme` と `light-dark()`)。

## schematic のプロファイル

schematic レイアウトのプロファイルの正本は、playground の `profiles/<network>/<名前>.yaml` です (人が書く YAML)。netomox-exp が読んで JSON に変換し、
`GET /topologies/:network/netoviz2/profiles` で返します。netoviz2 は、schematic レイアウトのとき、それを取得して、`target` (network / snapshot / layer) に合うものを自動で使います。
`?profile=<名前>` で、そのファイルだけを使うこともできます。使っているプロファイルは、画面下のパネルに表示されます。書式は [design/profile_format.md](design/profile_format.md) を参照してください。

正本を直したら、netomox-exp は毎回ファイルを読むので、ブラウザを再読み込みすれば反映されます (`docker compose` は `profiles/` を netomox-exp に read-only で渡します)。
`npm run dev` では、`/topologies` を api-proxy に転送するので、同じ API からプロファイルを読みます。
