// import attribute と（設定ファイル側の）'.ts' 拡張子は、Vite の configLoader: 'native'
// （将来のメジャーで既定になる予定）が要求する。外すと設定読み込み時に警告が出る。
import pkg from './package.json' with { type: 'json' };

/**
 * ビルド時に焼き込む定数。`vite.config.ts` と vitest の各設定が共有する。
 *
 * テスト側にも同じ `define` を渡さないと、`__APP_VERSION__` を参照した時点で
 * 「is not defined」で落ちる。3か所に書くと必ずどれかが取り残されるのでここに集約する。
 *
 * **このファイル自体はビルド時にしか動かず、クライアントバンドルに入らない。**
 * だから `package.json` を丸ごと import しても公開されるのは `define` に渡した
 * 文字列だけで、devDependencies の一覧が漏れることはない。
 * （アプリ側のコードから import すると中身ごとバンドルされるので、そちらでは禁止。）
 *
 * 日時は ISO（UTC）で焼き込み、表示側で JST に整える
 * （ビルド時に整形すると CI＝UTC とローカルで表示がずれる）。
 */
export function buildDefines(): Record<string, string> {
	return {
		__APP_VERSION__: JSON.stringify(pkg.version),
		__BUILD_TIME__: JSON.stringify(new Date().toISOString()),
	};
}
