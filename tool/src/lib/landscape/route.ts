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
	/**
	 * An open box, drawn round the boxes inside it: lines cross it freely, but keep `buffer` off
	 * its edges instead of running along them, hidden by its border (see `clearFrames`).
	 */
	frame?: boolean;
}

export type Side = 'l' | 'r';

/**
 * One end of a line, at height `y`. On a box lines go round (`on`), it leaves by whichever
 * of `sides` routes best; else it is a free point on side `sides[0]` of `x0`…`x1`, or with
 * `point`, a bare point at `x0`.
 */
export interface RouteEnd {
	on?: string;
	/**
	 * A bare point at `x0`, `y`, met from any side: no speck of a box round it, so it can sit
	 * as close to boxes as a line can run.
	 */
	point?: boolean;
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
 * near them: see `boxesNear`), and keep off the edges of those that are frames. With `shareEnds`, lines leaving one end run as one line from
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
	// No crossing penalty: libavoid calls it experimental, and it doubles the time lines take
	// together. Nudging still orders lines in a shared channel so they cross no more than needed.
	router.setRoutingOption(A.nudgeSharedPathsWithCommonEndPoint, !shareEnds);
	const temps: unknown[] = [];
	const temp = <T>(o: T) => (temps.push(o), o);
	const pt = (x: number, y: number) => temp(new A.Point(x, y));

	const solid = new Map<string, Rect>();
	const frames: Rect[] = [];
	for (const [id, r] of boxes)
		if (r.frame) frames.push(r);
		else solid.set(id, r);
	const near = boxesNear(solid, lines);

	const shapes = new Map<string, unknown>();
	const shape = (id: string, r: Rect) =>
		shapes.get(id) ??
		shapes
			.set(id, new A.ShapeRef(router, temp(new A.Rectangle(pt(r.x0, r.y0), pt(r.x1, r.y1)))))
			.get(id);
	for (const [id, r] of near) shape(id, r);
	// Pins on a box at one height and sides, shared by every line ending there.
	const pins = new Map<string, number>();
	const end = (e: RouteEnd) => {
		if (e.point) return temp(new A.ConnEnd(pt(e.x0, e.y)));
		let on = e.on;
		let box = on === undefined ? undefined : solid.get(on);
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
	return frames.length ? clearFrames(out, [...near.values()], frames) : out;
}

/** A straight piece of a route: across `axis` at `at`, from `lo` to `hi` along it. */
interface Span {
	/** 'x' for an upright piece, at an x; 'y' for a level one, at a y. */
	axis: 'x' | 'y';
	at: number;
	lo: number;
	hi: number;
}

interface Piece extends Span {
	id: string;
	/** It runs from corner `i` to corner `i + 1`. */
	i: number;
	/** Both its ends are bends, so it can move across itself; a piece ending a route cannot. */
	free: boolean;
}

/**
 * The routes with every piece running along a frame's edge, nearer than `gap`, moved off it,
 * with the pieces of other lines running beside it, so no border hides a line. libavoid keeps
 * lines `gap` off the boxes it routes round, but lines must cross frames, so it is not told of
 * them, and it runs a line down the middle between two boxes, which can be right on the border
 * of a frame round one of them. A piece moves to whichever side of the edge is nearer and
 * leaves it clear of boxes, frames' edges and other lines; with neither, or ending a route, it
 * stays.
 */
export function clearFrames(
	routes: Map<string, Point[]>,
	boxes: Rect[],
	frames: Rect[],
	gap: number = ROUTE.buffer
): Map<string, Point[]> {
	const EPS = 0.5;
	const out = new Map([...routes].map(([id, pts]) => [id, pts.map((p) => ({ ...p }))]));
	const edges: Span[] = frames.flatMap((f): Span[] => [
		{ axis: 'x', at: f.x0, lo: f.y0, hi: f.y1 },
		{ axis: 'x', at: f.x1, lo: f.y0, hi: f.y1 },
		{ axis: 'y', at: f.y0, lo: f.x0, hi: f.x1 },
		{ axis: 'y', at: f.y1, lo: f.x0, hi: f.x1 }
	]);
	const along = (a: 'x' | 'y') => (a === 'x' ? 'y' : 'x');
	const overlap = (a: Span, b: Span) => Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo) > EPS;
	const pieces = () => {
		const all: Piece[] = [];
		for (const [id, pts] of out)
			for (let i = 0; i + 1 < pts.length; i++) {
				const [p, q] = [pts[i], pts[i + 1]];
				const axis = Math.abs(p.x - q.x) < EPS ? 'x' : Math.abs(p.y - q.y) < EPS ? 'y' : undefined;
				if (!axis) continue;
				const [a, b] = [p[along(axis)], q[along(axis)]];
				const free = i > 0 && i + 2 < pts.length;
				all.push({ id, i, axis, at: p[axis], lo: Math.min(a, b), hi: Math.max(a, b), free });
			}
		return all;
	};
	/** Whether a piece comes nearer than `g` to a box. */
	const nears = (s: Span, r: Rect, g: number) =>
		s.axis === 'x'
			? r.x0 - g < s.at && s.at < r.x1 + g && r.y0 - g < s.hi && s.lo < r.y1 + g
			: r.y0 - g < s.at && s.at < r.y1 + g && r.x0 - g < s.hi && s.lo < r.x1 + g;
	const onEdge = (s: Span) =>
		edges.find((e) => e.axis === s.axis && Math.abs(e.at - s.at) < gap - EPS && overlap(e, s));

	/** The routes `bundle` is part of with it moved `d` across itself, if that leaves all clear. */
	const moved = (bundle: Piece[], all: Piece[], d: number) => {
		const next = new Map<string, Point[]>();
		for (const s of bundle) {
			const pts = next.get(s.id) ?? out.get(s.id)!.map((p) => ({ ...p }));
			next.set(s.id, pts);
			pts[s.i][s.axis] += d;
			pts[s.i + 1][s.axis] += d;
		}
		for (const s of bundle) {
			const to = { ...s, at: s.at + d };
			if (onEdge(to) || boxes.some((r) => nears(to, r, gap - EPS))) return undefined;
			for (const o of all)
				if (!bundle.includes(o) && o.axis === s.axis && overlap(o, to))
					if (Math.abs(o.at - to.at) < ROUTE.spread - EPS) return undefined;
			// The pieces either side only grow or shrink: each keeps its way and crosses no box.
			const [was, pts] = [out.get(s.id)!, next.get(s.id)!];
			for (const [j, k] of [
				[s.i - 1, s.i],
				[s.i + 1, s.i + 2]
			]) {
				const [before, after] = [was[k][s.axis] - was[j][s.axis], pts[k][s.axis] - pts[j][s.axis]];
				if (Math.sign(before) !== Math.sign(after) || Math.abs(after) < EPS) return undefined;
				const [a, b] = [pts[j][s.axis], pts[k][s.axis]];
				const side: Span = {
					axis: along(s.axis),
					at: pts[j][along(s.axis)],
					lo: Math.min(a, b),
					hi: Math.max(a, b)
				};
				if (boxes.some((r) => nears(side, r, 0))) return undefined;
			}
		}
		return next;
	};

	const stuck = new Set<string>();
	for (let tries = 1000; tries > 0; tries--) {
		const all = pieces();
		const s = all.find((p) => !stuck.has(`${p.id}|${p.i}`) && onEdge(p));
		if (!s) break;
		const e = onEdge(s)!;
		// The pieces of lines running beside it, `spread` apart, move with it.
		const bundle = [s];
		for (let k = 0; k < bundle.length; k++)
			for (const o of all)
				if (
					!bundle.includes(o) &&
					o.axis === s.axis &&
					Math.abs(o.at - bundle[k].at) <= ROUTE.spread + EPS &&
					overlap(o, bundle[k])
				)
					bundle.push(o);
		const ats = bundle.map((p) => p.at);
		const ds = [e.at + gap - Math.min(...ats), e.at - gap - Math.max(...ats)].sort(
			(a, b) => Math.abs(a) - Math.abs(b)
		);
		const next = bundle.every((p) => p.free)
			? ds.map((d) => moved(bundle, all, d)).find(Boolean)
			: undefined;
		if (next) for (const [id, pts] of next) out.set(id, pts);
		else for (const p of bundle) stuck.add(`${p.id}|${p.i}`);
	}
	return out;
}

/** Lines routed among `boxes` only. */
export interface RouteGroup {
	boxes: Map<string, Rect>;
	lines: RouteLine[];
}

/**
 * Each group's lines routed among its own boxes (see `routeLines`), all by line id. Lines that
 * can only run among a few boxes cost far less routed apart: what libavoid costs grows with
 * every box and every line routed together.
 */
export function routeGroups(groups: RouteGroup[], shareEnds = false): Map<string, Point[]> {
	const out = new Map<string, Point[]>();
	for (const g of groups)
		for (const [id, pts] of routeLines(g.boxes, g.lines, shareEnds)) out.set(id, pts);
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
