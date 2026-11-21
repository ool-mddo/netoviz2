# 規則の `group` に固定値を書けるようにする (v0.4.0)

## 背景

mddo-bgp の layer3 (自 AS と、上流 AS 2 つ、下流 AS 1 つ) を、Y 字 (上に外部 AS を左右に、下に自 AS から下流 AS を縦に) で並べたい。
そのためには、自 AS (名前に拠点が無い: `core-tk01`) と下流 AS (`as65520-core00`) を同じ列に置き、その列を外部 AS の列の間に置く必要がある。

従来は、group の値が `name` の正規表現で得た文字列に限られた。

- 名前の付け方が違うノードは、同じ group の値を持てない。
- group を持たない (取れない) ノードは、常に最後の 1 列になり、`order` で動かせない。
- `order` は列の順位だけを決めるので、別の group を同じ列にできない。

## 変更

規則の `group` に、名前付きグループの名前 (従来) のほかに、固定値 `{ value: <値> }` を書けるようにした。仕様は [design/profile_format.md](../../design/profile_format.md#拠点-group-の決め方)。

- `types.ts`: `ProfileRule.groupValue` を追加 (`group` と排他)。
- `profile.ts`: `group` がオブジェクトのとき `value` を読む。`value` は引用符付きの空でない文字列。`value` 以外のキーは警告。
- `annotate.ts`: `groupValue` があれば、それを group にする。後の規則が勝つ点は従来どおり。
- テスト: `profile.test.ts` (書式)、`annotate.test.ts` (固定値と上書き)、`slots.test.ts` (Y 字: 固定値の列が `order` で左右の列の間に入る)。

## 互換性

- `group: site` (文字列) の書き方と、その動作は変わらない。既存のプロファイル (`profiles/mddo-fw/asis.yaml`) の結果は変わらない。
- 推論 (`infer.ts`) と継承 (`inherit.ts`) は変更しない。
- バックエンド (netomox-exp) は YAML を JSON に変換するだけなので、`group` がオブジェクトでも変更は要らない。

## 残していること

- 列の x 座標を中央に揃えること (左右の列に対して中央列を厳密に対称にする) は、していない。列の順序は左・中央・右になるが、座標は従来のソルバ (リンクの希望位置の最小二乗) で決まる。
