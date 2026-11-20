import type { Rect, RouteGroup, RouteLine } from '../../src/lib/landscape/route';

/**
 * Lines at rest as a large landscape gives them to the router, made up from a seed: groups of
 * lines among sibling boxes (see `restGroups`), as many and as large as a real landscape of
 * about 4,900 entity files has: 116 groups, 1,251 lines, the largest 222 lines among 56 boxes.
 * Boxes stand in rows of varied sizes with room between, as the layout leaves them; each line
 * joins two of them at their name bars, leaving by the side facing the other.
 */

/** Lines and boxes of the largest groups; the rest are small, as in the real landscape. */
const LARGE: [lines: number, boxes: number][] = [
	[222, 56],
	[128, 92],
	[124, 103],
	[114, 111],
	[86, 87],
	[66, 60],
	[62, 27],
	[43, 30],
	[32, 33],
	[27, 37],
	[26, 30],
	[24, 40]
];
const GROUPS = 116;
const LINES = 1251;

/** A small seeded random number generator (mulberry32), so the fixture is the same each run. */
function random(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** One group: `boxes` boxes in rows, `lines` lines between distinct pairs of them. */
function group(n: number, lines: number, rnd: () => number, at: number): RouteGroup {
	const boxes = new Map<string, Rect>();
	const perRow = Math.max(2, Math.ceil(Math.sqrt(n * 1.5)));
	let [x, y, rowH] = [0, at, 0];
	for (let i = 0; i < n; i++) {
		if (i && i % perRow === 0) [x, y, rowH] = [0, y + rowH + 120, 0];
		const [w, h] = [160 + Math.round(rnd() * 240), 60 + Math.round(rnd() * 300)];
		boxes.set(`b${at}-${i}`, { x0: x, y0: y, x1: x + w, y1: y + h });
		x += w + 80 + Math.round(rnd() * 80);
		rowH = Math.max(rowH, h);
	}
	const ids = [...boxes.keys()];
	const out: RouteLine[] = [];
	const seen = new Set<string>();
	while (out.length < lines) {
		// Lines crowd round a few busy boxes, as they do round shared services.
		const pick = () => ids[Math.floor(ids.length * rnd() ** 2)];
		const [s, t] = [pick(), pick()];
		if (s === t || seen.has(`${s}>${t}`)) continue;
		seen.add(`${s}>${t}`);
		const [a, b] = [boxes.get(s)!, boxes.get(t)!];
		const right = (a.x0 + a.x1) / 2 <= (b.x0 + b.x1) / 2;
		out.push({
			id: `${s}>${t}`,
			s: { on: s, x0: a.x0, x1: a.x1, y: a.y0 + 14, sides: [right ? 'r' : 'l'] },
			t: { on: t, x0: b.x0, x1: b.x1, y: b.y0 + 14, sides: [right ? 'l' : 'r'] }
		});
	}
	return { boxes, lines: out };
}

/** The groups of a large landscape's lines at rest; `seed` picks which. */
export function syntheticLandscape(seed = 1): RouteGroup[] {
	const rnd = random(seed);
	const sizes = [...LARGE];
	let left = LINES - sizes.reduce((n, [l]) => n + l, 0);
	for (let k = GROUPS - sizes.length; k > 0; k--) {
		const l = Math.max(1, Math.min(left - (k - 1), Math.round((left / k) * (0.4 + rnd() * 1.2))));
		// Room for as many distinct pairs as lines, and a few more.
		sizes.push([l, Math.max(Math.ceil(Math.sqrt(l)) + 2, Math.round(l * (0.6 + rnd())))]);
		left -= l;
	}
	return sizes.map(([lines, boxes], i) => group(boxes, lines, rnd, i * 10_000));
}
