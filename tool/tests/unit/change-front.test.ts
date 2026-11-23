import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { flagStateOf, type Model } from '../../src/lib/model/model';
import { compare } from '../../src/lib/scenario/evaluate';
import { endsOf, flagFront, scenarioFront, type Front } from '../../src/lib/scenario/front';
import { loadDesign } from '../../src/lib/model/loader';
import { loadStrings } from './helpers';

/**
 * The shop's place calls ERP's new api when the key is on and its old one when off; each has a
 * handler. The old one writes Order's note and code; the new one only its id, and calls audit,
 * which nothing else calls and which writes Log. Report reads the code and calls mailer; GET
 * /orders/{id} returns Order; summary takes Order whole; copier mentions the note; sync writes
 * the id whatever the key.
 */
const unit = (id: string, parent: string, more: string[]) =>
	[`id: ${id}`, `parent: ${parent}`, `name: ${id}`, 'inputs: []', 'outputs: []', ...more].join(
		'\n'
	);
const FILES = {
	'shop/shop.module.yaml': 'id: shop\nname: Shop\n',
	'shop/f.flag.yaml': 'id: f\nparent: shop\nname: newFlow\nkey: new-flow\n',
	'shop/checkout.api.yaml': 'id: checkout\nparent: shop\nmethod: POST\npath: /checkout\n',
	'shop/place.logic-unit.yaml': unit('place', 'shop', [
		'handles: [checkout]',
		'steps:',
		'  - flag: f',
		'    on: [{ call: new-api }]',
		'    off: [{ call: old-api }]'
	]),
	'erp/erp.module.yaml': 'id: erp\nname: ERP\n',
	'erp/order.model.yaml': [
		'id: order',
		'ownedBy: erp',
		'name: Order',
		'fields:',
		'  - { id: o-id, name: id, type: uuid, pk: true }',
		'  - { id: o-note, name: note, type: string, nullable: true }',
		'  - { id: o-code, name: code, type: string, required: true }'
	].join('\n'),
	'erp/log.model.yaml':
		'id: log\nownedBy: erp\nname: Log\nfields:\n  - { id: l-msg, name: msg, type: string }\n',
	'erp/old.api.yaml': 'id: old-api\nparent: erp\nmethod: POST\npath: /old\n',
	'erp/new.api.yaml': 'id: new-api\nparent: erp\nmethod: POST\npath: /new\n',
	'erp/get.api.yaml':
		'id: get-order\nparent: erp\nmethod: GET\npath: /orders\nresponses:\n  - { status: 200, model: order }\n',
	'erp/h-old.logic-unit.yaml': unit('h-old', 'erp', [
		'handles: [old-api]',
		'steps:',
		'  - { write: o-id }',
		'  - { write: o-note }',
		'  - { write: o-code }'
	]),
	'erp/h-new.logic-unit.yaml': unit('h-new', 'erp', [
		'handles: [new-api]',
		'steps:',
		'  - { write: o-id }',
		'  - { call: audit }'
	]),
	'erp/audit.logic-unit.yaml': unit('audit', 'erp', ['steps:', '  - { write: log }']),
	'erp/report.logic-unit.yaml': unit('report', 'erp', [
		'handles: [get-order]',
		'steps:',
		'  - { read: o-code }',
		'  - { call: mailer }'
	]),
	'erp/mailer.logic-unit.yaml': unit('mailer', 'erp', ['steps:', '  - { note: send it }']),
	'erp/summary.logic-unit.yaml': [
		'id: summary',
		'parent: erp',
		'name: summary',
		'inputs: [{ id: sum-in, name: order, model: order }]',
		'outputs: []',
		'steps:',
		'  - { note: totals }'
	].join('\n'),
	'erp/copier.logic-unit.yaml': [
		'id: copier',
		'parent: erp',
		'name: copier',
		'inputs: [{ id: copy-in, name: order, model: order }]',
		'outputs: []',
		'steps:',
		'  - { note: copies the note }'
	].join('\n'),
	'erp/sync.logic-unit.yaml': unit('sync', 'erp', ['steps:', '  - { write: o-id }'])
};

const { model, data } = loadStrings(FILES);
const front = flagFront(data, model, 'new-flow', flagStateOf(model, {}));
const at = (f: Front, id: string) => f.level.get(id);

describe('the front of a flag flip', () => {
	it('has no errors to start from', () => {
		expect(model.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
	});

	it('carries the change through what runs in one state only', () => {
		expect(at(front, 'place')).toBe('changed');
		expect([...front.stepped]).toEqual(['place']);
		for (const id of ['old-api', 'new-api', 'h-old', 'h-new', 'audit'])
			expect(at(front, id)).toBe('changed');
		// Audit writes Log only when on.
		expect(at(front, 'l-msg')).toBe('changed');
	});

	it('stops where a field is written either way', () => {
		expect(at(front, 'order')).toBe('stopped');
		expect(front.keep.has('sync')).toBe(false);
	});

	it('breaks where a field nothing writes is read, and goes no further', () => {
		expect(at(front, 'o-code')).toBe('breaking');
		expect(at(front, 'report')).toBe('breaking');
		expect(front.keep.has('mailer')).toBe(false);
		expect(at(front, 'get-order')).toBe('breaking');
	});

	it('only asks to check a nullable field nothing writes', () => {
		expect(at(front, 'o-note')).toBe('check');
	});

	it('stops at a unit taking the model whole, unless its text names the field', () => {
		expect(at(front, 'summary')).toBe('stopped');
		expect(at(front, 'copier')).toBe('check');
	});

	it('draws the way in of a changed unit', () => {
		expect(at(front, 'checkout')).toBe('way-in');
		expect(front.keep.has('checkout')).toBe(true);
	});

	it('lists where it ends, worst first, each item once', () => {
		const ends = endsOf(front);
		expect(ends[0].level).toBe('breaking');
		expect(ends.map((o) => o.level)).toEqual(
			[...ends.map((o) => o.level)].sort(
				(a, b) =>
					['breaking', 'check', 'stopped'].indexOf(a) - ['breaking', 'check', 'stopped'].indexOf(b)
			)
		);
		expect(new Set(ends.map((o) => o.id)).size).toBe(ends.length);
		const report = ends.find((o) => o.id === 'report')!;
		expect(report.reason).toBe('reads code, but nothing writes Order.code with newFlow on');
		expect(report.label).toBe('report');
	});
});

describe('the front of a scenario', () => {
	it('ends at what the change breaks', () => {
		const before = { model, data };
		const gone = {
			...FILES,
			'erp/order.model.yaml': FILES['erp/order.model.yaml'].split('\n').slice(0, -1).join('\n')
		};
		const after = loadStrings(gone);
		const f = scenarioFront(compare(before, { model: after.model, data: after.data }));
		expect(at(f, 'o-code')).toBe('changed');
		expect(at(f, 'report')).toBe('breaking');
		expect(f.keep.has('order')).toBe(true);
		expect(f.keep.has('mailer')).toBe(false);
	});
});

describe('on the commerce example', () => {
	const root = fileURLToPath(new URL('../../../examples/commerce', import.meta.url));
	const walk = (dir: string): string[] =>
		readdirSync(dir).flatMap((n) => {
			const a = path.join(dir, n);
			return statSync(a).isDirectory() ? walk(a) : [path.relative(root, a)];
		});
	const d = loadDesign(
		walk(root)
			.filter((f) => f.endsWith('.yaml'))
			.map((p) => ({ path: p, text: readFileSync(path.join(root, p), 'utf8') }))
	);
	const names = (m: Model, ids: Iterable<string>) =>
		[...ids].map((id) => {
			const e = m.elements.get(id)!;
			return e.def.kind === 'api' ? `${e.def.method} ${e.def.path}` : e.name;
		});

	it('reaches what new-order-flow changes and no further', () => {
		const f = flagFront(d.data, d.model, 'new-order-flow', flagStateOf(d.model, {}));
		expect(names(d.model, f.keep).sort()).toEqual(
			[
				'GET /orders/{orderNo}',
				'Order',
				'POST /checkout',
				'POST /orders',
				'POST /orders/v2',
				'onPlaceOrder',
				'placeOrder'
			].sort()
		);
		// v2 has no comment: with the key on nothing writes Order.note.
		const note = [...d.model.fields].find(
			([, x]) =>
				x.def.name === 'note' &&
				x.modelId !== undefined &&
				d.model.elements.get(x.modelId)?.name === 'Order'
		)![0];
		expect(f.level.get(note)).toBe('check');
	});
});
