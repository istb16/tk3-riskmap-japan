import { describe, it, expect } from 'vitest';
import { formatBuildDate, formatBuildTime, buildLabel, APP_VERSION, BUILD_TIME } from './buildInfo';

describe('formatBuildDate', () => {
	it('JST の YYYY/MM/DD で返す', () => {
		expect(formatBuildDate('2026-08-01T23:15:00.000Z')).toBe('2026/08/02');
	});

	it('0埋めされる', () => {
		expect(formatBuildDate('2026-01-02T00:03:00.000Z')).toBe('2026/01/02');
	});

	// UTC で日付が変わる境界。JST 側の日付が出ないと「昨日のビルド」に見える
	it('UTC の日付ではなく JST の日付を出す', () => {
		expect(formatBuildDate('2026-08-01T15:00:00.000Z')).toBe('2026/08/02');
		expect(formatBuildDate('2026-08-01T14:59:00.000Z')).toBe('2026/08/01');
	});

	it('不正な値でも例外を投げず空文字を返す', () => {
		expect(formatBuildDate('壊れた日付')).toBe('');
	});
});

describe('formatBuildTime', () => {
	// タイムゾーンを JST に固定しているので、UTC の入力は +9 されて出る。
	// ここが環境依存だと「CI でビルドしたら9時間ずれる」が静かに起きる
	it('UTC の ISO を JST に直して返す', () => {
		expect(formatBuildTime('2026-08-01T23:15:00.000Z')).toBe('2026-08-02 08:15');
	});

	it('日付をまたぐ場合も JST 側の日付になる', () => {
		expect(formatBuildTime('2026-08-01T15:00:00.000Z')).toBe('2026-08-02 00:00');
		expect(formatBuildTime('2026-08-01T14:59:00.000Z')).toBe('2026-08-01 23:59');
	});

	it('実行環境のタイムゾーンに依存しない', () => {
		// 同じ瞬間を別表記で渡しても同じ結果になる（＝入力の表記に引きずられない）
		expect(formatBuildTime('2026-01-05T00:00:00.000Z')).toBe('2026-01-05 09:00');
		expect(formatBuildTime('2026-01-05T09:00:00+09:00')).toBe('2026-01-05 09:00');
	});

	it('0埋めされる（月・日・時・分すべて2桁）', () => {
		expect(formatBuildTime('2026-01-02T00:03:00.000Z')).toBe('2026-01-02 09:03');
	});

	// ヘッダーはページ最上部なので、ここで例外を投げると防災情報ごと画面が出なくなる
	it('不正な値でも例外を投げず空文字を返す', () => {
		expect(formatBuildTime('壊れた日付')).toBe('');
		expect(formatBuildTime('')).toBe('');
	});
});

describe('buildLabel', () => {
	it('サイト名の右に添える形（v○○ at 日付）で返す', () => {
		expect(buildLabel('0.1.0', '2026-08-01T23:15:00.000Z')).toBe('(v0.1.0 at 2026/08/02)');
	});

	it('日付が読めないときはバージョンだけ出す', () => {
		expect(buildLabel('0.1.0', '壊れた日付')).toBe('(v0.1.0)');
	});
});

describe('焼き込まれた値', () => {
	it('バージョンは package.json と一致する', async () => {
		const pkg = await import('../../../package.json');
		expect(APP_VERSION).toBe(pkg.version);
	});

	it('ビルド時刻は解釈できる ISO である', () => {
		expect(Number.isNaN(new Date(BUILD_TIME).getTime())).toBe(false);
	});
});
