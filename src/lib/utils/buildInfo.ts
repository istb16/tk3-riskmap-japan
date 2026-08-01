/**
 * ビルド情報。**どのデプロイが公開されているか**を画面から判別するために使う。
 *
 * 値は `vite.config.ts` の `define` でビルド時に焼き込まれる
 * （`__APP_VERSION__` / `__BUILD_TIME__`）。実行時に取得するものではない。
 *
 * **バージョン番号だけでは足りない。** `package.json` の version は手で上げない限り
 * 変わらないので、連続してデプロイしても表示が同じままになり
 * 「反映されたか」の判定に使えない。日時が実際に答えを出す情報。
 */

/** `package.json` の version（例: `0.1.0`）。 */
export const APP_VERSION: string = __APP_VERSION__;

/** ビルド時刻（ISO・UTC）。 */
export const BUILD_TIME: string = __BUILD_TIME__;

/**
 * ISO を JST の日付・時刻の部品に分解する。
 *
 * **タイムゾーンを固定するのが要点。** ビルド時に整形すると CI（UTC）とローカルで
 * ずれるので ISO で焼き込み、表示側で JST に寄せる。閲覧者の端末の時計にも依存させない
 * —— これは「いつビルドしたか」という開発側の事実であって、閲覧者の現地時刻ではない。
 *
 * 不正な値では `null` を返す。**ヘッダーはページ最上部なので、ここで例外を投げると
 * 防災情報ごと画面が出なくなる。**
 */
function jstParts(iso: string): { y: string; m: string; d: string; hh: string; mm: string } | null {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return null;

	const parts = new Intl.DateTimeFormat('ja-JP', {
		timeZone: 'Asia/Tokyo',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	}).formatToParts(date);

	const at = (type: Intl.DateTimeFormatPartTypes) =>
		parts.find((p) => p.type === type)?.value ?? '';
	return {
		y: at('year'),
		m: at('month'),
		d: at('day'),
		// 24時が 24:00 と出る環境があるので 00 に寄せる
		hh: at('hour') === '24' ? '00' : at('hour'),
		mm: at('minute'),
	};
}

/** ビルド日を JST の `YYYY/MM/DD` に整える（ヘッダー表示用）。 */
export function formatBuildDate(iso: string): string {
	const p = jstParts(iso);
	return p === null ? '' : `${p.y}/${p.m}/${p.d}`;
}

/** ビルド時刻を JST の `YYYY-MM-DD HH:mm` に整える（ツールチップ用・分まで出す）。 */
export function formatBuildTime(iso: string): string {
	const p = jstParts(iso);
	return p === null ? '' : `${p.y}-${p.m}-${p.d} ${p.hh}:${p.mm}`;
}

/**
 * サイト名の右に添える文字列（例: `(v0.1.0 at 2026/08/02)`）。
 *
 * バージョンはコミットごとにパッチを上げる運用なので、これがデプロイの識別子になる
 * （CLAUDE.md「コミット時の制限」参照）。日付はいつのビルドかの目印。
 */
export function buildLabel(version: string = APP_VERSION, iso: string = BUILD_TIME): string {
	const date = formatBuildDate(iso);
	return date === '' ? `(v${version})` : `(v${version} at ${date})`;
}
