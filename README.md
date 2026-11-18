# 日本リアルタイム危険マップ

日本全国64地域の気象・地震・津波・火山・大気汚染データをリアルタイムに統合し、地域ごとの危険スコア（0〜100）をランキングと地図で可視化するシングルページアプリ（SPA）。スコアは「その地域にいまいる人の生命に対する危険度」を表す。

## 機能

- **危険スコアリング** — 雨・雪・風・波浪高潮・気温・地震・津波・火山・大気の9カテゴリを評価し、0〜100 のスコアを算出（カテゴリ内は最大値、カテゴリ間は加算）
- **気象庁のデータが主** — 警報・注意報・早期注意情報・震度・津波警報・噴火警戒レベルは気象庁の公開 JSON から取得。Open-Meteo と USGS は数値指標と取得できなかったときの代替
- **5分間隔自動更新** — バックグラウンドで各APIを定期取得
- **インタラクティブ地図** — Leaflet によるマーカー表示。危険度の帯を色・大きさ・数値で示し、クリックで詳細パネルを表示
- **危険度別ランキング** — 全64地域をスコア降順で一覧表示。1位はトップのバナーで強調
- **詳細パネル** — 各地域のスコアの内訳（カテゴリごとの採用理由と点数）を表示
- **地域の絞り込み** — 地域名（漢字・かな）で絞り込む。ランキングと地図の両方に効く
- **ピン留め** — 気になる地域をランキングの上に固定する（`localStorage` に保存）
- **X でシェア** — 現在の1位の地域とスコアを投稿する
- **明暗の配色** — 端末の設定に従って明るい配色と暗い配色を切り替える

## 対象地域（64地域）

気象庁の発表官署・一次細分区域を境界に、**46都道府県＋北海道8地域＋離島10地域**を対象にする（`src/lib/regions.ts`）。

- 北海道8地域: 宗谷 / 上川・留萌 / 網走・北見・紋別 / 十勝 / 釧路・根室 / 胆振・日高 / 石狩・空知・後志 / 渡島・檜山
- 離島10地域: 伊豆・小笠原諸島 / 佐渡 / 隠岐 / 壱岐・対馬 / 五島 / 種子島・屋久島 / 奄美 / 大東島 / 宮古島 / 八重山

都道府県を県庁所在地1点で代表しない理由は [CLAUDE.md の対象地域](CLAUDE.md#対象地域regionsts) を参照。

## 技術スタック

| 要素           | 技術                                  |
| -------------- | ------------------------------------- |
| フレームワーク | SvelteKit（Svelte 5 Runes モード）    |
| ビルド         | Vite + @sveltejs/adapter-static       |
| 地図           | Leaflet 1.x                           |
| テスト         | Vitest（ロジック・ブラウザ・実API）   |
| ホスティング   | Firebase Hosting（`build/` フォルダ） |
| 状態管理       | Svelte store（writable / derived）    |

## 使用API（すべて無料・APIキー不要）

| API                    | 用途                                           |
| ---------------------- | ---------------------------------------------- |
| 気象庁 警報・注意報    | 警報レベル（全国分を1リクエスト）              |
| 気象庁 早期注意情報    | 警報級の可能性（全国分を1リクエスト）          |
| 気象庁 地震情報        | 都道府県・市区町村別の実測震度                 |
| 気象庁 津波            | 津波予報区ごとの警報レベル                     |
| 気象庁 噴火警報        | 噴火警戒レベル（火山一覧の位置で距離を判定）   |
| Open-Meteo Forecast    | 気温・体感温度・降水量・風速・突風・降雪・積雪 |
| Open-Meteo Air Quality | PM2.5・AQI                                     |
| USGS FDSN              | 地震のフォールバック（推定震度）               |

エンドポイントと選定の注意点は [CLAUDE.md の使用API](CLAUDE.md#使用apiすべて無料apiキー不要フロント直接fetch) を参照。

## スコアリングロジック

閾値・加点・文言は `src/lib/services/scoringRules.ts`、評価ロジックは `src/lib/services/riskCalculator.ts` にある。合計は最大100でキャップする。

| カテゴリ   | スコア = 以下の最大値                            |
| ---------- | ------------------------------------------------ |
| 雨         | 大雨・洪水系警報 / Open-Meteo推定レベル / 降水量 |
| 雪         | 大雪系警報 / 降雪量 / 積雪深                     |
| 風         | 暴風系警報 / 平均風速 / 最大瞬間風速             |
| 波浪・高潮 | 波浪・高潮系警報                                 |
| 気温       | 高温（体感温度）/ 低温（体感温度・低温注意報）   |
| 地震       | 震度 × 時間減衰 ＋ 群発性                        |
| 津波       | 津波警報レベル                                   |
| 火山       | 噴火警戒レベル                                   |
| 大気       | PM2.5                                            |

| スコア | 帯   | 気象庁の警戒レベル |
| ------ | ---- | ------------------ |
| 0–9    | 平穏 | —                  |
| 10–29  | 注意 | レベル2            |
| 30–49  | 警戒 | レベル3            |
| 50–100 | 危険 | レベル4以上        |

配点の基準と段階表は [CLAUDE.md のスコアリングロジック](CLAUDE.md#スコアリングロジック) を参照。

## 見た目

tk3.biz のアプリで共通の土台（`src/lib/styles/tk-base.css`）を使い、端末の設定に従って明るい配色と暗い配色を切り替える。危険度の色と決まりは [CLAUDE.md のカラーパレット](CLAUDE.md#カラーパレット) を参照。

## ディレクトリ構成

```tree
src/
  lib/
    api/                # 各APIの取得とパース（気象庁・Open-Meteo・USGS）
    services/
      scoringRules.ts   # 段階表・加点・理由文言
      riskCalculator.ts # スコア算出とAPI統合
    components/         # PinIcon など
    stores/             # riskStore（5分間隔自動更新）・pinnedStore（ピン留め）
    styles/tk-base.css  # tk3 apps の共通の土台
    utils/              # 並列fetch・距離・絞り込み・ビルド情報など
    regions.ts          # 対象64地域の定義
    types.ts            # 型定義
  app.css               # アプリ固有の色（明暗の両方の値）
  app.html              # <head>（color-scheme・theme-color・アイコン）
  routes/
    +layout.ts          # prerender=true, ssr=false
    +layout.svelte      # 共通の土台と app.css の読み込み
    +page.svelte        # メインUI（ランキング + 地図 + 詳細パネル）
```

ファイルごとの説明は [CLAUDE.md のディレクトリ構成](CLAUDE.md#ディレクトリ構成) を参照。

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
npm run lint          # ESLint ＋ Prettier のチェック
npm test              # ロジックのテスト（vitest run・外部依存なし）
npm run test:browser  # ブラウザモードのテスト（Chromium が必要）
npm run test:all      # npm test ＋ test:browser
npm run verify:jma    # 気象庁コード表の追随確認（実APIにアクセス）
```

## テスト

テストファイルは対象ファイルと同じディレクトリに置く。`*.test.ts` はロジック（`npm test`）、`*.browser.test.ts` はブラウザモード（`npm run test:browser`）、`*.live.test.ts` は実API（`npm run verify:jma`）。詳しくは [CLAUDE.md のテスト方針](CLAUDE.md#テスト方針) を参照。

## Firebase Hosting デプロイ

デプロイは GitHub Actions だけで行います（ローカルからはデプロイしません）。`main` は保護されていて、変更は PR で入れます。PR では `.github/workflows/ci.yml` が検証を流し、マージで `main` に入ると `.github/workflows/deploy.yml` がビルド・テストのあと Firebase Hosting へデプロイします。手動で出し直すときは Actions の画面から実行してください（`gh workflow run deploy.yml`）。

## 設計制約

- **バックエンドなし** — Firebase Functions 不使用、完全フロントエンド構成
- **SSR 無効** — `ssr=false`, `prerender=true` を必須とする
- **無料APIのみ** — すべてのデータソースは認証・課金不要
