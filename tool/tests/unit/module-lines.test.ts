import { describe, expect, it } from 'vitest';
import { edgesOf, moduleLines, moduleLook } from '../../src/lib/landscape/connections';
import { layoutLandscape } from '../../src/lib/landscape/layout';
import { loadStrings } from './helpers';

const unit = (id: string, parent: string, steps: string) =>
	`id: ${id}\nparent: ${parent}\nname: ${id}\ninputs: []\noutputs: []\nsteps: ${steps}\n`;

// NDI Website (w) holds Basket, which holds a controller and a service, and Checkout. Product
// (p) holds Price and Catalog; Catalog owns the item model, which Price stores.
const model = loadStrings({
	'w/w.module.yaml': 'id: w\n',
	'w/basket.module.yaml': 'id: basket\nparent: w\n',
	'w/ctrl.module.yaml': 'id: ctrl\nparent: basket\n',
	'w/svc.module.yaml': 'id: svc\nparent: basket\n',
	'w/checkout.module.yaml': 'id: checkout\nparent: w\n',
	'p/p.module.yaml': 'id: p\n',
	'p/price.module.yaml': 'id: price\nparent: p\n',
	'p/catalog.module.yaml': 'id: catalog\nparent: p\n',
	'p/item.model.yaml':
		'id: item\nownedBy: catalog\nstoredIn: price\nfields: [{ id: item-id, name: id, type: uuid, pk: true }]\n',
	'w/add.logic-unit.yaml': unit('add', 'ctrl', '[{ call: bundle }, { call: get-price }]'),
	'w/bundle.logic-unit.yaml': unit('bundle', 'svc', '[{ read: item }]'),
	'w/order.logic-unit.yaml': unit('order', 'checkout', '[{ call: add }]'),
	'p/get-price.logic-unit.yaml': unit('get-price', 'price', '[{ note: look it up }]')
}).model;
const { boxes } = layoutLandscape(model);
const boxById = new Map(boxes.map((b) => [b.id, b]));
const lines = moduleLines(model, edgesOf(model), (id) => boxById.has(id));

describe('Module Dependency Lines', () => {
	it('join sibling modules, one per pair and direction, lifted so none crosses a border', () => {
		expect(model.diagnostics).toEqual([]);
		expect(lines.map((l) => [l.id, l.parentId, l.kinds, l.count])).toEqual([
			['checkout>basket', 'w', ['calls'], 1],
			['ctrl>svc', 'basket', ['calls'], 1],
			// Price stores Catalog's item, so it depends on Catalog.
			['price>catalog', 'p', ['stores'], 1],
			['w>p', undefined, ['calls', 'reads'], 2]
		]);
	});

	it('go by the module owning each end, not where it is drawn', () => {
		// The item is drawn as a table in Price, but Catalog owns it: reading it depends on Catalog.
		expect(lines.find((l) => l.id === 'w>p')!.pairs).toEqual([
			{ from: 'ctrl', to: 'price' },
			{ from: 'svc', to: 'catalog' }
		]);
	});

	it('count every kind of connection, keys and lineage too', () => {
		const m = loadStrings({
			'a/a.module.yaml': 'id: a\n',
			'b/b.module.yaml': 'id: b\n',
			'b/t.model.yaml':
				'id: t\nownedBy: b\nfields: [{ id: t-id, name: id, type: uuid, pk: true }, { id: t-n, name: n, type: int }]\n',
			'a/u.model.yaml':
				'id: u\nownedBy: a\nfields: [{ id: u-t, name: tId, type: uuid, ref: t-id }, { id: u-n, name: n, type: int, from: [t-n] }]\n'
		}).model;
		const all = moduleLines(m, edgesOf(m), () => true);
		expect(all.map((l) => [l.id, l.kinds, l.count])).toEqual([['a>b', ['ref', 'from'], 2]]);
	});
});

describe('looking at a module', () => {
	it('lights its own lines and those round it carrying its dependencies', () => {
		const look = moduleLook(boxes, boxById, lines, 'basket');
		expect([...look.lit].sort()).toEqual(['checkout>basket', 'w>p']);
		// The line inside Basket stays as it is at rest.
		expect([...look.inside]).toEqual(['ctrl>svc']);
	});

	it('keeps bright only the modules really depended on in a far box', () => {
		const look = moduleLook(boxes, boxById, lines, 'ctrl');
		expect([...look.lit].sort()).toEqual(['checkout>basket', 'ctrl>svc', 'w>p']);
		for (const id of ['ctrl', 'basket', 'w', 'svc', 'checkout', 'price', 'p'])
			expect(look.bright.has(id)).toBe(true);
		// The controller calls Price; only the service reads Catalog's item.
		expect(look.bright.has('catalog')).toBe(false);
	});
});
