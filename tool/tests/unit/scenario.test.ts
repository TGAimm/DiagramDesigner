import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseDocument } from 'yaml';
import { loadDesign } from '../../src/lib/model/loader';
import { parseFile } from '../../src/lib/model/parse';
import { applyChanges, type Docs } from '../../src/lib/scenario/apply';
import { diffModels } from '../../src/lib/scenario/diff';
import { evaluate } from '../../src/lib/scenario/evaluate';
import { marksOf } from '../../src/lib/scenario/marks';
import {
	appendChange,
	newScenarioText,
	readScenario,
	removeChange,
	stringify
} from '../../src/lib/scenario/scenario';
import { loadStrings } from './helpers';

const EXAMPLE = fileURLToPath(new URL('../../../examples/commerce', import.meta.url));

function walk(dir: string, base = dir): string[] {
	return readdirSync(dir).flatMap((name) => {
		const abs = path.join(dir, name);
		return statSync(abs).isDirectory()
			? walk(abs, base)
			: [path.relative(base, abs).split(path.sep).join('/')];
	});
}

function example() {
	const sources = walk(EXAMPLE).map((p) => ({
		path: p,
		text: readFileSync(path.join(EXAMPLE, p), 'utf8')
	}));
	const design = loadDesign(sources);
	const docs: Docs = Object.fromEntries(Object.entries(design.parsed).map(([f, p]) => [f, p.doc]));
	return { design, docs, sources };
}

const docsOf = (files: Record<string, string>): Docs =>
	Object.fromEntries(Object.entries(files).map(([f, t]) => [f, parseDocument(t)]));

const MODEL = `id: m1
ownedBy: s1
name: Order
fields:
  - { id: f1, name: total, type: decimal }
  - { id: f2, name: note, type: string, nullable: true }
`;

describe('applyChanges', () => {
	it('sets a key when was matches, keeping the rest of the file as written', () => {
		const out = applyChanges(docsOf({ 'o.model.yaml': MODEL }), [
			{ set: 'f1', key: 'name', was: 'total', to: 'amount' }
		]);
		expect(out.results[0].status).toBe('ok');
		expect(stringify(out.docs['o.model.yaml'])).toBe(MODEL.replace('total', 'amount'));
	});

	it('reports a stale change and leaves the file alone', () => {
		const docs = docsOf({ 'o.model.yaml': MODEL });
		const out = applyChanges(docs, [{ set: 'f1', key: 'name', was: 'sum', to: 'amount' }]);
		expect(out.results[0]).toMatchObject({ status: 'stale', message: 'is now "total", not "sum"' });
		expect(out.touched.size).toBe(0);
		expect(out.docs['o.model.yaml']).toBe(docs['o.model.yaml']);
	});

	it('removes a key when to is absent, and reports missing ids', () => {
		const out = applyChanges(docsOf({ 'o.model.yaml': MODEL }), [
			{ set: 'f2', key: 'nullable', was: true },
			{ drop: 'nope' }
		]);
		expect(stringify(out.docs['o.model.yaml'])).toContain('{ id: f2, name: note, type: string }');
		expect(out.results[1].status).toBe('missing');
	});

	it('adds a field after another, and changes it in a later change', () => {
		const out = applyChanges(docsOf({ 'o.model.yaml': MODEL }), [
			{ add: 'f3', in: 'm1', after: 'f1', field: { name: 'vat', type: 'decimal' } },
			{ set: 'f3', key: 'required', to: true }
		]);
		expect(stringify(out.docs['o.model.yaml'])).toContain(
			'  - { id: f1, name: total, type: decimal }\n  - { id: f3, name: vat, type: decimal, required: true }\n  - { id: f2'
		);
	});

	it('drops a field or a whole entity file', () => {
		const docs = docsOf({ 'o.model.yaml': MODEL });
		const out = applyChanges(docs, [{ drop: 'f2' }]);
		expect(stringify(out.docs['o.model.yaml'])).not.toContain('note');
		expect(applyChanges(docs, [{ drop: 'm1' }]).docs['o.model.yaml']).toBeUndefined();
	});

	it('refuses to reuse an id', () => {
		const out = applyChanges(docsOf({ 'o.model.yaml': MODEL }), [
			{ add: 'f1', in: 'm1', field: { name: 'x', type: 'int' } }
		]);
		expect(out.results[0].status).toBe('exists');
	});
});

describe('scenario files', () => {
	it('appends and removes changes as flow maps', () => {
		let text = newScenarioText('Tidy');
		text = appendChange(text, { set: 'f1', key: 'name', was: 'total', to: 'amount' });
		text = appendChange(text, { drop: 'f2' });
		expect(text).toBe(
			'name: Tidy\nchanges:\n  - { set: f1, key: name, was: total, to: amount }\n  - { drop: f2 }\n'
		);
		expect(removeChange(text)).toBe(
			'name: Tidy\nchanges:\n  - { set: f1, key: name, was: total, to: amount }\n'
		);
	});

	it('reports a set with both key and path', () => {
		const s = readScenario(
			parseFile('x.scenario.yaml', 'name: X\nchanges:\n  - { set: a, key: b, path: [c] }\n')
		);
		expect(s.changes).toEqual([]);
		expect(s.diagnostics[0]).toMatchObject({ code: 'scenario', line: 3 });
	});

	it('is not part of the design model', () => {
		const d = loadStrings({
			'o.model.yaml': MODEL,
			's.system.yaml': 'id: s1\nname: S\n',
			'scenarios/x.scenario.yaml': 'name: X\nchanges: []\n'
		});
		expect(d.diagnostics).toEqual([]);
		expect(d.model.files).not.toContain('scenarios/x.scenario.yaml');
	});
});

describe('diffModels', () => {
	it('tells renames, moves, adds and drops apart by id', () => {
		const before = loadStrings({
			's.system.yaml': 'id: s1\nname: S\n',
			'a.model.yaml': MODEL,
			'b.model.yaml': 'id: m2\nownedBy: s1\nname: B\nfields: []\n'
		}).model;
		const after = loadStrings({
			's.system.yaml': 'id: s1\nname: S\n',
			'a.model.yaml': MODEL.replace('name: total', 'name: amount').replace(
				/ {2}- \{ id: f2.*\n/,
				''
			),
			'b.model.yaml':
				'id: m2\nownedBy: s1\nname: B\nfields:\n  - { id: f2, name: note, type: string, nullable: true }\n  - { id: f9, name: x, type: int }\n'
		}).model;
		const d = diffModels(before, after);
		expect(d.byId.get('f1')).toMatchObject({ change: 'changed', renamedFrom: 'total', keys: [] });
		expect(d.byId.get('f2')).toMatchObject({ change: 'changed', movedFrom: 'm1' });
		expect(d.byId.get('f9')).toMatchObject({ change: 'added' });
		expect(d.entries).toHaveLength(3);
	});
});

describe('impact of the example scenario', () => {
	const { design, docs, sources } = example();
	const src = sources.find((s) => s.path === 'scenarios/tidy-cart.scenario.yaml')!;
	const scenario = readScenario(parseFile(src.path, src.text));
	const ev = evaluate(docs, design, scenario.changes);
	const of = (cause: string) =>
		ev.report.impacts
			.filter((i) => i.cause === cause)
			.map((i) => `${i.depth} ${i.level} ${label(i.id, i.part, i.table)}: ${i.reason}`)
			.sort();
	const label = (id: string, part?: string | number, table?: boolean) => {
		const el = design.model.elements.get(id);
		if (table) return `table ${el?.name}`;
		if (el?.def.kind === 'api') return `${el.def.method} ${el.def.path} ${part}`;
		return (
			el?.name ??
			design.model.fields.get(id)?.def.name ??
			design.model.apiFields.get(id)?.def.name ??
			id
		);
	};

	it('applies cleanly', () => {
		expect(ev.results.map((r) => r.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
		expect(ev.after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		expect([...ev.dropped].sort()).toEqual(['ln23p2vbg7', 'owts056ek0']);
		const cart = ev.union.elements.get('uzi5stl672')!;
		expect(cart.def.fields?.map((f) => f.name)).toContain('customerId');
		expect(ev.union.fields.get('dj8m2h65tb')?.def.name).toBe('qty');
	});

	it('a rename breaks bodies that are the model and the table, not id-bound users', () => {
		expect(of('dj8m2h65tb')).toEqual([
			"1 breaking GET /cart 200: returns Cart, which holds Cart Line[]: the field's wire name changes",
			"1 breaking PATCH /cart/lines/{lineId} 200: the model itself: the field's wire name changes",
			"1 breaking POST /cart/lines 201: the model itself: the field's wire name changes",
			'1 breaking table Cart Line: stored column: needs a rename migration',
			'1 stopped quantity: own shape, keeps its own name',
			'1 stopped quantity: own shape, keeps its own name',
			'1 stopped updateCart: writes it by id',
			'2 breaking onAddToCart: calls POST /cart/lines',
			'2 breaking onChangeQuantity: calls PATCH /cart/lines/{lineId}',
			'2 breaking show: calls GET /cart'
		]);
	});

	it('finds the old name in nearby free text and offers the rewrite', () => {
		const m = ev.report.mentions.filter((x) => x.cause === 'dj8m2h65tb');
		expect(
			m.map((x) => `${design.model.elements.get(x.entity)!.name} ${x.path.join('.')}: ${x.to}`)
		).toEqual(expect.arrayContaining(['addToCart steps.2.else.0.note: insert, or add to qty']));
	});

	it('a drop loses stored data and breaks the bodies carrying it', () => {
		expect(of('owts056ek0')).toEqual(
			expect.arrayContaining([
				'1 breaking GET /cart 200: the model itself: the field is gone',
				'1 breaking table Cart: stored column: its data is dropped'
			])
		);
		expect(ev.report.impacts.find((i) => i.cause === 'owts056ek0' && i.table)?.data).toBe('loss');
	});

	it('an added nullable field is information only', () => {
		expect(of('k2v8sd0q1e').every((s) => s.includes(' info '))).toBe(true);
	});

	it('sums up the scenario', () => {
		expect(ev.summary).toMatchObject({ changed: 1, added: 1, dropped: 2, moved: 0 });
		expect(ev.summary.breaking).toBe(5);
		expect(ev.summary.affected).toBe(3);
	});

	it('marks what changed and rolls it up to the boxes round it', () => {
		const marks = marksOf(ev);
		expect(marks.glyph.get('dj8m2h65tb')).toBe('~');
		expect(marks.glyph.get('k2v8sd0q1e')).toBe('+');
		expect(marks.level.get('dj8m2h65tb')).toBe('breaking');
		expect(marks.dropped.has('owts056ek0')).toBe(true);
		const webshop = [...design.model.elements.values()].find((e) => e.name === 'Webshop')!;
		expect(marks.rollup.get(webshop.id)).toMatchObject({ level: 'breaking' });
		const pim = [...design.model.elements.values()].find((e) => e.name === 'PIM')!;
		expect(marks.rollup.get(pim.id)).toBeUndefined();
	});
});
