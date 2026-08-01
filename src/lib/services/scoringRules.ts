import type { AlertLevel, ShindoLevel, TsunamiLevel } from '../types';

/**
 * 危険スコアの「ルール定義」を計算ロジックから分離したモジュール。
 * 閾値・加点・理由文言（＝ポリシー）はすべてここに集約し、
 * riskCalculator.ts は「どう評価するか」だけに専念させる。
 *
 * CLAUDE.md のスコアリング表と1対1で対応する。
 *
 * ## スコアの意味（この尺度がすべての配点の基準）
 *
 * スコアは「その地域に**いま**いる人の、**生命**に対する危険度」を表す。
 * 「危険な事象がいくつ起きているか」でも「ニュースになる度合い」でもない。
 *
 * | スコア | 状態 |
 * | ------ | ---- |
 * | 100    | その場の全員が確実に死傷する。回避手段も猶予もない（10秒後に建物が崩落する等） |
 * | 90     | 命を守る行動が必要。避難できなければ死者が出る規模の現象が現に発生している |
 * | 70     | 生命の危険が差し迫っている。直ちに避難すべき |
 * | 50     | 避難が必要。逃げ遅れると命に関わる |
 * | 30     | 重大な災害のおそれ。高齢者等は避難、屋外は危険 |
 * | 15     | 条件次第で危険（屋外作業・高齢者・持病のある人） |
 * | 5      | 日常的な悪条件。健康な人に実害はない |
 * | 0      | 平穏 |
 *
 * この尺度から導かれる重要な帰結:
 * - **100はほぼ到達しない。** 都道府県〜離島という広さと5分更新という粒度では
 *   「全員が確実に死ぬ」状態は表現できない。大津波警報＋震度7のような複合時のみ。
 * - **不快さや健康影響と、致死性を混同しない。** PM2.5が非常に悪くても10秒後に死にはしない。
 * - **気象庁の警戒レベル1〜5がそのまま生命危険度の尺度**なので、警報のスコアはそれに合わせる
 *   （早期注意情報5 / 注意報10 / 警報30 / 危険警報50 / 特別警報70）。
 * - **「入山規制」のように対象が限定される警戒は低い。** 噴火警戒レベル3は登山者への規制で、
 *   居住地域の住民の生命は脅かされていない。
 *
 * ## 設計原則
 * 1. **カテゴリ内は最大値、カテゴリ間は加算**
 *    「大雨警報」と「降水量」は同じ雨のリスクなので、両方を加算すると二重計上になる。
 *    同一カテゴリ内では最も高いスコアだけを採用する。
 * 2. **段階の閾値は実データで較正する**
 *    体感温度・突風・地震の群発性の閾値は、実際のAPIレスポンス分布を見て決めている。
 *    「平常時はほぼ0点、異常時にはっきり跳ね上がる」ことを基準にする。
 *    閾値（どこで段が変わるか）は実データ、配点（何点か）は上の生命危険度の尺度で決める。
 */

/** 危険スコアの上限（これ以上は加点しない）。 */
export const MAX_SCORE = 100;

/**
 * スコアの帯。気象庁の警戒レベルに対応させている。
 * 高い順に並べること（最初に該当した帯を採用）。
 */
export interface RiskBand {
	readonly min: number;
	readonly label: string;
	/** UI が参照する CSS カスタムプロパティ名 */
	readonly colorVar: string;
	/**
	 * 地図マーカーの直径（px）。危険度を色とサイズの両方で符号化する。
	 *
	 * 帯ごとの離散値にしているのは、スコア分布が下側に圧縮されているため
	 * （実測は中央値13・最高57）。連続値で写像すると13点と20点の差が1px程度になり
	 * 判別できず、サイズ幅の大半も使われないまま終わる。
	 * 色と同じ区切りにすることで2つの視覚チャンネルが互いを補強し、
	 * 色覚特性のある利用者にも伝わる。
	 *
	 * 最小26pxまで下げられるのは、帯ごとに表示される桁数が違うため
	 * （平穏は1〜9の1桁、危険は最大3桁）。1段あたり約1.23倍の等比。
	 */
	readonly markerSizePx: number;
	/** マーカー内のスコア文字サイズ（px）。 */
	readonly markerFontPx: number;
}

export const RISK_BANDS: readonly RiskBand[] = [
	// 警戒レベル4相当以上：全員避難
	{ min: 50, label: '危険', colorVar: '--danger', markerSizePx: 48, markerFontPx: 15 },
	// 警戒レベル3相当：高齢者等避難
	{ min: 30, label: '警戒', colorVar: '--alert', markerSizePx: 40, markerFontPx: 13 },
	// 警戒レベル2相当
	{ min: 10, label: '注意', colorVar: '--caution', markerSizePx: 32, markerFontPx: 12 },
	{ min: 0, label: '平穏', colorVar: '--safe', markerSizePx: 26, markerFontPx: 11 },
];

export function riskBand(score: number): RiskBand {
	return RISK_BANDS.find((band) => score >= band.min) ?? RISK_BANDS[RISK_BANDS.length - 1];
}

// ─── 気象警報レベル ──────────────────────────────────────────────────────────

/**
 * 警報レベル → 加点。気象・津波・火山で共通のスケール感を持たせている。
 * 気象庁の警戒レベル（1〜5）と対応させており、`danger` は警戒レベル4（避難指示相当）。
 */
export const ALERT_LEVEL_SCORES: Record<AlertLevel, number> = {
	none: 0,
	early: 5,
	advisory: 10,
	warning: 30,
	danger: 50,
	special: 70,
};

export const ALERT_LEVEL_LABELS: Record<AlertLevel, string> = {
	none: '',
	early: '早期注意情報',
	advisory: '注意報',
	warning: '警報',
	danger: '危険警報',
	special: '特別警報',
};

/** レベルの強さ順位（比較用）。 */
const ALERT_LEVEL_RANK: Record<AlertLevel, number> = {
	none: 0,
	early: 1,
	advisory: 2,
	warning: 3,
	danger: 4,
	special: 5,
};

/** 2つの警報レベルのうち強い方を返す。 */
export function maxAlertLevel(a: AlertLevel, b: AlertLevel): AlertLevel {
	return ALERT_LEVEL_RANK[a] >= ALERT_LEVEL_RANK[b] ? a : b;
}

// ─── 数値指標の段階表 ────────────────────────────────────────────────────────

/**
 * 数値指標の段階（しきい値以上で該当）。
 * 配列は必ず高い順に並べること（最初に該当した段階を採用）。
 */
export interface ScoreTier {
	readonly min: number;
	readonly score: number;
	readonly reason: (value: number) => string;
}

/**
 * 「しきい値以下で該当」する段階（低温など、値が小さいほど危険な指標用）。
 * 配列は必ず低い順に並べること。
 */
export interface ScoreTierBelow {
	readonly max: number;
	readonly score: number;
	readonly reason: (value: number) => string;
}

/**
 * 値に該当する最上位の段階を返す（高い順に走査し、最初に `min` を満たした段階）。
 * 該当なしは null。
 */
export function matchTier(value: number, tiers: readonly ScoreTier[]): ScoreTier | null {
	for (const tier of tiers) {
		if (value >= tier.min) return tier;
	}
	return null;
}

/**
 * 値に該当する最下位の段階を返す（低い順に走査し、最初に `max` を満たした段階）。
 * 該当なしは null。
 */
export function matchTierBelow(
	value: number,
	tiers: readonly ScoreTierBelow[]
): ScoreTierBelow | null {
	for (const tier of tiers) {
		if (value <= tier.max) return tier;
	}
	return null;
}

/**
 * 平均風速 km/h → 加点。
 * 90km/h（25m/s）で屋外は行動不能、飛来物で死亡例がある。40km/h程度は歩きにくいだけ。
 * 「やや強い風」（20km/h）は日常の範囲なので配点しない。
 */
export const WIND_TIERS: readonly ScoreTier[] = [
	{ min: 90, score: 25, reason: (v) => `猛烈な風 ${Math.round(v)}km/h` },
	{ min: 60, score: 12, reason: (v) => `暴風 ${Math.round(v)}km/h` },
	{ min: 40, score: 4, reason: (v) => `強風 ${Math.round(v)}km/h` },
];

/**
 * 最大瞬間風速 km/h → 加点。
 * 実データでは突風は平均風速の約4倍で観測されるため、平均風速とは別の閾値を持つ。
 * 暴風警報の基準（平均20〜25m/s ≒ 最大瞬間30〜35m/s ≒ 108〜126km/h）に合わせている。
 */
export const GUST_TIERS: readonly ScoreTier[] = [
	{ min: 150, score: 35, reason: (v) => `猛烈な突風 ${Math.round(v)}km/h` },
	{ min: 120, score: 22, reason: (v) => `非常に強い突風 ${Math.round(v)}km/h` },
	{ min: 90, score: 12, reason: (v) => `強い突風 ${Math.round(v)}km/h` },
	{ min: 70, score: 4, reason: (v) => `突風 ${Math.round(v)}km/h` },
];

/**
 * 降水量 mm/h → 加点。
 * 雨そのものが直接人を殺すことは少なく、致命的になるのは土砂災害・洪水を経由したとき。
 * それらは気象庁の警報側で評価されるので、実測雨量の配点は控えめにする。
 * 「小雨」は配点しない。
 */
export const PRECIPITATION_TIERS: readonly ScoreTier[] = [
	{ min: 50, score: 20, reason: (v) => `猛烈な雨 ${v.toFixed(0)}mm/h` },
	{ min: 30, score: 12, reason: (v) => `非常に激しい雨 ${v.toFixed(0)}mm/h` },
	{ min: 15, score: 6, reason: (v) => `激しい雨 ${v.toFixed(0)}mm/h` },
	{ min: 5, score: 2, reason: (v) => `やや強い雨 ${v.toFixed(0)}mm/h` },
];

/**
 * 降雪量 cm/h → 加点。
 * 致死経路は「視界不良と立ち往生による車内での凍死・一酸化炭素中毒」。
 * 実際に毎年死者が出ているが、雨と同様に即時性は低い。
 */
export const SNOWFALL_TIERS: readonly ScoreTier[] = [
	{ min: 10, score: 28, reason: (v) => `猛烈な降雪 ${v.toFixed(0)}cm/h` },
	{ min: 5, score: 16, reason: (v) => `大雪 ${v.toFixed(0)}cm/h` },
	{ min: 3, score: 8, reason: (v) => `強い降雪 ${v.toFixed(1)}cm/h` },
	{ min: 1, score: 2, reason: (v) => `降雪 ${v.toFixed(1)}cm/h` },
];

/**
 * 積雪深 cm → 加点。
 * 積もっていること自体は即座に人を殺さない（豪雪地帯では100cmは日常）。
 * 致死経路は家屋倒壊と雪下ろし中の転落なので、極端な深さでのみ配点を上げる。
 */
export const SNOW_DEPTH_TIERS: readonly ScoreTier[] = [
	{ min: 200, score: 22, reason: (v) => `記録的な積雪 ${v.toFixed(0)}cm` },
	{ min: 100, score: 12, reason: (v) => `深い積雪 ${v.toFixed(0)}cm` },
	{ min: 50, score: 5, reason: (v) => `積雪 ${v.toFixed(0)}cm` },
	{ min: 20, score: 1, reason: (v) => `積雪 ${v.toFixed(0)}cm` },
];

/**
 * 体感温度℃（高温側）→ 加点。
 * 実データでは体感温度は気温より中央値+5.8℃（最大+8.5℃）高く出るため、
 * 気温ベースの閾値（28/30/35/40℃）をそのまま流用すると真夏に全国が最高段階へ張り付く。
 * 8月1日の全国分布（体感22.6〜43.7℃）を見て較正した。
 */
export const HEAT_TIERS: readonly ScoreTier[] = [
	{ min: 45, score: 30, reason: (v) => `危険な暑さ 体感${v.toFixed(1)}℃` },
	{ min: 40, score: 18, reason: (v) => `熱中症危険域 体感${v.toFixed(1)}℃` },
	{ min: 36, score: 8, reason: (v) => `厳重警戒の暑さ 体感${v.toFixed(1)}℃` },
	{ min: 32, score: 2, reason: (v) => `警戒すべき暑さ 体感${v.toFixed(1)}℃` },
];

/**
 * 体感温度℃（低温側）→ 加点。風速冷却込みの体感温度で評価する。
 * 屋内に入れる人にとっては致命的でないため、高温側よりやや低く配点する。
 * 「冷え込み」（3℃以下）は日常の範囲なので配点しない。
 */
export const COLD_TIERS: readonly ScoreTierBelow[] = [
	{ max: -15, score: 20, reason: (v) => `極寒 体感${v.toFixed(1)}℃` },
	{ max: -10, score: 12, reason: (v) => `厳しい寒さ 体感${v.toFixed(1)}℃` },
	{ max: -5, score: 6, reason: (v) => `強い寒気 体感${v.toFixed(1)}℃` },
	{ max: 0, score: 2, reason: (v) => `氷点下 体感${v.toFixed(1)}℃` },
];

/**
 * PM2.5 μg/m³ → 加点。
 * 大気汚染は長期的な健康影響と、呼吸器・循環器疾患のある人への急性影響が主で、
 * 健康な人がその場で死ぬ性質のものではない。生命危険度の尺度では低く置く。
 */
export const PM25_TIERS: readonly ScoreTier[] = [
	{ min: 100, score: 12, reason: (v) => `PM2.5 ${v.toFixed(0)}μg/m³（非常に悪い）` },
	{ min: 50, score: 6, reason: (v) => `PM2.5 ${v.toFixed(0)}μg/m³（悪い）` },
	{ min: 25, score: 2, reason: (v) => `PM2.5 ${v.toFixed(0)}μg/m³（やや悪い）` },
];

// ─── 地震 ────────────────────────────────────────────────────────────────────

/**
 * 気象庁震度階級 → 基礎加点（時間減衰を乗じる前の値。＝揺れている最中の危険度）。
 *
 * 気象庁の「震度階級関連解説表」が記述する人的被害の実態に合わせている:
 * - 震度3「屋内にいる人のほとんどが揺れを感じる」→ 実害なし
 * - 震度4「かなりの恐怖感。座りの悪い置物が倒れることがある」→ ほぼ実害なし
 * - 震度5弱「棚の食器や本が落ちることがある」→ 負傷の可能性
 * - 震度5強「物につかまらないと歩くことが難しい」→ 屋内で負傷
 * - 震度6弱「立っていることが困難。耐震性の低い木造建物は傾くことがある」
 * - 震度6強「はわないと動くことができない。耐震性の低い木造建物は倒れるものが多い」
 * - 震度7「耐震性の高い木造建物でも傾く。鉄筋コンクリート造でも倒れるものがある」
 *
 * 震度7でも「その場の全員が確実に死ぬ」わけではない（多くの人は生存する）ため90に置く。
 */
export const SHINDO_SCORES: Record<ShindoLevel, number> = {
	'1': 1,
	'2': 2,
	'3': 4,
	'4': 9,
	'5-': 20,
	'5+': 35,
	'6-': 55,
	'6+': 75,
	'7': 90,
};

export const SHINDO_LABELS: Record<ShindoLevel, string> = {
	'1': '震度1',
	'2': '震度2',
	'3': '震度3',
	'4': '震度4',
	'5-': '震度5弱',
	'5+': '震度5強',
	'6-': '震度6弱',
	'6+': '震度6強',
	'7': '震度7',
};

/** 震度の強さ順位（比較用）。弱い順に並べる。 */
export const SHINDO_ORDER: readonly ShindoLevel[] = [
	'1',
	'2',
	'3',
	'4',
	'5-',
	'5+',
	'6-',
	'6+',
	'7',
];

/**
 * 地震スコアの評価対象とする期間（日）。この日数を過ぎた地震は0点になる。
 * 気象庁は「1週間程度は同規模の地震に注意」と案内しており、1週目の時点でまだ危険が
 * 残っている必要がある。7日で打ち切ると1週間目がちょうど0になってしまうため2週間とる。
 */
export const QUAKE_WINDOW_DAYS = 14;

/**
 * 大森・宇津の法則の時定数（日）。余震発生率は 1/(経過日数 + c) に比例して減衰する。
 * c を大きくすると初期の落ち込みが緩やかになる。
 * 「特に最初の2〜3日は危険が高い」という実感に合うよう5日に置いている。
 */
const AFTERSHOCK_DECAY_C_DAYS = 5;

/**
 * 経過日数から地震スコアの時間減衰係数を求める。
 *
 * ## この係数が表しているもの
 * 揺れが収まった後も、その地域は「いつまた大きく揺れてもおかしくない」状態が続く。
 * 減衰係数はその**地域が置かれた危険な状態の残り具合**を表す:
 * - 余震（本震と同規模の地震が再来する可能性）
 * - 損傷して耐力が落ちた建物・崩れやすくなった斜面
 * - 途絶したライフラインと避難生活
 *
 * 「いま余震が起きる確率」そのものではない点に注意。厳密な確率だと発生直後でも
 * 5分以内に大地震が来る確率は極小で、スコアが即座に0近くまで落ちてしまう。
 *
 * ## 形
 * 余震発生率が従う大森・宇津の法則 `1/(t + c)` を基本形とし、
 * 観測窓の終端（14日）で滑らかに0へ落ちるテーパーを掛ける。
 * テーパーがないと窓の外に出た瞬間にスコアが不連続に消える。
 *
 * 直線減衰ではなくこの形にしているのは、余震危険度が「最初に急、そのあと長い尾を引く」
 * という実際の減り方をするため。
 *
 * 主な値: 0日=1.00 / 1日=0.77 / 3日=0.49 / 5日=0.32 / 7日=0.21 / 10日=0.10 / 14日=0
 */
export function quakeTimeFactor(ageDays: number): number {
	if (ageDays <= 0) return 1.0;
	if (ageDays >= QUAKE_WINDOW_DAYS) return 0;
	const omori = AFTERSHOCK_DECAY_C_DAYS / (ageDays + AFTERSHOCK_DECAY_C_DAYS);
	const taper = 1 - ageDays / QUAKE_WINDOW_DAYS;
	return omori * taper;
}

/**
 * 群発性（観測回数）を数える期間。
 * 「いま地震活動が活発か」を見る指標なので、スコアの評価期間（`QUAKE_WINDOW_DAYS`）より短く絞る。
 * 理由文言もこの定数から組み立てるので、変えれば表示も追随する。
 */
export const SWARM_WINDOW_DAYS = 7;

/**
 * 直近 `SWARM_WINDOW_DAYS` 日間に震度1以上を観測した回数 → 加点（群発地震・余震活動の指標）。
 * 実データでは平常時の都道府県は7日間で中央値2回、活発時は25〜338回だった。
 */
export const QUAKE_SWARM_TIERS: readonly ScoreTier[] = [
	{ min: 100, score: 8, reason: (v) => `地震活動が極めて活発 ${SWARM_WINDOW_DAYS}日間で${v}回` },
	{ min: 30, score: 5, reason: (v) => `地震活動が活発 ${SWARM_WINDOW_DAYS}日間で${v}回` },
	{ min: 10, score: 2, reason: (v) => `地震が頻発 ${SWARM_WINDOW_DAYS}日間で${v}回` },
	{ min: 5, score: 1, reason: (v) => `地震が継続 ${SWARM_WINDOW_DAYS}日間で${v}回` },
];

/**
 * 時間減衰を反映した震度スコア。「いま最も危険な地震はどれか」を比べるための値。
 * 各地域に割り当てる地震を選ぶときに使う（マグニチュード最大ではなく、この値が最大のもの）。
 */
export function decayedShindoScore(shindo: ShindoLevel, ageDays: number): number {
	return SHINDO_SCORES[shindo] * quakeTimeFactor(ageDays);
}

// ─── 津波 ────────────────────────────────────────────────────────────────────

/**
 * 津波警報レベル → 加点。
 *
 * 大津波警報はこの尺度の基準（100）に最も近い事象。到達すれば避難していない人はまず助からず、
 * 猶予も数分しかない。一方で「高台へ逃げれば助かる」ため100ではなく95に置く。
 * 津波注意報（〜1m）は海岸・河口から離れれば安全で、生命の危険は限定的。
 */
export const TSUNAMI_SCORES: Record<TsunamiLevel, number> = {
	none: 0,
	forecast: 2,
	advisory: 25,
	warning: 75,
	major: 95,
};

export const TSUNAMI_LABELS: Record<TsunamiLevel, string> = {
	none: '',
	forecast: '津波予報（若干の海面変動）',
	advisory: '津波注意報',
	warning: '津波警報',
	major: '大津波警報',
};

// ─── 火山 ────────────────────────────────────────────────────────────────────

/**
 * 噴火警戒レベル 1〜5 → 加点。
 *
 * **レベルごとに「誰の生命が脅かされているか」が違う**点を反映する。
 * レベル1〜3は火口周辺・登山者への規制であって、居住地域の住民は危険にさらされていない。
 * 居住地域に影響が及ぶレベル4以上で一気に上げる。
 * - レベル1（活火山であることに留意）: 対象者なし
 * - レベル2（火口周辺規制）: 火口周辺のみ
 * - レベル3（入山規制）: 登山者・入山者のみ
 * - レベル4（高齢者等避難）: 居住地域の要配慮者
 * - レベル5（避難）: 居住地域の全住民
 */
export const VOLCANO_LEVEL_SCORES: Record<number, number> = {
	1: 1,
	2: 6,
	3: 20,
	4: 55,
	5: 85,
};

/** 噴火警戒レベルのスコアを引く（範囲外は0）。 */
export function volcanoLevelScore(level: number): number {
	return VOLCANO_LEVEL_SCORES[level] ?? 0;
}
