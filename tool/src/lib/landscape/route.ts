import { AvoidLib } from 'libavoid-js';

/**
 * Lines routed by libavoid: right-angled, round every box in the way, and lines running side
 * by side spread apart. libavoid is WebAssembly, so it is loaded once before any routing. The
 * app routes in workers (see route-client.ts).
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

/**
 * Room kept between a line and a box, and between lines side by side, in canvas px; `room` is
 * kept clear round the boxes a set of lines is routed among (see `boxesNear`).
 */
export const ROUTE = { buffer: 8, spread: 8, room: 64 };

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- an Emscripten binding
let avoid: any;

/** Loads libavoid; from `wasmUrl` in a page, from the package next to it in Node. */
export async function loadRouter(wasmUrl?: string) {
	if (avoid) return;
	await AvoidLib.load(wasmUrl);
	avoid = AvoidLib.getInstance();
}

export const routerReady = () => !!avoid;

/**
 * The boxes lines are routed round: those meeting the rectangle round the lines' ends and the
 * boxes they end on, grown to hold each with `room` to spare, until no other box meets it.
 * Every box left out lies wholly outside it, and a line never needs to leave it (it can run
 * round its edge, clear of every box inside), so the lines route the same without them. What
 * libavoid costs grows with every box it is given, and most of a large landscape's boxes are
 * far from the few lines lit at a time.
 */
export function boxesNear(
	boxes: Map<string, Rect>,
	lines: RouteLine[],
	room: number = ROUTE.room
): Map<string, Rect> {
	const out = new Map<string, Rect>();
	if (!lines.length) return out;
	const r = { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
	const grow = (a: Rect) => {
		r.x0 = Math.min(r.x0, a.x0 - room);
		r.y0 = Math.min(r.y0, a.y0 - room);
		r.x1 = Math.max(r.x1, a.x1 + room);
		r.y1 = Math.max(r.y1, a.y1 + room);
	};
	for (const l of lines)
		for (const e of [l.s, l.t]) {
			grow({ x0: e.x0, y0: e.y, x1: e.x1, y1: e.y });
			const on = e.on === undefined ? undefined : boxes.get(e.on);
			if (on) grow(on);
		}
	for (let added = true; added;) {
		added = false;
		for (const [id, b] of boxes)
			if (!out.has(id) && b.x0 < r.x1 && b.x1 > r.x0 && b.y0 < r.y1 && b.y1 > r.y0) {
				out.set(id, b);
				grow(b);
				added = true;
			}
	}
	return out;
}

/**
 * Each line's corners, start and end included, by line id. Lines round `boxes` by id (those
 * near them: see `boxesNear`). With `shareEnds`, lines leaving one end run as one line from
 * it, else they spread apart there too.
 */
export function routeLines(
	boxes: Map<string, Rect>,
	lines: RouteLine[],
	shareEnds = false
): Map<string, Point[]> {
	const A = avoid;
	const router = new A.Router(A.OrthogonalRouting);
	router.setRoutingParameter(A.shapeBufferDistance, ROUTE.buffer);
	router.setRoutingParameter(A.idealNudgingDistance, ROUTE.spread);
	// A bend costs as much as this many px of line, so lines take few.
	router.setRoutingParameter(A.segmentPenalty, 50);
	// A line's end stays on its row: nudging the segments at a box slides ends along its side,
	// and can straighten a step between two rows into one run that ends on neither.
	router.setRoutingOption(A.nudgeOrthogonalSegmentsConnectedToShapes, false);
	router.setRoutingOption(A.nudgeOrthogonalTouchingColinearSegments, true);
	// A crossing costs as much as this many px of line.
	router.setRoutingParameter(A.crossingPenalty, 200);
	router.setRoutingOption(A.nudgeSharedPathsWithCommonEndPoint, !shareEnds);
	const temps: unknown[] = [];
	const temp = <T>(o: T) => (temps.push(o), o);
	const pt = (x: number, y: number) => temp(new A.Point(x, y));

	const shapes = new Map<string, unknown>();
	const shape = (id: string, r: Rect) =>
		shapes.get(id) ??
		shapes
			.set(id, new A.ShapeRef(router, temp(new A.Rectangle(pt(r.x0, r.y0), pt(r.x1, r.y1)))))
			.get(id);
	for (const [id, r] of boxesNear(boxes, lines)) shape(id, r);
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
	// A pair of lines joining the same two ends both ways would lie on itself, one line with two
	// heads: one runs a spread above those ends and the other below, room for a third between.
	const at = (e: RouteEnd) => `${e.on ?? `${e.x0},${e.x1}`}|${e.y}`;
	const ends = new Set(lines.map((l) => `${at(l.s)}>${at(l.t)}`));
	const conns = lines.map((l) => {
		const pair = ends.has(`${at(l.t)}>${at(l.s)}`);
		const dy = pair ? (at(l.s) < at(l.t) ? -1 : 1) * ROUTE.spread : 0;
		const s = { ...l.s, y: l.s.y + dy };
		const t = { ...l.t, y: l.t.y + dy };
		return [l.id, new A.ConnRef(router, end(s), end(t))] as const;
	});
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

/**
 * What a set of lines is known by when its routes are kept: the lines themselves, ends and all,
 * so lines ending elsewhere (a card folded or expanded, a new layout) are a new set. '' for no
 * lines, which need no routing.
 */
export const routeKey = (lines: RouteLine[], shareEnds = false) =>
	lines.length ? JSON.stringify([shareEnds, lines]) : '';

/** An SVG path through a route's corners. */
export const routePath = (pts: Point[]) =>
	pts.map((p, i) => `${i ? 'L' : 'M'}${p.x} ${p.y}`).join(' ');
