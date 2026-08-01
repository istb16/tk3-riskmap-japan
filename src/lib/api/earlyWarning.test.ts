import { describe, it, expect } from 'vitest';
import {
	categoryForPhenomenon,
	resolveEarlyWarnings,
	strongestEarlyWarningFor,
	type EarlyWarningData,
} from './earlyWarning';

describe('categoryForPhenomenon', () => {
	it.each([
		['大雨の警報級の可能性', 'rain'],
		['雨の警報級の可能性', 'rain'],
		['洪水の警報級の可能性', 'rain'],
		['雪の警報級の可能性', 'snow'],
		['波の警報級の可能性', 'coast'],
		['潮位の警報級の可能性', 'coast'],
	] as const)('%s → %s', (type, expected) => {
		expect(categoryForPhenomenon(type)).toBe(expected);
	});

	it('土砂災害は大雨に起因するので雨カテゴリに含める', () => {
		expect(categoryForPhenomenon('土砂災害の警報級の可能性')).toBe('rain');
	});

	it('「風（風雪）」は風と雪の両方を含むが風カテゴリに寄せる', () => {
		expect(categoryForPhenomenon('風（風雪）の警報級の可能性')).toBe('wind');
	});

	it('対応するカテゴリがなければ null', () => {
		expect(categoryForPhenomenon('未知の警報級の可能性')).toBeNull();
	});
});

describe('resolveEarlyWarnings', () => {
	function makePayload(
		areas: Array<{ code: string; props: Array<[string, string[]]> }>,
		wrapInArray = false
	) {
		const block = {
			reportDatetime: '2026-08-01T17:00:00+09:00',
			timeSeries: [
				{
					areas: areas.map((a) => ({
						code: a.code,
						properties: a.props.map(([type, probabilities]) => ({ type, probabilities })),
					})),
				},
			],
		};
		return wrapInArray ? [[block]] : [block];
	}

	it('区域コードごとにカテゴリ別の可能性を返す', () => {
		const result = resolveEarlyWarnings(
			makePayload([{ code: '130010', props: [['大雨の警報級の可能性', ['なし', '中', 'なし']]] }])
		);
		expect(result.get('130010')?.rain).toEqual({ phenomenon: '大雨', probability: '中' });
	});

	it('「なし」「空文字」しかない現象は含めない', () => {
		const result = resolveEarlyWarnings(
			makePayload([
				{
					code: '130010',
					props: [
						['大雨の警報級の可能性', ['', '', '']],
						['雪の警報級の可能性', ['なし', 'なし']],
					],
				},
			])
		);
		expect(result.size).toBe(0);
	});

	it('時系列の全コマのうち最も高い可能性を採用する', () => {
		const result = resolveEarlyWarnings(
			makePayload([{ code: '130010', props: [['大雨の警報級の可能性', ['中', '高', '中']]] }])
		);
		expect(result.get('130010')?.rain?.probability).toBe('高');
	});

	it('同一カテゴリに複数の現象があれば可能性の高い方を採用する', () => {
		// 大雨(中) と 土砂災害(高) はどちらも雨カテゴリ
		const result = resolveEarlyWarnings(
			makePayload([
				{
					code: '030010',
					props: [
						['大雨の警報級の可能性', ['中']],
						['土砂災害の警報級の可能性', ['高']],
					],
				},
			])
		);
		expect(result.get('030010')?.rain).toEqual({ phenomenon: '土砂災害', probability: '高' });
	});

	it('カテゴリが違えば併存する', () => {
		const result = resolveEarlyWarnings(
			makePayload([
				{
					code: '030010',
					props: [
						['大雨の警報級の可能性', ['中']],
						['波の警報級の可能性', ['高']],
					],
				},
			])
		);
		expect(result.get('030010')?.rain?.probability).toBe('中');
		expect(result.get('030010')?.coast?.probability).toBe('高');
	});

	it('外側の配列に配列が入れ子になっていても読める', () => {
		const result = resolveEarlyWarnings(
			makePayload([{ code: '130010', props: [['大雨の警報級の可能性', ['中']]] }], true)
		);
		expect(result.get('130010')?.rain?.probability).toBe('中');
	});

	it('配列でない・空のペイロードでも例外を投げない', () => {
		expect(resolveEarlyWarnings(null).size).toBe(0);
		expect(resolveEarlyWarnings({}).size).toBe(0);
		expect(resolveEarlyWarnings([]).size).toBe(0);
	});
});

describe('strongestEarlyWarningFor', () => {
	const BY_AREA = new Map<string, EarlyWarningData>([
		['130010', { rain: { phenomenon: '大雨', probability: '中' } }],
		['130020', { rain: { phenomenon: '土砂災害', probability: '高' } }],
		['130030', { coast: { phenomenon: '波', probability: '中' } }],
	]);

	it('地域が持つ区域のうち最も高い可能性を採用する', () => {
		const result = strongestEarlyWarningFor(['130010', '130020'], BY_AREA);
		expect(result.rain).toEqual({ phenomenon: '土砂災害', probability: '高' });
	});

	it('順序によらず最強を選ぶ', () => {
		expect(strongestEarlyWarningFor(['130020', '130010'], BY_AREA).rain?.probability).toBe('高');
	});

	it('複数区域のカテゴリをまとめる', () => {
		const result = strongestEarlyWarningFor(['130010', '130030'], BY_AREA);
		expect(result.rain?.probability).toBe('中');
		expect(result.coast?.probability).toBe('中');
	});

	it('該当区域がなければ空', () => {
		expect(strongestEarlyWarningFor(['999999'], BY_AREA)).toEqual({});
		expect(strongestEarlyWarningFor([], BY_AREA)).toEqual({});
	});
});
