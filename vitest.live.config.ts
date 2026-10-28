import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { buildDefines } from './build-defines.ts';

/**
 * 気象庁のコード表がハードコードした内容とズレていないかを、実APIで検証するための設定。
 * ネットワークにアクセスするため通常のテスト（vitest.config.ts）からは除外している。
 * 実行: `npm run verify:jma`
 */
export default defineConfig({
	// buildInfo.ts が参照する。渡さないと「__APP_VERSION__ is not defined」で落ちる
	define: buildDefines(),
	test: {
		environment: 'node',
		globals: true,
		include: ['src/**/*.live.test.ts'],
		testTimeout: 120_000,
	},
	resolve: {
		alias: {
			$lib: resolve(import.meta.dirname, './src/lib'),
		},
	},
});
