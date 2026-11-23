import { describe, expect, it } from 'vitest';
import { focusOf, focusOn, type Focus } from '../../src/lib/landscape/focus';
import { FOLD, layoutLandscape, TABLE } from '../../src/lib/landscape/layout';
import { loadStrings } from './helpers';

// Order holds its lines and refers to a customer; a line refers to a product and takes its
// price from Price; an api returns Order; a unit calls the api. The customer is stored apart.
const { model } = loadStrings({
	'erp/erp.module.yaml': 'id: erp\nname: ERP\n',
	'erp/order.module.yaml': 'id: om\nparent: erp\nname: Order\n',
	'erp/customer.module.yaml': 'id: cm\nparent: erp\nname: Customer\n',
	'erp/product.module.yaml': 'id: pm\nparent: erp\nname: Product\n',
	'erp/db.module.yaml': 'id: db\nparent: erp\nname: Database\n',
	'erp/order.model.yaml': [
		'id: o',
		'ownedBy: om',
		'name: Order',
		'fields:',
		'  - { id: o-id, name: id, type: uuid, pk: true }',
		'  - { id: o-cust, name: customerId, type: uuid, ref: c-id }',
		'  - { id: o-lines, name: lines, model: l, many: true }'
	].join('\n'),
	'erp/line.model.yaml': [
		'id: l',
		'ownedBy: om',
		'name: Order Line',
		'fields:',
		'  - { id: l-no, name: lineNo, type: int }',
		'  - { id: l-prod, name: productId, type: uuid, ref: p-id }',
		'  - { id: l-price, name: unitPrice, type: decimal, from: [p-price] }'
	].join('\n'),
	'erp/customer.model.yaml': [
		'id: c',
		'ownedBy: cm',
		'storedIn: db',
		'name: Customer',
		'fields:',
		'  - { id: c-name, name: name, type: string }',
		'  - { id: c-id, name: id, type: uuid, pk: true }'
	].join('\n'),
	'erp/product.model.yaml': [
		'id: p',
		'ownedBy: pm',
		'name: Product',
		'fields:',
		'  - { id: p-id, name: id, type: uuid, pk: true }',
		'  - { id: p-price, name: price, type: decimal }'
	].join('\n'),
	'erp/get.api.yaml': [
		'id: a',
		'parent: om',
		'name: Get order',
		'method: GET',
		'path: /orders/{id}',
		'responses:',
		'  - { status: 200, model: o }'
	].join('\n'),
	'erp/show.logic-unit.yaml': 'id: u\nparent: om\nname: showOrder\nsteps:\n  - { call: a }\n'
});

const kept = (f: Focus) =>
	[...focusOn(model, f).model.elements.values()]
		.filter((e) => ['model', 'api', 'logic-unit'].includes(e.def.kind))
		.map((e) => e.id)
		.sort();

// Order uses Customer (ref) and Order Line (holds); Order Line uses Product; the api uses Order
// (its body); the unit uses the api (calls).
describe('focusOn', () => {
	it('keeps what the subject uses and what uses it, one step each by default', () => {
		expect(kept(focusOf('o'))).toEqual(['a', 'c', 'l', 'o']);
		expect(kept(focusOf('o', { sides: 'uses' }))).toEqual(['c', 'l', 'o']);
		expect(kept(focusOf('o', { sides: 'usedBy' }))).toEqual(['a', 'o']);
	});

	it('follows each side on to its end with chain', () => {
		expect(kept(focusOf('o', { reach: 'chain' }))).toEqual(['a', 'c', 'l', 'o', 'p', 'u']);
		expect(kept(focusOf('o', { sides: 'uses', reach: 'chain' }))).toEqual(['c', 'l', 'o', 'p']);
		expect(kept(focusOf('o', { sides: 'usedBy', reach: 'chain' }))).toEqual(['a', 'o', 'u']);
	});

	it('never turns back: what uses a dependency is not a dependency', () => {
		// Customer is used by Order, which is used by the api, which the unit calls; Order Line,
		// which Order also uses, is not on Customer's chain.
		expect(kept(focusOf('c', { reach: 'chain' }))).toEqual(['a', 'c', 'o', 'u']);
		expect(kept(focusOf('c'))).toEqual(['c', 'o']);
	});

	it('keeps models only in a data focus, never bridged by an api or unit', () => {
		expect(kept(focusOf('o', { mode: 'data', reach: 'chain' }))).toEqual(['c', 'l', 'o', 'p']);
		// The api starts from the models it uses: its body's.
		expect(kept(focusOf('a', { mode: 'data' }))).toEqual(['o']);
		expect(kept(focusOf('a', { mode: 'data', reach: 'chain' }))).toEqual(['c', 'l', 'o', 'p']);
		expect(kept(focusOf('u', { mode: 'data' }))).toEqual([]);
	});

	it("starts a field's focus from that field's own links", () => {
		expect(kept(focusOf('o-cust'))).toEqual(['c', 'o']);
		// Chain goes on from the customer, not from the rest of Order.
		expect(kept(focusOf('o-cust', { reach: 'chain' }))).toEqual(['c', 'o']);
		expect(kept(focusOf('o-cust', { sides: 'usedBy' }))).toEqual(['o']);
	});

	it('shows what a module holds and its boundary, one step each way', () => {
		expect(kept(focusOf('om'))).toEqual(['a', 'c', 'l', 'o', 'p', 'u']);
		expect(kept(focusOf('om', { mode: 'data' }))).toEqual(['c', 'l', 'o', 'p']);
		// Sides and reach don't apply to a module.
		expect(kept(focusOf('om', { sides: 'uses', reach: 'chain' }))).toEqual(kept(focusOf('om')));
		// A module storing a model holds it.
		expect(kept(focusOf('db', { mode: 'data' }))).toEqual(['c', 'o']);
	});

	it('keeps the boxes round what is kept, and draws a model once, where it is owned', () => {
		const { model: m } = focusOn(model, focusOf('o', { mode: 'data' }));
		expect(m.rootElementIds).toEqual(['erp']);
		expect(m.elements.get('erp')!.childIds.sort()).toEqual(['cm', 'om']);
		expect(m.elements.get('om')!.childIds.sort()).toEqual(['l', 'o']);
		expect(m.elements.get('c')!.storedIn).toBeUndefined();
	});

	it("puts a neighbour's connecting rows first and folds the rest", () => {
		const f = focusOn(model, focusOf('o'));
		expect(f.model.elements.get('c')!.def.fields!.map((x) => x.id)).toEqual(['c-id', 'c-name']);
		expect(f.foldAt.get('c')).toBe(1);
		expect(f.foldAt.has('o')).toBe(false);
		const boxes = layoutLandscape(f.model, undefined, f.foldAt).boxes;
		const card = boxes.find((b) => b.id === 'c')!;
		expect(card.foldAt).toBe(1);
		// The name bar, the header row, one field row and the fold row.
		expect(card.height).toBe(TABLE.head + 3 * TABLE.rowHeight + 2);
	});

	it(`folds a neighbour no later than ${FOLD} rows, however many rows connect`, () => {
		const n = FOLD + 10;
		const f = focusOn(
			loadStrings({
				's/s.module.yaml': 'id: s\n',
				's/a.model.yaml': 'id: a\nownedBy: s\nfields:\n  - { id: a-id, name: id, type: uuid }\n',
				's/b.model.yaml': [
					'id: b',
					'ownedBy: s',
					'fields:',
					...Array.from(
						{ length: n },
						(_, i) => `  - { id: b${i}, name: b${i}, type: uuid, from: [a-id] }`
					),
					'  - { id: b-x, name: other, type: int }'
				].join('\n')
			}).model,
			focusOf('a')
		);
		expect(f.foldAt.get('b')).toBe(FOLD);
		const card = layoutLandscape(f.model, undefined, f.foldAt).boxes.find((b) => b.id === 'b')!;
		// The name bar, the header row, FOLD field rows and the fold row.
		expect(card.height).toBe(TABLE.head + (FOLD + 2) * TABLE.rowHeight + 2);
	});
});
