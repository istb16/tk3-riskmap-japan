import { describe, it, expect, vi, beforeEach } from 'vitest';
import { scoreWeather, scoreEarthquake, scoreAir, calculateRegionRisk } from './riskCalculator';
import type { WeatherData, EarthquakeData, AirData, Region } from '../types';

// vi.mock はモジュールトップレベルに置く（vitestが静的にhoist）
vi.mock('../api/weather', () => ({
	fetchWeather: vi.fn(),
	getWeatherLabel: (code: number) => `label(${code})`,
}));
vi.mock('../api/earthquake', () => ({
	fetchEarthquake: vi.fn(),
}));
vi.mock('../api/air', () => ({
	fetchAirQuality: vi.fn(),
}));
vi.mock('../api/jma', () => ({
	fetchJmaWarnings: vi.fn(),
}));

// モック済み関数を import（vi.mock のhoist後に解決される）
import { fetchWeather } from '../api/weather';
import { fetchEarthquake } from '../api/earthquake';
import { fetchAirQuality } from '../api/air';
import { fetchJmaWarnings } from '../api/jma';

// ---- ヘルパー ---------------------------------------------------------------

function makeWeather(overrides: Partial<WeatherData> = {}): WeatherData {
	return {
		temperature: 20,
		weatherCode: 0,
		precipitation: 0,
		windSpeed: 0,
		alertLevel: 'none',
		...overrides,
	};
}

function makeEarthquake(overrides: Partial<EarthquakeData> = {}): EarthquakeData {
	return { magnitude: null, place: null, time: null, depth: null, distanceKm: null, ...overrides };
}

function makeAir(overrides: Partial<AirData> = {}): AirData {
	return { pm25: null, aqi: null, ...overrides };
}

const TOKYO: Region = { id: 'tokyo', name: '東京', lat: 35.6895, lng: 139.6917, city: 'Tokyo', jmaCode: '130000' };

// ---- scoreWeather -----------------------------------------------------------

describe('scoreWeather', () => {
	describe('alertLevel によるスコア', () => {
		it('alertLevel=none → score 0, riskTypes に weather なし', () => {
			const result = scoreWeather(makeWeather({ alertLevel: 'none' }));
			expect(result.score).toBe(0);
			expect(result.riskTypes).not.toContain('weather');
		});

		it('alertLevel=advisory → +15点, weather リスクあり', () => {
			const result = scoreWeather(makeWeather({ alertLevel: 'advisory' }));
			expect(result.score).toBe(15);
			expect(result.riskTypes).toContain('weather');
			expect(result.reasons[0]).toBe('気象注意報');
		});

		it('alertLevel=warning → +30点', () => {
			const result = scoreWeather(makeWeather({ alertLevel: 'warning', weatherCode: 61 }));
			expect(result.score).toBe(30);
			expect(result.reasons[0]).toContain('大雨警報');
		});

		it('alertLevel=special → +50点', () => {
			const result = scoreWeather(makeWeather({ alertLevel: 'special', weatherCode: 95 }));
			expect(result.score).toBe(50);
			expect(result.reasons[0]).toContain('特別警報');
		});
	});

	describe('風速によるスコア', () => {
		it('windSpeed=45 → +12点(強風)', () => {
			const result = scoreWeather(makeWeather({ windSpeed: 45 }));
			expect(result.score).toBe(12);
			expect(result.reasons).toContainEqual(expect.stringContaining('強風'));
		});

		it('windSpeed=65 → +20点(暴風)', () => {
			const result = scoreWeather(makeWeather({ windSpeed: 65 }));
			expect(result.score).toBe(20);
			expect(result.reasons).toContainEqual(expect.stringContaining('暴風'));
		});

		it('special+暴風 → 70点', () => {
			// special=50 + 暴風(65km/h)=20
			const result = scoreWeather(makeWeather({ alertLevel: 'special', windSpeed: 65, weatherCode: 95 }));
			expect(result.score).toBe(70);
		});
	});

	describe('気温(熱中症)によるスコア', () => {
		it('temperature=27 → heat なし', () => {
			const result = scoreWeather(makeWeather({ temperature: 27 }));
			expect(result.riskTypes).not.toContain('heat');
			expect(result.score).toBe(0);
		});

		it('temperature=29 → +8点(真夏日)', () => {
			const result = scoreWeather(makeWeather({ temperature: 29 }));
			expect(result.riskTypes).toContain('heat');
			expect(result.score).toBe(8);
			expect(result.reasons).toContainEqual(expect.stringContaining('真夏日'));
		});

		it('temperature=32 → +15点(猛暑), heat リスクあり', () => {
			const result = scoreWeather(makeWeather({ temperature: 32 }));
			expect(result.score).toBe(15);
			expect(result.riskTypes).toContain('heat');
			expect(result.reasons).toContainEqual(expect.stringContaining('猛暑'));
		});

		it('temperature=36 → +30点(熱中症危険域)', () => {
			const result = scoreWeather(makeWeather({ temperature: 36 }));
			expect(result.score).toBe(30);
			expect(result.reasons).toContainEqual(expect.stringContaining('熱中症危険域'));
		});

		it('special + 猛暑 → weather と heat 両方のリスクタイプ', () => {
			const result = scoreWeather(makeWeather({ alertLevel: 'special', temperature: 36, weatherCode: 95 }));
			expect(result.riskTypes).toContain('weather');
			expect(result.riskTypes).toContain('heat');
		});
	});
});

// ---- scoreEarthquake --------------------------------------------------------

describe('scoreEarthquake', () => {
	it('magnitude=null → score 0', () => {
		expect(scoreEarthquake(makeEarthquake()).score).toBe(0);
	});

	it('M3.0(閾値未満) → score 0, earthquake なし', () => {
		const result = scoreEarthquake(makeEarthquake({ magnitude: 3.0 }));
		expect(result.score).toBe(0);
		expect(result.riskTypes).not.toContain('earthquake');
	});

	it('M3.5 → +10点', () => {
		const result = scoreEarthquake(makeEarthquake({ magnitude: 3.5 }));
		expect(result.score).toBe(10);
		expect(result.riskTypes).toContain('earthquake');
		expect(result.reasons[0]).toContain('小規模地震');
	});

	it('M4.0 → +20点', () => {
		const result = scoreEarthquake(makeEarthquake({ magnitude: 4.0 }));
		expect(result.score).toBe(20);
		expect(result.reasons[0]).toContain('7日以内');
	});

	it('M5.0 → +40点', () => {
		const result = scoreEarthquake(makeEarthquake({ magnitude: 5.0 }));
		expect(result.score).toBe(40);
		expect(result.reasons[0]).toContain('地震発生');
	});

	it('M6.5 → +40点(M5以上はすべて同点)', () => {
		expect(scoreEarthquake(makeEarthquake({ magnitude: 6.5 })).score).toBe(40);
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

	it('pm25=25 → +10点(やや悪い)', () => {
		const result = scoreAir(makeAir({ pm25: 25 }));
		expect(result.score).toBe(10);
		expect(result.riskTypes).toContain('air');
		expect(result.reasons[0]).toContain('やや悪い');
	});

	it('pm25=50 → +25点(悪い)', () => {
		const result = scoreAir(makeAir({ pm25: 50 }));
		expect(result.score).toBe(25);
		expect(result.reasons[0]).toContain('悪い');
	});

	it('pm25=100 → +40点(非常に悪い)', () => {
		const result = scoreAir(makeAir({ pm25: 100 }));
		expect(result.score).toBe(40);
		expect(result.reasons[0]).toContain('非常に悪い');
	});

	it('pm25=150 → +40点(上限は変わらない)', () => {
		expect(scoreAir(makeAir({ pm25: 150 })).score).toBe(40);
	});
});

// ---- calculateRegionRisk ----------------------------------------------------

describe('calculateRegionRisk', () => {
	beforeEach(() => {
		vi.mocked(fetchWeather).mockResolvedValue(makeWeather());
		vi.mocked(fetchEarthquake).mockResolvedValue(makeEarthquake());
		vi.mocked(fetchAirQuality).mockResolvedValue(makeAir());
		vi.mocked(fetchJmaWarnings).mockResolvedValue({ areas: [], alertLevel: 'none' });
	});

	it('危険情報がない場合、「現在危険情報なし」を返す', async () => {
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(0);
		expect(result.reasons).toEqual(['現在危険情報なし']);
		expect(result.riskTypes).toEqual([]);
	});

	it('スコアが100を超えない', async () => {
		vi.mocked(fetchWeather).mockResolvedValue(
			makeWeather({ alertLevel: 'special', weatherCode: 95, temperature: 36, windSpeed: 65 })
		);
		vi.mocked(fetchEarthquake).mockResolvedValue(makeEarthquake({ magnitude: 6.0 }));
		vi.mocked(fetchAirQuality).mockResolvedValue(makeAir({ pm25: 150, aqi: 300 }));
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBeLessThanOrEqual(100);
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
		vi.mocked(fetchWeather).mockResolvedValue(
			makeWeather({ alertLevel: 'warning', temperature: 32, weatherCode: 61 })
		);
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskTypes.length).toBe(new Set(result.riskTypes).size);
	});

	it('気象APIが失敗しても地震スコアを返す', async () => {
		vi.mocked(fetchWeather).mockRejectedValue(new Error('timeout'));
		vi.mocked(fetchEarthquake).mockResolvedValue(makeEarthquake({ magnitude: 5.5 }));
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(40);
		expect(result.details.weather).toBeUndefined();
	});

	it('すべてのAPIが失敗しても「現在危険情報なし」を返す', async () => {
		vi.mocked(fetchWeather).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchEarthquake).mockRejectedValue(new Error('fail'));
		vi.mocked(fetchAirQuality).mockRejectedValue(new Error('fail'));
		const result = await calculateRegionRisk(TOKYO);
		expect(result.riskScore).toBe(0);
		expect(result.reasons).toEqual(['現在危険情報なし']);
	});
});
