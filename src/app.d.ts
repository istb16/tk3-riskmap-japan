// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
	namespace App {
		// interface Error {}
		// interface Locals {}
		// interface PageData {}
		// interface PageState {}
		// interface Platform {}
	}

	/** package.json の version。`vite.config.ts` の define で焼き込む。 */
	const __APP_VERSION__: string;
	/** ビルド時刻（ISO・UTC）。`vite.config.ts` の define で焼き込む。 */
	const __BUILD_TIME__: string;
}

export {};
