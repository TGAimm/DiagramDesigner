import { beforeAll, describe, expect, it } from 'vitest';
import {
	loadRouter,
	ROUTE,
	routeLines,
	type Point,
	type Rect
} from '../../src/lib/landscape/route';

beforeAll(() => loadRouter());

const rect = (x0: number, y0: number, w: number, h: number): Rect => ({
	x0,
	y0,
	x1: x0 + w,
	y1: y0 + h
});
/** Whether a segment runs through a box. */
const hits = (a: Point, b: Point, r: Rect) =>
	Math.max(a.x, b.x) > r.x0 &&
	Math.min(a.x, b.x) < r.x1 &&
	Math.max(a.y, b.y) > r.y0 &&
	Math.min(a.y, b.y) < r.y1;

describe('routeLines', () => {
	const boxes = new Map([
		['a', rect(0, 0, 100, 60)],
		['mid', rect(150, -20, 100, 120)],
		['b', rect(300, 0, 100, 60)]
	]);
	const end = (on: string) => {
		const r = boxes.get(on)!;
		return { on, x0: r.x0, x1: r.x1, y: 30, sides: ['l', 'r'] as const };
	};

	it('runs right-angled from facing sides round the box between', () => {
		const pts = routeLines(boxes, [{ id: 'x', s: end('a'), t: end('b') }]).get('x')!;
		expect(pts[0]).toEqual({ x: 100, y: 30 });
		expect(pts.at(-1)).toEqual({ x: 300, y: 30 });
		for (let i = 1; i < pts.length; i++) {
			const [p, q] = [pts[i - 1], pts[i]];
			expect(p.x === q.x || p.y === q.y).toBe(true);
			expect(hits(p, q, boxes.get('mid')!)).toBe(false);
		}
	});

	it('ends a line on its rows when they sit at different heights', () => {
		// Facing cards with a narrow gap: the line must step between the rows, not be slid
		// along the cards' sides into one straight run that ends on neither row.
		const cards = new Map([
			['t', rect(300, 150, 93, 130)],
			['s', rect(441, 200, 259, 600)]
		]);
		const pts = routeLines(cards, [
			{
				id: 'x',
				s: { on: 's', x0: 441, x1: 700, y: 443, sides: ['l', 'r'] },
				t: { on: 't', x0: 300, x1: 393, y: 244, sides: ['l', 'r'] }
			}
		]).get('x')!;
		expect(pts[0]).toEqual({ x: 441, y: 443 });
		expect(pts.at(-1)).toEqual({ x: 393, y: 244 });
	});

	it('spreads lines running side by side', () => {
		const r = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: end('b') },
			{ id: 'y', s: end('a'), t: end('b') }
		]);
		const across = (pts: Point[]) => pts.find((p, i) => i && p.y === pts[i - 1].y && p.y < 0)!.y;
		expect(Math.abs(across(r.get('x')!) - across(r.get('y')!))).toBeGreaterThanOrEqual(4);
	});

	it('runs a pair joining two ends both ways side by side, not on itself', () => {
		const r = routeLines(
			new Map([
				['a', boxes.get('a')!],
				['b', boxes.get('b')!]
			]),
			[
				{ id: 'x', s: end('a'), t: end('b') },
				{ id: 'y', s: end('b'), t: end('a') }
			]
		);
		const [x, y] = [r.get('x')!, r.get('y')!];
		expect(Math.abs(x[0].y - y.at(-1)!.y)).toBeGreaterThanOrEqual(ROUTE.spread);
		expect(Math.abs(x.at(-1)!.y - y[0].y)).toBeGreaterThanOrEqual(ROUTE.spread);
	});

	it('runs lines leaving one end as one there when asked', () => {
		const lines = [
			{ id: 'x', s: end('a'), t: end('b') },
			{ id: 'y', s: end('a'), t: end('b') }
		];
		const gapAt = (r: Map<string, Point[]>) => Math.abs(r.get('x')![1].y - r.get('y')![1].y);
		expect(gapAt(routeLines(boxes, lines, true))).toBe(0);
	});

	it('ends a free end on the side asked', () => {
		const pts = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: { x0: 500, x1: 600, y: 30, sides: ['l'] } }
		]).get('x')!;
		expect(pts.at(-1)).toEqual({ x: 500, y: 30 });
	});
});
