import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
	scoreWeather,
	scoreEarthquake,
	scoreTsunami,
	scoreVolcano,
	scoreAir,
	mergeEarlyWarnings,
	calculateRegionRisk,
} from './riskCalculator';
import type {
	WeatherData,
	EarthquakeData,
	AirData,
	JmaData,
	TsunamiData,
	VolcanoData,
	VolcanoAlert,
	Region,
	AlertLevel,
	WeatherCategory,
} from '../types';

// vi.mock はモジュールトップレベルに置く（vitestが静的にhoist）
vi.mock('../api/weather', () => ({
	fetchWeatherBatch: vi.fn(),
}));
vi.mock('../api/earthquake', () => ({
	fetchEarthquakesAll: vi.fn(),
}));
vi.mock('../api/air', () => ({
	fetchAirQualityBatch: vi.fn(),
}));
vi.mock('../api/jma', () => ({
	fetchAllJmaWarnings: vi.fn(),
}));
vi.mock('../api/tsunami', () => ({
	fetchTsunamiAll: vi.fn(),
}));
vi.mock('../api/volcano', () => ({
	fetchVolcanoAll: vi.fn(),
}));
vi.mock('../api/earlyWarning', () => ({
	fetchEarlyWarningAll: vi.fn(),
}));

// モック済み関数を import（vi.mock のhoist後に解決される）
import { fetchWeatherBatch } from '../api/weather';
import { fetchEarthquakesAll } from '../api/earthquake';
import { fetchAirQualityBatch } from '../api/air';
import { fetchAllJmaWarnings } from '../api/jma';
import { fetchTsunamiAll } from '../api/tsunami';
import { fetchVolcanoAll } from '../api/volcano';
import { fetchEarlyWarningAll } from '../api/earlyWarning';

// ---- ヘルパー ---------------------------------------------------------------

function makeWeather(overrides: Partial<WeatherData> = {}): WeatherData {
	return {
		temperature: 20,
		apparentTemperature: 20,
		weatherCode: 0,
		precipitation: 0,
		windSpeed: 0,
		windGusts: 0,
		snowfall: 0,
		snowDepthCm: 0,
		alertLevel: 'none',
		...overrides,
	};
}

function makeEarthquake(overrides: Partial<EarthquakeData> = {}): EarthquakeData {
	return {
		magnitude: null,
		place: null,
		time: null,
		depth: null,
		distanceKm: null,
		shindo: null,
		shindoSource: null,
		recentQuakeCount: 0,
		...overrides,
	};
}

function makeAir(overrides: Partial<AirData> = {}): AirData {
	return { pm25: null, aqi: null, ...overrides };
}

function makeTsunami(overrides: Partial<TsunamiData> = {}): TsunamiData {
	return { level: 'none', areaName: null, issuedAt: null, ...overrides };
}

function makeVolcano(overrides: Partial<VolcanoData> = {}): VolcanoData {
	return { alerts: [], ...overrides };
}

/**
 * カテゴリ別レベルを持つ JmaData を組み立てる。
 * `names` を渡さない場合は正式名称なし（＝ラベルはカテゴリ総称になる）。
 */
function makeJma(
	levels: Partial<Record<WeatherCategory, AlertLevel>> = {},
	names: Partial<Record<WeatherCategory, string>> = {}
): JmaData {
	const empty = {
		rain: 'none',
		snow: 'none',
		wind: 'none',
		coast: 'none',
		temperature: 'none',
		other: 'none',
	} as const;
	const categoryLevels: Record<WeatherCategory, AlertLevel> = { ...empty, ...levels };
	const categoryNames: Record<WeatherCategory, string> = {
		rain: '',
		snow: '',
		wind: '',
		coast: '',
		temperature: '',
		other: '',
		...names,
	};
	const strongest = Object.values(categoryLevels).find((l) => l !== 'none') ?? 'none';
	return { areas: [], alertLevel: strongest, categoryLevels, categoryNames };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const daysAgo = (d: number) => Date.now() - d * DAY_MS;

const TOKYO: Region = {
	id: 'tokyo',
	name: '東京',
	lat: 35.6895,
	lng: 139.6917,
	city: 'Tokyo',
	jmaCode: '130000',
	class10Codes: ['130010'],
	tsunamiAreaCodes: ['312'],
};

// ---- scoreWeather: 警報レベル -------------------------------------------------

describe('scoreWeather 警報レベル', () => {
	it('警報なし → score 0', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'none' }));
		expect(result.score).toBe(0);
		expect(result.riskTypes).not.toContain('weather');
	});

	it('早期注意情報 → +5点', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'early' }));
		expect(result.score).toBe(5);
		expect(result.reasons[0]).toContain('早期注意情報');
	});

	it('注意報 → +10点', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'advisory' }));
		expect(result.score).toBe(10);
		expect(result.riskTypes).toContain('weather');
	});

	it('警報 → +30点', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'warning' }));
		expect(result.score).toBe(30);
		expect(result.reasons[0]).toContain('警報');
	});

	it('危険警報（警戒レベル4相当）→ +50点', () => {
		const result = scoreWeather(makeWeather(), makeJma({ rain: 'danger' }));
		expect(result.score).toBe(50);
		expect(result.reasons[0]).toContain('危険警報');
	});

	it('特別警報 → +70点', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'special' }));
		expect(result.score).toBe(70);
		expect(result.reasons[0]).toContain('特別警報');
	});

	it('JMAのカテゴリ別レベルが Open-Meteo 推定より強ければJMAを採用する', () => {
		const result = scoreWeather(
			makeWeather({ alertLevel: 'advisory' }),
			makeJma({ rain: 'special' })
		);
		expect(result.score).toBe(70);
	});

	it('JMAが未発令(none)なら Open-Meteo 推定は使わない', () => {
		// 気象庁が「発令なし」と言っているのを推定で上書きしてはいけない
		expect(
			scoreWeather(makeWeather({ alertLevel: 'special' }), makeJma({ rain: 'none' })).score
		).toBe(0);
	});

	it('JMA未取得(null)なら Open-Meteo 推定で採点する', () => {
		expect(scoreWeather(makeWeather({ alertLevel: 'warning' }), null).score).toBe(30);
	});
});

// ---- scoreWeather: ラベルの出典表示 -------------------------------------------

describe('mergeEarlyWarnings', () => {
	it('未発令のカテゴリに早期注意情報を反映する', () => {
		const merged = mergeEarlyWarnings(makeJma(), {
			rain: { phenomenon: '大雨', probability: '中' },
		});
		expect(merged?.categoryLevels.rain).toBe('early');
		expect(merged?.categoryNames.rain).toContain('早期注意情報');
		expect(merged?.categoryNames.rain).toContain('大雨');
		expect(merged?.alertLevel).toBe('early');
	});

	it('既に警報・注意報が出ているカテゴリは上書きしない', () => {
		const merged = mergeEarlyWarnings(makeJma({ rain: 'warning' }, { rain: '大雨警報' }), {
			rain: { phenomenon: '大雨', probability: '高' },
		});
		expect(merged?.categoryLevels.rain).toBe('warning');
		expect(merged?.categoryNames.rain).toBe('大雨警報');
	});

	it('別カテゴリには影響しない', () => {
		const merged = mergeEarlyWarnings(makeJma({ rain: 'warning' }), {
			coast: { phenomenon: '波', probability: '中' },
		});
		expect(merged?.categoryLevels.rain).toBe('warning');
		expect(merged?.categoryLevels.coast).toBe('early');
	});

	it('JMA警報が取得できていなくても早期注意情報だけで JmaData を組み立てる', () => {
		const merged = mergeEarlyWarnings(null, { snow: { phenomenon: '雪', probability: '中' } });
		expect(merged?.categoryLevels.snow).toBe('early');
		expect(merged?.areas).toEqual([]);
	});

	it('早期注意情報が無ければ元の JmaData をそのまま返す', () => {
		const jma = makeJma({ rain: 'advisory' });
		expect(mergeEarlyWarnings(jma, null)).toBe(jma);
		expect(mergeEarlyWarnings(jma, {})).toBe(jma);
		expect(mergeEarlyWarnings(null, null)).toBeNull();
	});
});

describe('scoreWeather ラベルは発表と推定を区別する', () => {
	it('気象庁が発令していれば正式名称をそのまま使う', () => {
		const result = scoreWeather(
			makeWeather(),
			makeJma({ other: 'advisory' }, { other: '濃霧注意報' })
		);
		expect(result.reasons[0]).toBe('濃霧注意報');
		expect(result.reasons[0]).not.toContain('推定');
	});

	it('早期注意情報だけが取れた場合も Open-Meteo 推定は使われる', () => {
		// mergeEarlyWarnings が JmaData を合成しても、警報が取れていないなら推定を使う。
		// 「無関係な早期注意情報の有無でフォールバックが効かなくなる」のを防ぐ
		const merged = mergeEarlyWarnings(null, { snow: { phenomenon: '雪', probability: '中' } });
		const result = scoreWeather(makeWeather({ alertLevel: 'special' }), merged, false);
		expect(result.score).toBe(75); // 大雨特別警報（推定）70 + 早期注意情報（雪）5
		expect(result.reasons[0]).toContain('推定');
	});

	it('気象庁のデータが取れない場合のみ Open-Meteo 推定を使い「推定」を付ける', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'warning' }), null);
		expect(result.score).toBe(30);
		expect(result.reasons[0]).toContain('推定');
	});

	it('気象庁のデータがあれば推定レベルは使わない', () => {
		// JMAが未発令なら、Open-Meteoが「警報」相当と推定していても計上しない。
		// 気象庁が出していない警報を表示すると発表と誤認させるため
		const result = scoreWeather(makeWeather({ alertLevel: 'warning' }), makeJma());
		expect(result.score).toBe(0);
	});

	it('気象庁が発令していればそちらだけを使う', () => {
		const result = scoreWeather(
			makeWeather({ alertLevel: 'special' }),
			makeJma({ rain: 'advisory' }, { rain: '雷注意報' })
		);
		expect(result.score).toBe(10);
		expect(result.reasons[0]).toBe('雷注意報');
	});

	it('気象庁が推定以上なら正式名称を使い観測時刻を付けない', () => {
		const result = scoreWeather(
			makeWeather({ alertLevel: 'advisory', observedAt: Date.now() }),
			makeJma({ rain: 'special' }, { rain: '大雨特別警報' })
		);
		expect(result.reasons[0]).toBe('大雨特別警報');
	});

	it('正式名称が取れないカテゴリは総称＋推定になる', () => {
		const result = scoreWeather(makeWeather(), makeJma({ coast: 'warning' }));
		expect(result.reasons[0]).toBe('波浪・高潮警報（推定）');
	});
});

// ---- scoreWeather: カテゴリ内の最大値採用 --------------------------------------

describe('scoreWeather カテゴリ内は最大値のみ採用', () => {
	it('特別警報70 と 猛烈な雨35 → 70点（二重計上しない）', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'special', precipitation: 50 }));
		expect(result.score).toBe(70);
	});

	it('非採用の候補は note に残る', () => {
		const result = scoreWeather(makeWeather({ alertLevel: 'special', precipitation: 50 }));
		expect(result.scoreItems[0].note).toContain('非加算');
		expect(result.scoreItems[0].note).toContain('猛烈な雨');
	});

	it('警報の方が高ければ警報を採用する（大雨警報30 > 猛烈な雨20）', () => {
		const result = scoreWeather(makeWeather(), makeJma({ rain: 'warning' }, { rain: '大雨警報' }));
		expect(result.score).toBe(30);
		expect(result.scoreItems[0].label).toBe('大雨警報');
	});

	it('実測値の方が高ければ実測値を採用する（大雨注意報10 < 猛烈な雨20）', () => {
		const result = scoreWeather(
			makeWeather({ precipitation: 50 }),
			makeJma({ rain: 'advisory' }, { rain: '大雨注意報' })
		);
		expect(result.score).toBe(20);
		expect(result.scoreItems[0].label).toContain('猛烈な雨');
	});

	it('風カテゴリは 平均風速 と 突風 の最大値を採る', () => {
		// 平均40km/h=4点 / 突風120km/h=22点 → 22点
		const result = scoreWeather(makeWeather({ windSpeed: 40, windGusts: 120 }));
		expect(result.score).toBe(22);
	});

	it('雪カテゴリは 降雪量 と 積雪深 の最大値を採る', () => {
		// 降雪1cm/h=2点 / 積雪100cm=12点 → 12点
		const result = scoreWeather(makeWeather({ snowfall: 1, snowDepthCm: 100 }));
		expect(result.score).toBe(12);
		expect(result.riskTypes).toContain('snow');
	});

	it('雨と風は別カテゴリなので加算される', () => {
		// 雨 = max(大雨特別警報70, 猛烈な雨20) = 70 / 風 = 突風120km/h = 22 → 92点
		const result = scoreWeather(
			makeWeather({ precipitation: 50, windGusts: 120 }),
			makeJma({ rain: 'special' }, { rain: '大雨特別警報' })
		);
		expect(result.score).toBe(92);
	});

	it('暴風特別警報と大雨特別警報は別カテゴリなので加算される', () => {
		const result = scoreWeather(makeWeather(), makeJma({ rain: 'special', wind: 'special' }));
		expect(result.score).toBe(140);
	});

	it('波浪・高潮警報は独立したカテゴリとして加算される', () => {
		const result = scoreWeather(makeWeather(), makeJma({ coast: 'warning' }));
		expect(result.score).toBe(30);
		expect(result.reasons[0]).toContain('波浪・高潮');
	});

	it('低温注意報は気温カテゴリで体感温度と競合する', () => {
		// 体感1℃ = 3点 < 低温注意報10点 → 10点、cold リスク
		const result = scoreWeather(
			makeWeather({ apparentTemperature: 1 }),
			makeJma({ temperature: 'advisory' })
		);
		expect(result.score).toBe(10);
		expect(result.riskTypes).toContain('cold');
	});

	it('気温カテゴリで非採用になった候補も note に残る', () => {
		// 体感36℃(8点) と 低温注意報(10点) が競合し、注意報が勝つ
		const result = scoreWeather(
			makeWeather({ apparentTemperature: 36 }),
			makeJma({ temperature: 'advisory' }, { temperature: '低温注意報' })
		);
		expect(result.score).toBe(10);
		expect(result.scoreItems[0].label).toBe('低温注意報');
		expect(result.scoreItems[0].note).toContain('厳重警戒の暑さ');
	});

	it('体感温度の方が高ければ低温注意報より実測を採用する', () => {
		// 体感-12℃ = 12点 > 低温注意報10点
		const result = scoreWeather(
			makeWeather({ apparentTemperature: -12 }),
			makeJma({ temperature: 'advisory' })
		);
		expect(result.score).toBe(12);
		expect(result.scoreItems[0].note).toContain('非加算');
	});

	it('複合警報（暴風雪）は1回だけ計上される', () => {
		// 暴風雪警報は wind と snow の両カテゴリに属するが、警報は1つなので点数も1回
		const result = scoreWeather(
			makeWeather(),
			makeJma({ wind: 'warning', snow: 'warning' }, { wind: '暴風雪警報', snow: '暴風雪警報' })
		);
		expect(result.score).toBe(30);
		expect(result.reasons).toEqual(['暴風雪警報']);
	});

	it('複合警報は両カテゴリの実測値も覆う（雪の二重計上を防ぐ）', () => {
		// 暴風雪警報は雪と風の両方を説明する警報なので、その上に実測降雪を足すと
		// 同じ雪を二重に数えることになる。警報1つ分の30点に収める
		const result = scoreWeather(
			makeWeather({ snowfall: 5 }),
			makeJma({ wind: 'warning', snow: 'warning' }, { wind: '暴風雪警報', snow: '暴風雪警報' })
		);
		expect(result.score).toBe(30);
		// 採用されなかった実測値は note に残る
		expect(result.scoreItems[0].note).toContain('大雪');
	});

	it('内訳のラベルが重複しない（UIのキー衝突を防ぐ）', () => {
		const result = scoreWeather(
			makeWeather(),
			makeJma(
				{ wind: 'special', snow: 'special' },
				{ wind: '暴風雪特別警報', snow: '暴風雪特別警報' }
			)
		);
		const labels = result.scoreItems.map((i) => i.label);
		expect(new Set(labels).size).toBe(labels.length);
		expect(result.score).toBe(70);
	});

	it('未分類の警報コードも other カテゴリとして計上される', () => {
		expect(scoreWeather(makeWeather(), makeJma({ other: 'advisory' })).score).toBe(10);
	});
});

// ---- scoreWeather: 気温（体感温度） -------------------------------------------

describe('scoreWeather 体感温度', () => {
	it('体感31℃ → 加点なし（真夏の平常値では反応しない）', () => {
		const result = scoreWeather(makeWeather({ temperature: 30, apparentTemperature: 31 }));
		expect(result.score).toBe(0);
		expect(result.riskTypes).not.toContain('heat');
	});

	it('体感40℃ → +18点(熱中症危険域)', () => {
		const result = scoreWeather(makeWeather({ temperature: 34, apparentTemperature: 40 }));
		expect(result.score).toBe(18);
		expect(result.riskTypes).toContain('heat');
		expect(result.reasons[0]).toContain('熱中症危険域');
	});

	it('評価は気温ではなく体感温度で行う（気温36℃・体感33℃ → 2点）', () => {
		const result = scoreWeather(makeWeather({ temperature: 36, apparentTemperature: 33 }));
		expect(result.score).toBe(2);
	});

	it('体感-12℃ → +12点(cold リスク)', () => {
		const result = scoreWeather(makeWeather({ temperature: -5, apparentTemperature: -12 }));
		expect(result.score).toBe(12);
		expect(result.riskTypes).toContain('cold');
		expect(result.riskTypes).not.toContain('heat');
	});

	it('高温と低温が同時に成立することはない', () => {
		const hot = scoreWeather(makeWeather({ apparentTemperature: 41 }));
		expect(hot.riskTypes).toContain('heat');
		expect(hot.riskTypes).not.toContain('cold');
	});

	it('気温カテゴリは気象カテゴリと加算される', () => {
		// 大雨警報30 + 熱中症危険域18 → 48点
		const result = scoreWeather(
			makeWeather({ apparentTemperature: 40 }),
			makeJma({ rain: 'warning' }, { rain: '大雨警報' })
		);
		expect(result.score).toBe(48);
	});
});

// ---- scoreEarthquake ---------------------------------------------------------

describe('scoreEarthquake 震度スコア', () => {
	it('震度なし → score 0', () => {
		const result = scoreEarthquake(makeEarthquake());
		expect(result.score).toBe(0);
		expect(result.riskTypes).not.toContain('earthquake');
	});

	it('震度3（発生直後）→ 4点（人的被害がほぼ生じないため低い）', () => {
		const result = scoreEarthquake(makeEarthquake({ shindo: '3', time: Date.now() }));
		expect(result.score).toBe(4);
		expect(result.riskTypes).toContain('earthquake');
		expect(result.reasons[0]).toContain('震度3');
	});

	it('震度7（発生直後）→ 90点（ユーザー指定の基準）', () => {
		expect(scoreEarthquake(makeEarthquake({ shindo: '7', time: Date.now() })).score).toBe(90);
	});

	it('震度5弱と5強でスコアが変わる', () => {
		const weak = scoreEarthquake(makeEarthquake({ shindo: '5-', time: Date.now() })).score;
		const strong = scoreEarthquake(makeEarthquake({ shindo: '5+', time: Date.now() })).score;
		expect(weak).toBe(20);
		expect(strong).toBe(35);
	});

	it('マグニチュードをラベルに併記する', () => {
		const result = scoreEarthquake(
			makeEarthquake({ shindo: '5+', magnitude: 6.2, time: Date.now() })
		);
		expect(result.reasons[0]).toContain('M6.2');
	});

	it('推定震度であることをラベルに明示する', () => {
		const result = scoreEarthquake(
			makeEarthquake({ shindo: '4', shindoSource: 'estimated', time: Date.now() })
		);
		expect(result.reasons[0]).toContain('推定');
	});

	it('実測震度には「推定」を付けない', () => {
		const result = scoreEarthquake(
			makeEarthquake({ shindo: '4', shindoSource: 'observed', time: Date.now() })
		);
		expect(result.reasons[0]).not.toContain('推定');
	});

	it('震源距離では減衰しない（距離は震度に内包されている）', () => {
		const near = scoreEarthquake(
			makeEarthquake({ shindo: '5+', time: Date.now(), distanceKm: 0 })
		).score;
		const far = scoreEarthquake(
			makeEarthquake({ shindo: '5+', time: Date.now(), distanceKm: 300 })
		).score;
		expect(near).toBe(far);
	});
});

describe('scoreEarthquake 時間減衰', () => {
	it('発生直後 → 減衰なし・note なし', () => {
		const result = scoreEarthquake(makeEarthquake({ shindo: '7', time: Date.now() }));
		expect(result.score).toBe(90);
		expect(result.scoreItems[0].note).toBeUndefined();
	});

	it('3日後もまだ高い（震度7: 90 → 44）', () => {
		const result = scoreEarthquake(makeEarthquake({ shindo: '7', time: daysAgo(3) }));
		expect(result.score).toBe(44);
		expect(result.scoreItems[0].note).toMatch(/減衰/);
	});

	it('1週間後も危険が残る（震度7: 90 → 19）', () => {
		expect(scoreEarthquake(makeEarthquake({ shindo: '7', time: daysAgo(7) })).score).toBe(19);
	});

	it('14日後 → 0点になり内訳からも消える', () => {
		const result = scoreEarthquake(makeEarthquake({ shindo: '7', time: daysAgo(14) }));
		expect(result.score).toBe(0);
		expect(result.scoreItems).toHaveLength(0);
		expect(result.riskTypes).not.toContain('earthquake');
	});

	it('14日を超えても0点のまま（最低保証点は存在しない）', () => {
		expect(scoreEarthquake(makeEarthquake({ shindo: '7', time: daysAgo(30) })).score).toBe(0);
	});

	it('小さい地震は早い段階で0点へ落ちる（震度1・6日後）', () => {
		// 1点 × 0.25 → 四捨五入で 0点。項目自体が消える
		const result = scoreEarthquake(makeEarthquake({ shindo: '1', time: daysAgo(6) }));
		expect(result.score).toBe(0);
		expect(result.scoreItems).toHaveLength(0);
	});

	it('note に基礎点と減衰率と経過日数を含む', () => {
		const note = scoreEarthquake(makeEarthquake({ shindo: '5+', time: daysAgo(4) })).scoreItems[0]
			.note;
		expect(note).toMatch(/基礎35点/);
		expect(note).toMatch(/0\.40/);
		expect(note).toMatch(/4\.0日経過/);
	});

	it('発生時刻が不明なら減衰させない', () => {
		expect(scoreEarthquake(makeEarthquake({ shindo: '3', time: null })).score).toBe(4);
	});
});

describe('scoreEarthquake 群発性', () => {
	it('4回以下 → 加点なし', () => {
		expect(scoreEarthquake(makeEarthquake({ recentQuakeCount: 4 })).score).toBe(0);
	});

	it('30回 → +5点（震度スコアに加算される）', () => {
		const result = scoreEarthquake(
			makeEarthquake({ shindo: '3', time: Date.now(), recentQuakeCount: 30 })
		);
		expect(result.score).toBe(9);
		expect(result.reasons).toContainEqual(expect.stringContaining('7日間で30回'));
	});

	it('震度スコアが0でも群発性だけで earthquake リスクになる', () => {
		const result = scoreEarthquake(makeEarthquake({ recentQuakeCount: 50 }));
		expect(result.score).toBe(5);
		expect(result.riskTypes).toContain('earthquake');
	});

	it('riskTypes に earthquake が重複しない', () => {
		const result = scoreEarthquake(
			makeEarthquake({ shindo: '4', time: Date.now(), recentQuakeCount: 50 })
		);
		expect(result.riskTypes).toEqual(['earthquake']);
	});
});

// ---- scoreTsunami -----------------------------------------------------------

describe('scoreTsunami', () => {
	it('none → 0点', () => {
		expect(scoreTsunami(makeTsunami()).score).toBe(0);
	});

	it('津波予報 → +2点', () => {
		expect(scoreTsunami(makeTsunami({ level: 'forecast' })).score).toBe(2);
	});

	it('津波注意報 → +25点（海岸から離れれば安全なため限定的）', () => {
		const result = scoreTsunami(makeTsunami({ level: 'advisory' }));
		expect(result.score).toBe(25);
		expect(result.riskTypes).toContain('tsunami');
	});

	it('津波警報 → +75点', () => {
		expect(scoreTsunami(makeTsunami({ level: 'warning' })).score).toBe(75);
	});

	it('大津波警報 → +95点（基準に最も近い事象）', () => {
		const result = scoreTsunami(makeTsunami({ level: 'major' }));
		expect(result.score).toBe(95);
		expect(result.reasons[0]).toContain('大津波警報');
	});

	it('予報区名をラベルに含める', () => {
		const result = scoreTsunami(makeTsunami({ level: 'warning', areaName: '熊本県天草灘沿岸' }));
		expect(result.reasons[0]).toContain('熊本県天草灘沿岸');
	});
});

// ---- scoreVolcano -----------------------------------------------------------

describe('scoreVolcano', () => {
	/** 距離減衰なし（近距離）の火山アラートを作る。 */
	function vAlert(name: string, level: number, distanceKm = 10, distanceFactor = 1): VolcanoAlert {
		return {
			name,
			level,
			levelText: `レベル${level}`,
			isLevelOperated: true,
			distanceKm,
			distanceFactor,
		};
	}

	it('警報なし → 0点', () => {
		expect(scoreVolcano(makeVolcano()).score).toBe(0);
	});

	it('レベル3（近距離）→ +20点（入山規制であり住民の生命は脅かされていない）', () => {
		const result = scoreVolcano(makeVolcano({ alerts: [vAlert('桜島', 3)] }));
		expect(result.score).toBe(20);
		expect(result.riskTypes).toContain('volcano');
		expect(result.reasons[0]).toContain('桜島');
	});

	it('レベル5（近距離）→ +85点', () => {
		expect(scoreVolcano(makeVolcano({ alerts: [vAlert('桜島', 5)] })).score).toBe(85);
	});

	it('距離減衰係数がスコアに掛かる（レベル3・係数0.5 → 10点）', () => {
		const result = scoreVolcano(makeVolcano({ alerts: [vAlert('伊豆大島', 3, 175, 0.5)] }));
		expect(result.score).toBe(10);
		expect(result.scoreItems[0].note).toMatch(/距離減衰0\.50/);
	});

	it('近距離は note に距離減衰を書かない', () => {
		const result = scoreVolcano(makeVolcano({ alerts: [vAlert('桜島', 3)] }));
		expect(result.scoreItems[0].note).toBeUndefined();
	});

	it('ラベルに距離を併記する', () => {
		const result = scoreVolcano(makeVolcano({ alerts: [vAlert('桜島', 3, 12)] }));
		expect(result.reasons[0]).toContain('12km');
	});

	it('減衰後スコアが最大の火山を採用する（レベル最大ではない）', () => {
		// 250km先のレベル4（55×0.2=11点）より 10km先のレベル3（20点）を選ぶ
		const result = scoreVolcano(
			makeVolcano({
				alerts: [vAlert('遠方の火山', 4, 250, 0.2), vAlert('近くの火山', 3, 10, 1)],
			})
		);
		expect(result.score).toBe(20);
		expect(result.reasons[0]).toContain('近くの火山');
	});

	it('採用されなかった火山は note に残る', () => {
		const result = scoreVolcano(
			makeVolcano({ alerts: [vAlert('桜島', 3), vAlert('薩摩硫黄島', 2)] })
		);
		expect(result.score).toBe(20);
		expect(result.scoreItems[0].note).toContain('薩摩硫黄島');
	});

	it('減衰で0点になった火山は計上しない', () => {
		expect(scoreVolcano(makeVolcano({ alerts: [vAlert('西之島', 1, 300, 0)] })).score).toBe(0);
	});
});

// ---- scoreAir ---------------------------------------------------------------

describe('scoreAir', () => {
	it('pm25=null → score 0', () => {
		expect(scoreAir(makeAir()).score).toBe(0);
	});

	it('pm25=10(良好) → score 0', () => {
		expect(scoreAir(makeAir({ pm25: 10 })).score).toBe(0);
	});

	it('pm25=25 → +2点(やや悪い)', () => {
		const result = scoreAir(makeAir({ pm25: 25 }));
		expect(result.score).toBe(2);
		expect(result.riskTypes).toContain('air');
	});

	it('pm25=100 → +12点(非常に悪い)', () => {
		expect(scoreAir(makeAir({ pm25: 100 })).score).toBe(12);
	});

	it('pm25=150 → +12点(上限は変わらない)', () => {
		expect(scoreAir(makeAir({ pm25: 150 })).score).toBe(12);
	});

	it('大気汚染は生命危険度の尺度では地震・津波より大幅に低い', () => {
		// 健康影響は大きいが、その場で人が死ぬ性質のものではない
		expect(scoreAir(makeAir({ pm25: 150 })).score).toBeLessThan(
			scoreTsunami(makeTsunami({ level: 'advisory' })).score
		);
	});
});

// ---- calculateRegionRisk ----------------------------------------------------

describe('calculateRegionRisk', () => {
	beforeEach(() => {
		vi.mocked(fetchWeatherBatch).mockResolvedValue([makeWeather()]);
		vi.mocked(fetchEarthquakesAll).mockResolvedValue([makeEarthquake()]);
		vi.mocked(fetchAirQualityBatch).mockResolvedValue([makeAir()]);
		vi.mocked(fetchAllJmaWarnings).mockResolvedValue([makeJma()]);
		vi.mocked(fetchTsunamiAll).mockResolvedValue([makeTsunami()]);
		vi.mocked(fetchVolcanoAll).mockResolvedValue([makeVolcano()]);
		vi.mocked(fetchEarlyWarningAll).mockResolvedValue([{}]);
	});

	it('危険情報がない場合、「現在危険情報なし」を返す', async () => {
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(0);
		expect(result.reasons).toEqual(['現在危険情報なし']);
		expect(result.riskTypes).toEqual([]);
	});

	it('スコアが100を超えない', async () => {
		vi.mocked(fetchWeatherBatch).mockResolvedValue([
			makeWeather({ alertLevel: 'special', apparentTemperature: 45, windGusts: 150 }),
		]);
		vi.mocked(fetchEarthquakesAll).mockResolvedValue([
			makeEarthquake({ shindo: '7', time: Date.now() }),
		]);
		vi.mocked(fetchAirQualityBatch).mockResolvedValue([makeAir({ pm25: 150, aqi: 300 })]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(100);
		expect(result.rawScore).toBeGreaterThan(100);
	});

	it('rawScore はキャップ前の合計を保持する', async () => {
		// 震度7(90) + 大津波警報(95) = 185。これが100に達する数少ない組み合わせ
		vi.mocked(fetchEarthquakesAll).mockResolvedValue([
			makeEarthquake({ shindo: '7', time: Date.now() }),
		]);
		vi.mocked(fetchTsunamiAll).mockResolvedValue([makeTsunami({ level: 'major' })]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.rawScore).toBe(185);
		expect(result.riskScore).toBe(100);
	});

	it('地域情報が正しくコピーされる', async () => {
		const result = await calculateRegionRisk(TOKYO);
		expect(result.id).toBe('tokyo');
		expect(result.name).toBe('東京');
		expect(result.lat).toBe(35.6895);
		expect(result.lng).toBe(139.6917);
	});

	it('updatedAt が現在時刻に近い', async () => {
		const before = Date.now();
		const result = await calculateRegionRisk(TOKYO);
		const after = Date.now();
		expect(result.updatedAt).toBeGreaterThanOrEqual(before);
		expect(result.updatedAt).toBeLessThanOrEqual(after);
	});

	it('riskTypes に重複がない', async () => {
		vi.mocked(fetchWeatherBatch).mockResolvedValue([
			makeWeather({ alertLevel: 'warning', windGusts: 120, apparentTemperature: 40 }),
		]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskTypes.length).toBe(new Set(result.riskTypes).size);
	});

	it('複数カテゴリのリスクタイプが揃う', async () => {
		vi.mocked(fetchWeatherBatch).mockResolvedValue([
			makeWeather({ snowDepthCm: 100, apparentTemperature: 40 }),
		]);
		vi.mocked(fetchAllJmaWarnings).mockResolvedValue([
			makeJma({ rain: 'warning' }, { rain: '大雨警報' }),
		]);
		vi.mocked(fetchEarthquakesAll).mockResolvedValue([
			makeEarthquake({ shindo: '4', time: Date.now() }),
		]);
		vi.mocked(fetchTsunamiAll).mockResolvedValue([makeTsunami({ level: 'advisory' })]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskTypes).toContain('weather');
		expect(result.riskTypes).toContain('snow');
		expect(result.riskTypes).toContain('heat');
		expect(result.riskTypes).toContain('earthquake');
		expect(result.riskTypes).toContain('tsunami');
	});

	it('早期注意情報がスコアに反映される', async () => {
		vi.mocked(fetchEarlyWarningAll).mockResolvedValue([
			{ rain: { phenomenon: '大雨', probability: '中' } },
		]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(5);
		expect(result.reasons[0]).toContain('早期注意情報');
		expect(result.reasons[0]).toContain('大雨');
	});

	it('警報が出ているカテゴリは早期注意情報で上書きされない', async () => {
		vi.mocked(fetchAllJmaWarnings).mockResolvedValue([
			makeJma({ rain: 'warning' }, { rain: '大雨警報' }),
		]);
		vi.mocked(fetchEarlyWarningAll).mockResolvedValue([
			{ rain: { phenomenon: '大雨', probability: '高' } },
		]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(30);
		expect(result.reasons[0]).toBe('大雨警報');
	});

	it('早期注意情報APIが失敗しても他のスコアを返す', async () => {
		vi.mocked(fetchEarlyWarningAll).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchAllJmaWarnings).mockResolvedValue([
			makeJma({ rain: 'warning' }, { rain: '大雨警報' }),
		]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(30);
	});

	it('気象APIが失敗しても地震スコアを返す', async () => {
		vi.mocked(fetchWeatherBatch).mockRejectedValue(new Error('timeout'));
		vi.mocked(fetchEarthquakesAll).mockResolvedValue([
			makeEarthquake({ shindo: '5+', time: Date.now() }),
		]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(35);
		expect(result.details.weather).toBeUndefined();
	});

	it('津波・火山APIが失敗しても他のスコアを返す', async () => {
		vi.mocked(fetchTsunamiAll).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchVolcanoAll).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchEarthquakesAll).mockResolvedValue([
			makeEarthquake({ shindo: '4', time: Date.now() }),
		]);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(9);
		expect(result.details.tsunami).toBeUndefined();
	});

	it('すべてのAPIが失敗しても「現在危険情報なし」を返す', async () => {
		vi.mocked(fetchWeatherBatch).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchEarthquakesAll).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchAirQualityBatch).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchAllJmaWarnings).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchTsunamiAll).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchVolcanoAll).mockRejectedValue(new Error('fail'));
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(0);
		expect(result.reasons).toEqual(['現在危険情報なし']);
	});
});
