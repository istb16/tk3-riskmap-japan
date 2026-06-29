import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchWeather, getWeatherLabel } from './weather';

// ---- getWeatherLabel --------------------------------------------------------

describe('getWeatherLabel', () => {
	it.each([
		[0,   '快晴'],
		[1,   '曇り'],
		[3,   '曇り'],
		[10,  '霧'],
		[48,  '霧'],
		[51,  '霧雨'],
		[57,  '霧雨'],
		[61,  '雨'],
		[67,  '雨'],
		[71,  '雪'],
		[77,  '雪'],
		[80,  'にわか雨'],
		[82,  'にわか雨'],
		[85,  '雪のにわか降り'],
		[86,  '雪のにわか降り'],
		[95,  '雷雨'],
		[99,  '雷雨'],
		[100, '不明'],
	] as const)('code=%i → %s', (code, label) => {
		expect(getWeatherLabel(code)).toBe(label);
	});
});

// ---- fetchWeather -----------------------------------------------------------

function mockFetchWeather(overrides: Partial<{
	temperature_2m: number;
	weather_code: number;
	precipitation: number;
	wind_speed_10m: number;
}> = {}) {
	const current = {
		temperature_2m: 20,
		weather_code: 0,
		precipitation: 0,
		wind_speed_10m: 0,
		...overrides,
	};
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve({ current }),
	}));
}

describe('fetchWeather', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('通常の天気データを正しくパースする', async () => {
		mockFetchWeather({ temperature_2m: 22, weather_code: 1, precipitation: 0, wind_speed_10m: 10 });
		const result = await fetchWeather(35.6, 139.7);
		expect(result.temperature).toBe(22);
		expect(result.weatherCode).toBe(1);
		expect(result.precipitation).toBe(0);
		expect(result.windSpeed).toBe(10);
		expect(result.alertLevel).toBe('none');
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
	});

	it('fetchが失敗した場合にエラーをthrowする', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
		await expect(fetchWeather(35, 135)).rejects.toThrow('Weather fetch failed: 503');
	});
});
