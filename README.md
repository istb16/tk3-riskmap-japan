# 日本リアルタイム危険マップ

日本全国15都市の気象・地震・大気汚染データをリアルタイムに統合し、地域ごとの危険スコア（0〜100）をランキングと地図で可視化するシングルページアプリ（SPA）。

## 機能

- **危険スコアリング** — 気象警報・風速・気温・地震・PM2.5 を複合評価し 0〜100 のスコアを算出
- **5分間隔自動更新** — バックグラウンドで各APIを定期ポーリング
- **インタラクティブ地図** — Leaflet によるマーカー表示。クリックで詳細パネルを表示
- **危険度別ランキング** — 全15都市をスコア降順で一覧表示
- **詳細パネル** — 各都市のスコア要因（警報・風速・地震・大気質）を文言で表示

## 対象都市（15都市）

札幌・仙台・東京・横浜・名古屋・大阪・京都・神戸・広島・福岡・那覇・金沢・新潟・静岡・鹿児島

## 技術スタック

| 要素 | 技術 |
|------|------|
| フレームワーク | SvelteKit（Svelte 5 Runes モード） |
| ビルド | Vite + @sveltejs/adapter-static |
| 地図 | Leaflet 1.x |
| テスト | Vitest |
| ホスティング | Firebase Hosting（`build/` フォルダ） |
| 状態管理 | Svelte store（writable / derived） |

## 使用API（すべて無料・認証不要）

| API | 用途 | エンドポイント |
|-----|------|--------------|
| Open-Meteo Forecast | 気温・降水量・風速・天気コード | `https://api.open-meteo.com/v1/forecast` |
| Open-Meteo Air Quality | PM2.5・AQI | `https://air-quality-api.open-meteo.com/v1/air-quality` |
| USGS FDSN | 地震マグニチュード（過去7日） | `https://earthquake.usgs.gov/fdsnws/event/1/query` |

## スコアリングロジック

各指標を以下の基準で加点し、合計を最大100でキャップする。

| 条件 | 加点 |
|------|------|
| 特別警報（WMO severe code） | +50 |
| 大雨警報（WMO warning code） | +30 |
| 気象注意報 | +15 |
| 暴風 ≥60km/h | +20 |
| 強風 ≥40km/h | +10 |
| 熱中症危険域 ≥35℃ | +30 |
| 猛暑 ≥30℃ | +20 |
| 地震 M5+ | +40 |
| 地震 M4+ | +20 |
| 地震 M3.5+ | +10 |
| PM2.5 ≥100μg/m³ | +40 |
| PM2.5 ≥50μg/m³ | +25 |
| PM2.5 ≥25μg/m³ | +10 |

## カラーパレット

| 危険度 | スコア | 色 |
|--------|--------|-----|
| 安全 | 0〜30 | `#22c55e`（緑） |
| 注意 | 31〜60 | `#f59e0b`（黄） |
| 危険 | 61〜100 | `#ef4444`（赤） |

## ディレクトリ構成

```
src/
  lib/
    api/
      weather.ts        # Open-Meteo 気象API
      earthquake.ts     # USGS 地震API
      air.ts            # Open-Meteo 大気質API
      http.ts           # fetch ラッパー
    services/
      riskCalculator.ts # スコアリング統合ロジック
      scoringRules.ts   # 閾値・加点ルール定義
    stores/
      riskStore.ts      # グローバルstate・5分間隔自動更新
    regions.ts          # 対象15都市の緯度経度定義
    types.ts            # 型定義（RegionRisk, WeatherData, etc.）
    utils/
      settled.ts        # Promise.allSettled ユーティリティ
  routes/
    +layout.ts          # prerender=true, ssr=false
    +layout.svelte      # favicon 注入
    +page.svelte        # メインUI（ランキング + 地図 + 詳細パネル）
```

## 開発環境のセットアップ

```bash
# 依存パッケージのインストール
npm install

# 開発サーバー起動（http://localhost:5173）
npm run dev
```

## 開発コマンド

```bash
npm run dev           # 開発サーバー起動
npm run build         # 本番ビルド → build/ フォルダ
npm run preview       # ビルド結果のプレビュー
npm run check         # TypeScript 型チェック
npm test              # テスト実行（vitest run）
npm run test:watch    # ウォッチモードでテスト
npm run test:coverage # カバレッジレポート生成
```

## テスト

Vitest を使用。テストファイルは対象ファイルと同じディレクトリに `*.test.ts` で配置する。

```bash
npm test
```

対象モジュール：
- `src/lib/api/weather.test.ts`
- `src/lib/api/earthquake.test.ts`
- `src/lib/api/air.test.ts`
- `src/lib/services/riskCalculator.test.ts`
- `src/lib/regions.test.ts`

## Firebase Hosting デプロイ

```bash
# Firebase CLI インストール（初回のみ）
npm install -g firebase-tools

# Firebase にログイン（初回のみ）
firebase login

# プロジェクト初期化（初回のみ）
firebase init hosting
# → public ディレクトリ: build
# → SPA として設定: Yes

# ビルド＆デプロイ
npm run build
firebase deploy --only hosting
```

## 設計制約

- **バックエンドなし** — Firebase Functions 不使用、完全フロントエンド構成
- **SSR 無効** — `ssr=false`, `prerender=true` を必須とする
- **無料APIのみ** — すべてのデータソースは認証・課金不要
