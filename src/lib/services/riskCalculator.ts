import type {
	RegionRisk,
	WeatherData,
	EarthquakeData,
	AirData,
	JmaData,
	TsunamiData,
	VolcanoData,
	RiskType,
	Region,
	ScoreItem,
	AlertLevel,
	WeatherCategory,
} from '../types';
import { emptyCategoryLevels, emptyCategoryNames } from '../types';
import { ageInDays } from '../utils/time';
import { fetchWeatherBatch } from '../api/weather';
import { fetchEarthquakesAll } from '../api/earthquake';
import { fetchAirQualityBatch } from '../api/air';
import { fetchAllJmaWarnings } from '../api/jma';
import { fetchTsunamiAll } from '../api/tsunami';
import { fetchVolcanoAll } from '../api/volcano';
import { fetchEarlyWarningAll } from '../api/earlyWarning';
import type { EarlyWarningData, EarlyWarningItem } from '../api/earlyWarning';
import { valueOrNull } from '../utils/settled';
import {
	WIND_TIERS,
	GUST_TIERS,
	PRECIPITATION_TIERS,
	SNOWFALL_TIERS,
	SNOW_DEPTH_TIERS,
	HEAT_TIERS,
	COLD_TIERS,
	PM25_TIERS,
	SHINDO_SCORES,
	SHINDO_LABELS,
	QUAKE_SWARM_TIERS,
	TSUNAMI_SCORES,
	TSUNAMI_LABELS,
	ALERT_LEVEL_SCORES,
	ALERT_LEVEL_LABELS,
	volcanoLevelScore,
	quakeTimeFactor,
	maxAlertLevel,
	matchTier,
	matchTierBelow,
	MAX_SCORE,
} from './scoringRules';
import type { ScoreTier, ScoreTierBelow } from './scoringRules';

export interface ScoreContribution {
	score: number;
	riskTypes: RiskType[];
	reasons: string[];
	scoreItems: ScoreItem[];
}

function emptyContribution(): ScoreContribution {
	return { score: 0, riskTypes: [], reasons: [], scoreItems: [] };
}

/** タイムスタンプ（ms）を「M/D HH:mm」形式の日本語日時文字列に変換 */
export function formatDateTime(ts: number): string {
	return new Date(ts).toLocaleString('ja-JP', {
		month: 'numeric',
		day: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		timeZone: 'Asia/Tokyo',
	});
}

// ─── カテゴリ内の最大値選択 ──────────────────────────────────────────────────

/** カテゴリ内のスコア候補。 */
interface Candidate {
	label: string;
	score: number;
}

/**
 * 同一カテゴリ内の候補から最大スコアの1件だけを採用する。
 *
 * 「大雨警報」と「降水量」は同じ雨のリスクを別の観測から見ているだけなので、
 * 両方を加算すると二重計上になる。採用されなかった候補は note に残して
 * 「なぜこの点数なのか」を説明できるようにする。
 */
function pickMaxCandidate(
	candidates: (Candidate | null)[],
	/** すでに他のカテゴリで計上済みのラベル。同じ警報を二重に数えないために除外する。 */
	usedLabels: ReadonlySet<string> = new Set()
): ScoreItem | null {
	const valid = candidates.filter(
		(c): c is Candidate => c !== null && c.score > 0 && !usedLabels.has(c.label)
	);
	if (valid.length === 0) return null;

	const winner = valid.reduce((best, c) => (c.score > best.score ? c : best));
	const others = valid.filter((c) => c !== winner);
	const note =
		others.length > 0
			? `同カテゴリのため非加算: ${others.map((o) => `${o.label} ${o.score}点`).join(' / ')}`
			: undefined;

	return { label: winner.label, points: winner.score, note };
}

function tierCandidate(value: number, tiers: readonly ScoreTier[]): Candidate | null {
	const tier = matchTier(value, tiers);
	return tier ? { label: tier.reason(value), score: tier.score } : null;
}

function tierBelowCandidate(value: number, tiers: readonly ScoreTierBelow[]): Candidate | null {
	const tier = matchTierBelow(value, tiers);
	return tier ? { label: tier.reason(value), score: tier.score } : null;
}

/** カテゴリごとの警報名の見出し。 */
const CATEGORY_ALERT_LABELS: Record<WeatherCategory, string> = {
	rain: '大雨・洪水',
	snow: '大雪',
	wind: '暴風',
	coast: '波浪・高潮',
	temperature: '低温',
	other: '気象',
};

/**
 * 気象警報のスコア候補を作る。
 *
 * `officialName` が渡された場合（＝気象庁が実際に発令している場合）はその正式名称を使う。
 * 「気象注意報」のような総称ではなく「濃霧注意報」と表示できる。
 * 渡されない場合は Open-Meteo からの推定なので、カテゴリ名の総称に「推定」を付けて
 * 気象庁の発表と区別する（防災情報で推定値を発表と誤認させてはいけない）。
 */
function alertCandidate(
	category: WeatherCategory,
	level: AlertLevel,
	officialName?: string
): Candidate | null {
	const score = ALERT_LEVEL_SCORES[level];
	if (score === 0) return null;
	if (officialName) return { label: officialName, score };

	const heading = CATEGORY_ALERT_LABELS[category];
	const generic =
		level === 'early' ? `早期注意情報（${heading}）` : `${heading}${ALERT_LEVEL_LABELS[level]}`;
	return { label: `${generic}（推定）`, score };
}

// ─── 気象 ────────────────────────────────────────────────────────────────────

/**
 * 気象データを「雨 / 雪 / 風 / 波浪高潮 / その他 / 気温」のカテゴリごとに採点する。
 * カテゴリ内は最大値、カテゴリ間は加算。
 *
 * 気象庁の警報が取得できている場合はそれを正とするが、気象庁は「早期注意情報」を
 * 警報JSONに含めないため、Open-Meteo から推定したレベルを雨カテゴリの下限として併用する
 * （推定は天気コードと降水量が主な根拠なので雨カテゴリに割り当てる）。
 */
export function scoreWeather(
	w: WeatherData,
	jma?: JmaData | null,
	/**
	 * 気象庁の警報を取得できたか。取得できなかったときだけ Open-Meteo の推定レベルを使う。
	 * `jma` の有無では判定できない —— 早期注意情報だけが取れた場合も `jma` は非nullになるため。
	 */
	jmaWarningsAvailable: boolean = jma != null
): ScoreContribution {
	const riskTypes: RiskType[] = [];
	const reasons: string[] = [];
	const scoreItems: ScoreItem[] = [];
	let score = 0;

	const jmaLevels = jma?.categoryLevels ?? emptyCategoryLevels();
	const jmaNames = jma?.categoryNames;
	const observedAtSuffix = w.observedAt ? ` ${formatDateTime(w.observedAt)}観測` : '';

	/** そのカテゴリで気象庁が発令していれば正式名称を返す。 */
	const officialName = (category: WeatherCategory): string | undefined =>
		jmaLevels[category] !== 'none' ? jmaNames?.[category] || undefined : undefined;

	/** 計上済みの警報名。複合警報（暴風雪＝風＋雪）を1回だけ数えるために使う。 */
	const usedLabels = new Set<string>();

	const addCategory = (item: ScoreItem | null, riskType: RiskType): void => {
		if (!item) return;
		usedLabels.add(item.label);
		score += item.points;
		reasons.push(item.label);
		scoreItems.push(item);
		if (!riskTypes.includes(riskType)) riskTypes.push(riskType);
	};

	/** そのカテゴリで気象庁が発令している警報の候補。 */
	const jmaAlert = (category: WeatherCategory): Candidate | null =>
		alertCandidate(category, jmaLevels[category], officialName(category));

	// 雨だけは Open-Meteo の推定レベルを併用するため個別に組み立てる。
	// 推定は気象庁のデータが取れなかったときだけの代替とする
	// （気象庁が発表していない「警報」を推定で出すと、発表と誤認させる恐れがあるため）。
	const estimatedLevel = jmaWarningsAvailable ? 'none' : w.alertLevel;
	const rainLevel = maxAlertLevel(jmaLevels.rain, estimatedLevel);
	const rainIsOfficial = jmaLevels.rain === rainLevel;
	const rainAlert = alertCandidate(
		'rain',
		rainLevel,
		rainIsOfficial ? officialName('rain') : undefined
	);
	if (rainAlert && !rainIsOfficial) rainAlert.label += observedAtSuffix;

	// カテゴリ内は最大値、カテゴリ間は加算。
	// 波浪・高潮とその他は対応する観測値を持たないため警報のみが候補になる。
	const weatherCategories: ReadonlyArray<{
		riskType: RiskType;
		candidates: (Candidate | null)[];
	}> = [
		{
			riskType: 'weather',
			candidates: [rainAlert, tierCandidate(w.precipitation, PRECIPITATION_TIERS)],
		},
		{
			riskType: 'snow',
			candidates: [
				jmaAlert('snow'),
				tierCandidate(w.snowfall, SNOWFALL_TIERS),
				tierCandidate(w.snowDepthCm, SNOW_DEPTH_TIERS),
			],
		},
		{
			riskType: 'weather',
			candidates: [
				jmaAlert('wind'),
				tierCandidate(w.windSpeed, WIND_TIERS),
				tierCandidate(w.windGusts, GUST_TIERS),
			],
		},
		{ riskType: 'weather', candidates: [jmaAlert('coast')] },
		{ riskType: 'weather', candidates: [jmaAlert('other')] },
	];
	// 同じ警報が複数カテゴリに属する場合（暴風雪＝風＋雪）、点数は最初のカテゴリでだけ計上し、
	// 残りのカテゴリはその警報を除いた次点（実測値など）を採る。
	// 二重計上を防ぎつつ、実際に観測されている雪や風を取りこぼさないため。
	for (const { riskType, candidates } of weatherCategories) {
		addCategory(pickMaxCandidate(candidates, usedLabels), riskType);
	}

	// 気温：高温側と低温側を1つのカテゴリとして競わせる。
	// 低温側は気象庁の低温注意報・霜注意報も候補に含める。
	// 他カテゴリと同じく pickMaxCandidate に通すことで、非採用の候補が note に残る。
	const heat = tierCandidate(w.apparentTemperature, HEAT_TIERS);
	const temperature = pickMaxCandidate(
		[heat, tierBelowCandidate(w.apparentTemperature, COLD_TIERS), jmaAlert('temperature')],
		usedLabels
	);
	if (temperature) {
		addCategory(temperature, temperature.label === heat?.label ? 'heat' : 'cold');
	}

	return { score, riskTypes, reasons, scoreItems };
}

// ─── 地震 ────────────────────────────────────────────────────────────────────

/**
 * 地震スコア = 震度の基礎点 × 時間減衰 ＋ 群発性の加点。
 *
 * 基礎点は「その地域で観測された震度」から引く。震源距離は震度そのものに
 * 内包されているため、距離による減衰は掛けない（掛けると二重減衰になる）。
 * 時間減衰のカーブは `quakeTimeFactor` を参照。
 */
export function scoreEarthquake(eq: EarthquakeData): ScoreContribution {
	const riskTypes: RiskType[] = [];
	const reasons: string[] = [];
	const scoreItems: ScoreItem[] = [];
	let score = 0;

	if (eq.shindo) {
		const base = SHINDO_SCORES[eq.shindo];
		const ageDays = eq.time === null ? 0 : ageInDays(eq.time);
		const factor = quakeTimeFactor(ageDays);
		const adjusted = Math.round(base * factor);

		// 7日経過した地震は0点。項目自体を内訳から落とす
		if (adjusted > 0) {
			const magPart = eq.magnitude !== null ? ` M${eq.magnitude.toFixed(1)}` : '';
			const estimatedPart = eq.shindoSource === 'estimated' ? '（推定）' : '';
			const datePart = eq.time !== null ? `（${formatDateTime(eq.time)}）` : '';
			const label = `${SHINDO_LABELS[eq.shindo]}${estimatedPart}${magPart}${datePart}`;

			const note =
				factor < 0.99
					? `基礎${base}点 × 減衰${factor.toFixed(2)}（${ageDays.toFixed(1)}日経過）`
					: undefined;

			score += adjusted;
			reasons.push(label);
			scoreItems.push({ label, points: adjusted, note });
			riskTypes.push('earthquake');
		}
	}

	// 群発性：揺れが続いていること自体が追加のリスクなので加算する
	const swarm = matchTier(eq.recentQuakeCount, QUAKE_SWARM_TIERS);
	if (swarm) {
		const label = swarm.reason(eq.recentQuakeCount);
		score += swarm.score;
		reasons.push(label);
		scoreItems.push({ label, points: swarm.score });
		if (!riskTypes.includes('earthquake')) riskTypes.push('earthquake');
	}

	return { score, riskTypes, reasons, scoreItems };
}

// ─── 津波・火山・大気 ────────────────────────────────────────────────────────

export function scoreTsunami(t: TsunamiData): ScoreContribution {
	const score = TSUNAMI_SCORES[t.level];
	if (score === 0) return emptyContribution();
	const areaPart = t.areaName ? `（${t.areaName}）` : '';
	const label = `${TSUNAMI_LABELS[t.level]}${areaPart}`;
	return {
		score,
		riskTypes: ['tsunami'],
		reasons: [label],
		scoreItems: [{ label, points: score }],
	};
}

/**
 * 火山スコア = 噴火警戒レベルの点数 × 距離減衰。
 *
 * 同一都道府県に複数の火山がある場合は「減衰後のスコアが最大」の1つを採用する。
 * 警戒レベルが最大の火山ではない —— 250km先のレベル3より10km先のレベル2のほうが危険。
 */
export function scoreVolcano(v: VolcanoData): ScoreContribution {
	const scored = v.alerts
		.map((alert) => ({
			alert,
			points: Math.round(volcanoLevelScore(alert.level) * alert.distanceFactor),
		}))
		.filter((s) => s.points > 0);
	if (scored.length === 0) return emptyContribution();

	const top = scored.reduce((best, s) => (s.points > best.points ? s : best));
	const distancePart =
		top.alert.distanceKm !== null ? `（${Math.round(top.alert.distanceKm)}km）` : '';
	const label = `${top.alert.name} ${top.alert.levelText}${distancePart}`;

	const notes: string[] = [];
	if (top.alert.distanceFactor < 0.99) {
		notes.push(
			`基礎${volcanoLevelScore(top.alert.level)}点 × 距離減衰${top.alert.distanceFactor.toFixed(2)}`
		);
	}
	const others = scored.filter((s) => s !== top);
	if (others.length > 0) {
		notes.push(
			`同カテゴリのため非加算: ${others.map((s) => `${s.alert.name} ${s.alert.levelText} ${s.points}点`).join(' / ')}`
		);
	}

	return {
		score: top.points,
		riskTypes: ['volcano'],
		reasons: [label],
		scoreItems: [
			{ label, points: top.points, note: notes.length > 0 ? notes.join(' / ') : undefined },
		],
	};
}

export function scoreAir(a: AirData): ScoreContribution {
	if (a.pm25 === null) return emptyContribution();
	const item = pickMaxCandidate(
		[tierCandidate(a.pm25, PM25_TIERS)].filter((c): c is Candidate => c !== null)
	);
	if (!item) return emptyContribution();
	return {
		score: item.points,
		riskTypes: ['air'],
		reasons: [item.label],
		scoreItems: [item],
	};
}

// ─── 統合 ────────────────────────────────────────────────────────────────────

interface RegionInputs {
	weather: WeatherData | null;
	earthquake: EarthquakeData | null;
	air: AirData | null;
	jma: JmaData | null;
	early: EarlyWarningData | null;
	tsunami: TsunamiData | null;
	volcano: VolcanoData | null;
}

/**
 * 早期注意情報（警報級の可能性）を気象庁の警報レベルに畳み込む。
 * 警報・注意報が既に出ているカテゴリは何もしない（早期注意情報より強いため）。
 */
export function mergeEarlyWarnings(
	jma: JmaData | null,
	early: EarlyWarningData | null
): JmaData | null {
	if (!early || Object.keys(early).length === 0) return jma;

	const base: JmaData = jma ?? {
		areas: [],
		alertLevel: 'none',
		categoryLevels: emptyCategoryLevels(),
		categoryNames: emptyCategoryNames(),
	};
	const categoryLevels = { ...base.categoryLevels };
	const categoryNames = { ...base.categoryNames };
	let alertLevel = base.alertLevel;

	for (const [category, item] of Object.entries(early) as [WeatherCategory, EarlyWarningItem][]) {
		if (categoryLevels[category] !== 'none') continue;
		categoryLevels[category] = 'early';
		categoryNames[category] =
			`早期注意情報（${item.phenomenon}・警報級の可能性${item.probability}）`;
		alertLevel = maxAlertLevel(alertLevel, 'early');
	}

	return { ...base, alertLevel, categoryLevels, categoryNames };
}

function buildRegionRisk(region: Region, inputs: RegionInputs, now: number): RegionRisk {
	const { weather, earthquake, air, tsunami, volcano } = inputs;
	const jma = mergeEarlyWarnings(inputs.jma, inputs.early);

	const contributions: ScoreContribution[] = [];
	if (weather) contributions.push(scoreWeather(weather, jma, inputs.jma !== null));
	if (earthquake) contributions.push(scoreEarthquake(earthquake));
	if (tsunami) contributions.push(scoreTsunami(tsunami));
	if (volcano) contributions.push(scoreVolcano(volcano));
	if (air) contributions.push(scoreAir(air));

	const totalScore = contributions.reduce((sum, c) => sum + c.score, 0);
	const reasons = contributions.flatMap((c) => c.reasons);
	const scoreItems = contributions.flatMap((c) => c.scoreItems);
	const riskTypes = [...new Set(contributions.flatMap((c) => c.riskTypes))];

	return {
		id: region.id,
		name: region.name,
		lat: region.lat,
		lng: region.lng,
		rawScore: totalScore,
		riskScore: Math.min(MAX_SCORE, totalScore),
		scoreItems,
		riskTypes,
		reasons: reasons.length > 0 ? reasons : ['現在危険情報なし'],
		updatedAt: now,
		details: {
			weather: weather ?? undefined,
			earthquake: earthquake ?? undefined,
			air: air ?? undefined,
			jma: jma ?? undefined,
			tsunami: tsunami ?? undefined,
			volcano: volcano ?? undefined,
		},
	};
}

export interface AllRegionRisksResult {
	regions: RegionRisk[];
	failedApis: string[];
}

/**
 * 全地域のリスクデータをバッチAPIで効率的に取得して計算する。
 * 個別に47回リクエストを送る代わりに、APIごとに1〜数リクエストにまとめる。
 * - Open-Meteo 天気・大気: 各1リクエスト（47地点一括）
 * - 気象庁 地震（実測震度）: 1リクエスト → 都道府県ごとに振り分け（失敗時はUSGSにフォールバック）
 * - 気象庁 津波: 一覧＋最新詳細の2リクエスト
 * - 気象庁 噴火警報: 1リクエスト
 * - 気象庁 警報・注意報: 同時実行数5で順次取得
 * - 気象庁 早期注意情報: 1リクエスト（全国分の一括JSON）
 */
export async function calculateAllRegionRisks(regions: Region[]): Promise<AllRegionRisksResult> {
	const [
		weatherSettled,
		earthquakeSettled,
		airSettled,
		jmaSettled,
		earlySettled,
		tsunamiSettled,
		volcanoSettled,
	] = await Promise.allSettled([
		fetchWeatherBatch(regions),
		fetchEarthquakesAll(regions),
		fetchAirQualityBatch(regions),
		fetchAllJmaWarnings(regions),
		fetchEarlyWarningAll(regions),
		fetchTsunamiAll(regions),
		fetchVolcanoAll(regions),
	]);

	const nulls = <T>(): (T | null)[] => new Array<T | null>(regions.length).fill(null);

	const weathers = valueOrNull(weatherSettled) ?? nulls<WeatherData>();
	const earthquakes = valueOrNull(earthquakeSettled) ?? nulls<EarthquakeData>();
	const airs = valueOrNull(airSettled) ?? nulls<AirData>();
	const jmas = valueOrNull(jmaSettled) ?? nulls<JmaData>();
	const earlies = valueOrNull(earlySettled) ?? nulls<EarlyWarningData>();
	const tsunamis = valueOrNull(tsunamiSettled) ?? nulls<TsunamiData>();
	const volcanoes = valueOrNull(volcanoSettled) ?? nulls<VolcanoData>();

	const failedApis: string[] = [];
	if (weatherSettled.status === 'rejected') failedApis.push('気象');
	if (earthquakeSettled.status === 'rejected') failedApis.push('地震');
	if (airSettled.status === 'rejected') failedApis.push('大気質');
	// JMA警報は地域ごとに取得するため、`runWithConcurrency` が個別の失敗を null に潰す。
	// バッチ自体は reject しないので、全地域が null なら全滅と判断する
	// （そうしないと「全国どこにも警報なし」と区別できず、エラー表示も出ない）。
	if (jmaSettled.status === 'rejected' || (regions.length > 0 && jmas.every((j) => j === null))) {
		failedApis.push('JMA警報');
	}
	if (earlySettled.status === 'rejected') failedApis.push('早期注意情報');
	if (tsunamiSettled.status === 'rejected') failedApis.push('津波');
	if (volcanoSettled.status === 'rejected') failedApis.push('火山');

	const now = Date.now();
	const regionList = regions.map((region, i) =>
		buildRegionRisk(
			region,
			{
				weather: weathers[i] ?? null,
				earthquake: earthquakes[i] ?? null,
				air: airs[i] ?? null,
				jma: jmas[i] ?? null,
				early: earlies[i] ?? null,
				tsunami: tsunamis[i] ?? null,
				volcano: volcanoes[i] ?? null,
			},
			now
		)
	);
	return { regions: regionList, failedApis };
}

/**
 * 単一地域のリスクを計算する（テスト・後方互換用）。
 * バッチ経路にそのまま委譲するため、スコアリングの挙動は全地域計算と完全に一致する。
 */
export async function calculateRegionRisk(region: Region): Promise<RegionRisk> {
	const { regions } = await calculateAllRegionRisks([region]);
	return regions[0];
}
