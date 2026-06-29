import { describe, it, expect } from 'vitest';
import { REGIONS } from './regions';

describe('REGIONS', () => {
	it('47都道府県が定義されている', () => {
		expect(REGIONS).toHaveLength(47);
	});

	it('すべてのIDが一意である', () => {
		const ids = REGIONS.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length);
	});

	it('すべてのフィールドが存在する', () => {
		for (const r of REGIONS) {
			expect(r.id).toBeTruthy();
			expect(r.name).toBeTruthy();
			expect(r.city).toBeTruthy();
			expect(typeof r.lat).toBe('number');
			expect(typeof r.lng).toBe('number');
		}
	});

	it('緯度が日本の範囲内(24〜46度)である', () => {
		for (const r of REGIONS) {
			expect(r.lat).toBeGreaterThanOrEqual(24);
			expect(r.lat).toBeLessThanOrEqual(46);
		}
	});

	it('経度が日本の範囲内(122〜146度)である', () => {
		for (const r of REGIONS) {
			expect(r.lng).toBeGreaterThanOrEqual(122);
			expect(r.lng).toBeLessThanOrEqual(146);
		}
	});

	it('代表的な都道府県が含まれている', () => {
		const ids = REGIONS.map((r) => r.id);
		expect(ids).toContain('tokyo');
		expect(ids).toContain('osaka');
		expect(ids).toContain('hokkaido');
		expect(ids).toContain('okinawa');
		expect(ids).toContain('aichi');
		expect(ids).toContain('fukuoka');
	});
});
