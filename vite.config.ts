import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';
import { buildDefines } from './build-defines';

export default defineConfig({
	// ヘッダーに出すバージョンとビルド日時（どのデプロイが公開されているかの判別用）
	define: buildDefines(),
	plugins: [
		sveltekit({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
			},
			adapter: adapter({
				pages: 'build',
				assets: 'build',
				fallback: 'index.html',
				precompress: false,
				strict: false,
			}),
		}),
	],
});
