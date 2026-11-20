import { describe, expect, it } from 'vitest';
import { RoutingClock } from '../../src/lib/landscape/routing-clock';

/** localStorage as far as the clock uses it. */
function storage() {
	const kept = new Map<string, string>();
	return {
		kept,
		getItem: (k: string) => kept.get(k) ?? null,
		setItem: (k: string, v: string) => void kept.set(k, v)
	};
}
const took = (s: ReturnType<typeof storage>) => JSON.parse(s.kept.get('sdv-route-ms') ?? '{}');

describe('RoutingClock', () => {
	it('starts once per routing, from when it started, with nothing to judge by the first time', () => {
		const clock = new RoutingClock(storage());
		const run = clock.start('nd', 100);
		expect(run).toMatchObject({ since: 100, expected: undefined });
		// Started again while it goes on (a change meanwhile): the same run, counting on.
		expect(clock.start('nd', 900)).toBe(run);
		expect(clock.current).toBe(run);
	});

	it('keeps how long a routing took once it came to an end, to judge by next time', () => {
		const s = storage();
		const clock = new RoutingClock(s);
		clock.start('nd', 100);
		clock.stop(5100, true);
		expect(clock.current).toBeUndefined();
		expect(took(s)).toEqual({ nd: 5000 });
		expect(new RoutingClock(s).start('nd', 0).expected).toBe(5000);
	});

	it('keeps nothing of a routing cut short', () => {
		const s = storage();
		const clock = new RoutingClock(s);
		clock.start('nd', 100);
		clock.stop(300, false);
		expect(took(s)).toEqual({});
		// Nor of one never started.
		clock.stop(400, true);
		expect(took(s)).toEqual({});
	});

	it('keeps the last 50 measures, newest last', () => {
		const s = storage();
		const clock = new RoutingClock(s);
		for (let i = 0; i < 60; i++) {
			clock.start(`k${i}`, 0);
			clock.stop(i, true);
		}
		const keys = Object.keys(took(s));
		expect(keys).toHaveLength(50);
		expect(keys[0]).toBe('k10');
		expect(keys.at(-1)).toBe('k59');
	});

	it('runs without storage, and with storage that is full or holds rubbish', () => {
		new RoutingClock().start('a', 0);
		const bad = {
			getItem: () => '{not json',
			setItem: () => {
				throw new Error('full');
			}
		};
		const clock = new RoutingClock(bad);
		expect(clock.start('a', 0).expected).toBeUndefined();
		expect(() => clock.stop(10, true)).not.toThrow();
	});
});
