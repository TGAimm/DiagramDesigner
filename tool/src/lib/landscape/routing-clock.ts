/**
 * How long routing the lines at rest takes, for the bar shown meanwhile (RoutingProgress): when
 * it started, how long it took last time for the same landscape and focus, and, once it comes
 * to an end, how long it took, kept for next time. A routing cut short (the page left, a new
 * layout) is no measure and is not kept.
 *
 * The clock only holds times: the page starts and stops it from an effect, and the bar reads
 * the time from it as it ticks, so nothing is written on every tick but the bar's own clock.
 */

/** The storage it keeps to: localStorage in a page. */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem'>;

const KEY = 'sdv-route-ms';
/** Measures kept, newest last. */
const KEEP = 50;

export interface RoutingRun {
	/** `performance.now()` when it started. */
	since: number;
	/** Ms it took last time, if known. */
	expected?: number;
}

export class RoutingClock {
	private run?: RoutingRun & { key: string };

	constructor(private readonly storage?: Storage) {}

	/** Routing started for `key` (landscape and focus) at `now`; a run going on goes on. */
	start(key: string, now: number): RoutingRun {
		if (this.run?.key === key) return this.run;
		this.run = { key, since: now, expected: this.took()[key] };
		return this.run;
	}

	/** The run going on, if any. */
	get current(): RoutingRun | undefined {
		return this.run;
	}

	/** Routing ended at `now`: `done` if every line came in, else cut short and not kept. */
	stop(now: number, done: boolean) {
		const run = this.run;
		this.run = undefined;
		if (!run || !done) return;
		const others = Object.entries(this.took())
			.filter(([k]) => k !== run.key)
			.slice(-(KEEP - 1));
		try {
			this.storage?.setItem(
				KEY,
				JSON.stringify(Object.fromEntries([...others, [run.key, now - run.since]]))
			);
		} catch {
			// Not kept; the bar then has nothing to judge by next time.
		}
	}

	private took(): Record<string, number> {
		try {
			const v = JSON.parse(this.storage?.getItem(KEY) ?? '{}');
			return v && typeof v === 'object' ? v : {};
		} catch {
			return {};
		}
	}
}
