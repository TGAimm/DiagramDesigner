import { describe, expect, it } from 'vitest';
import {
	DEFAULT_LAYOUT,
	fieldRowY,
	FOLD,
	LEAF,
	layoutLandscape,
	relationsOf,
	shownRows,
	TABLE
} from '../../src/lib/landscape/layout';
import { railGroups, railOf } from '../../src/lib/landscape/apis';
import { edgesOf, restLines } from '../../src/lib/landscape/connections';
import { sequenceOf } from '../../src/lib/landscape/sequence';
import { GLYPH, textWidth } from '../../src/lib/render/text';
import { loadFixture, loadStrings } from './helpers';

const { model } = loadFixture();
type Box = { absX: number; absY: number; width: number; height: number };
const overlap = (a: Box, b: Box) =>
	a.absX < b.absX + b.width &&
	b.absX < a.absX + a.width &&
	a.absY < b.absY + b.height &&
	b.absY < a.absY + a.height;
const inside = (child: Box, parent: Box) =>
	child.absX >= parent.absX &&
	child.absY >= parent.absY &&
	child.absX + child.width <= parent.absX + parent.width &&
	child.absY + child.height <= parent.absY + parent.height;

describe('layout options', () => {
	// System `b` depends on `a`; system `c` stands alone.
	const linked = loadStrings({
		'a/a.system.yaml': 'id: a\n',
		'a/x.model.yaml': 'id: x\nownedBy: a\nfields: [{ id: x-id, name: id, type: uuid, pk: true }]\n',
		'b/b.system.yaml': 'id: b\n',
		'b/y.model.yaml': 'id: y\nownedBy: b\nfields: [{ id: y-x, name: x, type: uuid, ref: x-id }]\n',
		'c/c.system.yaml': 'id: c\n'
	}).model;
	const at = (opts: Partial<typeof DEFAULT_LAYOUT>) => {
		const boxes = layoutLandscape(linked, true, { ...DEFAULT_LAYOUT, ...opts });
		return (id: string) => boxes.find((b) => b.id === id)!;
	};

	it('puts what is depended on first, in the direction asked', () => {
		const right = at({});
		expect(right('a').absX + right('a').width).toBeLessThanOrEqual(right('b').absX);
		const down = at({ direction: 'DOWN' });
		expect(down('a').absY + down('a').height).toBeLessThanOrEqual(down('b').absY);
		const left = at({ direction: 'LEFT' });
		expect(left('b').absX + left('b').width).toBeLessThanOrEqual(left('a').absX);
	});

	it('lays out as if every box were open and every line drawn, across borders too', () => {
		// In each system one model refers to another, so it has two layers. b's y refers to a's q.
		const model = loadStrings({
			'a/a.system.yaml': 'id: a\n',
			'a/m1.model.yaml': 'id: m1\nownedBy: a\nfields: [{ id: m1-id, name: id, type: uuid }]\n',
			'a/m2.model.yaml':
				'id: m2\nownedBy: a\nfields: [{ id: m2-m1, name: m1, type: uuid, ref: m1-id }]\n',
			'a/q.model.yaml': 'id: q\nownedBy: a\nfields: [{ id: q-id, name: id, type: uuid }]\n',
			'b/b.system.yaml': 'id: b\n',
			'b/n1.model.yaml': 'id: n1\nownedBy: b\nfields: [{ id: n1-id, name: id, type: uuid }]\n',
			'b/n2.model.yaml':
				'id: n2\nownedBy: b\nfields: [{ id: n2-n1, name: n1, type: uuid, ref: n1-id }]\n',
			'b/y.model.yaml': 'id: y\nownedBy: b\nfields: [{ id: y-q, name: q, type: uuid, ref: q-id }]\n'
		}).model;
		const boxes = layoutLandscape(model);
		const box = (id: string) => boxes.find((b) => b.id === id)!;
		// q sits on the side of a its line leaves by, y on the side of b it enters by.
		expect(box('q').absX).toBeGreaterThan(box('m1').absX + box('m1').width);
		expect(box('y').absX + box('y').width).toBeLessThan(box('n2').absX);
		for (const id of ['m1', 'm2', 'q']) expect(inside(box(id), box('a'))).toBe(true);
	});

	it('packs boxes no line ties together to the shape asked', () => {
		const files: Record<string, string> = {};
		for (const id of 'abcdefgh') files[`${id}/${id}.system.yaml`] = `id: ${id}\n`;
		const loose = loadStrings(files).model;
		const extent = (aspect: number) => {
			const boxes = layoutLandscape(loose, true, { ...DEFAULT_LAYOUT, aspect });
			return {
				w: Math.max(...boxes.map((b) => b.absX + b.width)),
				h: Math.max(...boxes.map((b) => b.absY + b.height))
			};
		};
		const tall = extent(0.3);
		const wide = extent(4);
		expect(tall.h).toBeGreaterThan(tall.w);
		expect(wide.w).toBeGreaterThan(wide.h);
	});

	it('scales the room between systems and between boxes inside', () => {
		const apart = (box: ReturnType<typeof at>) => box('b').absX - box('a').absX - box('a').width;
		expect(apart(at({ spacing: 2 })) - apart(at({}))).toBeCloseTo(120);
		// The fixture's two erp modules share no connection, so ELK packs them, a gap apart.
		const { model } = loadFixture();
		for (const spacing of [1, 2]) {
			const boxes = layoutLandscape(model, true, { ...DEFAULT_LAYOUT, spacing });
			const [i, o] = ['inventory', 'orders'].map((id) => boxes.find((b) => b.id === id)!);
			const [first, second] = i.absX < o.absX || i.absY < o.absY ? [i, o] : [o, i];
			expect(
				Math.max(second.absX - first.absX - first.width, second.absY - first.absY - first.height)
			).toBeCloseTo(32 * spacing);
		}
	});
});

describe('landscape layout', () => {
	const boxes = layoutLandscape(model);
	const box = (id: string) => boxes.find((b) => b.id === id)!;

	const notApi = (id: string) => model.elements.get(id)!.def.kind !== 'api';

	it('lays out every entity but apis, a module’s logic units on one card, parents first', () => {
		const kind = (id: string) => model.elements.get(id)!.def.kind;
		expect(boxes.map((b) => b.id).sort()).toEqual(
			[
				...[...model.elements.keys()].filter((id) => notApi(id) && kind(id) !== 'logic-unit'),
				'order#logic'
			].sort()
		);
		const index = new Map(boxes.map((b, i) => [b.id, i]));
		for (const b of boxes)
			if (b.parentId) expect(index.get(b.parentId)!).toBeLessThan(index.get(b.id)!);
	});

	it('nests children inside their parent, siblings apart', () => {
		expect(overlap(box('erp'), box('webshop'))).toBe(false);
		for (const b of boxes.filter((b) => b.parentId)) {
			const parent = box(b.parentId!);
			expect(inside(b, parent)).toBe(true);
			expect([b.x, b.y]).toEqual([b.absX - parent.absX, b.absY - parent.absY]);
		}
	});

	it('fits each box to its content instead of sharing a size with its siblings', () => {
		const leaves = boxes.filter((b) => !b.group && !b.table && !b.logic);
		for (const b of leaves)
			expect(b.width).toBe(
				Math.max(
					LEAF.minWidth,
					textWidth(model.elements.get(b.id)!.name, LEAF.font, true) + GLYPH * LEAF.font + 36
				)
			);
		const sizes = new Set(
			model.elements
				.get('erp')!
				.childIds.filter(notApi)
				.map((id) => `${box(id).width}x${box(id).height}`)
		);
		expect(sizes.size).toBeGreaterThan(1);
	});

	it('puts apis on their parent box and keeps room for the rail across its right border', () => {
		expect(box('erp').apis).toEqual(['order-api']);
		const { model } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\nname: M\n',
			's/n.module.yaml': 'id: n\nparent: s\nname: N\n',
			's/a.api.yaml': 'id: a\nparent: m\nmethod: DELETE\npath: /a/very/long/route/to/something\n'
		});
		const boxes = layoutLandscape(model);
		const [s, m, n] = ['s', 'm', 'n'].map((id) => boxes.find((b) => b.id === id)!);
		const rail = railOf(model, railGroups(model, 'm', ['a']), m.height);
		expect([m.group, m.apis]).toEqual([false, ['a']]);
		// Half the rail is inside the leaf, beside its name; half outside, clear of its sibling
		// and inside its parent.
		expect(m.width).toBe(LEAF.minWidth + rail.width / 2);
		const railRight = m.absX + m.width + rail.width / 2;
		expect(n.absX >= railRight || n.absY >= m.absY + m.height || m.absY >= n.absY + n.height).toBe(
			true
		);
		expect(railRight).toBeLessThanOrEqual(s.absX + s.width);
	});

	it('counts the api fields sending into or returning each model field', () => {
		const { model } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.model.yaml': 'id: m\nownedBy: s\nfields: [{ id: f, name: f, type: int }]\n',
			's/a.api.yaml': [
				'id: a',
				'parent: s',
				'method: POST',
				'path: /m',
				'request: { fields: [{ id: q, name: q, type: int, to: [f] }] }',
				'responses: [{ status: 200, fields: [{ id: r, name: r, type: int, from: [f] }] }]'
			].join('\n')
		});
		expect(relationsOf(model).api.get('f')).toBe(2);
	});

	it('is empty for an empty model', () => {
		expect(layoutLandscape(loadStrings({}).model)).toEqual([]);
	});

	it('draws a referenced model inside the referencing entity too, sized as a table', () => {
		const fields = Array.from(
			{ length: 12 },
			(_, i) => `  - { id: f${i}, name: f${i}, type: int }`
		);
		const boxes = layoutLandscape(
			loadStrings({
				's/s.system.yaml': 'id: s\n',
				's/m.module.yaml': 'id: m\nparent: s\n',
				's/db.module.yaml': 'id: db\nparent: s\nmodels: [a]\n',
				's/a.model.yaml': ['id: a', 'ownedBy: m', 'fields:', ...fields].join('\n')
			}).model
		);
		const owned = boxes.find((b) => b.id === 'a')!;
		const ref = boxes.find((b) => b.id === 'db>a')!;
		expect([owned.parentId, owned.ref]).toEqual(['m', false]);
		expect([ref.parentId, ref.elementId, ref.ref, ref.group]).toEqual(['db', 'a', true, false]);
		expect(owned.height).toBeGreaterThan(12 * 20);
		expect(boxes.find((b) => b.id === 'db')!.group).toBe(true);
	});

	it('draws a model as a class where owned and a table where stored', () => {
		const m = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/db.module.yaml': 'id: db\nparent: s\n',
			's/o.model.yaml': [
				'id: o',
				'ownedBy: m',
				'storedIn: db',
				'fields:',
				'  - { id: o-id, name: id, type: uuid, pk: true }',
				'  - { id: o-ls, name: lines, model: l, many: true }',
				'  - { id: o-n, name: count, type: int, stored: false }'
			].join('\n'),
			's/l.model.yaml': [
				'id: l',
				'ownedBy: m',
				'storedIn: db',
				'fields:',
				'  - { id: l-o, name: orderId, type: uuid, ref: o-id }',
				'  - { id: l-q, name: qty, type: int }'
			].join('\n'),
			's/t.model.yaml':
				'id: t\nownedBy: db\nstoredIn: db\nfields: [{ id: t-x, name: x, type: int }]\n'
		}).model;
		const boxes = layoutLandscape(m);
		const box = (id: string) => boxes.find((b) => b.id === id)!;
		const names = (id: string) => box(id).fields!.map((f) => f.name);
		// The owner shows one boundary round the holder and the part it alone holds.
		expect(boxes.filter((b) => b.parentId === 'm').map((b) => b.id)).toEqual(['o#parts']);
		expect(box('o#parts')).toMatchObject({ boundary: true, group: true, elementId: 'o' });
		expect([box('o').view, box('l').view, box('l').parentId]).toEqual([
			'class',
			'class',
			'o#parts'
		]);
		expect([names('o'), names('l')]).toEqual([['id', 'lines', 'count'], ['qty']]);
		// The store shows both as tables, plus the table it owns, drawn once.
		expect([box('db>o').view, names('db>o'), names('db>l')]).toEqual([
			'table',
			['id'],
			['orderId', 'qty']
		]);
		expect([box('t').view, boxes.filter((b) => b.elementId === 't').length]).toEqual(['table', 1]);
		expect(restLines(m, boxes, edgesOf(m)).map((l) => [l.id, l.kinds])).toEqual([
			['db>l>db>o', ['ref']],
			['o>l', ['model']]
		]);
	});

	it('leaves a model held from several places out of any boundary', () => {
		const m = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/a.model.yaml': 'id: a\nownedBy: s\nfields: [{ id: a-x, name: x, model: x }]\n',
			's/b.model.yaml': 'id: b\nownedBy: s\nfields: [{ id: b-x, name: x, model: x }]\n',
			's/x.model.yaml': 'id: x\nownedBy: s\n'
		}).model;
		expect(
			layoutLandscape(m)
				.filter((b) => b.parentId === 's')
				.map((b) => b.id)
		).toEqual(['a', 'b', 'x']);
	});

	const tables = loadStrings({
		's/s.system.yaml': 'id: s\n',
		's/a.model.yaml': 'id: a\nownedBy: s\nfields: [{ id: a-id, name: id, type: uuid, pk: true }]\n',
		's/b.model.yaml': [
			'id: b',
			'ownedBy: s',
			'fields:',
			...Array.from({ length: 8 }, (_, i) => `  - { id: b${i}, name: f${i}, type: int }`),
			'  - { id: b-a, name: aId, type: uuid, ref: a-id }',
			'  - { id: b-up, name: up, type: uuid, ref: b }',
			// c is held from two places, so it stays out of a boundary.
			'  - { id: b-c, name: c, model: c }'
		].join('\n'),
		's/c.model.yaml': 'id: c\nownedBy: s\nfields: [{ id: c-x, name: amount, type: decimal }]\n',
		's/d.model.yaml': [
			'id: d',
			'ownedBy: s',
			'fields:',
			'  - { id: d-a, name: aId, type: uuid, ref: a }',
			'  - { id: d-c, name: cs, model: c, many: true }'
		].join('\n')
	}).model;

	it('lays out a level along its connections, what is depended on left, each card at its own size', () => {
		const boxes = layoutLandscape(tables);
		const box = (id: string) => boxes.find((b) => b.id === id)!;
		// b and d refer to a and hold c.
		for (const from of ['b', 'd'])
			for (const to of ['a', 'c'])
				expect(box(to).absX + box(to).width).toBeLessThan(box(from).absX);
		expect(box('a').width).not.toBe(box('c').width);
		const cards = boxes.filter((b) => b.table);
		for (const x of cards) for (const y of cards) if (x !== y) expect(overlap(x, y)).toBe(false);
	});

	it('joins sibling cards at rest, one line per pair and direction', () => {
		const lines = restLines(tables, layoutLandscape(tables), edgesOf(tables));
		// b's ref to its own model is inside one card, so it has no line.
		expect(lines.map((l) => [l.id, l.kinds, l.count, l.parentId])).toEqual([
			['b>a', ['ref'], 1, 's'],
			['b>c', ['model'], 1, 's'],
			['d>a', ['ref'], 1, 's'],
			['d>c', ['model'], 1, 's']
		]);
	});

	const lineage = loadStrings({
		's/s.system.yaml': 'id: s\n',
		's/db.module.yaml': 'id: db\nparent: s\n',
		's/api.module.yaml': 'id: api\nparent: s\n',
		's/src.model.yaml':
			'id: src\nownedBy: db\nstoredIn: db\nfields: [{ id: src-id, name: id, type: uuid, pk: true }, { id: src-n, name: n, type: int }]\n',
		's/copy.model.yaml': [
			'id: copy',
			'ownedBy: db',
			'storedIn: db',
			'fields:',
			'  - { id: copy-id, name: id, type: uuid, ref: src-id }',
			'  - { id: copy-n, name: n, type: int, from: [src-n] }',
			'  - { id: copy-twice, name: twice, type: int, from: [copy-n], derived: n * 2 }'
		].join('\n'),
		's/dto.model.yaml':
			'id: dto\nownedBy: api\nfields: [{ id: dto-n, name: n, type: int, from: [src-n] }]\n'
	}).model;

	it('replaces the reference and source columns with a link strip', () => {
		const boxes = layoutLandscape(lineage);
		const cols = (id: string) => boxes.find((b) => b.id === id)!.table!;
		expect(cols('copy').map((c) => c.key)).toEqual([
			'name',
			'type',
			'required',
			'nullable',
			'links'
		]);
		expect(cols('copy').at(-1)!.slots).toEqual(['ref', 'from', 'inFrom']);
		expect(cols('src').at(-1)!.slots).toEqual(['inRef', 'inFrom']);
	});

	it('indexes field links both ways', () => {
		const rels = relationsOf(lineage);
		expect(rels.out.get('copy-n')).toEqual([{ kind: 'from', field: 'copy-n', to: 'src-n' }]);
		expect(rels.in.get('src-n')!.map((l) => l.field)).toEqual(['copy-n', 'dto-n']);
	});

	it('merges connections at rest, lifted to siblings, so no line crosses a border', () => {
		const lines = restLines(lineage, layoutLandscape(lineage), edgesOf(lineage));
		// copy's ref and lineage merge; lineage inside copy has no line; dto in module api
		// derives from src in module db, so the two modules are joined.
		expect(lines.map((l) => [l.id, l.kinds, l.count, l.parentId])).toEqual([
			['api>db', ['from'], 1, 's'],
			['copy>src', ['ref', 'from'], 2, 'db']
		]);
	});
});

describe('folded model cards', () => {
	const card = (n: number, fold = true) => {
		const fields = Array.from({ length: n }, (_, i) => `  - { id: f${i}, name: f${i}, type: int }`);
		return layoutLandscape(
			loadStrings({
				's/s.system.yaml': 'id: s\n',
				's/m.module.yaml': 'id: m\nparent: s\n',
				's/a.model.yaml': ['id: a', 'ownedBy: m', 'fields:', ...fields].join('\n')
			}).model,
			fold
		).find((b) => b.id === 'a')!;
	};

	it(`lays out a card of over ${FOLD} fields as ${FOLD} rows and a toggle row`, () => {
		expect(card(FOLD).fields).toHaveLength(FOLD);
		expect(card(FOLD + 1).height).toBe(card(FOLD).height + TABLE.rowHeight);
		expect(card(80).height).toBe(card(FOLD + 1).height);
		expect(card(80).fields).toHaveLength(80);
	});

	it('lays out every row, with no toggle row, when folding is off', () => {
		expect(card(80, false).height).toBe(card(FOLD, false).height + (80 - FOLD) * TABLE.rowHeight);
		expect(card(FOLD, false).height).toBe(card(FOLD).height);
	});

	it('ends the lines of hidden rows on the toggle row until the card is expanded', () => {
		expect(fieldRowY(FOLD + 5, 80, false)).toBe(fieldRowY(FOLD, 80, true));
		expect(fieldRowY(FOLD + 5, 80, true)).toBe(fieldRowY(FOLD, 80, true) + 5 * TABLE.rowHeight);
		expect(fieldRowY(3, 80, false)).toBe(fieldRowY(3, 10, false));
		expect([shownRows(80, false), shownRows(80, true), shownRows(FOLD, false)]).toEqual([
			FOLD,
			80,
			FOLD
		]);
	});
});

describe('logic cards', () => {
	const shop = loadStrings({
		's/s.system.yaml': 'id: s\n',
		's/shop.module.yaml': 'id: shop\nparent: s\n',
		's/svc.module.yaml': 'id: svc\nparent: shop\n',
		's/cart.model.yaml':
			'id: cart\nownedBy: shop\nfields: [{ id: cart-id, name: id, type: uuid, pk: true }, { id: cart-qty, name: qty, type: int }]\n',
		's/post.api.yaml':
			'id: post\nparent: svc\nmethod: POST\npath: /cart\nrequest: { model: cart }\n',
		's/add.logic-unit.yaml': [
			'id: add',
			'parent: svc',
			'name: addToCart',
			'handles: [post]',
			'inputs: [{ id: add-p, name: productId, type: uuid }, { id: add-q, name: quantity, type: int }]',
			'outputs: [{ id: add-o, name: line, model: cart }]',
			'steps:',
			'  - { call: load, gets: cart }',
			'  - { read: cart }',
			'  - { write: cart-qty }',
			'  - { return: line }'
		].join('\n'),
		's/load.logic-unit.yaml': [
			'id: load',
			'parent: svc',
			'name: loadCart',
			'inputs: []',
			'outputs: []',
			'steps: [{ read: cart }]'
		].join('\n')
	}).model;
	const boxes = layoutLandscape(shop);
	const box = (id: string) => boxes.find((b) => b.id === id)!;

	it('draws a module’s units as rows of one card: name and signature, no header', () => {
		expect(shop.diagnostics).toEqual([]);
		expect(boxes.filter((b) => b.parentId === 'svc').map((b) => b.id)).toEqual(['svc#logic']);
		const card = box('svc#logic').logic!;
		expect(card.cols.map((c) => c.key)).toEqual(['name', 'signature']);
		expect(card.rows.map((r) => [r.id, r.signature])).toEqual([
			['add', '(productId, quantity) → cart'],
			['load', '()']
		]);
		expect(box('svc#logic').height).toBe(TABLE.head + 2 * TABLE.rowHeight + 2);
	});

	it('indexes unit links both ways', () => {
		const rels = relationsOf(shop);
		expect(rels.out.get('add')!.map((l) => [l.kind, l.to])).toEqual([
			['handles', 'post'],
			['reads', 'cart'],
			['writes', 'cart-qty'],
			['calls', 'load']
		]);
		expect(rels.in.get('cart')!.map((l) => l.field)).toEqual(['add', 'load']);
		expect(rels.in.get('post')!.map((l) => [l.kind, l.field])).toEqual([['handles', 'add']]);
	});

	it('points every connection at what it depends on', () => {
		const edges = edgesOf(shop).filter((e) => ['add', 'post', 'load'].includes(e.from));
		expect(edges.map((e) => [e.kind, e.from, e.to])).toEqual([
			['handles', 'post', 'add'],
			['reads', 'add', 'cart'],
			['writes', 'add', 'cart-qty'],
			['calls', 'add', 'load'],
			['reads', 'load', 'cart'],
			['body', 'post', 'cart']
		]);
	});

	it('reads a unit’s steps as a sequence, lifelines in first-use order', () => {
		const seq = sequenceOf(shop, 'add');
		expect(seq.lifelines.map((l) => [l.kind, l.name, l.subs.map((s) => s.text)])).toEqual([
			['caller', 'Caller', ['POST /cart']],
			['self', 'addToCart', ['this unit']],
			['unit', 'svc', ['loadCart']],
			['model', 'cart', ['s › shop']]
		]);
		expect(seq.messages.map((m) => [m.from, m.to, m.tone, m.dashed, m.text])).toEqual([
			[0, 1, 'input', false, 'productId, quantity'],
			[1, 2, 'call', false, 'loadCart()'],
			[2, 1, 'return', true, 'cart'],
			[1, 3, 'read', false, 'reads'],
			[1, 3, 'write', false, 'writes qty'],
			[1, 0, 'return', true, 'line']
		]);
		// The callee's caller lifeline lists the units calling it.
		expect(sequenceOf(shop, 'load').lifelines[0].subs).toEqual([
			{ text: 'ƒ addToCart', target: 'add' }
		]);
	});

	it('boxes branches and loops, with a row for each header and else', () => {
		const { model } = loadStrings({
			's/s.system.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/u.logic-unit.yaml': [
				'id: u',
				'parent: m',
				'inputs: []',
				'outputs: [{ id: o, name: ok, type: bool }]',
				'fails: [{ name: bad }]',
				'steps:',
				'  - if: x',
				'    then: [{ fail: bad }]',
				'    else:',
				'      - each: y',
				'        do: [{ note: work }]',
				'      - { return: ok }'
			].join('\n')
		});
		const seq = sequenceOf(model, 'u');
		expect(seq.frags).toEqual([
			{
				label: 'alt',
				guard: '[x]',
				top: 1,
				bottom: 6,
				depth: 0,
				dividers: [{ row: 3, guard: '[else]' }]
			},
			{ label: 'loop', guard: '[each y]', top: 4, bottom: 5, depth: 1, dividers: [] }
		]);
		expect(seq.notes).toEqual([{ row: 5, text: 'work' }]);
		expect(seq.messages.map((m) => [m.row, m.tone, m.text])).toEqual([
			[0, 'input', '()'],
			[2, 'fail', 'fails bad'],
			[6, 'return', 'ok']
		]);
		expect(seq.rows).toBe(7);
	});
});
