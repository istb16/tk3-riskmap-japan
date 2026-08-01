import { describe, it, expect } from 'vitest';
import {
	matchTier,
	matchTierBelow,
	maxAlertLevel,
	quakeTimeFactor,
	QUAKE_WINDOW_DAYS,
	volcanoLevelScore,
	riskBand,
	RISK_BANDS,
	WIND_TIERS,
	GUST_TIERS,
	PRECIPITATION_TIERS,
	SNOWFALL_TIERS,
	SNOW_DEPTH_TIERS,
	HEAT_TIERS,
	COLD_TIERS,
	PM25_TIERS,
	QUAKE_SWARM_TIERS,
	SHINDO_SCORES,
	SHINDO_ORDER,
	ALERT_LEVEL_SCORES,
	TSUNAMI_SCORES,
} from './scoringRules';

describe('matchTier', () => {
	describe('WIND_TIERS（平均風速）', () => {
		it('日常的な風(39km/h以下) → null（配点しない）', () => {
			expect(matchTier(39, WIND_TIERS)).toBeNull();
			expect(matchTier(20, WIND_TIERS)).toBeNull();
		});

		it('強風閾値ちょうど(40km/h) → score=4', () => {
			expect(matchTier(40, WIND_TIERS)?.score).toBe(4);
		});

		it('暴風閾値ちょうど(60km/h) → score=12（強風より上位を採用）', () => {
			expect(matchTier(60, WIND_TIERS)?.score).toBe(12);
		});

		it('上限超え(200km/h) → 最上位の score=25', () => {
			expect(matchTier(200, WIND_TIERS)?.score).toBe(25);
		});
	});

	describe('GUST_TIERS（最大瞬間風速）', () => {
		it('平常時の突風(69km/h以下) → null（平均風速より高い閾値を持つ）', () => {
			expect(matchTier(69, GUST_TIERS)).toBeNull();
		});

		it('70km/h → score=4', () => {
			expect(matchTier(70, GUST_TIERS)?.score).toBe(4);
		});

		it('暴風警報相当(120km/h) → score=22', () => {
			expect(matchTier(120, GUST_TIERS)?.score).toBe(22);
		});

		it('平均風速と同じ値でも突風の方が低く評価される（60km/h）', () => {
			// 平均60km/hは暴風=12点だが、突風60km/hは配点なし
			expect(matchTier(60, WIND_TIERS)?.score).toBe(12);
			expect(matchTier(60, GUST_TIERS)).toBeNull();
		});
	});

	describe('PRECIPITATION_TIERS', () => {
		it('小雨(4.9mm/h以下) → null（配点しない）', () => {
			expect(matchTier(4.9, PRECIPITATION_TIERS)).toBeNull();
			expect(matchTier(1, PRECIPITATION_TIERS)).toBeNull();
		});

		it('やや強い雨(5mm/h) → score=2', () => {
			expect(matchTier(5, PRECIPITATION_TIERS)?.score).toBe(2);
		});

		it('猛烈な雨(50mm/h) → score=20', () => {
			expect(matchTier(50, PRECIPITATION_TIERS)?.score).toBe(20);
		});
	});

	describe('SNOWFALL_TIERS（降雪量 cm/h）', () => {
		it('降雪なし(0) → null', () => {
			expect(matchTier(0, SNOWFALL_TIERS)).toBeNull();
		});

		it('1cm/h → score=2', () => {
			expect(matchTier(1, SNOWFALL_TIERS)?.score).toBe(2);
		});

		it('5cm/h → score=16（大雪）', () => {
			const tier = matchTier(5, SNOWFALL_TIERS);
			expect(tier?.score).toBe(16);
			expect(tier?.reason(5)).toContain('大雪');
		});

		it('10cm/h → score=28', () => {
			expect(matchTier(10, SNOWFALL_TIERS)?.score).toBe(28);
		});
	});

	describe('SNOW_DEPTH_TIERS（積雪深 cm）', () => {
		it('19cm → null', () => {
			expect(matchTier(19, SNOW_DEPTH_TIERS)).toBeNull();
		});

		it('20cm → score=1', () => {
			expect(matchTier(20, SNOW_DEPTH_TIERS)?.score).toBe(1);
		});

		it('100cm → score=12（豪雪地帯では日常的な深さ）', () => {
			expect(matchTier(100, SNOW_DEPTH_TIERS)?.score).toBe(12);
		});

		it('200cm → score=22（記録的な積雪）', () => {
			expect(matchTier(200, SNOW_DEPTH_TIERS)?.reason(200)).toContain('記録的');
		});
	});

	describe('HEAT_TIERS（体感温度）', () => {
		it('体感31℃ → null（真夏でも平常なら加点しない）', () => {
			expect(matchTier(31, HEAT_TIERS)).toBeNull();
		});

		it('体感32℃ → score=2', () => {
			expect(matchTier(32, HEAT_TIERS)?.score).toBe(2);
		});

		it('体感40℃ → score=18（熱中症危険域）', () => {
			const tier = matchTier(40, HEAT_TIERS);
			expect(tier?.score).toBe(18);
			expect(tier?.reason(40)).toContain('熱中症危険域');
		});

		it('体感45℃ → score=30', () => {
			expect(matchTier(45, HEAT_TIERS)?.score).toBe(30);
		});

		it('reason に「体感」を明示する', () => {
			expect(matchTier(41, HEAT_TIERS)?.reason(41.2)).toContain('体感41.2');
		});
	});

	describe('PM25_TIERS', () => {
		it('閾値未満(24μg) → null', () => {
			expect(matchTier(24, PM25_TIERS)).toBeNull();
		});

		it('100μg → score=12（健康影響は大きいが即座に死ぬ性質ではない）', () => {
			expect(matchTier(100, PM25_TIERS)?.score).toBe(12);
		});
	});

	describe('QUAKE_SWARM_TIERS（7日間の観測回数）', () => {
		it('平常時(4回) → null', () => {
			expect(matchTier(4, QUAKE_SWARM_TIERS)).toBeNull();
		});

		it('5回 → score=1', () => {
			expect(matchTier(5, QUAKE_SWARM_TIERS)?.score).toBe(1);
		});

		it('30回 → score=5', () => {
			expect(matchTier(30, QUAKE_SWARM_TIERS)?.score).toBe(5);
		});

		it('338回（実データの最大級） → score=8', () => {
			expect(matchTier(338, QUAKE_SWARM_TIERS)?.score).toBe(8);
		});
	});

	describe('共通挙動', () => {
		it('空のtiers配列 → null', () => {
			expect(matchTier(999, [])).toBeNull();
		});
	});
});

describe('matchTierBelow（COLD_TIERS）', () => {
	it('体感4℃ → null', () => {
		expect(matchTierBelow(4, COLD_TIERS)).toBeNull();
	});

	it('体感1℃ → null（冷え込みは配点しない）', () => {
		expect(matchTierBelow(1, COLD_TIERS)).toBeNull();
	});

	it('体感0℃ → score=2（氷点下）', () => {
		expect(matchTierBelow(0, COLD_TIERS)?.score).toBe(2);
	});

	it('体感-10℃ → score=12', () => {
		expect(matchTierBelow(-10, COLD_TIERS)?.score).toBe(12);
	});

	it('体感-30℃ → 最下位段階の score=20', () => {
		expect(matchTierBelow(-30, COLD_TIERS)?.score).toBe(20);
	});

	it('空のtiers配列 → null', () => {
		expect(matchTierBelow(-100, [])).toBeNull();
	});
});

describe('riskBand（スコアの帯）', () => {
	it.each([
		[0, '平穏'],
		[9, '平穏'],
		[10, '注意'],
		[29, '注意'],
		[30, '警戒'],
		[49, '警戒'],
		[50, '危険'],
		[100, '危険'],
	])('スコア%i → %s', (score, label) => {
		expect(riskBand(score).label).toBe(label);
	});

	it('帯の境界が気象庁の警戒レベルに対応している', () => {
		// 注意報10点=レベル2 / 警報30点=レベル3 / 危険警報50点=レベル4
		expect(riskBand(ALERT_LEVEL_SCORES.advisory).label).toBe('注意');
		expect(riskBand(ALERT_LEVEL_SCORES.warning).label).toBe('警戒');
		expect(riskBand(ALERT_LEVEL_SCORES.danger).label).toBe('危険');
		expect(riskBand(ALERT_LEVEL_SCORES.special).label).toBe('危険');
	});

	it('日常的な悪条件では「平穏」のまま', () => {
		// 体感32℃(2点) + 積雪20cm(1点) + PM2.5 25μg(2点) 程度では帯は上がらない
		expect(riskBand(5).label).toBe('平穏');
	});

	it('震度4は「平穏」、震度5弱で「注意」、震度5強で「警戒」、震度6弱で「危険」', () => {
		expect(riskBand(SHINDO_SCORES['4']).label).toBe('平穏');
		expect(riskBand(SHINDO_SCORES['5-']).label).toBe('注意');
		expect(riskBand(SHINDO_SCORES['5+']).label).toBe('警戒');
		expect(riskBand(SHINDO_SCORES['6-']).label).toBe('危険');
	});
});

describe('地図マーカーのサイズ', () => {
	it('危険度が上がるほど大きくなる', () => {
		const sizes = [...RISK_BANDS].reverse().map((b) => b.markerSizePx);
		for (let i = 1; i < sizes.length; i++) {
			expect(sizes[i]).toBeGreaterThan(sizes[i - 1]);
		}
	});

	it('文字サイズも危険度に応じて大きくなる', () => {
		const fonts = [...RISK_BANDS].reverse().map((b) => b.markerFontPx);
		for (let i = 1; i < fonts.length; i++) {
			expect(fonts[i]).toBeGreaterThanOrEqual(fonts[i - 1]);
		}
	});

	it('最大は現在の40pxから大きく離れない（48px以下）', () => {
		expect(Math.max(...RISK_BANDS.map((b) => b.markerSizePx))).toBeLessThanOrEqual(48);
	});

	it('最小でもその帯に出る桁数の数字が収まる', () => {
		// 等幅フォントの1文字幅は約0.6em。内径 = サイズ - 枠線2px×2
		const digitsFor = (band: (typeof RISK_BANDS)[number]) =>
			band.min >= 100 ? 3 : band.min >= 10 ? 2 : 1;
		for (const band of RISK_BANDS) {
			// その帯に入りうる最大スコアの桁数（最上位帯だけ100=3桁がありうる）
			const maxDigits = band.colorVar === '--danger' ? 3 : digitsFor(band);
			const textWidth = maxDigits * band.markerFontPx * 0.6;
			const innerDiameter = band.markerSizePx - 4;
			expect(textWidth).toBeLessThan(innerDiameter);
		}
	});

	it('隣り合う帯のサイズ差が判別できる（1.15倍以上）', () => {
		const sizes = [...RISK_BANDS].reverse().map((b) => b.markerSizePx);
		for (let i = 1; i < sizes.length; i++) {
			expect(sizes[i] / sizes[i - 1]).toBeGreaterThan(1.15);
		}
	});
});

describe('ALERT_LEVEL_SCORES', () => {
	it('早期注意情報=5 / 注意報=10 / 警報=30 / 危険警報=50 / 特別警報=70', () => {
		expect(ALERT_LEVEL_SCORES.none).toBe(0);
		expect(ALERT_LEVEL_SCORES.early).toBe(5);
		expect(ALERT_LEVEL_SCORES.advisory).toBe(10);
		expect(ALERT_LEVEL_SCORES.warning).toBe(30);
		expect(ALERT_LEVEL_SCORES.danger).toBe(50);
		expect(ALERT_LEVEL_SCORES.special).toBe(70);
	});

	it('レベルが上がるとスコアも単調増加する', () => {
		const order = ['none', 'early', 'advisory', 'warning', 'danger', 'special'] as const;
		for (let i = 1; i < order.length; i++) {
			expect(ALERT_LEVEL_SCORES[order[i]]).toBeGreaterThan(ALERT_LEVEL_SCORES[order[i - 1]]);
		}
	});
});

describe('maxAlertLevel', () => {
	it('warning と advisory → warning', () => {
		expect(maxAlertLevel('warning', 'advisory')).toBe('warning');
	});

	it('danger は warning より強く special より弱い', () => {
		expect(maxAlertLevel('danger', 'warning')).toBe('danger');
		expect(maxAlertLevel('danger', 'special')).toBe('special');
	});

	it('none と early → early', () => {
		expect(maxAlertLevel('none', 'early')).toBe('early');
	});

	it('special が最強', () => {
		expect(maxAlertLevel('special', 'warning')).toBe('special');
		expect(maxAlertLevel('advisory', 'special')).toBe('special');
	});

	it('同レベルならそのレベル', () => {
		expect(maxAlertLevel('advisory', 'advisory')).toBe('advisory');
	});
});

describe('SHINDO_SCORES', () => {
	it('震度7=90（避難できなければ死者が出る規模）', () => {
		expect(SHINDO_SCORES['7']).toBe(90);
	});

	it('人的被害がほぼ生じない震度3・4は極めて低い', () => {
		expect(SHINDO_SCORES['3']).toBe(4);
		expect(SHINDO_SCORES['4']).toBe(9);
	});

	it('建物被害が出はじめる震度5強以上で大きく跳ね上がる', () => {
		expect(SHINDO_SCORES['5+']).toBe(35);
		expect(SHINDO_SCORES['6-']).toBe(55);
		expect(SHINDO_SCORES['6+']).toBe(75);
	});

	it('震度が上がるとスコアも単調増加する', () => {
		const scores = SHINDO_ORDER.map((s) => SHINDO_SCORES[s]);
		for (let i = 1; i < scores.length; i++) {
			expect(scores[i]).toBeGreaterThan(scores[i - 1]);
		}
	});

	it('5弱と5強、6弱と6強が区別される', () => {
		expect(SHINDO_SCORES['5-']).toBeLessThan(SHINDO_SCORES['5+']);
		expect(SHINDO_SCORES['6-']).toBeLessThan(SHINDO_SCORES['6+']);
	});
});

describe('quakeTimeFactor（余震ハザードの時間減衰）', () => {
	it('発生直後(0日) → 1.0', () => {
		expect(quakeTimeFactor(0)).toBe(1.0);
	});

	it('負の経過日数（時刻ずれ）でも 1.0 に丸める', () => {
		expect(quakeTimeFactor(-1)).toBe(1.0);
	});

	it('評価期間の終端(14日)で0になる', () => {
		expect(quakeTimeFactor(QUAKE_WINDOW_DAYS)).toBe(0);
		expect(quakeTimeFactor(30)).toBe(0);
		expect(quakeTimeFactor(100)).toBe(0);
	});

	it('最初の3日間は高い水準を保つ（余震が集中する期間）', () => {
		expect(quakeTimeFactor(1)).toBeGreaterThan(0.7);
		expect(quakeTimeFactor(2)).toBeGreaterThan(0.6);
		expect(quakeTimeFactor(3)).toBeGreaterThan(0.45);
	});

	it('1週間後もまだ危険が残っている（0にならない）', () => {
		// 気象庁は「1週間程度は同規模の地震に注意」と案内している
		expect(quakeTimeFactor(7)).toBeGreaterThan(0.15);
		expect(quakeTimeFactor(7)).toBeLessThan(0.3);
	});

	it('2週目に入ると大きく下がる', () => {
		expect(quakeTimeFactor(10)).toBeLessThan(0.15);
		expect(quakeTimeFactor(12)).toBeLessThan(0.06);
	});

	it('大森・宇津の法則どおり最初が急で長い尾を引く（直線減衰ではない）', () => {
		// 前半3日の落ち込みが、同じ長さの後半（3〜6日）より大きい
		const dropEarly = quakeTimeFactor(0) - quakeTimeFactor(3);
		const dropLate = quakeTimeFactor(3) - quakeTimeFactor(6);
		expect(dropEarly).toBeGreaterThan(dropLate);
	});

	it('経過に対して単調減少する', () => {
		let prev = Infinity;
		for (let d = 0; d <= 16; d += 0.25) {
			const f = quakeTimeFactor(d);
			expect(f).toBeLessThanOrEqual(prev);
			prev = f;
		}
	});

	it('震度7が「危険」帯に留まるのは4日程度まで', () => {
		// 90点 × 係数。50点（避難が必要）を下回るのがいつか
		const scoreAt = (d: number) => SHINDO_SCORES['7'] * quakeTimeFactor(d);
		expect(scoreAt(3)).toBeGreaterThanOrEqual(40);
		expect(scoreAt(7)).toBeGreaterThan(15);
		expect(scoreAt(13)).toBeLessThan(5);
	});
});

describe('TSUNAMI_SCORES', () => {
	it('予報2 / 注意報25 / 警報75 / 大津波警報95', () => {
		expect(TSUNAMI_SCORES.none).toBe(0);
		expect(TSUNAMI_SCORES.forecast).toBe(2);
		expect(TSUNAMI_SCORES.advisory).toBe(25);
		expect(TSUNAMI_SCORES.warning).toBe(75);
		expect(TSUNAMI_SCORES.major).toBe(95);
	});

	it('大津波警報が全指標中で最も高い（基準に最も近い事象）', () => {
		expect(TSUNAMI_SCORES.major).toBeGreaterThan(SHINDO_SCORES['7']);
		expect(TSUNAMI_SCORES.major).toBeGreaterThan(ALERT_LEVEL_SCORES.special);
	});
});

describe('volcanoLevelScore', () => {
	it('レベル1〜5 → 1/6/20/55/85', () => {
		expect(volcanoLevelScore(1)).toBe(1);
		expect(volcanoLevelScore(2)).toBe(6);
		expect(volcanoLevelScore(3)).toBe(20);
		expect(volcanoLevelScore(4)).toBe(55);
		expect(volcanoLevelScore(5)).toBe(85);
	});

	it('居住地域に影響が及ぶレベル4以上で大きく跳ね上がる', () => {
		// レベル3までは火口周辺・登山者への規制で、住民の生命は脅かされていない
		expect(volcanoLevelScore(4) - volcanoLevelScore(3)).toBeGreaterThan(30);
	});

	it('範囲外は0', () => {
		expect(volcanoLevelScore(0)).toBe(0);
		expect(volcanoLevelScore(6)).toBe(0);
	});
});
