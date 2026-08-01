/**
 * リスクの種別（UIのバッジ・タグ表示に使う）。
 * スコアの「カテゴリ」（重複排除の単位）とは別概念で、カテゴリより粗い粒度。
 */
export type RiskType =
	| 'weather' // 雨・風・波浪高潮
	| 'snow' // 大雪・積雪
	| 'earthquake'
	| 'tsunami'
	| 'volcano'
	| 'heat'
	| 'cold'
	| 'air';

/**
 * 気象警報のレベル。
 * `danger` は気象庁の「レベル４○○危険警報」（警戒レベル4＝避難指示相当）に対応し、
 * 警報（レベル3相当）と特別警報（レベル5相当）の間に位置する。
 */
export type AlertLevel = 'none' | 'early' | 'advisory' | 'warning' | 'danger' | 'special';

/**
 * 気象警報のカテゴリ。
 * 同一カテゴリ内では「公式警報スコア」と「実測値スコア」の最大値のみを採用し、
 * 同じ現象の二重計上を防ぐ（例: 大雨警報 と 降水量 は同じ雨のリスク）。
 */
export type WeatherCategory = 'rain' | 'snow' | 'wind' | 'coast' | 'temperature' | 'other';

/** すべてのカテゴリを「未発令」で初期化する。 */
export function emptyCategoryLevels(): Record<WeatherCategory, AlertLevel> {
	return {
		rain: 'none',
		snow: 'none',
		wind: 'none',
		coast: 'none',
		temperature: 'none',
		other: 'none',
	};
}

/** すべてのカテゴリを「名称なし」で初期化する。 */
export function emptyCategoryNames(): Record<WeatherCategory, string> {
	return { rain: '', snow: '', wind: '', coast: '', temperature: '', other: '' };
}

export interface JmaWarningArea {
	name: string;
	warnings: string[];
}

export interface JmaData {
	areas: JmaWarningArea[];
	/** 全カテゴリ中の最高レベル（UI表示・後方互換用）。 */
	alertLevel: AlertLevel;
	/** カテゴリごとの発令レベル。スコア計算はこちらを使う。 */
	categoryLevels: Record<WeatherCategory, AlertLevel>;
	/**
	 * カテゴリごとの「最も強い警報の正式名称」（未発令は空文字）。
	 * 「気象注意報」のような総称ではなく「濃霧注意報」と表示するために使う。
	 */
	categoryNames: Record<WeatherCategory, string>;
}

/** 気象庁震度階級（5弱=`5-`、5強=`5+`、6弱=`6-`、6強=`6+`）。 */
export type ShindoLevel = '1' | '2' | '3' | '4' | '5-' | '5+' | '6-' | '6+' | '7';

/** 津波警報のレベル。 */
export type TsunamiLevel = 'none' | 'forecast' | 'advisory' | 'warning' | 'major';

/** スコア内訳の1行分 */
export interface ScoreItem {
	label: string;
	points: number;
	/** 「基礎90点 × 減衰0.80」「大雨警報40点を採用（降水量25点は同カテゴリのため非加算）」など */
	note?: string;
}

export interface RegionRisk {
	id: string;
	name: string;
	lat: number;
	lng: number;
	riskScore: number;
	rawScore: number; // キャップ前の合計点
	scoreItems: ScoreItem[]; // スコア内訳
	riskTypes: RiskType[];
	reasons: string[];
	updatedAt: number;
	details: {
		weather?: WeatherData;
		earthquake?: EarthquakeData;
		air?: AirData;
		jma?: JmaData;
		tsunami?: TsunamiData;
		volcano?: VolcanoData;
	};
}

export interface WeatherData {
	temperature: number;
	/** 体感温度℃（湿度・風を考慮）。熱中症・低温の評価はこちらを使う。 */
	apparentTemperature: number;
	weatherCode: number;
	precipitation: number;
	/** 平均風速 km/h */
	windSpeed: number;
	/** 最大瞬間風速 km/h */
	windGusts: number;
	/** 降雪量 cm/h */
	snowfall: number;
	/** 積雪深 cm（Open-Meteoはm単位で返すため変換済み） */
	snowDepthCm: number;
	alertLevel: AlertLevel;
	/** Open-Meteo current.time をミリ秒UNIXタイムスタンプに変換した観測時刻 */
	observedAt?: number | null;
}

export interface EarthquakeData {
	magnitude: number | null;
	place: string | null;
	time: number | null;
	depth: number | null;
	distanceKm: number | null;
	/** その地域で観測（または推定）された震度。スコアはこれを基礎点にする。 */
	shindo: ShindoLevel | null;
	/** 震度の由来。observed=気象庁の実測値、estimated=USGSデータからの推定値。 */
	shindoSource: 'observed' | 'estimated' | null;
	/**
	 * 直近の一定期間にその地域で震度1以上を観測した回数（群発性の指標）。
	 * 期間は `SWARM_WINDOW_DAYS`（scoringRules.ts）で定義する。
	 */
	recentQuakeCount: number;
}

export interface TsunamiData {
	level: TsunamiLevel;
	/** 該当した津波予報区名（例: 「熊本県天草灘沿岸」）。 */
	areaName: string | null;
	issuedAt: number | null;
}

export interface VolcanoAlert {
	/** 火山名（例: 「桜島」） */
	name: string;
	/** 噴火警戒レベル 1〜5。レベル運用外の火山は警報種別から相当レベルに換算する。 */
	level: number;
	/** 表示用の警戒レベル文言（例: 「レベル3（入山規制）」「火口周辺警報」） */
	levelText: string;
	/** 噴火警戒レベルが運用されている火山か（false なら換算値）。 */
	isLevelOperated: boolean;
	/** 地域の代表地点から火口までの距離km。座標が不明なら null。 */
	distanceKm: number | null;
	/** 距離による減衰係数（0〜1）。近距離は1.0で、遠いほど0に近づく。 */
	distanceFactor: number;
}

export interface VolcanoData {
	/** 同一都道府県内で噴火警報・予報が出ている火山（レベル降順）。 */
	alerts: VolcanoAlert[];
}

export interface AirData {
	pm25: number | null;
	aqi: number | null;
}

export interface Region {
	id: string;
	name: string;
	/**
	 * 表示名まるごとの読み。ひらがなのみ・区切り記号なし
	 * （`釧路・根室（北海道）` → `くしろねむろほっかいどう`）。
	 *
	 * 地域フィルタの照合に使う。IME で `kushiro` と打つと、変換を確定する前に入力欄の値は
	 * 既に `くしろ` になっているため、かなを持っていないと「打ちながら絞り込む」が成立しない
	 * （漢字だけを照合すると確定するまで1件もヒットしない）。
	 * 区切り記号を含めないのは変換途中の文字列に合わせるため。接尾辞の都道府県も読みに含めるので、
	 * `ほっかいどう` で北海道8地域、`おきなわ` で沖縄4地域にヒットする。
	 */
	kana: string;
	lat: number;
	lng: number;
	city: string;
	/** 気象庁の発表官署コード（警報JSONの取得単位）。離島は本土と別の官署のことがある。 */
	jmaCode: string;
	/**
	 * この地域を構成する気象庁の一次細分区域コード。
	 * 警報は同じ官署でもこの区域だけに絞って集計する
	 * （東京都の警報JSONには伊豆諸島・小笠原諸島の分も含まれるため）。
	 */
	class10Codes: string[];
	/** この地域に対応する気象庁の津波予報区コード。内陸の地域は空配列。 */
	tsunamiAreaCodes: string[];
}

/** 都道府県コード（jmaCode の先頭2桁）。JMAの地震・火山データの地域マッチに使う。 */
export function prefCodeOf(region: Pick<Region, 'jmaCode'>): string {
	return region.jmaCode.slice(0, 2);
}
