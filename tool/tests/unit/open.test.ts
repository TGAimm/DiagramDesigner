import { describe, expect, it } from 'vitest';
import type { LandscapeBox } from '../../src/lib/landscape/layout';
import { apiHosts, cardsBrief, railOpen } from '../../src/lib/landscape/open';
import type { Rail } from '../../src/lib/landscape/apis';

const box = (id: string, parentId?: string) => ({ id, parentId, group: true }) as LandscapeBox;
// A system a holding module m, which holds a model card t.
const boxes = [box('a'), box('m', 'a'), { ...box('t', 'm'), group: false }];

describe('cards', () => {
	it('draw only their frames while their rows would be under 6px', () => {
		// Rows 13 × 0.47 = 6.1px; 13 × 0.46 = 5.98px.
		expect(cardsBrief(0.47)).toBe(false);
		expect(cardsBrief(0.46)).toBe(true);
	});
});

describe('api hosts', () => {
	const withApis = [{ ...boxes[0], apis: ['a1'] }, { ...boxes[1], apis: ['m1', 'm2'] }, boxes[2]];
	it('draws an api on its parent box while that box is shown', () => {
		expect(apiHosts(withApis, new Set(['a']))).toEqual(
			new Map([
				['a', ['a1']],
				['m', ['m1', 'm2']]
			])
		);
	});

	it('moves an api to the nearest shown box round its hidden parent', () => {
		expect(apiHosts(withApis, new Set())).toEqual(new Map([['a', ['a1', 'm1', 'm2']]]));
	});
});

describe('api rail', () => {
	it('lists its endpoints while their rows read at 6px, else shows its name', () => {
		const rail = { scale: 0.25 } as Rail;
		// Rows 12 × 0.25 × 2 = 6px.
		expect(railOpen(rail, 2)).toBe(true);
		expect(railOpen(rail, 1.9)).toBe(false);
	});
});
