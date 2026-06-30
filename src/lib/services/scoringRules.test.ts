import { describe, it, expect } from 'vitest';
import {
	matchTier,
	WIND_TIERS,
	PRECIPITATION_TIERS,
	HEAT_TIERS,
	QUAKE_TIERS,
	PM25_TIERS,
} from './scoringRules';

describe('matchTier', () => {
	describe('WIND_TIERS', () => {
		it('閾値未満(19km/h) → null', () => {
			expect(matchTier(19, WIND_TIERS)).toBeNull();
		});

		it('下限ちょうど(20km/h) → やや強い風 score=5', () => {
			const tier = matchTier(20, WIND_TIERS);
			expect(tier?.score).toBe(5);
			expect(tier?.reason(20)).toContain('やや強い風');
		});

		it('強風閾値ちょうど(40km/h) → score=12', () => {
			expect(matchTier(40, WIND_TIERS)?.score).toBe(12);
		});

		it('暴風閾値ちょうど(60km/h) → score=20（強風より上位を採用）', () => {
			expect(matchTier(60, WIND_TIERS)?.score).toBe(20);
		});

		it('猛烈な風(90km/h) → score=30', () => {
			expect(matchTier(90, WIND_TIERS)?.score).toBe(30);
		});

		it('上限超え(200km/h) → 最上位の score=30', () => {
			expect(matchTier(200, WIND_TIERS)?.score).toBe(30);
		});

		it('reason に値を含む', () => {
			expect(matchTier(65, WIND_TIERS)?.reason(65)).toContain('65');
		});
	});

	describe('PRECIPITATION_TIERS', () => {
		it('閾値未満(0.9mm/h) → null', () => {
			expect(matchTier(0.9, PRECIPITATION_TIERS)).toBeNull();
		});

		it('小雨ちょうど(1mm/h) → score=3', () => {
			expect(matchTier(1, PRECIPITATION_TIERS)?.score).toBe(3);
		});

		it('やや強い雨(5mm/h) → score=8', () => {
			expect(matchTier(5, PRECIPITATION_TIERS)?.score).toBe(8);
		});

		it('激しい雨(15mm/h) → score=15', () => {
			expect(matchTier(15, PRECIPITATION_TIERS)?.score).toBe(15);
		});

		it('非常に激しい雨(30mm/h) → score=25', () => {
			expect(matchTier(30, PRECIPITATION_TIERS)?.score).toBe(25);
		});

		it('猛烈な雨(50mm/h) → score=35', () => {
			expect(matchTier(50, PRECIPITATION_TIERS)?.score).toBe(35);
		});
	});

	describe('HEAT_TIERS', () => {
		it('閾値未満(27℃) → null', () => {
			expect(matchTier(27, HEAT_TIERS)).toBeNull();
		});

		it('真夏日(28℃) → score=8', () => {
			expect(matchTier(28, HEAT_TIERS)?.score).toBe(8);
		});

		it('危険な高温(40℃) → score=40', () => {
			expect(matchTier(40, HEAT_TIERS)?.score).toBe(40);
		});
	});

	describe('QUAKE_TIERS', () => {
		it('閾値未満(3.4) → null', () => {
			expect(matchTier(3.4, QUAKE_TIERS)).toBeNull();
		});

		it('M3.5ちょうど → score=10', () => {
			expect(matchTier(3.5, QUAKE_TIERS)?.score).toBe(10);
		});

		it('M4.0 → score=20（M3.5より上位）', () => {
			expect(matchTier(4.0, QUAKE_TIERS)?.score).toBe(20);
		});

		it('M5.0 → score=40', () => {
			expect(matchTier(5.0, QUAKE_TIERS)?.score).toBe(40);
		});

		it('reason にマグニチュードを含む', () => {
			expect(matchTier(5.5, QUAKE_TIERS)?.reason(5.5)).toContain('5.5');
		});
	});

	describe('PM25_TIERS', () => {
		it('閾値未満(24μg) → null', () => {
			expect(matchTier(24, PM25_TIERS)).toBeNull();
		});

		it('25μg → score=10', () => {
			expect(matchTier(25, PM25_TIERS)?.score).toBe(10);
		});

		it('100μg → score=40', () => {
			expect(matchTier(100, PM25_TIERS)?.score).toBe(40);
		});
	});

	describe('共通挙動', () => {
		it('空のtiers配列 → null', () => {
			expect(matchTier(999, [])).toBeNull();
		});

		it('値0 → 全tiers でマッチしない（最小閾値>0）', () => {
			expect(matchTier(0, WIND_TIERS)).toBeNull();
			expect(matchTier(0, PRECIPITATION_TIERS)).toBeNull();
		});
	});
});
