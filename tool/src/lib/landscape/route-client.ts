import { routeKey, type Point, type Rect, type RouteGroup, type RouteLine } from './route.ts';
import type { FromRouter, ToRouter } from './route-service.ts';

/**
 * Lines routed in workers, so routing never holds up input or frames, and routed ahead of time,
 * so looking at something finds its lines ready.
 *
 * One worker routes what is wanted now: the lines at rest, then the lit lines of what is looked
 * at, the newest only. The other routes ahead: after each layout, the lit lines of everything
 * that can be looked at, those near the view first. Both keep to one set of lines at a time,
 * so the page can still reorder what waits. Routes are kept by their lines (`routeKey`) until
 * the boxes change.
 */

export type Routes = Map<string, Point[]>;

/** A worker running route-worker.ts, or anything answering like one. */
export interface RoutePort {
	postMessage(m: ToRouter): void;
	onmessage: ((e: { data: FromRouter }) => void) | null;
	onerror: ((e: { message?: string }) => void) | null;
	terminate(): void;
}

/**
 * Something that can be looked at, to route its lit lines ahead of time: where it is, so those
 * near the view go first, and its lines, worked out when its turn comes.
 */
export interface RouteAhead {
	x: number;
	y: number;
	lines: () => RouteLine[];
}

/** What is wanted now, by priority: lines at rest before lit ones. */
const SLOTS = ['rest', 'lit'] as const;
type Slot = (typeof SLOTS)[number];

interface Job {
	key: string;
	lines: RouteLine[];
	shareEnds: boolean;
	/** Routed group by group among their own boxes, not `lines` among all the boxes. */
	groups?: RouteGroup[];
	slot?: Slot;
	done?: () => void;
}

interface Lane {
	port: RoutePort;
	busy?: Job & { id: number; ver: number };
}

const NONE: Routes = new Map();

export class RouteClient {
	/** Settles once both workers have loaded libavoid. */
	readonly ready: Promise<void>;
	/** Routing has stopped: libavoid did not load or broke, or the client was destroyed. */
	failed = false;
	/** Told once when routing fails. */
	onfail?: (error: string) => void;

	private boxes?: Map<string, Rect>;
	private ver = 0;
	/** Routes by key, least lately used first. */
	private readonly kept = new Map<string, Routes>();
	/** The lines at rest, kept apart so routing ahead never pushes them out. */
	private rest?: { key: string; routes: Routes };
	private keep = 256;
	private readonly now: Lane;
	private readonly later: Lane;
	private readonly waiting = new Map<Slot, Job>();
	/** What to route ahead, nearest last. */
	private queue: RouteAhead[] = [];
	private ids = 0;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(now: RoutePort, later: RoutePort, wasmUrl?: string) {
		this.now = { port: now };
		this.later = { port: later };
		this.ready = Promise.all([this.now, this.later].map((lane) => this.open(lane, wasmUrl))).then(
			() => undefined
		);
		this.ready.catch((e) => this.fail(String(e)));
	}

	private open(lane: Lane, wasmUrl?: string) {
		return new Promise<void>((resolve, reject) => {
			lane.port.onerror = (e) => {
				const error = e.message ?? 'route worker failed';
				reject(new Error(error));
				this.fail(error);
			};
			lane.port.onmessage = ({ data: m }) => {
				if (m.type === 'loaded') resolve();
				else if (m.type === 'failed') reject(new Error(m.error));
				else this.routed(lane, m);
			};
			lane.port.postMessage({ type: 'load', wasmUrl });
		});
	}

	/** The routes kept for `key` among `boxes` (no lines need none), or undefined. */
	get(boxes: Map<string, Rect>, key: string): Routes | undefined {
		if (!key) return NONE;
		if (!this.same(boxes)) return undefined;
		if (this.rest?.key === key) return this.rest.routes;
		const r = this.kept.get(key);
		if (r) {
			this.kept.delete(key);
			this.kept.set(key, r);
		}
		return r;
	}

	/**
	 * Routes `lines` (known by `key`, see `routeKey`) among `boxes` before anything routed ahead,
	 * unless they are kept, and tells `done` once `get` has them. What waits in `slot` is
	 * dropped: only the newest is wanted. With `groups`, those are routed instead, each among
	 * its own boxes; `boxes` still says which layout they belong to.
	 */
	want(
		boxes: Map<string, Rect>,
		key: string,
		lines: RouteLine[],
		shareEnds: boolean,
		slot: Slot,
		done: () => void,
		groups?: RouteGroup[]
	) {
		this.use(boxes);
		this.waiting.delete(slot);
		if (this.get(boxes, key)) return;
		for (const lane of [this.now, this.later])
			if (lane.busy?.key === key && lane.busy.ver === this.ver) {
				lane.busy.done = done;
				return;
			}
		this.waiting.set(slot, { key, lines, shareEnds, groups, slot, done });
		this.sendWaiting();
	}

	/**
	 * Routes the lit lines of each of `looks` among `boxes` when nothing is wanted now, those
	 * nearest `from` first, and keeps them; replaces what was left to route ahead.
	 */
	ahead(boxes: Map<string, Rect>, looks: RouteAhead[], from: { x: number; y: number }) {
		this.use(boxes);
		// Room for every look's routes, and for those of looks folded or expanded since.
		this.keep = Math.max(256, 2 * looks.length);
		this.queue = [...looks];
		this.aheadFrom(from);
	}

	/** Routes ahead what is nearest `from` first, as when the view has moved there. */
	aheadFrom(from: { x: number; y: number }) {
		const d = (a: RouteAhead) => (a.x - from.x) ** 2 + (a.y - from.y) ** 2;
		this.queue.sort((a, b) => d(b) - d(a));
		this.pump();
	}

	destroy() {
		this.failed = true;
		clearTimeout(this.timer);
		this.now.port.terminate();
		this.later.port.terminate();
	}

	/**
	 * Whether `boxes` are those routed among, as they are or rebuilt alike (taken on then), as
	 * when what the boxes are worked out from changed but they did not.
	 */
	private same(boxes: Map<string, Rect>) {
		const was = this.boxes;
		if (boxes === was) return true;
		if (!was || boxes.size !== was.size) return false;
		for (const [id, r] of boxes) {
			const o = was.get(id);
			if (!o || o.x0 !== r.x0 || o.y0 !== r.y0 || o.x1 !== r.x1 || o.y1 !== r.y1) return false;
		}
		this.boxes = boxes;
		return true;
	}

	/** New boxes: what was routed or waits among the old ones is dropped. */
	private use(boxes: Map<string, Rect>) {
		if (this.same(boxes)) return;
		this.boxes = boxes;
		this.ver++;
		this.kept.clear();
		this.rest = undefined;
		this.waiting.clear();
		this.queue = [];
		for (const lane of [this.now, this.later])
			lane.port.postMessage({ type: 'boxes', ver: this.ver, boxes });
	}

	private send(lane: Lane, job: Job) {
		lane.busy = { ...job, id: ++this.ids, ver: this.ver };
		lane.port.postMessage({
			type: 'route',
			id: lane.busy.id,
			ver: this.ver,
			lines: job.lines,
			shareEnds: job.shareEnds,
			groups: job.groups
		});
	}

	private sendWaiting() {
		if (this.failed || this.now.busy) return;
		for (const slot of SLOTS) {
			const job = this.waiting.get(slot);
			if (!job) continue;
			this.waiting.delete(slot);
			if (this.rest?.key === job.key || this.kept.has(job.key)) job.done?.();
			else return this.send(this.now, job);
		}
	}

	/** Sends the nearest look whose lines are not routed yet, a few ms of looking at a time. */
	private pump() {
		if (this.failed || this.later.busy || this.timer) return;
		const t0 = performance.now();
		for (let a = this.queue.pop(); a; a = this.queue.pop()) {
			let lines: RouteLine[] = [];
			try {
				lines = a.lines();
			} catch {
				// Gone since it was listed; the next layout lists what is there.
			}
			const key = routeKey(lines);
			if (key && !this.kept.has(key) && this.now.busy?.key !== key)
				return this.send(this.later, { key, lines, shareEnds: false });
			if (performance.now() - t0 > 4) {
				this.timer = setTimeout(() => {
					this.timer = undefined;
					this.pump();
				});
				return;
			}
		}
	}

	private routed(lane: Lane, m: Extract<FromRouter, { type: 'routed' }>) {
		const job = lane.busy?.id === m.id ? lane.busy : undefined;
		lane.busy = undefined;
		if (m.error) return this.fail(m.error);
		if (job && m.routes && m.ver === this.ver) {
			if (job.slot === 'rest') this.rest = { key: job.key, routes: m.routes };
			else {
				this.kept.delete(job.key);
				this.kept.set(job.key, m.routes);
				for (const k of this.kept.keys()) {
					if (this.kept.size <= this.keep) break;
					this.kept.delete(k);
				}
			}
			job.done?.();
		}
		if (lane === this.now) this.sendWaiting();
		else this.pump();
	}

	private fail(error: string) {
		if (this.failed) return;
		this.failed = true;
		clearTimeout(this.timer);
		this.onfail?.(error);
	}
}
