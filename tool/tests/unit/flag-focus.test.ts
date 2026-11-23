import { describe, expect, it } from 'vitest';
import {
	cutLike,
	flagReach,
	flagRoles,
	focusOf,
	focusOnFlag,
	type Focus
} from '../../src/lib/landscape/focus';
import { familyParts, flagSites } from '../../src/lib/landscape/flag-sites';
import { searchLandscape } from '../../src/lib/landscape/search';
import { buildModel, flagStateOf } from '../../src/lib/model/model';
import { loadStrings } from './helpers';

/**
 * One key in two systems: the shop's placeOrder (handling POST /checkout) calls v2 when on and
 * v1 when off; ERP has v1 only when off and v2 only when on, each with a unit handling it; v2's
 * handler writes Order. ERP's customer api has nothing to do with the flag.
 */
const FILES = {
	'shop/shop.module.yaml': 'id: shop\nname: Shop\n',
	'shop/co.module.yaml': 'id: co\nparent: shop\nname: Checkout\n',
	'shop/flag.flag.yaml': 'id: shop-flag\nparent: co\nname: newFlow\nkey: new-flow\n',
	'shop/checkout.api.yaml': 'id: checkout\nparent: co\nmethod: POST\npath: /checkout\n',
	'shop/place.logic-unit.yaml': [
		'id: place',
		'parent: co',
		'name: placeOrder',
		'handles: [checkout]',
		'inputs: []',
		'outputs: []',
		'steps:',
		'  - flag: shop-flag',
		'    on: [{ call: v2 }]',
		'    off: [{ call: v1 }]'
	].join('\n'),
	'erp/erp.module.yaml': 'id: erp\nname: ERP\n',
	'erp/order.module.yaml': 'id: om\nparent: erp\nname: Order\n',
	'erp/flag.flag.yaml': 'id: erp-flag\nparent: om\nname: newFlow\nkey: new-flow\n',
	'erp/order.model.yaml':
		'id: order\nownedBy: om\nname: Order\nfields:\n  - { id: o-id, name: id, type: uuid, pk: true }\n',
	'erp/v1.api.yaml':
		'id: v1\nparent: om\nmethod: POST\npath: /orders\nwhen: { flag: erp-flag, is: off }\n',
	'erp/v2.api.yaml':
		'id: v2\nparent: om\nmethod: POST\npath: /orders/v2\nwhen: { flag: erp-flag, is: on }\n',
	'erp/h1.logic-unit.yaml': 'id: h1\nparent: om\nname: createOrder\nhandles: [v1]\n',
	'erp/h2.logic-unit.yaml': [
		'id: h2',
		'parent: om',
		'name: createOrderV2',
		'handles: [v2]',
		'inputs: []',
		'outputs: []',
		'steps:',
		'  - { write: order }'
	].join('\n'),
	'erp/customers.api.yaml': 'id: cust\nparent: om\nmethod: GET\npath: /customers\n'
};

const { model, data } = loadStrings(FILES);
const flag = (over: Partial<Focus> = {}): Focus => focusOf('new-flow', { flag: true, ...over });
const kept = (f: { model: { elements: Map<string, unknown> } }) =>
	[...f.model.elements.keys()].sort();

describe('flag focus', () => {
	it('reaches the units checking the key, both branch ends, what is gated and their handlers', () => {
		expect([...flagReach(model, 'new-flow')].sort()).toEqual(['h1', 'h2', 'place', 'v1', 'v2']);
		expect(flagReach(model, 'no-such-key').size).toBe(0);
	});

	it('tells the part each plays', () => {
		const r = flagRoles(model, 'new-flow');
		expect([...r.checks]).toEqual(['place']);
		expect([...r.off]).toEqual(['v1']);
		expect([...r.on]).toEqual(['v2']);
		expect([...r.gated].sort()).toEqual(['v1', 'v2']);
		expect([...r.around].sort()).toEqual(['h1', 'h2', 'place']);
	});

	it('keeps what depends on the key alone when direct, with the boxes round it', () => {
		expect(kept(focusOnFlag(model, flag()))).toEqual(
			['co', 'erp', 'h1', 'h2', 'om', 'place', 'shop', 'v1', 'v2'].sort()
		);
	});

	it('chains up to who gets the new behaviour and down to where each branch leads', () => {
		const ids = kept(focusOnFlag(model, flag({ reach: 'chain' })));
		// Up: the api placeOrder handles. Down: v2's handler writes Order.
		expect(ids).toContain('checkout');
		expect(ids).toContain('order');
		expect(ids).not.toContain('cust');
	});

	it('keeps the models the reach touches in a data focus', () => {
		const ids = kept(focusOnFlag(model, flag({ mode: 'data' })));
		expect(ids).toContain('order');
		expect(ids).not.toContain('v2');
		expect(ids).not.toContain('place');
	});

	it('cuts each flag state like the whole design, so both draw in one layout', () => {
		const whole = focusOnFlag(model, flag());
		for (const on of [false, true]) {
			const state = buildModel(
				data,
				undefined,
				Object.fromEntries(flagStateOf(model, { 'shop-flag': on, 'erp-flag': on }))
			);
			const drawn = cutLike(whole, state);
			expect(kept(drawn)).toEqual(kept(whole));
			const calls = drawn.model.elements.get('place')!.logic!.calls;
			expect(calls).toEqual([on ? 'v2' : 'v1']);
		}
	});

	it('says what each branch of every flag step on the key does', () => {
		expect(flagSites(model, 'new-flow')).toEqual([
			{
				unit: 'place',
				flag: 'shop-flag',
				context: [],
				off: ['calls POST /orders'],
				on: ['calls POST /orders/v2']
			}
		]);
		const { model: m } = loadStrings({
			's/s.module.yaml': 'id: s\nname: S\n',
			's/f.flag.yaml': 'id: f\nparent: s\nname: F\nkey: f\n',
			's/u.logic-unit.yaml': [
				'id: u',
				'parent: s',
				'name: run',
				'inputs: []',
				'outputs: []',
				'steps:',
				'  - if: the country is DK',
				'    then:',
				'      - flag: f',
				'        on: [{ note: skipped }]'
			].join('\n')
		});
		expect(flagSites(m, 'f')).toEqual([
			{ unit: 'u', flag: 'f', context: ['if the country is DK'], off: [], on: ['skipped'] }
		]);
	});

	it("names each key of a family by the part of its name the others don't share", () => {
		expect(familyParts(['UseNewBilling.DK', 'UseNewBilling.SE', 'UseNewBilling.NO'])).toEqual([
			'DK',
			'SE',
			'NO'
		]);
		expect(familyParts(['a:x', 'a:y-z'])).toEqual(['x', 'y-z']);
		expect(familyParts(['alone'])).toEqual(['alone']);
		expect(familyParts(['same', 'same'])).toEqual(['same', 'same']);
	});

	it('is found in search once per key, where its first definition lives', () => {
		const flags = searchLandscape(model, 'newfl').find((g) => g.kind === 'flag')!;
		expect(flags.hits).toEqual([
			{ kind: 'flag', id: 'new-flow', text: 'newFlow', mark: [0, 5], at: ['ERP', 'Order'] }
		]);
	});
});
