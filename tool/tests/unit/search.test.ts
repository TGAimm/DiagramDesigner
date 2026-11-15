import { describe, expect, it } from 'vitest';
import { searchLandscape } from '../../src/lib/landscape/search';
import { loadStrings } from './helpers';

const { model } = loadStrings({
	'erp/erp.module.yaml': 'id: erp\nname: ERP\n',
	'pim/pim.module.yaml': 'id: pim\nname: PIM\n',
	'erp/order.module.yaml': 'id: m\nparent: erp\nname: Order\n',
	'erp/order.model.yaml': [
		'id: o',
		'ownedBy: m',
		'name: Order',
		'fields:',
		'  - { id: o-no, name: orderNo, type: string }',
		'  - { id: o-total, name: total, type: decimal }'
	].join('\n'),
	'erp/line.model.yaml': 'id: l\nownedBy: m\nname: Sales Order Line\n',
	'erp/place.api.yaml': 'id: a\nparent: m\nname: Place order\nmethod: POST\npath: /checkout\n',
	'erp/get.api.yaml': 'id: g\nparent: m\nname: Get one\nmethod: GET\npath: /orders/{orderNo}\n',
	'erp/place.logic-unit.yaml': 'id: u\nparent: m\nname: placeOrder\n'
});

describe('searchLandscape', () => {
	it('lists the systems when nothing is typed', () => {
		expect(searchLandscape(model, '  ')).toEqual([
			{
				kind: 'system',
				title: 'SYSTEMS',
				hits: [
					{ kind: 'system', id: 'erp', text: 'ERP', at: [] },
					{ kind: 'system', id: 'pim', text: 'PIM', at: [] }
				]
			}
		]);
	});

	it('groups hits in landscape order, names starting with the query first', () => {
		const groups = searchLandscape(model, 'ORDER');
		expect(groups.map((g) => g.kind)).toEqual(['module', 'model', 'field', 'api', 'logic-unit']);
		const models = groups.find((g) => g.kind === 'model')!.hits;
		expect(models.map((h) => [h.text, h.mark])).toEqual([
			['Order', [0, 5]],
			['Sales Order Line', [6, 11]]
		]);
		expect(groups.find((g) => g.kind === 'field')!.hits).toEqual([
			{ kind: 'field', id: 'o-no', text: 'orderNo', mark: [0, 5], at: ['ERP', 'Order', 'Order'] }
		]);
		expect(groups.find((g) => g.kind === 'logic-unit')!.hits[0].at).toEqual(['ERP', 'Order']);
	});

	it('lists a root module as a system and the rest as modules', () => {
		const groups = searchLandscape(model, 'r');
		expect(groups.find((g) => g.kind === 'system')!.hits.map((h) => h.id)).toEqual(['erp']);
		expect(groups.find((g) => g.kind === 'module')!.hits.map((h) => h.id)).toEqual(['m']);
	});

	it('finds apis by path, or by name shown beside the path', () => {
		const apis = searchLandscape(model, 'order').find((g) => g.kind === 'api')!.hits;
		expect(apis.map((h) => [h.method, h.text, h.mark, h.alt])).toEqual([
			['GET', '/orders/{orderNo}', [1, 6], undefined],
			['POST', '/checkout', undefined, { text: 'Place order', mark: [6, 11] }]
		]);
	});

	it('finds nothing for a query matching no name', () => {
		expect(searchLandscape(model, 'zzz')).toEqual([]);
	});
});
