// static/ogp.svg から static/ogp.png（1200×630）を書き出す。
// SNS は og:image の SVG を表示しないので、PNG を書き出してコミットする（ビルドでは作らない）。
// 日本語の書体は手元の環境のものを使うため、書き出したら PNG を目で見て確かめる。
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const svgUrl = new URL('../static/ogp.svg', import.meta.url);
const pngPath = new URL('../static/ogp.png', import.meta.url);
const svg = await readFile(svgUrl, 'utf8');

const browser = await chromium.launch();
try {
	const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
	await page.setContent(
		`<!doctype html><style>html,body{margin:0}svg{display:block}</style>${svg}`
	);
	await page.evaluate(() => document.fonts.ready);
	await page.screenshot({ path: fileURLToPath(pngPath) });
} finally {
	await browser.close();
}
