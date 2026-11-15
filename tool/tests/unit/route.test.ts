import { beforeAll, describe, expect, it } from 'vitest';
import { loadRouter, routeLines, type Point, type Rect } from '../../src/lib/landscape/route';

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

	it('spreads lines running side by side', () => {
		const r = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: end('b') },
			{ id: 'y', s: end('a'), t: end('b') }
		]);
		const across = (pts: Point[]) => pts.find((p, i) => i && p.y === pts[i - 1].y && p.y < 0)!.y;
		expect(Math.abs(across(r.get('x')!) - across(r.get('y')!))).toBeGreaterThanOrEqual(4);
	});

	it('ends a free end on the side asked', () => {
		const pts = routeLines(boxes, [
			{ id: 'x', s: end('a'), t: { x0: 500, x1: 600, y: 30, sides: ['l'] } }
		]).get('x')!;
		expect(pts.at(-1)).toEqual({ x: 500, y: 30 });
	});
});
