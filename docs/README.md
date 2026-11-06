# netoviz2 のドキュメント

使い方は、リポジトリ直下の [README](../README.md) を参照してください。ここは、開発する人向けのドキュメントです。

## 構成と開発

| 文書                               | 内容                                                                                                |
| ---------------------------------- | --------------------------------------------------------------------------------------------------- |
| [architecture.md](architecture.md) | 構成・アーキテクチャ (ソースの構成、データの流れ、状態管理、描画、レイアウト、ビルド・配信、テスト) |
| [development.md](development.md)   | 開発手順 (コマンド、動作確認の方法、コンテナ、CI、ブランチ名)                                       |
| [agent_guide.md](agent_guide.md)   | AI エージェント向けの開発ルール (`CLAUDE.md` から取り込まれる)                                      |

## 設計 (現行の仕様)

| 文書                                                     | 内容                                                                                     |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| [design/layout.md](design/layout.md)                     | レイアウトエンジン (force、stress) の設計と、検討の経緯 (ELK を採用しなかった理由を含む) |
| [design/schematic_layout.md](design/schematic_layout.md) | schematic レイアウト (構成図向け) の設計: 考え方、配置の流れ、推論、継承、リンクの経路   |
| [design/profile_format.md](design/profile_format.md)     | schematic のダイアグラムプロファイル (YAML) の書式                                       |

## 計画・経緯の記録

| 文書                                                             | 内容                                                    |
| ---------------------------------------------------------------- | ------------------------------------------------------- |
| [work/plans/requirements.md](work/plans/requirements.md)         | 要求・設計・実装計画 (開発の途中までの経緯。一部は古い) |
| [work/plans/schematic_layout.md](work/plans/schematic_layout.md) | schematic レイアウトの計画・判断・進捗の履歴            |

`work/` は、計画 (`plans/`)・調査 (`investigations/`)・やること (`todo/`) の作業メモです。現行の仕様は、上の「設計」にあります。

## 他のリポジトリの文書

- データ形式・API 仕様 (netomox-exp と netoviz2 の共通の仕様): playground の [netoviz2_data_format.md](https://github.com/ool-mddo/playground/blob/main/docs/netoviz2_data_format.md)
- schematic のプロファイルの正本 (ネットワークごとの YAML): playground の [profiles/](https://github.com/ool-mddo/playground/tree/main/profiles)
