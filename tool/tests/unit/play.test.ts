import { describe, expect, it } from 'vitest';
import { runOf, stepOutOf, type Run } from '../../src/lib/landscape/play';
import { loadStrings } from './helpers';

const { model } = loadStrings({
	's/s.system.yaml': 'id: s\n',
	's/m.module.yaml': 'id: m\nparent: s\n',
	's/cart.model.yaml': 'id: cart\nownedBy: m\nfields: [{ id: cart-id, name: id, type: uuid }]\n',
	's/post.api.yaml': 'id: post\nparent: m\nmethod: POST\npath: /orders\n',
	's/get.api.yaml': 'id: get\nparent: m\nmethod: GET\npath: /cart\n',
	's/place.logic-unit.yaml': [
		'id: place',
		'parent: m',
		'name: placeOrder',
		'handles: [post]',
		'inputs: [{ id: place-n, name: note, type: string }]',
		'outputs: [{ id: place-o, name: order, type: string }]',
		'fails: [{ name: empty }]',
		'steps:',
		'  - { call: get, with: sessionId, gets: cart }',
		'  - if: no lines',
		'    then: [{ fail: empty }]',
		'  - each: line',
		'    do: [{ write: cart-id }]',
		'  - { return: order }'
	].join('\n'),
	's/load.logic-unit.yaml': [
		'id: load',
		'parent: m',
		'name: loadCart',
		'handles: [get]',
		'inputs: []',
		'outputs: [{ id: load-o, name: cart, type: string }]',
		'steps: [{ read: cart, gets: row }, { return: cart }]'
	].join('\n')
});
const run = (choices: Record<string, number> = {}, into: string[] = []) =>
	runOf(model, 'place', choices, new Set(into));
const brief = (r: Run) => r.steps.map((s) => [s.kind, s.text, s.from, s.to, s.frame.length]);

describe('playing a unit', () => {
	it('runs to the first choice not yet made, from the caller’s input', () => {
		expect(model.diagnostics).toEqual([]);
		const r = run();
		expect(r.pending).toBe(true);
		expect(brief(r)).toEqual([
			['input', 'note', 'post', 'place', 1],
			['call', 'GET /cart (sessionId)', 'place', 'get', 1],
			['gets', 'cart', 'get', 'place', 1],
			['choice', '[no lines]', 'place', 'place', 1]
		]);
		expect(r.steps[1]).toMatchObject({ method: 'GET', into: 'load' });
		expect(r.steps[3].choice!.options.map((o) => o.label)).toEqual(['yes', 'no']);
	});

	it('follows the branch picked, and ends at a fail of the unit it started in', () => {
		const r = run({ 's.1': 0 });
		expect(r.pending).toBe(false);
		expect(brief(r).at(-1)).toEqual(['fail', 'fails empty', 'place', 'post', 1]);
		expect(r.steps.at(-2)!.choice!.picked).toBe(0);
	});

	it('goes round a loop as often as asked, then returns', () => {
		const r = run({ 's.1': 1, 's.2#1': 0, 's.2#2': 0, 's.2#3': 1 });
		expect(r.pending).toBe(false);
		expect(brief(r).slice(4)).toEqual([
			['choice', '[each line]', 'place', 'place', 1],
			['write', 'writes id', 'place', 'cart-id', 1],
			['choice', '[each line] ×2', 'place', 'place', 1],
			['write', 'writes id', 'place', 'cart-id', 1],
			['choice', '[each line] ×3', 'place', 'place', 1],
			['return', 'order', 'place', 'post', 1]
		]);
	});

	it('steps into the unit handling a called api; its return stands for what the call gets', () => {
		const r = run({}, ['s.0']);
		expect(brief(r).slice(1, 5)).toEqual([
			['call', 'GET /cart (sessionId)', 'place', 'get', 1],
			['read', 'reads cart', 'load', 'cart', 2],
			['gets', 'row', 'cart', 'load', 2],
			['return', 'cart', 'load', 'place', 2]
		]);
		expect(r.steps[2].frame).toEqual(['place', 'load']);
		// Step out lands on the first step back in placeOrder: the choice.
		expect(stepOutOf(r, 2)).toBe(5);
		expect(r.steps[5].kind).toBe('choice');
	});

	it('keeps choices made inside a unit stepped into apart from the caller’s', () => {
		const keys = run({}, ['s.0']).steps.map((s) => s.key);
		expect(new Set(keys).size).toBe(keys.length);
	});
});
