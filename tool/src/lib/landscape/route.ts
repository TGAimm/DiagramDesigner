import { AvoidLib } from 'libavoid-js';

/**
 * Lines routed by libavoid: right-angled, round every box in the way, and lines running side
 * by side spread apart. libavoid is WebAssembly, so it is loaded once before any routing.
 */

export interface Rect {
	x0: number;
	y0: number;
	x1: number;
	y1: number;
}

export type Side = 'l' | 'r';

/**
 * One end of a line, at height `y`. On a box lines go round (`on`), it leaves by whichever
 * of `sides` routes best; else it is a free point on side `sides[0]` of `x0`…`x1`.
 */
export interface RouteEnd {
	on?: string;
	x0: number;
	x1: number;
	y: number;
	sides: readonly Side[];
}

export interface RouteLine {
	id: string;
	s: RouteEnd;
	t: RouteEnd;
}

export type Point = { x: number; y: number };

/** Room kept between a line and a box, and between lines side by side, in canvas px. */
export const ROUTE = { buffer: 8, spread: 8 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an Emscripten binding
let avoid: any;

/** Loads libavoid; from `wasmUrl` in a page, from the package next to it in Node. */
export async function loadRouter(wasmUrl?: string) {
	if (avoid) return;
	await AvoidLib.load(wasmUrl);
	avoid = AvoidLib.getInstance();
}

export const routerReady = () => !!avoid;

/** Each line's corners, start and end included, by line id. Lines round `boxes` by id. */
export function routeLines(boxes: Map<string, Rect>, lines: RouteLine[]): Map<string, Point[]> {
	const A = avoid;
	const router = new A.Router(A.OrthogonalRouting);
	router.setRoutingParameter(A.shapeBufferDistance, ROUTE.buffer);
	router.setRoutingParameter(A.idealNudgingDistance, ROUTE.spread);
	// A bend costs as much as this many px of line, so lines take few.
	router.setRoutingParameter(A.segmentPenalty, 50);
	router.setRoutingOption(A.nudgeOrthogonalSegmentsConnectedToShapes, true);
	router.setRoutingOption(A.nudgeOrthogonalTouchingColinearSegments, true);
	const temps: unknown[] = [];
	const temp = <T>(o: T) => (temps.push(o), o);
	const pt = (x: number, y: number) => temp(new A.Point(x, y));

	const shapes = new Map<string, unknown>();
	const shape = (id: string, r: Rect) =>
		shapes.get(id) ??
		shapes
			.set(id, new A.ShapeRef(router, temp(new A.Rectangle(pt(r.x0, r.y0), pt(r.x1, r.y1)))))
			.get(id);
	for (const [id, r] of boxes) shape(id, r);
	// Pins on a box at one height and sides, shared by every line ending there.
	const pins = new Map<string, number>();
	const end = (e: RouteEnd) => {
		let on = e.on;
		let box = on === undefined ? undefined : boxes.get(on);
		let sides = e.sides;
		if (!box) {
			// The binding has no end that is a point with a direction, so a free end is a pin
			// on a speck of a box just inside its side.
			const x = sides[0] === 'r' ? e.x1 - 1 : e.x0;
			on = `free|${x}|${e.y}`;
			box = { x0: x, y0: e.y - 0.5, x1: x + 1, y1: e.y + 0.5 };
			sides = [sides[0]];
		}
		const ref = shape(on!, box);
		const key = `${on}|${e.y}|${sides.join('')}`;
		let cls = pins.get(key);
		if (cls === undefined) {
			cls = pins.size + 1;
			pins.set(key, cls);
			for (const side of sides)
				new A.ShapeConnectionPin(
					ref,
					cls,
					side === 'r' ? box.x1 - box.x0 : 0,
					e.y - box.y0,
					false,
					0,
					side === 'r' ? A.ConnDirRight : A.ConnDirLeft
				).setExclusive(false);
		}
		return temp(new A.ConnEnd(ref, cls));
	};
	const conns = lines.map((l) => [l.id, new A.ConnRef(router, end(l.s), end(l.t))] as const);
	router.processTransaction();

	const out = new Map<string, Point[]>();
	for (const [id, c] of conns) {
		const route = c.displayRoute();
		const pts: Point[] = [];
		for (let i = 0; i < route.size(); i++) {
			const p = route.get_ps(i);
			pts.push({ x: p.x, y: p.y });
		}
		out.set(id, pts);
	}
	// The router owns its shapes, pins and lines.
	A.destroy(router);
	for (const o of temps) A.destroy(o);
	return out;
}

/** An SVG path through a route's corners. */
export const routePath = (pts: Point[]) =>
	pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
