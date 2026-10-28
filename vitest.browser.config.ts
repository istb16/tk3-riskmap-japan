import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { playwright } from '@vitest/browser-playwright';
import { buildDefines } from './build-defines.ts';

/**
 * ブラウザモードのテスト（`*.browser.test.ts`）。
 *
 * 通常の `npm test` から分離しているのは、実行に Chromium のバイナリが必要なため
 * （`npx playwright install chromium` が済んでいない環境では走らない）。
 * ネットワークを必要とする `*.live.test.ts` を `vitest.live.config.ts` に切り出しているのと
 * 同じ理由・同じ構造。`npm run test:browser` で実行する。
 *
 * ここに置くのは**本物のブラウザでしか確かめられないこと**に限る:
 * - `document.activeElement`（フォーカスがどこへ移るか）
 * - `localStorage` を跨いだ再マウントでの復元
 * - `getComputedStyle` の解決結果（CSSカスタムプロパティの継承・実際の行の高さ）
 * - 実際のクリック・キーボード操作
 *
 * 純粋なロジックは node 側（`npm test`）で書く。こちらは起動が重いので、
 * jsdom でも書けるアサーションを持ち込まない。
 */
export default defineConfig({
	// ヘッダーが参照する。渡さないと +page.svelte の描画時点で落ちる
	define: buildDefines(),
	// runes は vite.config.ts の sveltekit() と同じ設定にする ——
	// アプリと違うコンパイラ設定でテストしても意味がない
	plugins: [
		svelte({
			compilerOptions: {
				runes: ({ filename }) =>
					filename.split(/[/\\]/).includes('node_modules') ? undefined : true,
			},
		}),
	],
	test: {
		include: ['src/**/*.browser.test.ts'],
		globals: true,
		browser: {
			enabled: true,
			provider: playwright(),
			headless: true,
			screenshotFailures: false,
			instances: [{ browser: 'chromium' }],
		},
	},
	resolve: {
		// ブラウザモードでは Svelte のブラウザ向けエントリを使わせる
		conditions: ['browser'],
	},
});
