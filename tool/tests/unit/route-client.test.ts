import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { edgesOf, restLines } from '../../src/lib/landscape/connections';
import { layoutLandscape } from '../../src/lib/landscape/layout';
import {
	loadRouter,
	routeKey,
	routeLines,
	type Rect,
	type RouteEnd,
	type RouteLine
} from '../../src/lib/landscape/route';
import {
	keyedGroup,
	rerouted,
	RouteClient,
	type KeyedGroup,
	type RoutePort
} from '../../src/lib/landscape/route-client';
import { routeStore } from '../../src/lib/landscape/route-store';
import { routeService, type ToRouter } from '../../src/lib/landscape/route-service';
import { loadDesign } from '../../src/lib/model/loader';
import { syntheticLandscape } from './synthetic';

beforeAll(() => loadRouter());

/** route-worker.ts in this thread: messages copied both ways as a worker's are, a task later. */
class InProcess implements RoutePort {
	onmessage: RoutePort['onmessage'] = null;
	onerror: RoutePort['onerror'] = null;
	sent: ToRouter[] = [];
	private serve = routeService((m) =>
		setTimeout(() => this.onmessage?.({ data: structuredClone(m) }))
	);
	postMessage(m: ToRouter) {
		this.sent.push(m);
		const copy = structuredClone(m);
		setTimeout(() => void this.serve(copy));
	}
	terminate() {}
	/** The keys of the lines it was asked to route, in order. */
	routed() {
		return this.sent.flatMap((m) => (m.type === 'route' ? [routeKey(m.lines, m.shareEnds)] : []));
	}
}

const rect = (x0: number, y0: number, w: number, h: number): Rect => ({
	x0,
	y0,
	x1: x0 + w,
	y1: y0 + h
});
const on = (id: string, r: Rect, y = (r.y0 + r.y1) / 2): RouteEnd => ({
	on: id,
	x0: r.x0,
	x1: r.x1,
	y,
	sides: ['l', 'r']
});

/** The example design's lines at rest, ends on their boxes' middles, among its cards. */
function example() {
	const root = fileURLToPath(new URL('../../../examples/commerce', import.meta.url));
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((name) => {
			const abs = path.join(dir, name);
			return statSync(abs).isDirectory() ? walk(abs) : [abs];
		});
	const { model } = loadDesign(
		walk(root).map((abs) => ({
			path: path.relative(root, abs).split(path.sep).join('/'),
			text: readFileSync(abs, 'utf8')
		}))
	);
	const { boxes: laid, lines: laidLines } = layoutLandscape(model);
	const byId = new Map(laid.map((b) => [b.id, b]));
	const boxes = new Map(
		laid.filter((b) => !b.group).map((b) => [b.id, rect(b.absX, b.absY, b.width, b.height)])
	);
	const end = (id: string): RouteEnd => {
		const b = byId.get(id)!;
		const r = rect(b.absX, b.absY, b.width, b.height);
		return boxes.has(id) ? on(id, r) : { ...on(id, r), on: undefined, sides: ['r'] };
	};
	const lines: RouteLine[] = restLines(laidLines, edgesOf(model)).map((l) => ({
		id: l.id,
		s: end(l.source),
		t: end(l.target)
	}));
	// What lights looking at each card: its own lines, routed apart from the rest.
	const looks = [...boxes].map(([id, r]) => ({
		x: (r.x0 + r.x1) / 2,
		y: (r.y0 + r.y1) / 2,
		lines: () => lines.filter((l) => l.s.on === id || l.t.on === id)
	}));
	return { boxes, lines, looks };
}

describe('RouteClient', () => {
	it('routes in workers exactly as on the page, now and ahead', async () => {
		const { boxes, lines, looks } = example();
		expect(lines.length).toBeGreaterThan(5);
		const client = new RouteClient(new InProcess(), new InProcess());
		await client.ready;
		const key = routeKey(lines, true);
		const done = vi.fn();
		client.want(boxes, key, lines, true, 'rest', done);
		await vi.waitFor(() => expect(done).toHaveBeenCalled());
		expect(client.get(boxes, key)).toEqual(routeLines(boxes, lines, true));

		client.ahead(boxes, looks, { x: 0, y: 0 });
		const lit = looks.map((l) => l.lines()).filter((ls) => ls.length);
		expect(lit.length).toBeGreaterThan(3);
		await vi.waitFor(() => {
			for (const ls of lit) expect(client.get(boxes, routeKey(ls))).toBeDefined();
		});
		for (const ls of lit) expect(client.get(boxes, routeKey(ls))).toEqual(routeLines(boxes, ls));
		client.destroy();
	});

	const boxes = new Map([
		['a', rect(0, 0, 100, 60)],
		['b', rect(300, 0, 100, 60)],
		['c', rect(0, 300, 100, 60)]
	]);
	const line = (id: string, s: string, t: string, y = 30): RouteLine => ({
		id,
		s: on(s, boxes.get(s)!, boxes.get(s)!.y0 + y),
		t: on(t, boxes.get(t)!, boxes.get(t)!.y0 + y)
	});

	it('routes the newest of what is wanted, at rest before lit', async () => {
		const now = new InProcess();
		const client = new RouteClient(now, new InProcess());
		const done = vi.fn();
		const want = (ls: RouteLine[], slot: 'rest' | 'lit') =>
			client.want(boxes, routeKey(ls, slot === 'rest'), ls, slot === 'rest', slot, done);
		const [first, stale, lit, rest] = [
			[line('x', 'a', 'b')],
			[line('x', 'a', 'c')],
			[line('x', 'b', 'c')],
			[line('x', 'a', 'b', 20)]
		];
		want(first, 'lit');
		want(stale, 'lit');
		want(lit, 'lit');
		want(rest, 'rest');
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(3));
		expect(now.routed()).toEqual([routeKey(first), routeKey(rest, true), routeKey(lit)]);
		// Kept: wanting them again routes nothing.
		want(lit, 'lit');
		want(rest, 'rest');
		expect(now.routed()).toHaveLength(3);
		expect(client.get(boxes, routeKey(stale))).toBeUndefined();
		client.destroy();
	});

	it('routes ahead the nearest first, skipping looks without lines or routed already', async () => {
		const later = new InProcess();
		const client = new RouteClient(new InProcess(), later);
		const ab = [line('x', 'a', 'b')];
		const ac = [line('y', 'a', 'c')];
		const looks = [
			{ x: 350, y: 30, lines: () => ab },
			{ x: 50, y: 330, lines: () => ac },
			{ x: 50, y: 30, lines: () => [] },
			{ x: 340, y: 30, lines: () => ab }
		];
		client.ahead(boxes, looks, { x: 50, y: 400 });
		await vi.waitFor(() => expect(client.get(boxes, routeKey(ab))).toBeDefined());
		expect(later.routed()).toEqual([routeKey(ac), routeKey(ab)]);
		client.destroy();
	});

	it('forgets what was routed among other boxes, not among the same boxes rebuilt', async () => {
		const client = new RouteClient(new InProcess(), new InProcess());
		const ls = [line('x', 'a', 'b')];
		const key = routeKey(ls);
		const done = vi.fn();
		client.want(boxes, key, ls, false, 'lit', done);
		await vi.waitFor(() => expect(done).toHaveBeenCalled());
		expect(client.get(new Map(boxes), key)).toBeDefined();
		const moved = new Map([...boxes, ['c', rect(150, -100, 100, 300)]]);
		expect(client.get(moved, key)).toBeUndefined();
		client.want(moved, key, ls, false, 'lit', done);
		expect(client.get(boxes, key)).toBeUndefined();
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
		expect(client.get(moved, key)).toEqual(routeLines(moved, ls));
		expect(client.get(moved, '')).toEqual(new Map());
		client.destroy();
	});

	it('finds what was routed among boxes again on going back to them, routing nothing', async () => {
		const now = new InProcess();
		const client = new RouteClient(now, new InProcess());
		const ls = [line('x', 'a', 'b')];
		const [rest, lit] = [routeKey(ls, true), routeKey(ls)];
		const done = vi.fn();
		client.want(boxes, rest, ls, true, 'rest', done);
		client.want(boxes, lit, ls, false, 'lit', done);
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
		// A focus: other boxes, its lines routed among them.
		const focus = new Map([
			['a', boxes.get('a')!],
			['b', rect(200, 0, 100, 60)]
		]);
		client.want(focus, rest, ls, true, 'rest', done);
		await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(3));
		expect(now.routed()).toHaveLength(3);
		// Back to the whole landscape, rebuilt alike: both kept, told at once.
		const back = new Map(boxes);
		client.want(back, rest, ls, true, 'rest', done);
		client.want(back, lit, ls, false, 'lit', done);
		expect(done).toHaveBeenCalledTimes(5);
		expect(client.get(back, rest)).toEqual(routeLines(boxes, ls, true));
		expect(client.get(back, lit)).toEqual(routeLines(boxes, ls));
		expect(now.routed()).toHaveLength(3);
		client.destroy();
	});

	it('keeps lines routed for boxes left meanwhile, for going back', async () => {
		const now = new InProcess();
		const client = new RouteClient(now, new InProcess());
		const ls = [line('x', 'a', 'b')];
		const key = routeKey(ls, true);
		const done = vi.fn();
		client.want(boxes, key, ls, true, 'rest', done);
		// Left before they came, and back.
		client.want(new Map([['a', boxes.get('a')!]]), '', [], true, 'rest', done);
		client.want(boxes, key, ls, true, 'rest', done);
		await vi.waitFor(() => expect(client.get(boxes, key)).toBeDefined());
		expect(now.routed()).toHaveLength(1);
		client.destroy();
	});

	describe('lines at rest by group', () => {
		const far = new Map([
			['p', rect(1000, 0, 100, 60)],
			['q', rect(1300, 0, 100, 60)]
		]);
		const farLine = (id: string, y = 30): RouteLine => ({
			id,
			s: on('p', far.get('p')!, y),
			t: on('q', far.get('q')!, y)
		});
		const small = keyedGroup({ boxes: far, lines: [farLine('pq')] }, true);
		const big = keyedGroup(
			{ boxes, lines: [line('ab', 'a', 'b'), line('ac', 'a', 'c'), line('bc', 'b', 'c')] },
			true
		);

		it('routes each group among its own boxes, the smaller first, on both workers', async () => {
			const [now, later] = [new InProcess(), new InProcess()];
			const client = new RouteClient(now, later);
			const done = vi.fn();
			client.wantGroups([big, small], true, done);
			expect(client.groupRoutes([big, small]).done).toBe(false);
			await vi.waitFor(() => expect(done).toHaveBeenCalledTimes(2));
			expect(now.routed()).toEqual([routeKey(small.lines, true)]);
			expect(later.routed()).toEqual([routeKey(big.lines, true)]);
			const { routes, done: all } = client.groupRoutes([big, small]);
			expect(all).toBe(true);
			expect(routes).toEqual(
				new Map([...routeLines(boxes, big.lines, true), ...routeLines(far, small.lines, true)])
			);
			client.destroy();
		});

		it('routes a large group only on the worker routing ahead', async () => {
			const [now, later] = [new InProcess(), new InProcess()];
			const client = new RouteClient(now, later);
			const many = keyedGroup(
				{
					boxes,
					lines: Array.from({ length: 65 }, (_, i) => line(`l${i}`, 'a', 'b', 5 + i * 0.75))
				},
				true
			);
			client.wantGroups([many], true, vi.fn());
			client.wantGroups([many, small], true, vi.fn());
			await vi.waitFor(() => expect(client.groupRoutes([many, small]).done).toBe(true));
			expect(now.routed()).toEqual([routeKey(small.lines, true)]);
			expect(later.routed()).toEqual([routeKey(many.lines, true)]);
			client.destroy();
		});

		it('routes again only the groups that changed, whatever else did', async () => {
			const [now, later] = [new InProcess(), new InProcess()];
			const client = new RouteClient(now, later);
			const done = vi.fn();
			client.wantGroups([big, small], true, done);
			await vi.waitFor(() => expect(client.groupRoutes([big, small]).done).toBe(true));
			const changed = keyedGroup({ boxes: far, lines: [farLine('pq', 20)] }, true);
			// Another layout meanwhile: groups do not belong to one.
			client.want(new Map([['a', boxes.get('a')!]]), '', [], true, 'rest', done);
			client.wantGroups([big, changed], true, done);
			expect(client.groupRoutes([big, changed])).toMatchObject({ done: false });
			expect(client.groupRoutes([big, changed]).routes.has('ab')).toBe(true);
			await vi.waitFor(() => expect(client.groupRoutes([big, changed]).done).toBe(true));
			expect([...now.routed(), ...later.routed()]).toHaveLength(3);
			client.destroy();
		});

		it('finds a group moved elsewhere whole, its lines moved with it', async () => {
			const [now, later] = [new InProcess(), new InProcess()];
			const client = new RouteClient(now, later);
			client.wantGroups([big], true, vi.fn());
			await vi.waitFor(() => expect(client.groupRoutes([big]).done).toBe(true));
			const by = (r: Rect): Rect => ({
				x0: r.x0 + 500,
				y0: r.y0 - 70,
				x1: r.x1 + 500,
				y1: r.y1 - 70
			});
			const shifted = new Map([...boxes].map(([id, r]) => [id, by(r)]));
			const end = (e: RouteEnd): RouteEnd => ({
				...e,
				x0: e.x0 + 500,
				x1: e.x1 + 500,
				y: e.y - 70
			});
			const lines = big.lines.map((l) => ({ ...l, s: end(l.s), t: end(l.t) }));
			const there = keyedGroup({ boxes: shifted, lines }, true);
			expect(there.key).toBe(big.key);
			const done = vi.fn();
			client.wantGroups([there], true, done);
			expect(done).toHaveBeenCalledOnce();
			expect(client.groupRoutes([there]).routes).toEqual(routeLines(shifted, lines, true));
			expect([...now.routed(), ...later.routed()]).toHaveLength(1);
			client.destroy();
		});

		it('gives the same routes back until a group comes in', async () => {
			const client = new RouteClient(new InProcess(), new InProcess());
			const groups = [big, small];
			client.wantGroups(groups, true, vi.fn());
			const before = client.groupRoutes(groups);
			expect(client.groupRoutes(groups)).toBe(before);
			await vi.waitFor(() => expect(client.groupRoutes(groups).done).toBe(true));
			const after = client.groupRoutes(groups);
			expect(after).not.toBe(before);
			expect(client.groupRoutes(groups)).toBe(after);
			client.destroy();
		});

		describe('after a change', () => {
			// Four cards in one group, known by its id across layouts: a b on top, c d below.
			const at = (moves: Record<string, Rect> = {}) =>
				new Map(
					Object.entries({
						a: rect(0, 0, 100, 60),
						b: rect(400, 0, 100, 60),
						c: rect(0, 400, 100, 60),
						d: rect(400, 400, 100, 60),
						...moves
					})
				);
			const group = (bx: Map<string, Rect>) => {
				const ln = (id: string, s: string, t: string): RouteLine => ({
					id,
					s: { ...on(s, bx.get(s)!), sides: ['r'] },
					t: { ...on(t, bx.get(t)!), sides: ['l'] }
				});
				const lines = [ln('ab', 'a', 'b'), ln('cd', 'c', 'd'), ln('ad', 'a', 'd')];
				return keyedGroup({ boxes: bx, lines }, true, 'root');
			};
			async function routed(client: RouteClient, g: KeyedGroup) {
				client.wantGroups([g], true, vi.fn());
				await vi.waitFor(() => expect(client.groupRoutes([g]).done).toBe(true));
				return client.groupRoutes([g]).routes;
			}
			const sentLines = (...ports: InProcess[]) =>
				ports.flatMap((p) =>
					p.sent.flatMap((m) => (m.type === 'route' ? [m.lines.map((l) => l.id)] : []))
				);

			it('routes again only the lines whose ends moved, keeping the others', async () => {
				const [now, later] = [new InProcess(), new InProcess()];
				const client = new RouteClient(now, later);
				const before = await routed(client, group(at()));
				// d moves down: the lines ending on it are routed again, ab keeps its route.
				const moved = group(at({ d: rect(400, 500, 100, 60) }));
				client.wantGroups([moved], true, vi.fn());
				// Meanwhile the lines kept are drawn as they were.
				expect(client.groupRoutes([moved])).toMatchObject({ done: false });
				expect(client.groupRoutes([moved]).routes.get('ab')).toEqual(before.get('ab'));
				expect(client.groupRoutes([moved]).routes.has('cd')).toBe(false);
				await vi.waitFor(() => expect(client.groupRoutes([moved]).done).toBe(true));
				const after = client.groupRoutes([moved]).routes;
				expect(sentLines(now, later)).toEqual([
					['ab', 'cd', 'ad'],
					['cd', 'ad']
				]);
				expect(after.get('ab')).toEqual(before.get('ab'));
				expect(after.get('cd')).toEqual(routeLines(moved.boxes, moved.lines, true).get('cd'));
				expect(after.get('cd')!.at(-1)!.y).toBe(530);
				client.destroy();
			});

			it('routes again a line whose route a box now stands in', async () => {
				const [now, later] = [new InProcess(), new InProcess()];
				const client = new RouteClient(now, later);
				const before = await routed(client, group(at()));
				// A new card right on ab's way; no other line comes near it.
				const g = group(at({ e: rect(300, 10, 40, 40) }));
				await routed(client, g);
				const after = client.groupRoutes([g]).routes;
				expect(sentLines(now, later).at(-1)).toEqual(['ab']);
				expect(after.get('cd')).toEqual(before.get('cd'));
				expect(after.get('ad')).toEqual(before.get('ad'));
				expect(after.get('ab')).not.toEqual(before.get('ab'));
				client.destroy();
			});

			it('routes nothing when a change touches no line', async () => {
				const [now, later] = [new InProcess(), new InProcess()];
				const client = new RouteClient(now, later);
				const before = await routed(client, group(at()));
				const g = group(at({ e: rect(900, 900, 60, 40) }));
				const done = vi.fn();
				client.wantGroups([g], true, done);
				expect(done).toHaveBeenCalledOnce();
				expect(client.groupRoutes([g])).toEqual({ routes: before, done: true });
				expect(sentLines(now, later)).toHaveLength(1);
				client.destroy();
			});

			it('keeps what it can of a group moved whole and changed inside', () => {
				const was = group(at());
				const routes = routeLines(was.boxes, was.lines, true);
				const fromCorner = new Map(
					[...routes].map(([id, pts]) => [id, pts.map((p) => ({ x: p.x - was.x, y: p.y - was.y }))])
				);
				const shift = (r: Rect): Rect => ({
					x0: r.x0 + 50,
					y0: r.y0 + 70,
					x1: r.x1 + 50,
					y1: r.y1 + 70
				});
				const bx = new Map(
					[...at({ d: rect(400, 500, 100, 60) })].map(([id, r]) => [id, shift(r)])
				);
				const { keep, lines } = rerouted(group(bx), was, fromCorner);
				expect(lines.map((l) => l.id)).toEqual(['cd', 'ad']);
				expect(keep.get('ab')).toEqual(fromCorner.get('ab'));
			});

			it('keeps only groups routed whole in the store, so a new page routes them whole', async () => {
				const kept = new Map<string, Map<string, { x: number; y: number }[]>>();
				const store = { load: (k: string) => kept.get(k), save: vi.fn((k, r) => kept.set(k, r)) };
				const client = new RouteClient(new InProcess(), new InProcess(), undefined, store);
				await routed(client, group(at()));
				expect(store.save).toHaveBeenCalledOnce();
				const moved = group(at({ d: rect(400, 500, 100, 60) }));
				await routed(client, moved);
				expect(store.save).toHaveBeenCalledOnce();
				client.destroy();
				const [now, later] = [new InProcess(), new InProcess()];
				const again = new RouteClient(now, later, undefined, store);
				await routed(again, moved);
				expect(sentLines(now, later)).toEqual([['ab', 'cd', 'ad']]);
				again.destroy();
			});

			it('routes the whole group again without its id', async () => {
				const [now, later] = [new InProcess(), new InProcess()];
				const client = new RouteClient(now, later);
				const anon = (bx: Map<string, Rect>) => ({ ...group(bx), id: undefined });
				await routed(client, anon(at()));
				await routed(client, anon(at({ d: rect(400, 500, 100, 60) })));
				expect(sentLines(now, later).at(-1)).toEqual(['ab', 'cd', 'ad']);
				client.destroy();
			});
		});

		it('takes groups from the store, and keeps them there once routed', async () => {
			const kept = new Map<string, Map<string, { x: number; y: number }[]>>();
			const store = { load: (k: string) => kept.get(k), save: vi.fn((k, r) => kept.set(k, r)) };
			const first = new RouteClient(new InProcess(), new InProcess(), undefined, store);
			first.wantGroups([small, big], true, vi.fn());
			await vi.waitFor(() => expect(store.save).toHaveBeenCalledTimes(2));
			first.destroy();
			const [now, later] = [new InProcess(), new InProcess()];
			const again = new RouteClient(now, later, undefined, store);
			const done = vi.fn();
			again.wantGroups([small, big], true, done);
			expect(done).toHaveBeenCalledOnce();
			expect(again.groupRoutes([small, big]).done).toBe(true);
			expect([...now.routed(), ...later.routed()]).toEqual([]);
			again.destroy();
		});
	});

	it('takes lines at rest from the store, and keeps them there once routed', async () => {
		const kept = new Map<string, Map<string, { x: number; y: number }[]>>();
		const store = { load: (k: string) => kept.get(k), save: vi.fn((k, r) => kept.set(k, r)) };
		const ls = [line('x', 'a', 'b')];
		const key = routeKey(ls, true);
		const done = vi.fn();
		const first = new RouteClient(new InProcess(), new InProcess(), undefined, store);
		first.want(boxes, key, ls, true, 'rest', done);
		await vi.waitFor(() => expect(store.save).toHaveBeenCalledOnce());
		first.destroy();

		const now = new InProcess();
		const again = new RouteClient(now, new InProcess(), undefined, store);
		again.want(new Map(boxes), key, ls, true, 'rest', done);
		expect(done).toHaveBeenCalledTimes(2);
		expect(again.get(boxes, key)).toEqual(routeLines(boxes, ls, true));
		expect(now.routed()).toEqual([]);
		// Not among other boxes.
		again.want(new Map([...boxes, ['c', rect(0, 400, 100, 60)]]), key, ls, true, 'rest', done);
		expect(now.routed()).toHaveLength(1);
		again.destroy();
	});
});

describe('a landscape the size of a large one', () => {
	// 116 groups, 1,251 lines at rest, the largest 222 lines among 56 boxes (see synthetic.ts).
	const groups = syntheticLandscape().map((g, i) => keyedGroup(g, true, `g${i}`));
	const lines = groups.reduce((n, g) => n + g.lines.length, 0);

	it('routes all its lines at rest within a minute', async () => {
		expect(lines).toBe(1251);
		const client = new RouteClient(new InProcess(), new InProcess());
		const t0 = performance.now();
		client.wantGroups(groups, true, vi.fn());
		await vi.waitFor(() => expect(client.groupRoutes(groups).done).toBe(true), {
			timeout: 60_000,
			interval: 50
		});
		expect(performance.now() - t0).toBeLessThan(60_000);
		expect(client.groupRoutes(groups).routes.size).toBe(lines);
		client.destroy();
	}, 70_000);

	it('after one box moves, routes again only the lines it touched', async () => {
		const [now, later] = [new InProcess(), new InProcess()];
		const client = new RouteClient(now, later);
		client.wantGroups(groups, true, vi.fn());
		await vi.waitFor(() => expect(client.groupRoutes(groups).done).toBe(true), {
			timeout: 60_000,
			interval: 50
		});
		const before = [now, later].map((p) => p.sent.length);
		// A box of the largest group with a few lines grows taller.
		const big = groups[0];
		const ending = (id: string) => big.lines.filter((l) => l.s.on === id || l.t.on === id).length;
		const id = [...big.boxes.keys()].find((id) => ending(id) === 3)!;
		const r = big.boxes.get(id)!;
		const boxes = new Map(big.boxes).set(id, { ...r, y1: r.y1 + 40 });
		const changed = keyedGroup({ boxes, lines: big.lines }, true, big.id);
		const next = [changed, ...groups.slice(1)];
		client.wantGroups(next, true, vi.fn());
		await vi.waitFor(() => expect(client.groupRoutes(next).done).toBe(true), {
			timeout: 60_000,
			interval: 50
		});
		const again = [now, later].flatMap((p, i) =>
			p.sent.slice(before[i]).filter((m) => m.type === 'route')
		);
		expect(again).toHaveLength(1);
		const routedAgain = again[0].type === 'route' ? again[0].lines.length : 0;
		expect(routedAgain).toBeGreaterThan(0);
		expect(routedAgain).toBeGreaterThanOrEqual(ending(id));
		expect(routedAgain).toBeLessThan(big.lines.length / 4);
		expect(client.groupRoutes(next).routes.size).toBe(lines);
		client.destroy();
	}, 130_000);
});

describe('routeStore', () => {
	const memory = (limit = Infinity) => {
		const m = new Map<string, string>();
		return {
			m,
			getItem: (k: string) => m.get(k) ?? null,
			setItem: (k: string, v: string) => {
				const size = [...m].reduce((n, [key, val]) => n + (key === k ? 0 : val.length), 0);
				if (size + v.length > limit) throw new Error('quota');
				m.set(k, v);
			},
			removeItem: (k: string) => void m.delete(k)
		};
	};
	const routes = (n: number) => new Map([[`l${n}`, [{ x: n, y: 0 }]]]);

	it('gives back what it kept, the last few only', () => {
		const storage = memory();
		const store = routeStore(storage, 2);
		for (const n of [1, 2, 3]) store.save(`k${n}`, routes(n));
		expect(store.load('k1')).toBeUndefined();
		expect(store.load('k2')).toEqual(routes(2));
		expect(store.load('k3')).toEqual(routes(3));
		expect(storage.m.size).toBe(3);
	});

	it('drops the oldest to make room when the storage is full', () => {
		// Room for two sets of 50 corners, not three.
		const storage = memory(2000);
		const store = routeStore(storage, 8);
		const long = (n: number) =>
			new Map([[`l${n}`, Array.from({ length: 50 }, (_, i) => ({ x: i, y: n }))]]);
		for (const n of [1, 2, 3, 4]) store.save(`k${n}`, long(n));
		expect(store.load('k4')).toEqual(long(4));
		expect(store.load('k3')).toEqual(long(3));
		expect(store.load('k1')).toBeUndefined();
		expect(store.load('k2')).toBeUndefined();
	});
});
