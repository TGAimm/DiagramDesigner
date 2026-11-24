import { describe, expect, it } from 'vitest';
import { sequenceOf } from '../../src/lib/landscape/sequence';
import { triggerGlyph, triggerWords } from '../../src/lib/model/message';
import type { Element } from '../../src/lib/model/schema';
import { loadStrings } from './helpers';

const base: Record<string, string> = {
	's/s.module.yaml': 'id: s\n',
	's/m.module.yaml': 'id: m\nparent: s\n',
	's/a.model.yaml': 'id: a\nownedBy: m\nfields: [{ id: a-kind, name: kind, type: string }]\n',
	's/b.model.yaml': 'id: b\nownedBy: m\nfields: [{ id: b-kind, name: kind, type: string }]\n',
	's/page.model.yaml': [
		'id: page',
		'ownedBy: m',
		'generic: T',
		'fields:',
		'  - { id: page-items, name: items, type: T, many: true }',
		'  - { id: page-total, name: total, type: int }'
	].join('\n')
};
const model = (fields: string[]) =>
	['id: x', 'ownedBy: m', 'fields:', ...fields.map((f) => `  - ${f}`)].join('\n');
const diags = (extra: Record<string, string>) =>
	loadStrings({ ...base, ...extra })
		.model.diagnostics.filter((d) => d.code !== 'logic-unused')
		.map((d) => [d.code, d.message]);

describe('field shapes', () => {
	it('takes enums, maps, unions and generics, with their descriptions', () => {
		expect(
			diags({
				's/x.model.yaml': model([
					'{ id: x-state, name: state, type: string, values: [draft, sent], description: Where it is }',
					'{ id: x-prices, name: prices, map: string, type: decimal }',
					'{ id: x-event, name: event, oneOf: [a, b], discriminator: kind }',
					'{ id: x-page, name: page, model: page, of: a }'
				])
			})
		).toEqual([]);
	});

	it('needs exactly one of type, model and oneOf, and the keys that go with each', () => {
		expect(
			diags({
				's/x.model.yaml': model([
					'{ id: x-1, name: one, type: string, oneOf: [a, b] }',
					'{ id: x-2, name: two, model: a, values: [p] }',
					'{ id: x-3, name: three, type: string, discriminator: kind }',
					'{ id: x-4, name: four, type: string, of: a }'
				])
			})
		).toEqual([
			['field-type', 'field "one" has type and oneOf; give exactly one of type, model and oneOf'],
			['field-shape', 'field "two": values go with type'],
			['field-shape', 'field "three": discriminator goes with oneOf'],
			['field-shape', 'field "four": of goes with model']
		]);
	});

	it('checks the models a shape names, and that generics are filled', () => {
		expect(
			diags({
				's/x.model.yaml': model([
					'{ id: x-1, name: one, oneOf: [a, m] }',
					'{ id: x-2, name: two, model: page }',
					'{ id: x-3, name: three, model: a, of: b }'
				])
			})
		).toEqual([
			['not-a-model', 'field "one": oneOf names "m", which is not a model'],
			['field-generic', 'field "two": "page" is generic, so give of (its T)'],
			['field-generic', 'field "three": "a" is not generic, so it takes no of']
		]);
	});

	it('gives logic fields constraints and shapes too', () => {
		expect(
			diags({
				's/u.logic-unit.yaml': [
					'id: u',
					'parent: m',
					'inputs: [{ id: u-q, name: quantity, type: int, constraints: [positive] }]',
					'outputs: [{ id: u-s, name: state, type: string, values: [ok, low] }]'
				].join('\n')
			})
		).toEqual([]);
	});
});

describe('lineage through api fields', () => {
	const api = (id: string, fields: string) =>
		`id: ${id}\nparent: m\nmethod: GET\npath: /${id}\nresponses:\n  - { status: 200, fields: [${fields}] }\n`;
	it('lets a model field or a response field come from another api’s field', () => {
		expect(
			diags({
				's/src.api.yaml': api('src', '{ id: src-price, name: price, type: decimal, derived: computed }'),
				's/proxy.api.yaml': api('proxy', '{ id: proxy-price, name: price, type: decimal, from: [src-price] }'),
				's/x.model.yaml': model(['{ id: x-price, name: price, type: decimal, from: [proxy-price] }'])
			})
		).toEqual([]);
	});

	it('finds cycles through them', () => {
		expect(
			diags({
				's/one.api.yaml': api('one', '{ id: one-f, name: f, type: int, from: [two-f] }'),
				's/two.api.yaml': api('two', '{ id: two-f, name: f, type: int, from: [one-f] }')
			}).map(([c]) => c)
		).toEqual(['lineage-cycle']);
	});
});

describe('render and emit', () => {
	const unit = (id: string, extra: string[]) =>
		[`id: ${id}`, 'parent: m', 'inputs: []', 'outputs: []', ...extra].join('\n');
	const files = (parentSteps: string, childEmits = 'emits: [{ id: c-sel, name: select, type: string }]') => ({
		's/p.logic-unit.yaml': unit('p', ['steps:', parentSteps]),
		's/c.logic-unit.yaml': unit('c', [childEmits, 'steps: [{ emit: select, with: the id }]'])
	});

	it('renders a unit, runs steps on its events, and counts the render as a call', () => {
		const loaded = loadStrings({
			...base,
			...files('  - { render: c, with: items, events: { select: [{ call: c }] } }')
		}).model;
		expect(loaded.diagnostics).toEqual([]);
		expect(loaded.elements.get('p')!.logic).toMatchObject({ calls: ['c'], renders: ['c'] });
	});

	it('checks event names against emits, and emits against the unit’s own', () => {
		expect(
			diags({
				...files('  - { render: c, events: { open: [] } }'),
				's/c.logic-unit.yaml': unit('c', [
					'emits: [{ id: c-sel, name: select, type: string }]',
					'steps: [{ emit: close }]'
				])
			})
		).toEqual([
			['logic-emit', 'emits "close", which is not in emits'],
			['render-event', '"c" emits no "open"; it emits select']
		]);
		expect(diags(files('  - { call: c, events: { select: [] } }')).map(([c]) => c)).toEqual([
			'logic-step'
		]);
	});
});

describe('render and emit, drawn and played', () => {
	const unit = (id: string, extra: string[]) =>
		[`id: ${id}`, 'parent: m', 'inputs: []', 'outputs: []', ...extra].join('\n');
	const files = {
		...base,
		's/p.logic-unit.yaml': unit('p', [
			'steps:',
			'  - { render: c, with: items, events: { select: [{ note: open it }] } }'
		]),
		's/c.logic-unit.yaml': unit('c', [
			'emits: [{ id: c-sel, name: select, type: string }]',
			'steps: [{ emit: select, with: the id }]'
		])
	};

	it('draws a render as an async message and each event as an on box', () => {
		const seq = sequenceOf(loadStrings(files).model, 'p');
		expect(seq.messages.map((m) => m.text)).toContain('renders c (items)');
		expect(seq.frags).toMatchObject([{ label: 'on', guard: '[c emits select]' }]);
		expect(seq.notes.map((n) => n.text)).toEqual(['open it']);
		expect(sequenceOf(loadStrings(files).model, 'c').messages.map((m) => m.text)).toContain(
			'emits select (the id)'
		);
	});

	it('words a by trigger and gives it its glyph', () => {
		const def = { by: { user: 'clicks Add to cart' } } as Element;
		expect(triggerWords(def)).toBe('User · clicks Add to cart');
		expect(triggerGlyph(def)).toBe('user');
	});
});
