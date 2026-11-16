import { beforeAll, describe, expect, it } from 'vitest';
import {
	boxesNear,
	loadRouter,
	ROUTE,
	routeLines,
	routeMemo,
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

describe('boxesNear', () => {
	const at = (x0: number, x1: number, y: number, on?: string) => ({
		on,
		x0,
		x1,
		y,
		sides: ['l', 'r'] as const
	});
	const line = (s: ReturnType<typeof at>, t: ReturnType<typeof at>) => ({ id: 'x', s, t });

	it('keeps the boxes round the ends and those meeting them, and drops the far ones', () => {
		const boxes = new Map([
			['a', rect(0, 0, 100, 60)],
			['b', rect(300, 0, 100, 60)],
			// Meets the rectangle round the ends.
			['tall', rect(150, 60 + ROUTE.room - 1, 100, 400)],
			// Meets it only once it has grown round `tall`.
			['below', rect(150, 60 + 2 * ROUTE.room + 400 - 2, 100, 60)],
			['far', rect(5000, 5000, 100, 60)]
		]);
		const near = boxesNear(boxes, [line(at(0, 100, 30, 'a'), at(300, 400, 30, 'b'))]);
		expect([...near.keys()].sort()).toEqual(['a', 'b', 'below', 'tall']);
	});

	it('keeps the boxes round a free end', () => {
		const boxes = new Map([
			['a', rect(0, 0, 100, 60)],
			['x', rect(1000, 0, 100, 60)],
			['far', rect(1000, 1000, 100, 60)]
		]);
		const near = boxesNear(boxes, [line(at(0, 100, 30, 'a'), at(1000, 1100, 30))]);
		expect([...near.keys()].sort()).toEqual(['a', 'x']);
	});

	it('is empty without lines', () => {
		expect(boxesNear(new Map([['a', rect(0, 0, 10, 10)]]), []).size).toBe(0);
	});

	it('leaves routes round the boxes near them as they are', () => {
		const near = new Map([
			['a', rect(0, 0, 100, 60)],
			['mid', rect(150, -20, 100, 120)],
			['b', rect(300, 0, 100, 60)]
		]);
		const far = Array.from({ length: 40 }, (_, i) => ['f' + i, rect(2000 + i * 150, 0, 100, 60)]);
		const lines = [line(at(0, 100, 30, 'a'), at(300, 400, 40, 'b'))];
		const all = new Map([...near, ...(far as [string, Rect][])]);
		expect(boxesNear(all, lines)).toEqual(near);
		const pts = routeLines(all, lines).get('x')!;
		expect(pts.length).toBeGreaterThan(2);
		expect(routeLines(near, lines)).toEqual(routeLines(all, lines));
	});
});

describe('routeMemo', () => {
	const boxes = new Map([
		['a', rect(0, 0, 100, 60)],
		['b', rect(300, 0, 100, 60)]
	]);
	const lines = [
		{
			id: 'x',
			s: { on: 'a', x0: 0, x1: 100, y: 30, sides: ['l', 'r'] as const },
			t: { on: 'b', x0: 300, x1: 400, y: 30, sides: ['l', 'r'] as const }
		}
	];

	it('gives the same routes again for the same lines among the same boxes', () => {
		const route = routeMemo(2);
		const first = route(boxes, lines);
		expect(route(boxes, structuredClone(lines))).toBe(first);
		expect(first).toEqual(routeLines(boxes, lines));
	});

	it('routes again among other boxes, or once it has forgotten', () => {
		const route = routeMemo(1);
		const first = route(boxes, lines);
		expect(route(new Map(boxes), lines)).not.toBe(first);
		const again = route(boxes, lines);
		route(boxes, [{ ...lines[0], id: 'y' }]);
		expect(route(boxes, lines)).not.toBe(again);
	});
});
