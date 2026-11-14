# schematic レイアウトで対称性を扱う (計画)

状態: **実装済み (v0.4.0-dev、2026-11-14)。** 段階 0〜3 をすべて実装し、mddo-bgp と mddo-fw で描画を確認した。

## 実装状況の要約

| 段階 | 内容                              | 書式                                       | 状態   |
| ---- | --------------------------------- | ------------------------------------------ | ------ |
| 前提 | group の固定値 (名前に依らない列) | 規則の `group: { value: <値> }`            | 実装済 |
| 0    | 現状の測定                        | (テスト: `symmetry.test.ts`、フィクスチャ) | 実装済 |
| 1    | 行の中央揃え (②)                  | 規則の `align: center`                     | 実装済 |
| 2    | 列の鏡像配置 (①)                  | 最上位の `symmetry: { axis, mirror }`      | 実装済 |
| 3    | 空の行を残す (③)                  | 最上位の `keepEmptyTiers: true`            | 実装済 |

- 仕様 (現行): [design/profile_format.md](../../design/profile_format.md) (「拠点 (group) の決め方」「左右対称」「空の行」「列の鏡像配置」)、[design/schematic_layout.md](../../design/schematic_layout.md)。固定値の group の経緯: [group_literal_value.md](group_literal_value.md)。
- コミット (`v0.4.0-dev`): 固定値 group `763aacb`、計画 `26c9af4`、段階 0 `c3e1555`、段階 1 `03c5cac`、段階 3 `1656830`、段階 2 `53907e1`。
- 利用した profile (playground): `profiles/mddo-bgp/asis.yaml` (自 AS を中央、外部 AS を左右、下流 AS を下に置く Y 字。固定値 group・`align`・`symmetry`・`keepEmptyTiers` をすべて使う)、`profiles/mddo-fw/asis_y.yaml` (DC を中央の縦列、拠点を上の左右に置く Y 字。`align`・`symmetry`。`?profile=asis_y` で選ぶ)。
- テスト用のコピー: `src/test/mddoBgpProfile.yaml` (`profiles/mddo-bgp/asis.yaml` と同じ内容。変えたら同期する)。
- 互換性: 追加のキーのみで、書かなければ従来の動作。`profiles/mddo-fw/asis.yaml` の配置は変わらない。netomox-exp は YAML → JSON の変換だけなので、変更は不要だった (新しいキーが素通しで返ることを確認済み)。

## 残っている制限・今後の課題

- `symmetry` は列の**位置**だけを合わせる。2 つの列の中のノードの鏡像は保証しない (中の左右対称は `align` で、列ごとに行う)。
- 外へ動かした列が、さらに外側の列と重なるときは、列の間隔を取り直すので、鏡像が保たれないことがある。
- 拠点ごとに階層 (tier) を変えるときは、拠点ごとに規則を書く必要がある (1 つの規則で複数の拠点を選ぶ書式は無い。例: `profiles/mddo-fw/asis_y.yaml`)。
- 空の行を、リンクが通るときの見え方は、実データ (mddo-bgp) でしか確認していない。
- 列の x 座標は、リンクの希望位置の最小二乗で決まる。`align` と `symmetry` が効くのは、列の中と列どうしの位置まで。

## 背景と目的

playground の `profiles/mddo-bgp/asis.yaml` (emulated_asis の layer3) は、AS 全体を Y 字にしたい。

```
   上流 AS65550        上流 AS65560        ← 左右に配置 (上)
        \                /
         \              /
          自 AS65518 (edge → core → edge)  ← 中央の縦列
                |
          下流 AS65520                      ← 自 AS の下
```

見てわかるようにしたい対称性は 3 つ。

| #   | 対称性                  | 内容                                                                               |
| --- | ----------------------- | ---------------------------------------------------------------------------------- |
| ①   | AS 全体 (左右)          | 中央列を軸に、左右の外部 AS が等距離に並ぶ (Y 字)                                  |
| ②   | 個々の AS の内部 (左右) | AS の中の機器が、その AS の軸に対して左右対称 (例: `edge01/02` が `core00` の左右) |
| ③   | 自 AS を中心にした上下  | 上流側と下流側の行の構成が、自 AS を中心に鏡像 (行数・高さが揃う)                  |

## 現状 (調査結果)

- y: tier ごとに行の高さが決まる。tier が 1 ノードも無い行は作られない ([slots.ts](../../../src/render/layout/schematic/slots.ts))。
- x ([solve.ts](../../../src/render/layout/schematic/solve.ts)): 行ごとに、順序と最小間隔を守る最小二乗 (`spaceOutWith`、PAV 法)。ノードの希望位置は、他の行のつながり先の位置の平均。これを反復する。
- 列 (group) は全行を通じて 1 つのブロック。ブロックの順序は `order`、間隔は `groupGap` (160px)。ブロックの位置は、各ブロックの広がりの中心を最小二乗で解く (`spaceOutBlocks`)。
- 対称性は、目的にも制約にも入っていない。左右対称になるのは、トポロジが偶然対称なときだけ。
- 2 つ以上の group を同じ列にする手段は、v0.4.0 の `group: { value }` で入った ([group_literal_value.md](group_literal_value.md))。

## 方針

- 対称性は**自動検出しない** (グラフの自己同型は重く、構成図の意図とも限らない)。**profile で宣言**し、ソルバは宣言を守る。
  - 「ドメインの知識は profile に置く。コードはネットワーク名・ユースケース・命名規則で分岐しない」(agent_guide.md) に合う。
- 既存の profile の結果は変えない。新しいキーを書いたときだけ動作が変わる。
- 既存のインタフェース (型、関数、オプション、URL) は維持する (追加のみ)。
- 大きな変更を一度に入れない。段階ごとにテスト・ドキュメントを更新し、描画で確認してから次に進む。

## 段階

### 段階 0: 現状の測定 (変更なし)

- mddo-bgp layer3 のフィクスチャ (ノード名・リンクだけ。`src/test/` の既存の流儀に合わせる) と、`profiles/mddo-bgp/asis.yaml` の複製 (テスト用) を用意する。
- 今のソルバの座標から、次を数値で出す (テストか一時スクリプト)。
  - ①: 左右の列の中心と、中央列の中心の距離の差
  - ②: 各 AS 内の各行の中心と、その AS の軸のずれ
  - ③: 上流側と下流側の行数と、自 AS からの高さの差
- 何が既に出ていて、何が足りないかを確認し、段階 1 以降の内容を見直す。

**結果 (2026-11-14、`symmetry.test.ts`、`test/mddoBgpLayer3.ts`):**

- ① 上流 AS の 2 列は、行ごとの x の集合として左右の鏡像になっている (AS65550 の `edge01` の鏡像は AS65560 の `edge02` で、同名どうしではない。行の中の順序がリンクに従うため)。中央列 (自 AS) も軸 (x=0) の上にある。**この topology が対称なので、結果として成り立っているだけで、保証はない。**
- ② AS の内部は**対称になっていない**。例: AS65550 の `edge01/02` (x=-387, -305) の中心 (-346) が `core00` (-305) とずれ、4 つの endpoint (-551〜-305) も `core01` (-305) が右端にある。AS65520 は対称 (自 AS の列と同じ軸に揃っている)。
- ③ 上流側は endpoint → core01 → core00 → edge の 4 行、下流側は edge → core00 → endpoint の 3 行で、行数が違う。行の間隔は、セグメントの行が挟まるため不揃い。

→ 段階 1 (②) は必要。段階 2 (①) は、この topology では既に成り立っているが、対称でない topology では保証されない (必要性は低いが、保証のために実装した)。段階 3 (③) は必要。

### 段階 1: 行の中央揃え (②) — 実装済み (v0.4.0-dev)

- 書式: group を単位に `align: center`。
  ```yaml
  - { select: '[site=as65550]', align: center }
  ```
- 動作: その group の各行を、group の軸 (全行の中心の平均) に揃える。行の中の順序と最小間隔は守る。リンクを縦に近づける力より優先する。
- 変更: `types.ts` (`ProfileRule.align`)、`profile.ts` (読み込みと検査)、`annotate.ts` (group ごとの設定)、`slots.ts` / `solve.ts` (反復の中で行を軸に寄せる)、テスト、`profile_format.md`。
- 確認: 奇数個・偶数個の行、ペアを含む行、リンクが斜めになるとき。

### 段階 2: 列の鏡像配置 (①) — 実装済み (v0.4.0-dev)

- 書式: profile の最上位に `symmetry`。
  ```yaml
  symmetry:
    axis: center # 軸にする group
    mirror: [[as65550, as65560]] # 軸に対して等距離に置く group の組
  ```
- 動作: `axis` の列の中心を軸にして、`mirror` の 2 列を左右に等距離に置く。距離は、軸から遠いほうに合わせ、近いほうを外へ動かす (間隔は狭くならない)。
- 変更: `solve.ts` の `mirrorBlocks`。反復のたびと最後に、列の位置を鏡像に補正し、最後に `spaceOutBlocks` で間隔を取り直す。軸は、軸の列の中心。左右は、現在の位置で決める (`order` との整合の検査と警告は、入れていない)。
- 範囲: 列の位置の対称まで。列の中のノードの鏡像 (2 つの AS の内部が同じ構造であることが前提) は、この段階では扱わない。

### 段階 3: 空の行を残す (③) — 実装済み (v0.4.0-dev)

- 書式: プロファイルに `keepEmptyTiers: true`。
- 動作: `tiers` に書いた tier を、ノードが無くても行として残す (高さは、図でいちばん大きいノードと同じ)。AS65520 の `core00` を上流 AS の `core01` と同じ高さの tier に置き、間の空の行で、自 AS を中心に上下の行数を揃える。
- 変更: `slots.ts` の行の決め方、`solve.ts` の y の計算。
- 確認: 空の行にリンクが通るときの経路 (`linkRouter`)。

## 確認した点 (決定)

1. **対称の厳密さ**: ①は列の位置の対称まで (列の中のノードの鏡像までは扱わない)。列の中は ② (`align`) で対称にする。
2. **書式**: `align` (規則)、`symmetry` / `keepEmptyTiers` (最上位) のキー名と置き場所は、案のとおり。
3. **進め方**: 段階 0 から 1 つずつ実装し、各段階をコミットして (戻せるようにして) 進めた。

## 影響と互換性

- 変更したのは `repos/netoviz2` のみ (netomox-exp は YAML → JSON の変換だけで、新しいキーは素通しになる。確認済み)。
- `profiles/mddo-fw/asis.yaml` の配置は変わらない (新しいキーを使わない)。回帰は既存テストで確認した。
- バージョン: 固定値 group と同じ v0.4.0 (`v0.4.0-dev` ブランチ) に入れる。リリースは `release-submodule` の手順で行う (未実施)。

## 関連

- [group_literal_value.md](group_literal_value.md): 固定値の group (v0.4.0)
- [../../design/schematic_layout.md](../../design/schematic_layout.md)、[../../design/profile_format.md](../../design/profile_format.md)
