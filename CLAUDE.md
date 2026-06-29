# 日本リアルタイム危険マップ — CLAUDE.md

## プロジェクト概要

日本全国の気象・地震・大気汚染データをリアルタイムに統合し、
地域ごとの危険スコア（0〜100）をランキングと地図で可視化するSPA。

## 技術スタック

| 要素 | 技術 |
|------|------|
| フレームワーク | SvelteKit（Svelte 5 Runes モード） |
| ビルド | Vite + @sveltejs/adapter-static |
| 地図 | Leaflet 1.x |
| ホスティング | Firebase Hosting（build/ フォルダ） |
| 状態管理 | Svelte store（writable / derived） |

## ディレクトリ構成

```
src/
  lib/
    api/
      weather.ts      # Open-Meteo API（気温・降水量・天気コード）
      earthquake.ts   # USGS FDSN API（地震マグニチュード）
      air.ts          # Open-Meteo Air Quality API（PM2.5・AQI）
    services/
      riskCalculator.ts  # スコアリングロジック（全API統合）
    stores/
      riskStore.ts    # グローバルstate・自動更新（5分間隔）
    regions.ts        # 対象15都市の緯度経度定義
    types.ts          # 型定義（RegionRisk, WeatherData, etc.）
  routes/
    +layout.ts        # prerender=true, ssr=false
    +layout.svelte    # favicon注入
    +page.svelte      # メインUI（ランキング + 地図 + 詳細パネル）
```

## スコアリングロジック（riskCalculator.ts）

| 条件 | 加算 |
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

最大100でキャップ。

## 使用API（すべて無料・フロント直接fetch）

- **Open-Meteo**: `https://api.open-meteo.com/v1/forecast` — 気象データ
- **Open-Meteo Air Quality**: `https://air-quality-api.open-meteo.com/v1/air-quality` — PM2.5・AQI
- **USGS FDSN**: `https://earthquake.usgs.gov/fdsnws/event/1/query` — 地震

## 開発コマンド

```bash
npm run dev           # 開発サーバー起動（localhost:5173）
npm run build         # 本番ビルド → build/ フォルダ
npm run preview       # ビルド結果のプレビュー
npm run check         # TypeScript型チェック
npm test              # テスト実行（vitest run）
npm run test:watch    # ウォッチモードでテスト
npm run test:coverage # カバレッジレポート生成
```

## テスト方針

- テストフレームワーク: **Vitest**（`vitest.config.ts` で設定）
- テストファイルは対象ファイルと同じディレクトリに `*.test.ts` で配置
- `.svelte` コンポーネントはテスト対象外（ビジネスロジックのみテスト）
- `vi.mock` はモジュールトップレベルに置く（関数内で呼ぶとhoist問題が起きる）
- モジュールモックの設定は `beforeEach` で `vi.mocked(fn).mockResolvedValue(...)` を使う
- `scoreWeather`, `scoreEarthquake`, `scoreAir` は直接テストできるよう `export` している

## Firebase Hostingデプロイ手順

```bash
# 1. Firebase CLIインストール（初回のみ）
npm install -g firebase-tools

# 2. Firebaseにログイン（初回のみ）
firebase login

# 3. プロジェクト初期化（初回のみ）
firebase init hosting
# → public: build
# → SPA: Yes

# 4. ビルド＆デプロイ
npm run build
firebase deploy --only hosting
```

## TypeScript 型規約

- **`any` 禁止** — 型安全性を維持するため `any` は使用しない
- **APIレスポンス型を必ず定義する** — `res.json()` の結果は必ず `as ResponseType` でキャストする。レスポンス型インターフェースは各 API ファイル内にローカル定義する（外部から使わないため export しない）
- **外部ライブラリの型を活用する** — Leaflet は `@types/leaflet` から `Map`, `Marker` 等を import して使う。動的 import のパラメータ型は `typeof import('leaflet')` 形式を使う
- **Null の型ガード** — `null` になりうる変数を関数に渡す前に早期 return でナローイングする
- **`strict: true`** — `tsconfig.json` で有効化済み。型チェックは `npm run check` で確認する

## 重要な設計制約

- **Firebase Functions禁止** — バックエンドなし、完全フロントエンド構成
- **SSR禁止** — `ssr=false`, `prerender=true` を必須とする
- **有料API禁止** — すべてのデータソースは無料プランで動作
- **APIキー不要** — 使用するすべてのAPIはキーなしでアクセスできる（Open-Meteo・USGS）

## Svelte 5 Runes について

このプロジェクトは Svelte 5 の Runes モードで動作する。
- `$state()`, `$derived()`, `$effect()`, `$props()` を使用
- 旧 `$:` リアクティブ宣言は使用しない
- イベントハンドラは `onclick={}` 形式（`on:click` ではない）

## カラーパレット

| 危険度 | 色 | スコア |
|--------|-----|--------|
| 安全 | `#22c55e`（緑） | 0〜30 |
| 注意 | `#f59e0b`（黄） | 31〜60 |
| 危険 | `#ef4444`（赤） | 61〜100 |
| 背景 | `#0f172a` | — |
| カード | `#1e293b` | — |

## コミット時の制限

- コミットログは日本語とする
- Co-Authored-By は記載しない