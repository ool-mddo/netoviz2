# netoviz2

[ool-mddo](https://github.com/ool-mddo) の**マルチレイヤのネットワークトポロジ用ビューワー**です。ブラウザで動く SPA (フロントエンドのみ) で、
ネットワーク機器の物理接続 (L1)、L2、L3、ルーティングプロトコルなど、**レイヤを重ねたトポロジ**を表示し、レイヤ間の依存関係 (support) をたどれます。

- ユースケースに依存しない汎用のビューワーです (ネットワーク名・レイヤの種類・属性の中身に応じた特別な処理を持たない)。
- データの加工は持ちません。トポロジの読み込みと整形は、netomox-exp の API (`/topologies/:network/:snapshot/netoviz2/*`) が行い、netoviz2 は REST API で取得して描画・操作に専念します。

## 主な機能

- **トポロジの表示:** レイヤごとにノード・リンク・term-point (ポート) を表示します。ダブルクリックで term-point を展開できます。
- **レイヤの切替:** 表示するレイヤをチェックボックスで選びます。
- **support のトレース:** オブジェクトを選ぶと、それを支える下位レイヤのオブジェクトと、それが支える上位レイヤのオブジェクトを強調し、属性・差分を右のパネルに表示します。
- **dependency 表示:** 選んだ node / term-point の依存関係を、レイヤの帯 (上位が上) に描いた副画面で見られます。
- **3 つのレイアウト:**
  - **stress** (既定): ストレス最小化。リンクの交差が少なく、コンパクトです。
  - **force**: d3-force による力学配置です。
  - **schematic**: 実務の構成図に近い配置です。拠点を左右、階層 (外部接続 → FW → コア → ...) を上下、冗長ペアを横並びに置きます。
    配置の情報は、トポロジとは別の YAML (ダイアグラムプロファイル) に書けます。無いときは、下位レイヤの配置の引き継ぎや、名前とリンクからの推論で作ります (下書きは画面から取り出せます)。
    ノードや term-point に重なるリンクは、水平・垂直の折れ線で避けます。
- **ドラッグ:** ノードをドラッグすると、周囲が追従します。term-point は、所属ノードの円周上を動かせます。
- **差分と警告:** snapshot 間の差分 (diff) と、トポロジの警告を表示します。
- **自動更新:** 5 秒ごとに更新を確認し、トポロジが更新されたら自動で再読み込みします。
- **テーマ:** ライト / ダークを、ヘッダー右の「Auto / Light / Dark」で切り替えます。

## 使い方

### 起動する

netoviz2 は、[playground](https://github.com/ool-mddo/playground) の一部として起動します (netomox-exp と api-proxy が必要です)。

```bash
# playground のディレクトリで
docker compose up -d
# → http://localhost:15000/netoviz2/
```

開発サーバで起動する方法は、[docs/development.md](docs/development.md) を参照してください。

### 画面の操作

1. `/netoviz2/` で network を選び、snapshot を選びます。
2. 左のチェックボックスで、表示するレイヤを選びます (レイヤが多いときは、最上位のレイヤだけが表示されます)。
3. ノードや term-point をクリックすると、support のトレースと属性が表示されます。ダブルクリックで term-point を展開します。
4. ツールバーで、レイアウトの切替、Trace の方向、Dependency view の表示を切り替えます。

### URL で状態を指定する

表示の状態は、URL のクエリで指定でき、リンクで共有できます (ID は URL エンコードします)。

```
/netoviz2/<network>/<snapshot>?layers=<レイヤ ID,...>&sel=<オブジェクト ID>&layout=<stress|force|schematic>&profile=<名前>&dependency=1
```

| クエリ       | 内容                                                |
| ------------ | --------------------------------------------------- |
| `layers`     | 表示するレイヤ                                      |
| `sel`        | 選択するオブジェクト                                |
| `layout`     | レイアウト: `stress` (既定) / `force` / `schematic` |
| `profile`    | schematic のプロファイルの名前                      |
| `dependency` | `1` で依存関係の副画面を表示                        |

### schematic レイアウト

`?layout=schematic` を付けるだけで、プロファイルが無くても構成図風に配置されます (プロファイルは、`profiles/` に置いたものが、対象の network・snapshot・レイヤに合えば自動で使われます)。画面の下に、配置の由来 (プロファイル / 継承 / 推論) と、例外 (階層が付かないノードなど) が表示され、
推論した結果を YAML の下書きとして保存できます。プロファイルを書くときは、[docs/design/profile_format.md](docs/design/profile_format.md) を参照してください。

## ドキュメント

構成・開発手順・設計は、[docs/](docs/README.md) にあります。

- [構成・アーキテクチャ](docs/architecture.md)
- [開発手順](docs/development.md)
- [レイアウトの設計](docs/design/layout.md)、[schematic レイアウトの設計](docs/design/schematic_layout.md)、[プロファイルの書式](docs/design/profile_format.md)

## ライセンス

MIT ([LICENSE](LICENSE))。
