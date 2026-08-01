import { describe, it, expect } from 'vitest';
import { parsePinned, serializePinned, PINNED_STORAGE_KEY } from './pinnedStorage';

const VALID = new Set(['tokyo', 'kumamoto', 'hokkaido-kushiro']);

describe('parsePinned', () => {
	it('未保存（null）なら空配列', () => {
		expect(parsePinned(null, VALID)).toEqual([]);
	});

	it('IDの配列をそのまま読む', () => {
		expect(parsePinned('["tokyo","kumamoto"]', VALID)).toEqual(['tokyo', 'kumamoto']);
	});

	it('入力の順序を保つ', () => {
		expect(parsePinned('["kumamoto","tokyo"]', VALID)).toEqual(['kumamoto', 'tokyo']);
	});

	// 読むときに捨てるだけで、保存値は書き換えない（別タブの古いバンドルがピンを消さないため）。
	// このモジュールは純関数なので副作用が無いこと自体が保証だが、
	// 「掃除した結果を書き戻す」実装に戻す誘惑があるので意図を残す
	it('掃除しても元の文字列を書き換える手段を持たない（純関数）', () => {
		const raw = '["hokkaido","tokyo"]';
		expect(parsePinned(raw, VALID)).toEqual(['tokyo']);
		expect(raw).toBe('["hokkaido","tokyo"]');
	});

	// 地域構成の変更でIDは消えうる（hokkaido は8地域へ分割された）
	it('存在しないIDは捨てる', () => {
		expect(parsePinned('["tokyo","hokkaido","osaka-old"]', VALID)).toEqual(['tokyo']);
	});

	it('重複は1つにまとめる', () => {
		expect(parsePinned('["tokyo","tokyo","kumamoto"]', VALID)).toEqual(['tokyo', 'kumamoto']);
	});

	// 以下はすべて「例外を投げずに空を返す」ことが要件。
	// 初期描画で走るコードなので、壊れた保存値でページを落としてはいけない。
	it('JSONとして壊れていても投げずに空を返す', () => {
		expect(parsePinned('{壊れた', VALID)).toEqual([]);
		expect(parsePinned('', VALID)).toEqual([]);
	});

	it('配列でない値は空扱いにする', () => {
		expect(parsePinned('"tokyo"', VALID)).toEqual([]);
		expect(parsePinned('42', VALID)).toEqual([]);
		expect(parsePinned('null', VALID)).toEqual([]);
		expect(parsePinned('{"ids":["tokyo"]}', VALID)).toEqual([]);
	});

	// 文字列以外を捨てることが、バージョン欄を持たない設計の担保でもある ——
	// 将来スキーマをオブジェクトの配列に変えても、古いコードは黙って空扱いにする
	it('文字列でない要素は捨てる（＝将来スキーマを変えても古い形は空になる）', () => {
		expect(parsePinned('["tokyo",1,null,{"id":"kumamoto"},["tokyo"]]', VALID)).toEqual(['tokyo']);
		expect(parsePinned('[{"id":"tokyo","order":0}]', VALID)).toEqual([]);
	});

	it('空配列はそのまま空', () => {
		expect(parsePinned('[]', VALID)).toEqual([]);
	});
});

describe('serializePinned', () => {
	it('配列をJSONにする', () => {
		expect(serializePinned(['tokyo', 'kumamoto'])).toBe('["tokyo","kumamoto"]');
	});

	it('Set も受け取れる', () => {
		expect(serializePinned(new Set(['tokyo']))).toBe('["tokyo"]');
	});

	it('parsePinned と往復できる', () => {
		const ids = ['tokyo', 'hokkaido-kushiro'];
		expect(parsePinned(serializePinned(ids), VALID)).toEqual(ids);
	});
});

describe('保存キー', () => {
	it('アプリ名で名前空間を切っている', () => {
		expect(PINNED_STORAGE_KEY).toBe('riskmap:pinned');
	});
});
