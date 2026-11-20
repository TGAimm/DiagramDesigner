import { describe, expect, it } from 'vitest';
import { runOf } from '../../src/lib/landscape/play';
import { sequenceOf } from '../../src/lib/landscape/sequence';
import {
	flagFindings,
	flagSplits,
	flagSplitsOf,
	gatedOff,
	pruneFlags,
	stateOf
} from '../../src/lib/model/flags';
import { buildModel, flagStateOf } from '../../src/lib/model/model';
import { compare } from '../../src/lib/scenario/evaluate';
import { loadStrings } from './helpers';

/** Two systems, one flag key defined in both: the shop calls v2 when on, ERP has v2 when on. */
const FILES = {
	'shop/shop.module.yaml': 'id: shop\n',
	'shop/co.module.yaml': 'id: co\nparent: shop\nname: Checkout\n',
	'shop/flag.flag.yaml': 'id: shop-flag\nparent: co\nname: newFlow\nkey: new-flow\n',
	'shop/place.logic-unit.yaml': [
		'id: place',
		'parent: co',
		'name: placeOrder',
		'inputs: []',
		'outputs: []',
		'steps:',
		'  - flag: shop-flag',
		'    on: [{ call: v2, gets: order }]',
		'    off: [{ call: v1, gets: order }]',
		'  - { note: done }'
	].join('\n'),
	'erp/erp.module.yaml': 'id: erp\nname: ERP\n',
	'erp/order.module.yaml': 'id: order\nparent: erp\nname: Order\n',
	'erp/flag.flag.yaml': 'id: erp-flag\nparent: order\nname: newFlow\nkey: new-flow\n',
	'erp/v1.api.yaml':
		'id: v1\nparent: order\nmethod: POST\npath: /orders\nwhen: { flag: erp-flag, is: off }\n',
	'erp/v2.api.yaml':
		'id: v2\nparent: order\nmethod: POST\npath: /orders/v2\nwhen: { flag: erp-flag, is: on }\n'
};

const design = () => loadStrings(FILES);
const at = (overrides: Record<string, boolean>) => {
	const d = design();
	return stateOf(d.data, flagStateOf(d.model, overrides));
};

describe('flag validation', () => {
	const messages = (files: Record<string, string>) =>
		loadStrings(files).diagnostics.map((d) => [d.severity, d.code, d.message]);

	it('accepts a flag used in a step and a gate, and warns about each split that breaks', () => {
		const d = design();
		expect(d.diagnostics.filter((x) => x.code !== 'flag-split')).toEqual([]);
		expect(d.diagnostics.map((x) => x.message)).toEqual([
			'breaks with new-flow on in ERP › Order, off in shop › Checkout: placeOrder calls POST /orders, which ERP has only when its newFlow is off',
			'breaks with new-flow off in ERP › Order, on in shop › Checkout: placeOrder calls POST /orders/v2, which ERP has only when its newFlow is on'
		]);
	});

	it('finds the same splits from the data alone, as the worker checking them does', () => {
		const d = design();
		const fromData = flagSplitsOf(structuredClone(d.data));
		expect(fromData).toHaveLength(2);
		expect(fromData).toEqual(flagSplits(d.model, d.data));
	});

	it('catches a flip a caller in another system does not follow', () => {
		const files = { ...FILES } as Record<string, string>;
		delete files['shop/flag.flag.yaml'];
		files['shop/place.logic-unit.yaml'] =
			'id: place\nparent: co\nname: placeOrder\ninputs: []\noutputs: []\nsteps: [{ call: v1 }]\n';
		expect(loadStrings(files).diagnostics.map((x) => x.message)).toEqual([
			'breaks with new-flow on in ERP › Order: placeOrder calls POST /orders, which ERP has only when its newFlow is off'
		]);
	});

	it('reports misused flags, gates and flag steps', () => {
		expect(
			messages({
				's/s.module.yaml': 'id: s\n',
				's/a.module.yaml': 'id: a\nparent: s\n',
				's/b.module.yaml': 'id: b\nparent: s\n',
				's/f.flag.yaml': 'id: f\nparent: a\nname: f\n',
				's/g.flag.yaml': 'id: g\nparent: a\nname: g\nkey: g\ndefault: on\n',
				's/g2.flag.yaml': 'id: g2\nparent: b\nname: g\nkey: g\n',
				's/m.model.yaml': 'id: m\nownedBy: a\nkey: x\nwhen: { flag: g, is: on }\n',
				's/u.logic-unit.yaml': [
					'id: u',
					'parent: b',
					'inputs: []',
					'outputs: []',
					'steps:',
					'  - { flag: g }',
					'  - { flag: m, on: [] }',
					'  - { note: x, on: [] }'
				].join('\n')
			})
		).toEqual([
			['error', 'flag-key', 'flag "f" needs key'],
			['error', 'flag-only', 'only flags have key'],
			['error', 'flag-gate', 'only apis, logic units and triggers have when'],
			['error', 'flag-scope', `flag "g" is defined outside this unit's module`],
			['error', 'logic-step', 'a flag step needs on, off or both'],
			['error', 'logic-target', 'flag names model "m"; allowed: flag'],
			['error', 'logic-step', 'on goes with flag'],
			['warning', 'flag-unused', 'flag "f" is never checked: no flag step or when names it'],
			['warning', 'flag-unused', 'flag "g" is never checked: no flag step or when names it'],
			[
				'warning',
				'flag-defaults',
				'flag key "g" is on by default in s/g.flag.yaml but off elsewhere: production is split'
			],
			[
				'warning',
				'flag-defaults',
				'flag key "g" is on by default in s/g.flag.yaml but off elsewhere: production is split'
			]
		]);
	});
});

describe('flag states', () => {
	it('prunes gated items and replaces flag steps with the branch taken', () => {
		const d = design();
		const { data, touched } = pruneFlags(d.data, flagStateOf(d.model, { 'shop-flag': true }));
		expect(data['erp/v2.api.yaml']).toBeUndefined();
		expect((data['shop/place.logic-unit.yaml'] as { steps: unknown[] }).steps).toEqual([
			{ call: 'v2', gets: 'order' },
			{ note: 'done' }
		]);
		expect([...touched].sort()).toEqual(['erp/v2.api.yaml', 'shop/place.logic-unit.yaml']);
	});

	it('links every branch in the whole design, only the taken one in a state', () => {
		const d = design();
		expect(d.model.elements.get('place')!.logic!.calls).toEqual(['v2', 'v1']);
		const drawn = buildModel(d.data, undefined, { 'shop-flag': true });
		expect(drawn.elements.get('place')!.logic!.calls).toEqual(['v2']);
		expect([...gatedOff(drawn)]).toEqual(['v2']);
	});

	it('finds what a split breaks, and nothing when both sides flip', () => {
		const all = design().model;
		const defaults = at({}).model;
		const split = flagFindings(all, defaults, at({ 'shop-flag': true }).model);
		expect(split).toEqual([
			{
				level: 'breaking',
				at: 'place',
				message: 'placeOrder calls POST /orders/v2, which ERP has only when its newFlow is on'
			}
		]);
		const both = at({ 'shop-flag': true, 'erp-flag': true });
		expect(flagFindings(all, defaults, both.model)).toEqual([]);
		// The old api is gone, but its caller now calls the new one: nothing breaks.
		const c = compare(at({}), both);
		expect(c.report.impacts.filter((i) => i.level === 'breaking')).toEqual([]);
		expect(c.diff.entries.map((e) => [e.id, e.change]).sort()).toEqual([
			['place', 'changed'],
			['v1', 'dropped'],
			['v2', 'added']
		]);
	});

	it('flags a read nothing writes in the state', () => {
		const files = {
			's/s.module.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/f.flag.yaml': 'id: f\nparent: m\nname: f\nkey: f\n',
			's/d.model.yaml': 'id: d\nownedBy: m\n',
			's/w.logic-unit.yaml':
				'id: w\nparent: m\nname: writer\nwhen: { flag: f, is: off }\ninputs: []\noutputs: []\nsteps: [{ write: d }]\n',
			's/r.logic-unit.yaml':
				'id: r\nparent: m\nname: reader\ninputs: []\noutputs: []\nsteps: [{ read: d }]\n'
		};
		const d = loadStrings(files);
		const st = (o: Record<string, boolean>) => stateOf(d.data, flagStateOf(d.model, o)).model;
		expect(flagFindings(d.model, st({}), st({ f: true }))).toEqual([
			{ level: 'check', at: 'r', message: 'reader reads d, which nothing writes in this state' }
		]);
	});
});

describe('flag steps in the unit card and player', () => {
	it('draws both branches in a flag box, dimming the one not taken', () => {
		const d = design();
		const seq = sequenceOf(buildModel(d.data, undefined, {}), 'place');
		expect(seq.frags).toEqual([
			{
				label: 'flag',
				guard: '[newFlow on]',
				top: 1,
				bottom: 6,
				depth: 0,
				dividers: [{ row: 4, guard: '[off]' }],
				dim: true
			}
		]);
		expect(seq.messages.filter((m) => m.dim).map((m) => m.text)).toEqual([
			'POST /orders/v2',
			'order'
		]);
		expect(seq.lifelines.map((l) => l.name)).toEqual(['Caller', 'placeOrder', 'Order']);
	});

	it('plays the branch the state takes without asking', () => {
		const d = design();
		const run = runOf(buildModel(d.data, undefined, { 'shop-flag': true }), 'place', {}, new Set());
		expect(run.pending).toBe(false);
		expect(run.steps.map((s) => s.text)).toEqual(['()', 'POST /orders/v2', 'order', 'done']);
	});
});
