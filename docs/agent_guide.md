# AI エージェント向けの開発ルール

netoviz2 を AI エージェント (Claude Code など) で開発するときのルールです。リポジトリ直下の `CLAUDE.md` から取り込まれます。
人が読んでも構いません。構成は [architecture.md](architecture.md)、手順は [development.md](development.md) にあります。

## 概要

ool-mddo の汎用トポロジビューワー (Vite + Vue 3 + TypeScript の SPA)。ユースケース非依存。
データ加工はバックエンド (netomox-exp) の責務で、このリポジトリは描画と操作だけを持つ。
データ形式・API 仕様 (canonical): playground の [`docs/netoviz2_data_format.md`](https://github.com/ool-mddo/playground/blob/main/docs/netoviz2_data_format.md)。

## 方針

- サーバ機能・ローカルファイルへのアクセスは持たない。バックエンドは netomox-exp のみ (`/topologies/...` を同一オリジンで呼ぶ)。
- ユースケース名・ネットワーク名・レイヤの種類 (`kind`)・属性スキーマ・ノード名の命名規則に依存する分岐を、コードに入れない。未知のものは汎用の表示にフォールバックする。ドメインの知識は、データ (schematic ではプロファイル) に置く。
- オブジェクトの ID は不透明な文字列として扱う (分解しない)。例外は、先頭のセグメントが layer の ID であること (仕様で保証) を使う `layerOfId` のみ。名前 (`name`) の分解は、プロファイルの正規表現で行う。
- 選択・support のトレース・属性表示は、Viewer によらず共通の部品 (`src/domain/`、`src/stores/`) で実装する。描画 (Viewer) はその上に載せる。
- 描画ライブラリは差し替えられる構造にする (まず d3-force + SVG)。レイアウトも `src/render/layout/` のエンジン (force、自前の stress (既定)、プロファイルで構成図の並びを決める schematic) として差し替えられる。設計と検討の経緯は [design/layout.md](design/layout.md)、[design/schematic_layout.md](design/schematic_layout.md)。
- 依存は寛容なライセンス (MIT / ISC / BSD 系) のものにする。ELK (elkjs, EPL-2.0) は検証したうえで採用しなかった (理由は [design/layout.md](design/layout.md))。依存を追加するときは、ライセンスを確認する。
- 既存のインタフェース (型、関数、オプション、URL) は、明示的な承認が無い限り維持する。大きな変更を一度に入れない。不必要なリファクタリングを避ける。

## 変更するときの手順

- コードを変更する前に、既存の実装を読んで調べる。設計に影響する変更は、先に方針を提案して承認を得る。
- 変更は小さい単位に分け、各ステップの後に関連するテストを実行する。
- **コミット前に、`npm run typecheck` / `npm test` / `npm run lint` / `npm run build` の 4 つを通す。** prettier (`npx prettier --check src`) も通す。
- ブランチ名にスラッシュを入れない (CI がブランチ名をイメージのタグにするため。例: `v0.2.0-dev`)。
- ドキュメントは `docs/` に置く。設計 (現行の仕様) は `docs/design/`、計画・調査・経緯の記録は `docs/work/` (`plans/`、`investigations/`、`todo/`。ファイル名に `plan_` などの接頭辞は付けない)。仕様を変えたら、現行の仕様の文書も更新する。

## 動作確認

- 開発サーバ: `npm run dev` (`/topologies` は api-proxy (既定 `http://localhost:15000`) へ転送)。コンテナ: CI が作ったイメージを playground で `docker compose pull netoviz2 && docker compose up -d netoviz2 api-proxy` → `http://localhost:15000/netoviz2/` (同じタグは上書きされるので pull が必要)。詳細は [development.md](development.md)。
- ヘッドレス Chrome の `--screenshot --virtual-time-budget` では、force-simulation が数ティックしか動かない (`requestAnimationFrame` が進まない)。実時間で待って確認する (DevTools Protocol で操作・評価・撮影)。
- 状態は URL で指定できる: `?layers=<layer ID,...>&sel=<object ID>&layout=<stress|force|schematic>&layerlayout=<column|grid>&profile=<名前>&dependency=1`。

## schematic レイアウトを触るとき

- プロファイルの書式は [design/profile_format.md](design/profile_format.md)。正本は playground の `profiles/<network>/<名前>.yaml` (YAML)。netomox-exp が JSON に変換して `GET /topologies/:network/netoviz2/profiles` で返し、netoviz2 はそれを読む (**YAML は読まない。コピーを `src/` に置かない**)。どの snapshot・レイヤに使うかは、プロファイルの `target` が決める。テスト用の複製は `src/test/mddoFwProfile.yaml`。
- 配置は、プロファイル → 下位レイヤからの継承 → 名前とリンクからの推論 → stress の順に試す。接続点 (L3 セグメントなど) は、配置の主体ではなく、機器の配置の後に機器の間に置く。`kind` では見分けない。継承するときは「複数の下位ノードに支えられるノード」、下位レイヤの候補が無くプロファイルで配置するときは「階層を持たず、階層を持つ 2 つ以上のノードとつながるノード」が接続点になる (推論と、継承元の配置には後者を使わない: 階層が付かない機器を、例外として報告するため)。
- リンクの経路は、描画のたびに現在の位置から `ForceRenderer` が求める (`linkRouter.ts`)。**ノードとポートに重ならないことを、リンクどうしの交差を避けることより優先する。** 直線で済むリンクは直線のままにする。経路は水平・垂直の線分だけ。
- 純粋な処理 (`annotate`、`slots`、`solve`、`infer`、`inherit`、`connectors`、`linkRouter`) は、純粋関数としてテストを書く。実データから抜き出したフィクスチャは `src/test/` にある (ノード名・リンク・support だけを持つ)。
