import type { AlertLevel, JmaData, JmaWarningArea, WeatherCategory } from '../types';
import { emptyCategoryLevels, emptyCategoryNames } from '../types';
import { fetchJson } from './http';
import { runWithConcurrency } from '../utils/concurrent';
import { maxAlertLevel } from '../services/scoringRules';

/**
 * JMA警報コードの定義。
 * `categories` はスコア計算時の重複排除の単位で、同一カテゴリ内では
 * 「警報スコア」と「実測値スコア」の最大値のみが採用される。
 * 暴風雪・風雪のような複合警報は風と雪の両カテゴリに属する。
 *
 * ## 出典
 * 気象庁防災情報XMLフォーマット「警報等情報要素コード管理表」（`code.WeatherWarning`）。
 * <https://xml.kishou.go.jp/tec_material.html> の「コード管理表一式」に収録されている公式表。
 *
 * このコード表は実行時に取得するデータではなく、ソースに焼き込む静的データなので、
 * CORS の制約（`bosai` 系以外はブラウザから叩けない）は適用されない。
 * 実行時に叩く `warning/{prefCode}.json` は値を2桁ゼロ埋めで返すため、キーも2桁で持つ。
 *
 * ## 土砂災害のカテゴリについて
 * 土砂災害警報（09/29/39/49）は大雨を原因とする現象なので `rain` に含める。
 * 大雨警報と土砂災害警報が同時に出ても、同一カテゴリ内の最大値として1回だけ計上される。
 */
interface WarningRule {
	readonly name: string;
	/** 気象庁の正式な区分（注意報・警報・特別警報）。表示と分類に使う。 */
	readonly level: Exclude<AlertLevel, 'early'>;
	/**
	 * スコアリング上の重み。省略時は `level` と同じ。
	 *
	 * 同じ「注意報」でも生命への危険度は一様ではない。大雨注意報は警戒レベル2として
	 * 避難行動の確認を促すが、濃霧注意報は視程障害の周知であって屋内にいる人には無害。
	 * スコアは「いまその地域にいる人の生命への危険度」なので、
	 * 気象庁の区分をそのまま点数にせず、危険度の実態で重みを下げる。
	 */
	readonly scoreLevel?: AlertLevel;
	readonly categories: readonly WeatherCategory[];
}

const WARNING_RULES: Record<string, WarningRule> = {
	'00': { name: '解除', level: 'none', categories: [] },
	// 警報（警戒レベル3相当）
	'02': { name: '暴風雪警報', level: 'warning', categories: ['wind', 'snow'] },
	'03': { name: '大雨警報', level: 'warning', categories: ['rain'] },
	'04': { name: '洪水警報', level: 'warning', categories: ['rain'] },
	'05': { name: '暴風警報', level: 'warning', categories: ['wind'] },
	'06': { name: '大雪警報', level: 'warning', categories: ['snow'] },
	'07': { name: '波浪警報', level: 'warning', categories: ['coast'] },
	'08': { name: '高潮警報', level: 'warning', categories: ['coast'] },
	'09': { name: '土砂災害警報', level: 'warning', categories: ['rain'] },
	// 注意報（警戒レベル2相当）
	'10': { name: '大雨注意報', level: 'advisory', categories: ['rain'] },
	'12': { name: '大雪注意報', level: 'advisory', categories: ['snow'] },
	'13': { name: '風雪注意報', level: 'advisory', categories: ['wind', 'snow'] },
	// 落雷の死者は年間十数人。屋内退避で回避できるため重みを下げる
	'14': { name: '雷注意報', level: 'advisory', scoreLevel: 'early', categories: ['rain'] },
	'15': { name: '強風注意報', level: 'advisory', categories: ['wind'] },
	'16': { name: '波浪注意報', level: 'advisory', categories: ['coast'] },
	'17': { name: '融雪注意報', level: 'advisory', categories: ['snow'] },
	'18': { name: '洪水注意報', level: 'advisory', categories: ['rain'] },
	'19': { name: '高潮注意報', level: 'advisory', categories: ['coast'] },
	// 視程障害の周知。交通のリスクであって屋内にいる人には無害
	'20': { name: '濃霧注意報', level: 'advisory', scoreLevel: 'early', categories: ['other'] },
	// 火災の起きやすさであり、それ自体が人を危険にさらすわけではない
	'21': { name: '乾燥注意報', level: 'advisory', scoreLevel: 'early', categories: ['other'] },
	'22': { name: 'なだれ注意報', level: 'advisory', categories: ['snow'] },
	'23': { name: '低温注意報', level: 'advisory', categories: ['temperature'] },
	// 農作物への被害が主で人体への危険はない
	'24': { name: '霜注意報', level: 'advisory', scoreLevel: 'early', categories: ['temperature'] },
	// 船舶・航空機への着氷。陸上の住民には影響しない
	'25': { name: '着氷注意報', level: 'advisory', scoreLevel: 'early', categories: ['other'] },
	'26': { name: '着雪注意報', level: 'advisory', categories: ['snow'] },
	'27': { name: 'その他の注意報', level: 'advisory', categories: ['other'] },
	'29': { name: '土砂災害注意報', level: 'advisory', categories: ['rain'] },
	// 特別警報（警戒レベル5相当）
	'32': { name: '暴風雪特別警報', level: 'special', categories: ['wind', 'snow'] },
	'33': { name: '大雨特別警報', level: 'special', categories: ['rain'] },
	'35': { name: '暴風特別警報', level: 'special', categories: ['wind'] },
	'36': { name: '大雪特別警報', level: 'special', categories: ['snow'] },
	'37': { name: '波浪特別警報', level: 'special', categories: ['coast'] },
	'38': { name: '高潮特別警報', level: 'special', categories: ['coast'] },
	'39': { name: '土砂災害特別警報', level: 'special', categories: ['rain'] },
	// 危険警報（警戒レベル4相当＝避難指示レベル）
	'43': { name: '大雨危険警報', level: 'danger', categories: ['rain'] },
	'48': { name: '高潮危険警報', level: 'danger', categories: ['coast'] },
	'49': { name: '土砂災害危険警報', level: 'danger', categories: ['rain'] },
};

/**
 * 未知のコードは注意報相当・カテゴリ `other` として扱う。
 *
 * 「何かの注意報が出ている」というシグナルは失わず、かつ推測で名称を捏造しない。
 * レベルを注意報（10点）に固定するのは、万一それが警報級だった場合に
 * 過大評価するより過小評価するほうが安全だという判断。
 * 公式表には `42` `45` `46` `47` `56`〜`58` が「未定・予約」として存在するため、
 * 将来これらが運用開始されたときはこの経路に落ちる。
 */
function ruleFor(code: string): WarningRule {
	return (
		WARNING_RULES[code] ?? {
			name: `気象注意報（コード${code}）`,
			level: 'advisory',
			categories: ['other'],
		}
	);
}

export function warningName(code: string): string {
	return ruleFor(code).name;
}

/** 公式コード表に載っているコードか（未知コードの検知に使う）。 */
export function isKnownWarningCode(code: string): boolean {
	return code in WARNING_RULES;
}

interface JmaWarningEntry {
	code?: string;
	status: string;
}

interface JmaArea {
	code: string;
	warnings: JmaWarningEntry[];
}

interface JmaAreaType {
	areas: JmaArea[];
}

interface JmaWarningResponse {
	areaTypes: JmaAreaType[];
}

interface AreaInfo {
	name: string;
}

interface Class15Info {
	name: string;
	parent?: string;
	children?: string[];
}

interface AreaJson {
	class10s: Record<string, AreaInfo>;
	class15s: Record<string, Class15Info>;
}

const AREA_JSON_URL = 'https://www.jma.go.jp/bosai/common/const/area.json';

// area.json（Promiseをキャッシュして並列fetch競合・永続汚染を防ぐ）
let areaJsonPromise: Promise<AreaJson> | null = null;

function getAreaJson(): Promise<AreaJson> {
	if (!areaJsonPromise) {
		areaJsonPromise = fetchJson<AreaJson>(AREA_JSON_URL, 'JMAArea').catch(() => {
			areaJsonPromise = null;
			return { class10s: {}, class15s: {} } as AreaJson;
		});
	}
	return areaJsonPromise;
}

function getAreaNames(): Promise<Record<string, string>> {
	return getAreaJson().then((data) =>
		Object.fromEntries(Object.entries(data.class10s ?? {}).map(([code, info]) => [code, info.name]))
	);
}

/**
 * 一次細分区域コード → その区域に属する市区町村コード（7桁）。
 *
 * 気象庁の地震情報は都道府県単位と市区町村単位の震度を持つが、一次細分区域単位は持たない。
 * 地域を一次細分区域で定義しているので、震度を引くにはここで市区町村へ展開する必要がある。
 * `area.json` の class15（二次細分区域）が class10 を親に持ち、その子が市区町村コードになっている。
 */
export function getCityCodesByClass10(): Promise<Record<string, string[]>> {
	return getAreaJson().then((data) => {
		const result: Record<string, string[]> = {};
		for (const info of Object.values(data.class15s ?? {})) {
			if (!info.parent || !info.children) continue;
			(result[info.parent] ??= []).push(...info.children);
		}
		return result;
	});
}

/**
 * 発令中のコード一覧から、カテゴリごとの最高レベルと全体の最高レベルを求める。
 * あわせて各カテゴリで最も強い警報の正式名称を返す（表示用）。
 */
export function levelsFromCodes(activeCodes: string[]): {
	alertLevel: AlertLevel;
	categoryLevels: Record<WeatherCategory, AlertLevel>;
	categoryNames: Record<WeatherCategory, string>;
} {
	const categoryLevels = emptyCategoryLevels();
	const categoryNames = emptyCategoryNames();
	let alertLevel: AlertLevel = 'none';
	for (const code of activeCodes) {
		const rule = ruleFor(code);
		if (rule.level === 'none') continue;
		// カテゴリのレベルはスコアリング上の重みで決める（生命危険度が低い注意報は下げてある）
		const scoreLevel = rule.scoreLevel ?? rule.level;
		alertLevel = maxAlertLevel(alertLevel, scoreLevel);
		for (const category of rule.categories) {
			const merged = maxAlertLevel(categoryLevels[category], scoreLevel);
			// レベルが上がった場合のみ名称を更新する（同レベルなら先に見つけたものを維持）
			if (merged !== categoryLevels[category] || categoryNames[category] === '') {
				categoryNames[category] = rule.name;
			}
			categoryLevels[category] = merged;
		}
	}
	return { alertLevel, categoryLevels, categoryNames };
}

/**
 * 指定した官署の警報を取得し、`class10Codes` に含まれる一次細分区域だけを集計する。
 *
 * 官署単位で丸ごと集約してはいけない。たとえば東京都の警報JSONには伊豆諸島・小笠原諸島の
 * 分も含まれており、実測では東京23区が無警報なのに伊豆諸島の4つの注意報が
 * 東京のスコアに乗っていた。
 *
 * `class10Codes` が空の場合は官署内の全区域を対象にする（後方互換）。
 */
export async function fetchJmaWarnings(
	officeCode: string,
	class10Codes: readonly string[] = []
): Promise<JmaData> {
	const [warningData, areaNames] = await Promise.all([
		fetchJson<JmaWarningResponse>(
			`https://www.jma.go.jp/bosai/warning/data/warning/${officeCode}.json`,
			'JMA'
		),
		getAreaNames(),
	]);

	// 一次細分区域（areaTypes[0]）を使用
	const primaryAreas: JmaArea[] = warningData.areaTypes?.[0]?.areas ?? [];
	const wanted = new Set(class10Codes);

	const allActiveCodes: string[] = [];
	const activeAreas: JmaWarningArea[] = [];
	for (const area of primaryAreas) {
		if (wanted.size > 0 && !wanted.has(area.code)) continue;
		const codes = (area.warnings ?? [])
			.filter((w) => w.code && (w.status === '発表' || w.status === '継続'))
			.map((w) => w.code as string);
		if (codes.length > 0) {
			allActiveCodes.push(...codes);
			activeAreas.push({
				name: areaNames[area.code] ?? area.code,
				warnings: codes.map(warningName),
			});
		}
	}

	return { areas: activeAreas, ...levelsFromCodes(allActiveCodes) };
}

/**
 * 全地域の警報データを同時実行数5で取得する。
 * 同じ官署を共有する地域（本土と離島）でも、集計対象の区域が異なるので個別に絞り込む。
 */
export async function fetchAllJmaWarnings(
	regions: Array<{ jmaCode: string; class10Codes: string[] }>
): Promise<(JmaData | null)[]> {
	return runWithConcurrency(regions, (r) => fetchJmaWarnings(r.jmaCode, r.class10Codes), 5);
}
