# Grill: JMA警報の一次細分区域表示
Date: 2026-06-30

## Intent
都道府県ごとのリスク表示に、JMA公式警報データを使った一次細分区域レベルの警報情報を追加する。
詳細パネルとランキングリストに「どの区域で何の警報が出ているか」を見せる。

## Constraints
- 有料API禁止・APIキー不要（JMAの非公式公開JSONエンドポイントを使用）
- Firebase Functions禁止（フロント直接fetch）
- SSR禁止、prerender=true維持

## Key decisions
- Decision: JMAの非公式公開API（`https://www.jma.go.jp/bosai/warning/data/warning/{都道府県コード}.json`）を使用。
  Reason: 無料・APIキー不要でプロジェクト制約を満たす。
  Alternative considered: Open-Meteoのみ継続（公式警報と乖離が生じるため却下）。

- Decision: 表示粒度は一次細分区域レベル。
  Reason: 市町村レベルは情報過多、都道府県レベルは既存と変わらない。

- Decision: JMA警報データをスコア計算に使用し、取得失敗時はOpen-Meteoの推定値にフォールバック。
  Reason: 「JMA警報あり・スコア低い」という矛盾を防ぐ。

- Decision: 都道府県スコア = 全一次細分区域のスコアの最大値。
  Reason: 最も危険な状況をランキングに反映するのが自然かつ安全側。

- Decision: 警報ゼロの場合は何も表示しない（「現在警報なし」テキストも出さない）。
  Reason: ユーザー明示。

- Decision: ランキングリストのカード内に小テキストで「⚠ [区域名]: [警報種別]」を追加。
  Reason: 既存のカードUIを壊さず情報を追加できる最小変更。

- Decision: 地図マーカーのポップアップへの警報区域追加は今回スコープ外。
  Reason: スコア変化で色は自動追従する。詳細パネルに集中する。

## Surfaced assumptions
- JMAの一次細分区域コードと現在の15都市（regions.ts）のマッピングが必要（実装時に解決）
- JMAのJSONエンドポイントは非公式のため、仕様変更時の事前通知なし

## Out of scope
- 地図ポップアップへの警報区域表示
- 市町村レベルの細分化
- JMA警報種別の色分けや独自アイコン化
