import { describe, it, expect } from 'vitest';
import { render } from 'vitest-browser-svelte';
import PinIcon from './PinIcon.svelte';

/**
 * PinIcon の二状態が**実際に描画された結果として**区別できるかを見る。
 *
 * ここをブラウザモードで書く理由は `getComputedStyle` —— 未ピン/ピン済みの差は
 * `fill: none` / `fill: currentColor` という CSS の解決結果でしか表れず、
 * 属性を読むだけでは確認できない。
 * 「アイコンが2状態を描き分けられていること」はこの機能の中核なので、
 * それを静かに失わないための防波堤にする。
 */
describe('PinIcon', () => {
	const svgOf = (container: HTMLElement): SVGElement => {
		const svg = container.querySelector('svg');
		if (svg === null) throw new Error('svg が描画されていない');
		return svg;
	};
	const pathStyle = (container: HTMLElement) => {
		const path = container.querySelector('svg path');
		if (path === null) throw new Error('path が描画されていない');
		return getComputedStyle(path);
	};

	it('未ピンは塗らずに輪郭だけを描く', async () => {
		const { container } = await render(PinIcon, { props: { filled: false } });
		const style = pathStyle(container);
		expect(style.fill).toBe('none');
		// 輪郭は currentColor を解決した実際の色になる（none ではない）
		expect(style.stroke).not.toBe('none');
	});

	it('ピン済みは塗る', async () => {
		const { container } = await render(PinIcon, { props: { filled: true } });
		expect(pathStyle(container).fill).not.toBe('none');
	});

	// 単色（currentColor）であることがこの機能の要。危険度の4色と競合させないため、
	// 親の color をそのまま拾うことを確認する
	it('色は親の color を継承する（単色アイコン）', async () => {
		const { container } = await render(PinIcon, { props: { filled: true } });
		container.style.color = 'rgb(1, 2, 3)';
		expect(pathStyle(container).fill).toBe('rgb(1, 2, 3)');
	});

	it('size で実寸が変わる（行は18px・詳細パネルは14px）', async () => {
		const big = await render(PinIcon, { props: { filled: false, size: 18 } });
		const small = await render(PinIcon, { props: { filled: false, size: 14 } });
		expect(Math.round(svgOf(big.container).getBoundingClientRect().width)).toBe(18);
		expect(Math.round(svgOf(small.container).getBoundingClientRect().width)).toBe(14);
	});

	/**
	 * viewBox が 76 単位なので、`vector-effect: non-scaling-stroke` が無いと
	 * size を変えたときに線の太さまで一緒に変わってしまう。
	 * 18px と 14px で線幅が同じであることをここで担保する。
	 */
	it('size を変えても輪郭の線幅は変わらない', async () => {
		const big = await render(PinIcon, { props: { filled: false, size: 18 } });
		const small = await render(PinIcon, { props: { filled: false, size: 14 } });
		expect(pathStyle(small.container).strokeWidth).toBe(pathStyle(big.container).strokeWidth);
		expect(pathStyle(big.container).vectorEffect).toBe('non-scaling-stroke');
	});

	it('装飾なので支援技術からは隠す', async () => {
		const { container } = await render(PinIcon, { props: { filled: false } });
		expect(svgOf(container).getAttribute('aria-hidden')).toBe('true');
		// フォーカス可能にしてはいけない（ボタンの中に入るため）
		expect(svgOf(container).getAttribute('focusable')).toBe('false');
	});
});
