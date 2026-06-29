import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchAirQuality } from './air';

function makeOpenMeteoAirResponse(pm2_5: number | null, european_aqi: number | null) {
	return { current: { pm2_5, european_aqi } };
}

describe('fetchAirQuality', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('pm25とaqiを正しく返す', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(makeOpenMeteoAirResponse(18, 42)),
		}));
		const result = await fetchAirQuality(35.6, 139.7);
		expect(result.pm25).toBe(18);
		expect(result.aqi).toBe(42);
	});

	it('APIがnullを返した場合、{ pm25: null, aqi: null } を返す', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve(makeOpenMeteoAirResponse(null, null)),
		}));
		const result = await fetchAirQuality(35.6, 139.7);
		expect(result).toEqual({ pm25: null, aqi: null });
	});

	it('HTTPエラーの場合、エラーをスローする', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 503 }));
		await expect(fetchAirQuality(35.6, 139.7)).rejects.toThrow('503');
	});

	it('ネットワークエラーの場合、エラーをスローする', async () => {
		vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('Network error')));
		await expect(fetchAirQuality(35.6, 139.7)).rejects.toThrow('Network error');
	});
});
