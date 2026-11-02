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
- 描画ライブラリは差し替えられる構造にする (まず d3-force + SVG)。

## 動作確認

- 開発サーバ: `npm run dev` (`/topologies` は api-proxy (既定 `http://localhost:15000`) へプロキシ)。コンテナ: playground で `docker compose up -d --build netoviz2 api-proxy` → `http://localhost:15000/netoviz2/`。
- ヘッドレス Chrome の `--screenshot --virtual-time-budget` では force-simulation が数ティックしか動かない (`requestAnimationFrame` が進まない)。実時間で待って確認する (DevTools Protocol で操作・評価・撮影)。
- 状態は URL で指定できる: `?layers=<layer ID,...>&sel=<object ID>`。

## コマンド

`npm run typecheck` / `npm test` / `npm run lint` / `npm run build`。コミット前に 4 つとも通すこと。
