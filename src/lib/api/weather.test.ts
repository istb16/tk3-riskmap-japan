import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchWeather, getWeatherLabel } from './weather';

// ---- getWeatherLabel --------------------------------------------------------

describe('getWeatherLabel', () => {
	it.each([
		[0, '快晴'],
		[1, '曇り'],
		[3, '曇り'],
		[10, '霧'],
		[48, '霧'],
		[51, '霧雨'],
		[57, '霧雨'],
		[61, '雨'],
		[67, '雨'],
		[71, '雪'],
		[77, '雪'],
		[80, 'にわか雨'],
		[82, 'にわか雨'],
		[85, '雪のにわか降り'],
		[86, '雪のにわか降り'],
		[95, '雷雨'],
		[99, '雷雨'],
		[100, '不明'],
	] as const)('code=%i → %s', (code, label) => {
		expect(getWeatherLabel(code)).toBe(label);
	});
});

// ---- fetchWeather -----------------------------------------------------------

interface CurrentOverrides {
	temperature_2m?: number;
	apparent_temperature?: number;
	weather_code?: number;
	precipitation?: number;
	wind_speed_10m?: number;
	wind_gusts_10m?: number;
	snowfall?: number;
	snow_depth?: number;
}

function mockFetchWeather(overrides: CurrentOverrides = {}) {
	const current = {
		temperature_2m: 20,
		apparent_temperature: 20,
		weather_code: 0,
		precipitation: 0,
		wind_speed_10m: 0,
		wind_gusts_10m: 0,
		snowfall: 0,
		snow_depth: 0,
		...overrides,
	};
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ current }),
		})
	);
}

describe('fetchWeather', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('通常の天気データを正しくパースする', async () => {
		mockFetchWeather({
			temperature_2m: 22,
			apparent_temperature: 25,
			weather_code: 1,
			precipitation: 0,
			wind_speed_10m: 10,
			wind_gusts_10m: 38,
		});
		const result = await fetchWeather(35.6, 139.7);
		expect(result.temperature).toBe(22);
		expect(result.apparentTemperature).toBe(25);
		expect(result.weatherCode).toBe(1);
		expect(result.precipitation).toBe(0);
		expect(result.windSpeed).toBe(10);
		expect(result.windGusts).toBe(38);
		expect(result.alertLevel).toBe('none');
	});

	describe('積雪の単位変換', () => {
		it('snow_depth は m 単位で返るため cm に変換する', async () => {
			mockFetchWeather({ snow_depth: 1.25 });
			const result = await fetchWeather(35, 135);
			expect(result.snowDepthCm).toBe(125);
		});

		it('snowfall は cm 単位のまま扱う', async () => {
			mockFetchWeather({ snowfall: 3.5 });
			const result = await fetchWeather(35, 135);
			expect(result.snowfall).toBe(3.5);
		});
	});

	describe('欠損値のフォールバック', () => {
		it('apparent_temperature が無ければ気温で代替する', async () => {
			mockFetchWeather({ temperature_2m: 18, apparent_temperature: undefined });
			const result = await fetchWeather(35, 135);
			expect(result.apparentTemperature).toBe(18);
		});

		it('wind_gusts_10m が無ければ平均風速で代替する', async () => {
			mockFetchWeather({ wind_speed_10m: 12, wind_gusts_10m: undefined });
			const result = await fetchWeather(35, 135);
			expect(result.windGusts).toBe(12);
		});
	});

	describe('alertLevel', () => {
		it('WMO severe code(95) → special', async () => {
			mockFetchWeather({ weather_code: 95 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('special');
		});

		it('precipitation > 30 → special', async () => {
			mockFetchWeather({ precipitation: 31 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('special');
		});

		it('WMO warning code(61) → warning', async () => {
			mockFetchWeather({ weather_code: 61 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('warning');
		});

		it('precipitation > 10 → warning', async () => {
			mockFetchWeather({ precipitation: 15 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('warning');
		});

		it('precipitation > 2 → advisory', async () => {
			mockFetchWeather({ precipitation: 3 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('advisory');
		});

		it('wind > 50 → advisory', async () => {
			mockFetchWeather({ wind_speed_10m: 55 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('advisory');
		});

		it('霧(45) → early（早期注意情報相当）', async () => {
			mockFetchWeather({ weather_code: 45 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('early');
		});

		it('霧雨(51) → early', async () => {
			mockFetchWeather({ weather_code: 51 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('early');
		});

		it('ごく弱い降水(0.5mm/h) → early', async () => {
			mockFetchWeather({ precipitation: 0.5 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('early');
		});

		it('やや強い風(40km/h) → early', async () => {
			mockFetchWeather({ wind_speed_10m: 40 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('early');
		});

		it('通常の気象データ → none', async () => {
			mockFetchWeather({ weather_code: 0, precipitation: 0, wind_speed_10m: 5 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('none');
		});

		it('special は warning より優先される', async () => {
			mockFetchWeather({ weather_code: 61, precipitation: 35 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('special');
		});

		it('advisory は early より優先される', async () => {
			mockFetchWeather({ weather_code: 45, precipitation: 3 });
			const { alertLevel } = await fetchWeather(35, 135);
			expect(alertLevel).toBe('advisory');
		});
	});

	it('新しい観測項目をリクエストに含める', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ current: {} }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await fetchWeather(35.6, 139.7);
		const url: string = fetchMock.mock.calls[0][0];
		expect(url).toContain('apparent_temperature');
		expect(url).toContain('wind_gusts_10m');
		expect(url).toContain('snowfall');
		expect(url).toContain('snow_depth');
	});

	it('fetchが失敗した場合にエラーをthrowする', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
		await expect(fetchWeather(35, 135)).rejects.toThrow('Weather fetch failed: 503');
	});
});
