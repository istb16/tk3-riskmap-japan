export type RiskType = 'weather' | 'earthquake' | 'heat' | 'air';

export interface JmaWarningArea {
	name: string;
	warnings: string[];
}

export interface JmaData {
	areas: JmaWarningArea[];
	alertLevel: 'none' | 'advisory' | 'warning' | 'special';
}

/** スコア内訳の1行分 */
export interface ScoreItem {
	label: string;
	points: number;
	note?: string; // "基礎40点 × 減衰0.43" など減衰がある場合のみ
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
	};
}

export interface WeatherData {
	temperature: number;
	weatherCode: number;
	precipitation: number;
	windSpeed: number;
	alertLevel: 'none' | 'advisory' | 'warning' | 'special';
	/** Open-Meteo current.time をミリ秒UNIXタイムスタンプに変換した観測時刻 */
	observedAt?: number | null;
}

export interface EarthquakeData {
	magnitude: number | null;
	place: string | null;
	time: number | null;
	depth: number | null;
	distanceKm: number | null;
}

export interface AirData {
	pm25: number | null;
	aqi: number | null;
}

export interface Region {
	id: string;
	name: string;
	lat: number;
	lng: number;
	city: string;
	jmaCode: string;
}
