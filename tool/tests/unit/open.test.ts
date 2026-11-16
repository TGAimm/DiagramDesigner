import { describe, expect, it } from 'vitest';
import type { LandscapeBox } from '../../src/lib/landscape/layout';
import {
	apiHosts,
	cardsLegible,
	drawnInFull,
	railOpen,
	type Camera
} from '../../src/lib/landscape/open';
import type { Rail } from '../../src/lib/landscape/apis';

const box = (id: string, parentId?: string) => ({ id, parentId, group: true }) as LandscapeBox;
// A system a holding module m, which holds a model card t.
const boxes = [box('a'), box('m', 'a'), { ...box('t', 'm'), group: false }];

describe('cards', () => {
	it('show their rows while those would read at 4px', () => {
		// Rows 13 × 0.31 = 4.03px; 13 × 0.3 = 3.9px.
		expect(cardsLegible(0.31)).toBe(true);
		expect(cardsLegible(0.3)).toBe(false);
	});
});

describe('drawn in full', () => {
	const card = (id: string, absX: number) =>
		({ id, absX, absY: 0, width: 100, height: 100, table: [] }) as unknown as LandscapeBox;
	// One card on screen, one just past the screen's right edge, one far off it.
	const cards = [card('here', 100), card('beside', 1200), card('far', 5000)];
	const cam = (zoom: number): Camera => ({ x: 0, y: 0, zoom, width: 1000, height: 1000 });

	it('draws only the cards on or near the screen, so layout stays as it is', () => {
		expect([...drawnInFull(cards, new Map(), cam(1))]).toEqual(['here', 'beside']);
	});

	it('draws no card whose rows would not read', () => {
		expect([...drawnInFull(cards, new Map(), cam(0.3))]).toEqual([]);
	});

	it('lists a rail near the screen once its rows read, keyed by its host', () => {
		const rail = { scale: 1, top: 0, width: 100, height: 50 } as Rail;
		const rails = new Map([
			['here', rail],
			['far', rail]
		]);
		expect([...drawnInFull(cards, rails, cam(0.6))]).toEqual(['here', 'beside']);
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
	it('lists its endpoints while their rows read at 4px, else shows its name', () => {
		const rail = { scale: 0.25 } as Rail;
		// Rows 12 × 0.25 × 1.34 = 4.02px; × 1.33 = 3.99px.
		expect(railOpen(rail, 1.34)).toBe(true);
		expect(railOpen(rail, 1.33)).toBe(false);
	});
});
