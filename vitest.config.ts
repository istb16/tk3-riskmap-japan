import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		// 外部リソースを要するテストは通常実行から外す。
		// *.live.test.ts   … ネットワークにアクセスする（npm run verify:jma）
		// *.browser.test.ts … Chromium のバイナリを要する（npm run test:browser）
		exclude: [...configDefaults.exclude, '**/*.live.test.ts', '**/*.browser.test.ts'],
		coverage: {
			provider: 'v8',
			include: ['src/lib/**/*.ts'],
			exclude: ['src/lib/index.ts', 'src/lib/assets/**'],
			reporter: ['text', 'html'],
		},
	},
	resolve: {
		alias: {
			$lib: resolve(__dirname, './src/lib'),
		},
	},
});
