# CLAUDE.md — netoviz2

## 概要

ool-mddo の汎用トポロジビューワー (Vite + Vue 3 + TypeScript の SPA)。ユースケース非依存。
データ加工はバックエンド (netomox-exp) の責務で、本リポジトリは描画と操作だけを持つ。
仕様: playground の `docs/netoviz2_data_format.md` (canonical)。

## 方針

- サーバ機能・ローカルファイルへのアクセスは持たない。バックエンドは netomox-exp のみ (`/topologies/...` を同一オリジンで呼ぶ)。
- ユースケース名・ネットワーク名・レイヤの種類 (`kind`)・属性スキーマに依存する分岐を入れない。未知のものは汎用の表示にフォールバックする。
- オブジェクトの ID は不透明な文字列として扱う (分解しない)。例外は、先頭のセグメントが layer の ID であること (仕様で保証) を使う `layerOfId` のみ。
- 選択・support のトレース・属性表示は Viewer によらず共通の部品 (`src/domain/`, `src/stores/`) で実装する。描画 (Viewer) はその上に載せる。
- 描画ライブラリは差し替えられる構造にする (まず d3-force + SVG)。レイアウトも `src/render/layout/` のエンジン (force と、自前の stress (`stress.ts`。既定は stress)、プロファイルで構成図の並びを決める schematic (`schematic/`)) として差し替えられる。設計と検討の経緯は playground の `docs/design_notes/netoviz2_layout.md`。
- 依存は寛容なライセンス (MIT / ISC / BSD 系) のものにする。ELK (elkjs, EPL-2.0) は検証したうえで採用しなかった (理由とライセンスの分析は上記の設計ドキュメント)。依存を追加するときは、ライセンスを確認する。

## 動作確認

- 開発サーバ: `npm run dev` (`/topologies` は api-proxy (既定 `http://localhost:15000`) へプロキシ)。コンテナ: CI が作ったイメージを playground で `docker compose pull netoviz2 && docker compose up -d netoviz2 api-proxy` → `http://localhost:15000/netoviz2/` (`v0.1.0-dev` は同じタグを上書きするので pull が必要)。
- ヘッドレス Chrome の `--screenshot --virtual-time-budget` では force-simulation が数ティックしか動かない (`requestAnimationFrame` が進まない)。実時間で待って確認する (DevTools Protocol で操作・評価・撮影)。
- 状態は URL で指定できる: `?layers=<layer ID,...>&sel=<object ID>&layout=<stress|force|schematic>&profile=<名前>&dependency=1`。`profile` は schematic レイアウトの図の定義 (`src/profiles/<名前>.yaml`。試行段階の作業用コピーで、正本は playground の `profiles/`)。省略すると、下位レイヤからの継承 (`inherit.ts`)、名前とリンクからの推論 (`infer.ts`) の順に試す。リンクの経路は、描画のたびに現在の位置から求める (`src/render/linkRouter.ts`。schematic のみ)。プロファイルの書式は playground の `profiles/README.md`。

## コマンド

`npm run typecheck` / `npm test` / `npm run lint` / `npm run build`。コミット前に 4 つとも通すこと。
