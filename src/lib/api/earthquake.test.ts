import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchEarthquake, estimateShindo, shindoLevelFromInstrumental } from './earthquake';
import { SHINDO_SCORES } from '../services/scoringRules';
import type { ShindoLevel } from '../types';

function makeFeature(mag: number, place: string | null, time: number, depth: number) {
	return {
		properties: { mag, place, time },
		geometry: { coordinates: [139.7, 35.6, depth] },
	};
}

function mockFetchEarthquake(features: ReturnType<typeof makeFeature>[]) {
	vi.stubGlobal(
		'fetch',
		vi.fn().mockResolvedValue({
			ok: true,
			json: () => Promise.resolve({ features }),
		})
	);
}

describe('shindoLevelFromInstrumental', () => {
	it.each([
		[0.4, null],
		[0.5, '1'],
		[1.4, '1'],
		[1.5, '2'],
		[2.5, '3'],
		[3.5, '4'],
		[4.5, '5-'],
		[5.0, '5+'],
		[5.5, '6-'],
		[6.0, '6+'],
		[6.5, '7'],
		[7.2, '7'],
	] as const)('計測震度 %f → %s', (value, expected) => {
		expect(shindoLevelFromInstrumental(value)).toBe(expected);
	});
});

describe('estimateShindo', () => {
	it('M4.0・深さ10km・直下 → 震度3程度', () => {
		expect(estimateShindo(4.0, 10, 0)).toBe('3');
	});

	it('M7.0・深さ10km・直下 → 震度6弱以上', () => {
		const shindo = estimateShindo(7.0, 10, 0);
		expect(shindo).not.toBeNull();
		expect(SHINDO_SCORES[shindo as ShindoLevel]).toBeGreaterThanOrEqual(SHINDO_SCORES['6-']);
	});

	it('距離が離れるほど震度は下がる（M6.5・深さ10km）', () => {
		const distances = [0, 50, 150, 400];
		const scores = distances.map((d) => {
			const s = estimateShindo(6.5, 10, d);
			return s === null ? 0 : SHINDO_SCORES[s];
		});
		for (let i = 1; i < scores.length; i++) {
			expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
		}
		expect(scores[0]).toBeGreaterThan(scores[scores.length - 1]);
	});

	it('マグニチュードが大きいほど震度は上がる（同一距離・深さ）', () => {
		const scoreOf = (m: number) => {
			const s = estimateShindo(m, 20, 50);
			return s === null ? 0 : SHINDO_SCORES[s];
		};
		expect(scoreOf(4.0)).toBeLessThan(scoreOf(6.0));
		expect(scoreOf(6.0)).toBeLessThan(scoreOf(8.0));
	});

	it('深い地震は同じ規模でも震度が低い', () => {
		const shallow = estimateShindo(6.0, 10, 0);
		const deep = estimateShindo(6.0, 300, 0);
		const shallowScore = shallow === null ? 0 : SHINDO_SCORES[shallow];
		const deepScore = deep === null ? 0 : SHINDO_SCORES[deep];
		expect(deepScore).toBeLessThan(shallowScore);
	});

	it('十分に遠い小地震 → null（体感しない）', () => {
		expect(estimateShindo(3.0, 10, 500)).toBeNull();
	});

	it('深さ・距離が不明ならデフォルト値で推定する', () => {
		expect(estimateShindo(5.0, null, null)).not.toBeNull();
	});
});

describe('fetchEarthquake', () => {
	afterEach(() => vi.unstubAllGlobals());

	it('地震なし → 全フィールドがnull・群発カウント0', async () => {
		mockFetchEarthquake([]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result).toEqual({
			magnitude: null,
			place: null,
			time: null,
			depth: null,
			distanceKm: null,
			shindo: null,
			shindoSource: null,
			recentQuakeCount: 0,
		});
	});

	it('M5.2の地震を正しく返す', async () => {
		mockFetchEarthquake([makeFeature(5.2, '東京都 東部', 1700000000000, 30)]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.magnitude).toBe(5.2);
		expect(result.place).toBe('東京都 東部');
		expect(result.time).toBe(1700000000000);
		expect(result.depth).toBe(30);
	});

	it('USGS経路では震度が推定値としてマークされる', async () => {
		mockFetchEarthquake([makeFeature(5.2, '東京都 東部', 1700000000000, 30)]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.shindo).not.toBeNull();
		expect(result.shindoSource).toBe('estimated');
	});

	it('USGS経路では群発性を評価しない（都道府県別の回数が得られない）', async () => {
		mockFetchEarthquake([makeFeature(5.2, null, 1700000000000, 30)]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.recentQuakeCount).toBe(0);
	});

	it('place が null の場合も正常に返す', async () => {
		mockFetchEarthquake([makeFeature(4.0, null, 1700000000000, 10)]);
		const result = await fetchEarthquake(35.6, 139.7);
		expect(result.magnitude).toBe(4.0);
		expect(result.place).toBeNull();
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
