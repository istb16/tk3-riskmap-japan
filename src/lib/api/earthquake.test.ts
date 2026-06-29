import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchEarthquake } from './earthquake';

function makeFeature(mag: number, place: string | null, time: number, depth: number) {
	return {
		properties: { mag, place, time },
		geometry: { coordinates: [139.7, 35.6, depth] },
	};
}

function mockFetchEarthquake(features: ReturnType<typeof makeFeature>[]) {
	vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
		ok: true,
		json: () => Promise.resolve({ features }),
	}));
}

describe('fetchEarthquake', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('地震なし → 全フィールドがnull', async () => {
		mockFetchEarthquake([]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result).toEqual({ magnitude: null, place: null, time: null, depth: null });
	});

	it('M5.2の地震を正しく返す', async () => {
		mockFetchEarthquake([makeFeature(5.2, '東京都 東部', 1700000000000, 30)]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.magnitude).toBe(5.2);
		expect(result.place).toBe('東京都 東部');
		expect(result.time).toBe(1700000000000);
		expect(result.depth).toBe(30);
	});

	it('place が null の場合も正常に返す', async () => {
		mockFetchEarthquake([makeFeature(4.0, null, 1700000000000, 10)]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.magnitude).toBe(4.0);
		expect(result.place).toBeNull();
	});

	it('複数結果があれば最初の1件のみ使用する', async () => {
		mockFetchEarthquake([
			makeFeature(5.5, '大きい地震', 1700000001000, 20),
			makeFeature(3.0, '小さい地震', 1700000000000, 5),
		]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.magnitude).toBe(5.5);
	});

	it('fetchが失敗した場合にエラーをthrowする', async () => {
		vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500 }));
		await expect(fetchEarthquake(35.6, 139.7)).rejects.toThrow('Earthquake fetch failed: 500');
	});

	it('正しいUSGSエンドポイントに問い合わせる', async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ features: [] }),
		});
		vi.stubGlobal('fetch', fetchMock);
		await fetchEarthquake(35.6, 139.7);
		const url: string = fetchMock.mock.calls[0][0];
		expect(url).toContain('earthquake.usgs.gov');
		expect(url).toContain('latitude=35.6');
		expect(url).toContain('longitude=139.7');
	});
});
