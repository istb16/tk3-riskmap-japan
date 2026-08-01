import { defineConfig, configDefaults } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
		// *.live.test.ts はネットワークにアクセスするため通常実行から除外する（npm run verify:jma で実行）
		exclude: [...configDefaults.exclude, '**/*.live.test.ts'],
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
