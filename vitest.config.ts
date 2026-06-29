import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
	test: {
		environment: 'node',
		globals: true,
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
