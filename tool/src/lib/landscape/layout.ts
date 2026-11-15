import { LOGIC_KEYS, type Model } from '../model/model';
import type { Element, ModelField, ModelIndex } from '../model/schema';
import { GLYPH, textWidth } from '../render/text';
import { railGroups, railOf } from './apis';
import { edgesOf } from './connections';
import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api';
import { elkLayout } from './elk';
import { ROUTE } from './route';

/** A model is drawn as a class where it is owned, as a table where it is stored. */
export type ModelView = 'class' | 'table';

export interface LandscapeBox {
	/**
	 * Element id; `<parent box id>>model id` for a model owned elsewhere (referenced or
	 * stored there); `<root model id>#parts` for a composition boundary.
	 */
	id: string;
	/** The element drawn in the box; a boundary's root model. */
	elementId: string;
	/** Drawn here but owned elsewhere. */
	ref: boolean;
	/** Boundary round a model and the models only it holds. */
	boundary: boolean;
	/** Has boxes inside. */
	group: boolean;
	parentId?: string;
	/** Relative to the parent box (Svelte Flow convention). */
	x: number;
	y: number;
	/** Absolute canvas coordinates. */
	absX: number;
	absY: number;
	width: number;
	height: number;
	/** Field columns, for a model card. */
	table?: TableColumn[];
	view?: ModelView;
	/** The model's fields that exist in this view. */
	fields?: ModelField[];
	/** How many field rows the card shows folded, when not `FOLD`. */
	foldAt?: number;
	/** Apis of the element, drawn on a rail across its right border (see `apiHosts`). */
	apis?: string[];
	/** A module's logic units, one row each; set when the box is its logic card. */
	logic?: { cols: TableColumn[]; rows: LogicRow[] };
}

interface Size {
	width: number;
	height: number;
	/** Room kept clear right of the box, for the half of its api rail outside it. */
	right?: number;
}

interface Item {
	/** Box id. */
	id: string;
	/** Element drawn. */
	el: string;
	ref: boolean;
	boundary?: boolean;
	view?: ModelView;
	/** The logic card of module `el`. */
	logic?: boolean;
}

/** A box without children: its name at a fixed size, the box fitted round it. */
export const LEAF = { font: 15, padX: 18, height: 52, minWidth: 100 };
/** A closed group's name scales with the box, so a system reads the same at any size. */
export const groupFont = (width: number, height: number) => Math.min(width * 0.085, height * 0.2);

/** The ELK options a viewer can change in Settings. */
export interface LayoutOptions {
	/** Which way connections run: what is depended on comes first. */
	direction: 'RIGHT' | 'DOWN' | 'LEFT' | 'UP';
	/** Scales the room between boxes: 120 px between systems, 32 inside a box at 1. */
	spacing: number;
	placement: 'NETWORK_SIMPLEX' | 'BRANDES_KOEPF' | 'LINEAR_SEGMENTS' | 'SIMPLE';
	/** Width over height that unconnected groups are packed into. */
	aspect: number;
	/** File order breaks ties between equally good layouts. */
	fileOrder: boolean;
}

export const DEFAULT_LAYOUT: LayoutOptions = {
	direction: 'RIGHT',
	spacing: 1,
	placement: 'NETWORK_SIMPLEX',
	aspect: 1.6,
	fileOrder: true
};
const PAD = 32;
/** Room above the children for the open box's header. */
export const HEADER = 48;

/** Model tables: font sizes and spacing in px, shared with LandscapeNode. */
export const TABLE = {
	title: 14,
	note: 11,
	/** Column labels in a table's header row. */
	label: 11,
	row: 13,
	badge: 11,
	/** A logic unit's signature, after its name. */
	signature: 12,
	rowHeight: 26,
	/** Name bar above the tables. */
	head: 48,
	/** Side padding in every cell. */
	pad: 10,
	/** Space between two badges, or a name and its badges, in a cell. */
	badgeGap: 4,
	/** Mark in the required and nullable columns. */
	check: '✓'
};

export type FieldColumn = 'name' | 'type' | 'required' | 'nullable' | 'constraints' | 'links';
export type LogicColumn = 'name' | 'signature';

/**
 * Marks in a row's link strip: a foreign key (`ref`), lineage (`from`), and how many fields
 * refer to (`inRef`) or derive from (`inFrom`) this one, and how many api fields send into or
 * return it (`inApi`). Each kind has its own slot, so marks
 * line up down the card.
 */
export type LinkSlot = 'ref' | 'from' | 'inRef' | 'inFrom' | 'inApi';

/** Link strip sizes in px, shared with LandscapeNode. */
export const LINK = { icon: 14, slot: 20, count: 10 };

export interface TableColumn {
	key: FieldColumn | LogicColumn;
	label: string;
	/** Hover text for a short label. */
	title?: string;
	width: number;
	/** The link strip's slots, in order. */
	slots?: LinkSlot[];
}

/**
 * One edge of the field graph: field `field` refers to, derives from, or holds `to`; or logic
 * unit `field` handles an api, reads or writes a model or field, or calls a unit or api.
 */
export interface FieldLink {
	kind: 'ref' | 'from' | 'model' | (typeof LOGIC_KEYS)[number];
	/** The field or logic unit the link is written on. */
	field: string;
	/** A field id, or a model id for `ref` to a model and `model`; any target for a unit. */
	to: string;
}

export interface Relations {
	/** By the field the links are written on. */
	out: Map<string, FieldLink[]>;
	/** By the field or model they point at. */
	in: Map<string, FieldLink[]>;
	/** By model field: how many api fields send into it (`to`) or return it (`from`). */
	api: Map<string, number>;
}

/** Every field link in the design, both ways round. Links to unknown ids are left out. */
export function relationsOf(model: Model): Relations {
	const rels: Relations = { out: new Map(), in: new Map(), api: new Map() };
	const add = (m: Map<string, FieldLink[]>, k: string, l: FieldLink) =>
		m.set(k, [...(m.get(k) ?? []), l]);
	for (const [id, info] of model.fields) {
		const f = info.def;
		const links: FieldLink[] = [
			...(f.ref ? [{ kind: 'ref' as const, field: id, to: f.ref }] : []),
			...(f.model ? [{ kind: 'model' as const, field: id, to: f.model }] : []),
			...(f.from ?? []).map((to) => ({ kind: 'from' as const, field: id, to }))
		].filter((l) => model.fields.has(l.to) || model.elements.has(l.to));
		for (const l of links) {
			add(rels.out, id, l);
			add(rels.in, l.to, l);
		}
	}
	for (const [id, info] of model.elements)
		for (const kind of info.logic ? LOGIC_KEYS : [])
			for (const to of info.logic![kind])
				if (model.fields.has(to) || model.elements.has(to)) {
					const l = { kind, field: id, to };
					add(rels.out, id, l);
					add(rels.in, to, l);
				}
	for (const f of model.apiFields.values())
		for (const id of [...(f.def.to ?? []), ...(f.def.from ?? [])])
			if (model.fields.has(id)) rels.api.set(id, (rels.api.get(id) ?? 0) + 1);
	return rels;
}

/** Fields pointing at a field: foreign keys to it (`ref`) or fields derived from it (`from`). */
export const incomingCount = (rels: Relations, fieldId: string, kind: 'ref' | 'from' | 'api') =>
	kind === 'api'
		? (rels.api.get(fieldId) ?? 0)
		: (rels.in.get(fieldId)?.filter((l) => l.kind === kind).length ?? 0);

const IN_KIND = { inRef: 'ref', inFrom: 'from', inApi: 'api' } as const;

/** What an incoming slot's pill says. */
export const slotCount = (s: 'inRef' | 'inFrom' | 'inApi', n: number) =>
	s === 'inApi' ? `API ${n}` : String(n);

/** Badges after a field's name. */
export const keysOf = (f: ModelField) => [f.pk && 'PK', f.pi && 'PI'].filter((k) => k) as string[];

export const KEY_TITLES: Record<string, string> = { PK: 'Primary key', PI: 'Primary index' };

export const indexKind = (ix: ModelIndex) => (ix.unique ? 'Unique' : 'Index');

/** What a field ref shows: the model's name, or `Model.field` for a ref to a field. */
export function refLabel(model: Model, id: string): string | undefined {
	const field = model.fields.get(id);
	if (!field) return model.elements.get(id)?.name;
	return `${model.elements.get(field.modelId)?.name}.${field.def.name}`;
}

/** A field's type: its primitive or the held model's name, with `[]` for a list. */
export const typeText = (f: ModelField, label: (id: string) => string | undefined) =>
	(f.model ? (label(f.model) ?? f.model) : (f.type ?? '')) + (f.many ? '[]' : '');

/** An index's fields by name, in index order. */
export const indexFields = (ix: ModelIndex, fields: ModelField[]) =>
	ix.fields.map((id) => fields.find((f) => f.id === id)?.name ?? id).join(', ');

/** Line under a model's name: its view, plus the owner when it is owned elsewhere. */
export const subtitle = (view: ModelView, owner?: string) =>
	(view === 'table' ? 'Stored' : 'Model') + (owner ? ` · owned by ${owner}` : '');

/** Every model holding each model through a `model` field, itself excluded. */
export function holdersOf(model: Model): Map<string, Set<string>> {
	const out = new Map<string, Set<string>>();
	for (const [id, info] of model.elements)
		for (const f of info.def.fields ?? []) {
			if (!f.model || f.model === id || !model.elements.has(f.model)) continue;
			if (!out.has(f.model)) out.set(f.model, new Set());
			out.get(f.model)!.add(id);
		}
	return out;
}

/**
 * The model a model is a part of: the only model with the same owner that holds it. Parts
 * are drawn inside their root's boundary; a model held from several places stands alone.
 */
function partOf(model: Model, holders: Map<string, Set<string>>): Map<string, string> {
	const out = new Map<string, string>();
	for (const [id, hs] of holders) {
		const owner = model.elements.get(id)!.parentId;
		// A holder drawn as a table in the owner has no held models to show.
		const same = [...hs].filter((h) => {
			const holder = model.elements.get(h)!;
			return holder.parentId === owner && holder.storedIn !== owner;
		});
		if (owner && same.length === 1) out.set(id, same[0]);
	}
	// Models holding each other: the first one found is no part, so the rest have a root.
	for (const id of [...out.keys()]) {
		const seen = new Set([id]);
		let cur = out.get(id);
		while (cur && !seen.has(cur)) {
			seen.add(cur);
			cur = out.get(cur);
		}
		if (cur === id) out.delete(id);
	}
	return out;
}

/**
 * The fields that exist in a view. A table has no held models and no `stored: false`
 * fields; a class has no ref to a model holding it, as being held already links the two.
 */
export function viewFields(
	model: Model,
	holders: Map<string, Set<string>>,
	modelId: string,
	view: ModelView
): ModelField[] {
	const fields = model.elements.get(modelId)?.def.fields ?? [];
	if (view === 'table') return fields.filter((f) => !f.model && f.stored !== false);
	const hs = holders.get(modelId);
	return fields.filter((f) => {
		if (!f.ref || !hs) return true;
		return !hs.has(model.fields.get(f.ref)?.modelId ?? f.ref);
	});
}

/** A card with more fields than this shows only the first ones, and a row to show all. */
export const FOLD = 20;

/**
 * Whether a card of `count` fields is folded: its rows past `at` hide behind a toggle row.
 * `at` is `FOLD` but for a card that shows only some rows on purpose, as in a focus.
 */
export const foldable = (count: number, at = FOLD) => count > at;

/** How many field rows a card of `count` fields shows. */
export const shownRows = (count: number, expanded: boolean, at = FOLD) =>
	foldable(count, at) && !expanded ? at : count;

/**
 * Vertical centre of field row `i` of `count`: below the border, the name bar and the header
 * row. A row hidden in a folded card sits on the toggle row, so its lines end there.
 */
export const fieldRowY = (i: number, count: number, expanded: boolean, at = FOLD) =>
	1 + TABLE.head + (Math.min(i, shownRows(count, expanded, at)) + 1.5) * TABLE.rowHeight;

/** Vertical centre of unit row `i` of a logic card, which has no header row. */
export const logicRowY = (i: number) => 1 + TABLE.head + (i + 0.5) * TABLE.rowHeight;

/** Badges have 6px side padding (see LandscapeNode). */
const badgesWidth = (labels: string[]) =>
	labels.reduce(
		(w, k, i) => w + textWidth(k, TABLE.badge, true) + 12 + (i ? TABLE.badgeGap : 0),
		0
	);

/**
 * Field columns. Required and nullable are always shown, so a blank reads as "no"; the
 * others only when some row has something in them.
 */
function fieldColumns(
	fields: ModelField[],
	view: ModelView,
	label: (id: string) => string | undefined,
	rels: Relations
): TableColumn[] {
	const text = (s: string) => textWidth(s, TABLE.row);
	const defs: [FieldColumn, string, string | undefined, number[], boolean][] = [
		[
			'name',
			'Name',
			undefined,
			fields.map((f) => {
				const keys = view === 'table' ? keysOf(f) : [];
				return text(f.name) + (keys.length ? TABLE.badgeGap + badgesWidth(keys) : 0);
			}),
			true
		],
		['type', 'Type', undefined, fields.map((f) => text(typeText(f, label))), true],
		['required', 'Req', 'Required', [text(TABLE.check)], true],
		['nullable', 'Null', 'Nullable', [text(TABLE.check)], true],
		[
			'constraints',
			'Constraints',
			undefined,
			fields.map((f) => badgesWidth(f.constraints ?? [])),
			false
		]
	];
	const cols: TableColumn[] = defs
		.filter(([, , , ws, always]) => always || ws.some((w) => w > 0))
		.map(([key, label, title, ws]) => ({
			key,
			label,
			title,
			width: Math.max(textWidth(label, TABLE.label, true), ...ws) + 2 * TABLE.pad
		}));
	const slots = linkSlots(fields, rels);
	if (slots.length)
		cols.push({
			key: 'links',
			label: '',
			title: 'References, sources and incoming links; hover or click a row',
			slots,
			width: slots.reduce((w, s) => w + slotWidth(s, fields, rels), 0) + TABLE.pad
		});
	return cols;
}

/** The slots a card's link strip needs: those some field fills. */
function linkSlots(fields: ModelField[], rels: Relations): LinkSlot[] {
	const has: Record<LinkSlot, boolean> = {
		ref: fields.some((f) => f.ref),
		from: fields.some((f) => f.from?.length),
		inRef: fields.some((f) => incomingCount(rels, f.id, 'ref') > 0),
		inFrom: fields.some((f) => incomingCount(rels, f.id, 'from') > 0),
		inApi: fields.some((f) => incomingCount(rels, f.id, 'api') > 0)
	};
	return (['ref', 'from', 'inRef', 'inFrom', 'inApi'] as const).filter((s) => has[s]);
}

/** An incoming slot holds a count pill, so it is as wide as the largest one. */
const slotWidth = (s: LinkSlot, fields: ModelField[], rels: Relations) =>
	s === 'inRef' || s === 'inFrom' || s === 'inApi'
		? 14 +
			Math.max(
				...fields.map((f) =>
					textWidth(slotCount(s, incomingCount(rels, f.id, IN_KIND[s])), LINK.count, true)
				)
			)
		: LINK.slot;

/** One index per row: its kind badge, its name, then its fields. */
const indexWidth = (ix: ModelIndex, fields: ModelField[]) =>
	badgesWidth([indexKind(ix)]) +
	2 * TABLE.badgeGap +
	textWidth(ix.name, TABLE.row) +
	textWidth(`  ${indexFields(ix, fields)}`, TABLE.row) +
	2 * TABLE.pad;

function tableLayout(
	name: string,
	def: Element,
	fields: ModelField[],
	view: ModelView,
	owner: string | undefined,
	label: (id: string) => string | undefined,
	rels: Relations,
	fold: boolean,
	at: number
): { size: Size; cols: TableColumn[] } {
	const indexes = view === 'table' ? (def.indexes ?? []) : [];
	const cols = fieldColumns(fields, view, label, rels);
	// The 2px is the card's border, which sits inside the box.
	const width = Math.max(
		textWidth(name, TABLE.title, true) + GLYPH * TABLE.title + 2 * TABLE.pad,
		textWidth(subtitle(view, owner), TABLE.note) + 2 * TABLE.pad,
		fields.length ? cols.reduce((w, c) => w + c.width, 0) : 0,
		...indexes.map((ix) => indexWidth(ix, fields))
	);
	const rows = (n: number) => (n ? n + 1 : 0);
	// Laid out folded: an expanded card draws over what is below it rather than moving it.
	const fieldRows = fold
		? rows(shownRows(fields.length, false, at)) + (foldable(fields.length, at) ? 1 : 0)
		: rows(fields.length);
	const height = TABLE.head + (fieldRows + rows(indexes.length)) * TABLE.rowHeight;
	return { size: { width: Math.ceil(width) + 2, height: height + 2 }, cols };
}

/** A logic unit's row: its name and signature, input names in, outputs out. */
export interface LogicRow {
	id: string;
	name: string;
	/** `(productId, quantity) → Cart Line`; an output that is a model goes by the model's name. */
	signature: string;
}

export function logicRow(model: Model, id: string): LogicRow {
	const def = model.elements.get(id)!.def;
	const outs = (def.outputs ?? []).map((o) =>
		o.model ? (model.elements.get(o.model)?.name ?? o.name) + (o.many ? '[]' : '') : o.name
	);
	return {
		id,
		name: model.elements.get(id)!.name,
		signature: `(${(def.inputs ?? []).map((f) => f.name).join(', ')})${outs.length ? ` → ${outs.join(', ')}` : ''}`
	};
}

/** Room for the ƒ before a unit's name. */
const FN_GLYPH = 14;

/** A module's logic card: a name bar, then one row per unit: its name and signature. */
function logicLayout(rows: LogicRow[]): { size: Size; cols: TableColumn[] } {
	const col = (key: LogicColumn, ws: number[]) => ({
		key,
		label: '',
		width: Math.max(0, ...ws) + 2 * TABLE.pad
	});
	const cols = [
		col(
			'name',
			rows.map((r) => FN_GLYPH + textWidth(r.name, TABLE.row))
		),
		col(
			'signature',
			rows.map((r) => textWidth(r.signature, TABLE.signature))
		)
	];
	const width = Math.max(
		textWidth('Logic', TABLE.title, true) + GLYPH * TABLE.title + 2 * TABLE.pad,
		textWidth(logicNote(rows.length), TABLE.note) + 2 * TABLE.pad,
		cols.reduce((w, c) => w + c.width, 0)
	);
	const height = TABLE.head + rows.length * TABLE.rowHeight;
	return { size: { width: Math.ceil(width) + 2, height: height + 2 }, cols };
}

/** Line under a logic card's name. */
export const logicNote = (n: number) => `${n} logic unit${n === 1 ? '' : 's'}`;

const leafWidth = (name: string) =>
	Math.max(LEAF.minWidth, textWidth(name, LEAF.font, true) + GLYPH * LEAF.font + 2 * LEAF.padX);

/** A block of siblings: where each goes, relative to the block, by box id. */
interface Block extends Size {
	at: Map<string, { x: number; y: number }>;
}

/**
 * ELK's spacing at one level: `gap` between boxes, and lines spaced as the canvas routes them
 * (see route.ts), so ELK keeps room between layers for as many lines as run there.
 */
const spacing = (gap: number) => ({
	'elk.spacing.nodeNode': String(gap),
	'elk.spacing.componentComponent': String(gap),
	'elk.layered.spacing.nodeNodeBetweenLayers': String(gap),
	'elk.spacing.edgeEdge': String(ROUTE.spread),
	'elk.spacing.edgeNode': String(ROUTE.buffer),
	'elk.layered.spacing.edgeEdgeBetweenLayers': String(ROUTE.spread),
	'elk.layered.spacing.edgeNodeBetweenLayers': String(ROUTE.buffer)
});

/**
 * Lays out the whole element tree as one graph by ELK's layered algorithm, as if every box
 * were open and every connection drawn between the cards holding its ends: what is depended
 * on before what depends on it (in `opts.direction`), crossings few, file order breaking ties
 * if `opts.fileOrder`. Run sideways, a line leaves and enters a card at its row's height, so
 * the cards are ordered by where their lines really are. Leaves are fitted to their content,
 * groups round their children; each box keeps room right of it for its rail. Parents precede
 * their children in the result, as Svelte Flow requires.
 *
 * A model is a class card in its owner, inside a boundary with the models only it holds, and
 * a table card in the entity storing it. A model stored where it is owned is one table card.
 * With `fold` off every card is sized to show all its fields. `foldAt` folds a model's cards
 * after that many rows instead of `FOLD`, by model id.
 */
export function layoutLandscape(
	model: Model,
	fold = true,
	opts: LayoutOptions = DEFAULT_LAYOUT,
	foldAt = new Map<string, number>()
): LandscapeBox[] {
	const gap = 32 * opts.spacing;
	const systemGap = 120 * opts.spacing;
	const out: LandscapeBox[] = [];
	const sizes = new Map<string, Size>();
	const cards = new Map<string, { cols: TableColumn[]; fields: ModelField[] }>();
	const logicCards = new Map<string, { cols: TableColumn[]; rows: LogicRow[] }>();
	const holders = holdersOf(model);
	const rels = relationsOf(model);
	const parts = partOf(model, holders);
	const rootOf = (id: string): string => (parts.has(id) ? rootOf(parts.get(id)!) : id);
	const hasParts = new Set([...parts.keys()].map(rootOf));
	const card = (id: string): Item => {
		const info = model.elements.get(id)!;
		return { id, el: id, ref: false, view: info.storedIn === info.parentId ? 'table' : 'class' };
	};
	const owned = (id: string): Item => {
		if (model.elements.get(id)!.def.kind !== 'model') return { id, el: id, ref: false };
		return hasParts.has(id) ? { id: `${id}#parts`, el: id, ref: false, boundary: true } : card(id);
	};
	// A model owned elsewhere is drawn as a closed card, so it never has boxes inside.
	const kidsOf = (item: Item): Item[] => {
		const info = model.elements.get(item.el);
		if (item.ref || item.view || item.logic || !info) return [];
		if (item.boundary)
			return model.elements
				.get(info.parentId!)!
				.childIds.filter((id) => id === item.el || (parts.has(id) && rootOf(id) === item.el))
				.map(card);
		// A module's logic units share one card, drawn first.
		const units = info.childIds.filter(isUnit);
		return [
			...(units.length ? [{ id: `${item.id}#logic`, el: item.el, ref: false, logic: true }] : []),
			...info.childIds.filter((id) => !parts.has(id) && !isApi(id) && !isUnit(id)).map(owned),
			...info.refIds.map((id) => ({
				id: `${item.id}>${id}`,
				el: id,
				ref: true,
				view: 'class' as const
			})),
			...info.storedIds.map((id) => ({
				id: `${item.id}>${id}`,
				el: id,
				ref: true,
				view: 'table' as const
			}))
		];
	};
	const isApi = (id: string) => model.elements.get(id)!.def.kind === 'api';
	const isUnit = (id: string) => model.elements.get(id)!.def.kind === 'logic-unit';
	const apisOf = (item: Item) =>
		item.ref || item.view || item.boundary || item.logic
			? []
			: (model.elements.get(item.el)?.childIds.filter(isApi) ?? []);
	// Every api inside an element, which all move to its rail while it is closed.
	const deepApis = (id: string): string[] =>
		model.elements.get(id)!.childIds.flatMap((c) => (isApi(c) ? [c] : deepApis(c)));
	const railWidth = (el: string, apis: string[], height: number) =>
		apis.length ? railOf(model, railGroups(model, el, apis), height).width : 0;
	/** Half of the own rail, which sits inside the box, so children keep clear of it. */
	const inner = new Map<string, number>();

	// The box tree, and the boxes each leaf (model, field, unit, api, api field) is drawn in.
	const kidsBy = new Map<string, Item[]>();
	const parentOf = new Map<string, string>();
	const homes = new Map<string, Item[]>();
	const leavesOf = (item: Item): string[] => {
		const apis = apisOf(item);
		return [
			...(item.view
				? [item.el, ...viewFields(model, holders, item.el, item.view).map((f) => f.id)]
				: []),
			...(item.logic ? model.elements.get(item.el)!.childIds.filter(isUnit) : []),
			...apis,
			...[...model.apiFields].filter(([, f]) => apis.includes(f.apiId)).map(([id]) => id)
		];
	};
	const walk = (item: Item, parent?: string) => {
		const kids = kidsOf(item);
		kidsBy.set(item.id, kids);
		if (parent) parentOf.set(item.id, parent);
		for (const leaf of leavesOf(item)) homes.set(leaf, [...(homes.get(leaf) ?? []), item]);
		for (const k of kids) walk(k, item.id);
	};
	const roots: Item[] = model.rootElementIds.map((id) => ({ id, el: id, ref: false }));
	for (const r of roots) walk(r);

	const chain = (id: string) => {
		const out = [id];
		for (let p = parentOf.get(id); p; p = parentOf.get(p)) out.push(p);
		return out;
	};
	// A leaf drawn in several boxes links to a sibling where it can, else to where it is owned
	// (see `linkTarget`).
	const nearest = (a: Item, to: string) =>
		(homes.get(to) ?? homes.get(modelOf(model, to)) ?? [])
			.map((c) => ({ c, score: (parentOf.get(c.id) === parentOf.get(a.id) ? 0 : 2) + +c.ref }))
			.sort((x, y) => x.score - y.score)[0]?.c;

	/** A box without children, fitted to its content. */
	function measure(item: Item): Size {
		const info = model.elements.get(item.el);
		let size: Size;
		if (info && item.view) {
			const owner = item.ref ? model.elements.get(info.parentId ?? '')?.name : undefined;
			const fields = viewFields(model, holders, info.id, item.view);
			const t = tableLayout(
				info.name,
				info.def,
				fields,
				item.view,
				owner,
				(id) => refLabel(model, id),
				rels,
				fold,
				foldAt.get(info.id) ?? FOLD
			);
			cards.set(item.id, { cols: t.cols, fields });
			size = t.size;
		} else if (info && item.logic) {
			const rows = info.childIds.filter(isUnit).map((id) => logicRow(model, id));
			const l = logicLayout(rows);
			logicCards.set(item.id, { cols: l.cols, rows });
			size = l.size;
		} else size = { width: leafWidth(info?.name ?? item.el), height: LEAF.height };
		const own = railWidth(item.el, apisOf(item), size.height) / 2;
		if (own) {
			inner.set(item.id, own);
			size.width += own;
		}
		// Closed, the box carries the apis of everything inside it too.
		const deep = item.ref || item.view || item.boundary || item.logic ? [] : deepApis(item.el);
		const right = Math.max(own, railWidth(item.el, deep, size.height) / 2);
		if (right) size.right = right;
		sizes.set(item.id, size);
		return size;
	}

	function place(items: Item[], area: Size & { x: number; y: number }, parent?: LandscapeBox) {
		const block = blocks.get(parent?.id ?? '')!;
		const x0 = area.x + (area.width - block.width) / 2;
		const y0 = area.y + (area.height - block.height) / 2;
		for (const item of items) {
			const slot = { ...block.at.get(item.id)!, ...sizes.get(item.id)! };
			const absX = x0 + slot.x;
			const absY = y0 + slot.y;
			const kids = kidsBy.get(item.id)!;
			const box: LandscapeBox = {
				id: item.id,
				elementId: item.el,
				ref: item.ref,
				boundary: item.boundary ?? false,
				group: kids.length > 0,
				parentId: parent?.id,
				x: absX - (parent?.absX ?? 0),
				y: absY - (parent?.absY ?? 0),
				absX,
				absY,
				width: slot.width,
				height: slot.height,
				table: cards.get(item.id)?.cols,
				view: item.view,
				fields: cards.get(item.id)?.fields,
				foldAt: item.view ? foldAt.get(item.el) : undefined,
				apis: apisOf(item),
				logic: logicCards.get(item.id)
			};
			out.push(box);
			if (kids.length)
				place(
					kids,
					{
						x: absX + PAD,
						y: absY + HEADER,
						width: slot.width - 2 * PAD - (inner.get(item.id) ?? 0),
						height: slot.height - HEADER - PAD
					},
					box
				);
		}
	}

	if (!roots.length) return out;
	const items = new Map<string, Item>();
	for (const kids of kidsBy.values()) for (const k of kids) items.set(k.id, k);
	for (const r of roots) items.set(r.id, r);
	for (const item of items.values()) if (!kidsBy.get(item.id)!.length) measure(item);

	/** Height of a leaf's row in its card: a field or unit row, else the name bar's middle. */
	const rowHeight = (home: Item, leaf: string) => {
		const card = cards.get(home.id);
		const i = card ? card.fields.findIndex((f) => f.id === leaf) : -1;
		if (card && i >= 0) return fieldRowY(i, card.fields.length, !fold, foldAt.get(home.el) ?? FOLD);
		const u = logicCards.get(home.id)?.rows.findIndex((r) => r.id === leaf) ?? -1;
		if (u >= 0) return logicRowY(u);
		return home.view || home.logic ? TABLE.head / 2 : sizes.get(home.id)!.height / 2;
	};

	// Run sideways, a line leaves a box toward what depends on it, by a port at its row.
	const [outSide, inSide] =
		opts.direction === 'RIGHT'
			? ['EAST', 'WEST']
			: opts.direction === 'LEFT'
				? ['WEST', 'EAST']
				: [];
	const ports = new Map<string, ElkPort[]>();
	const port = (home: Item, side: string | undefined, leaf: string) => {
		if (!side || kidsBy.get(home.id)!.length) return home.id;
		const size = sizes.get(home.id)!;
		const y = rowHeight(home, leaf);
		const id = `${home.id}|${side}|${y}`;
		const list = ports.get(home.id) ?? [];
		ports.set(home.id, list);
		if (!list.some((p) => p.id === id))
			list.push({
				id,
				x: side === 'EAST' ? size.width + (size.right ?? 0) : 0,
				y,
				width: 0,
				height: 0,
				layoutOptions: { 'elk.port.side': side }
			});
		return id;
	};
	// Every connection, between the boxes holding its ends; `to` is what is depended on. One
	// between a box and what is inside it has no line.
	const conns: { from: Item; to: Item; fromLeaf: string; toLeaf: string }[] = [];
	for (const e of edgesOf(model))
		for (const a of homes.get(e.from) ?? []) {
			const b = nearest(a, e.to);
			if (!b || b === a || chain(a.id).includes(b.id) || chain(b.id).includes(a.id)) continue;
			conns.push({ from: a, to: b, fromLeaf: e.from, toLeaf: e.to });
		}

	/**
	 * Siblings in groups joined by their connections: those a line ties to outside their
	 * parent (`tied`), and each group no line leaves (`loose`).
	 */
	const components = (kids: Item[]) => {
		const kidOf = (x: Item) => {
			const c = chain(x.id);
			return kids.find((k) => c.includes(k.id));
		};
		const up = new Map(kids.map((k) => [k.id, k.id]));
		const find = (id: string): string => (up.get(id) === id ? id : find(up.get(id)!));
		const tiedIds = new Set<string>();
		for (const c of conns) {
			const f = kidOf(c.from);
			const t = kidOf(c.to);
			if (f && t) up.set(find(f.id), find(t.id));
			else if (f || t) tiedIds.add((f ?? t)!.id);
		}
		const groups = new Map<string, Item[]>();
		for (const k of kids) groups.set(find(k.id), [...(groups.get(find(k.id)) ?? []), k]);
		const loose = [...groups.values()].filter((g) => !g.some((k) => tiedIds.has(k.id)));
		return { tied: kids.filter((k) => !loose.some((g) => g.includes(k))), loose };
	};

	/** Blocks in rows, in order, packed to about `opts.aspect`, `g` apart. */
	const pack = (parts: Block[], g: number): Block => {
		const area = parts.reduce((sum, b) => sum + (b.width + g) * (b.height + g), 0);
		const rowWidth = Math.max(...parts.map((b) => b.width), Math.sqrt(area * opts.aspect));
		const at = new Map<string, { x: number; y: number }>();
		let [x, y, rowHeight, width] = [0, 0, 0, 0];
		for (const b of parts) {
			if (x > 0 && x + b.width > rowWidth) [x, y, rowHeight] = [0, y + rowHeight + g, 0];
			for (const [id, p] of b.at) at.set(id, { x: x + p.x, y: y + p.y });
			width = Math.max(width, x + b.width);
			x += b.width + g;
			rowHeight = Math.max(rowHeight, b.height);
		}
		return { width, height: y + rowHeight, at };
	};

	// A group's rail scales with the group's height, so keep room for it at full size.
	const fullRail = (item: Item) => {
		const own = railWidth(item.el, apisOf(item), Infinity) / 2;
		if (own) inner.set(item.id, own);
		const deep = item.boundary ? [] : deepApis(item.el);
		return Math.max(own, railWidth(item.el, deep, Infinity) / 2);
	};

	// Each group's children, relative to the room inside it ('' for the top level), and its size.
	const blocks = new Map<string, Block>();
	/**
	 * Boxes `top`, `g` apart, and everything inside them, as one ELK graph. In a box, siblings
	 * no line ties to the rest are laid out apart and packed (ELK does not pack a graph with
	 * lines across borders), standing in the graph as one box.
	 */
	const run = (top: Item[], g: number): Block => {
		const shown = new Set<string>();
		const packed = new Map<string, Block>();
		const visit = (item: Item) => {
			shown.add(item.id);
			const kids = kidsBy.get(item.id)!;
			if (!kids.length) return;
			const { tied, loose } = components(kids);
			if (!tied.length && loose.length === 1) return kids.forEach(visit);
			tied.forEach(visit);
			if (loose.length)
				packed.set(
					item.id,
					pack(
						loose.map((c) => run(c, gap)),
						gap
					)
				);
		};
		top.forEach(visit);
		const edges: ElkExtendedEdge[] = conns
			.filter((c) => shown.has(c.from.id) && shown.has(c.to.id))
			.map((c, i) => ({
				id: `e${i}`,
				sources: [port(c.to, outSide, c.toLeaf)],
				targets: [port(c.from, inSide, c.fromLeaf)]
			}));
		const node = (item: Item): ElkNode => {
			const kids = kidsBy.get(item.id)!;
			if (!kids.length) {
				const size = sizes.get(item.id)!;
				return {
					id: item.id,
					width: size.width + (size.right ?? 0),
					height: size.height,
					layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
					ports: ports.get(item.id) ?? []
				};
			}
			const right = fullRail(item);
			if (right) sizes.set(item.id, { width: 0, height: 0, right });
			const padRight = PAD + (inner.get(item.id) ?? 0) + right;
			const loose = packed.get(item.id);
			return {
				id: item.id,
				layoutOptions: {
					...spacing(gap),
					'elk.padding': `[top=${HEADER},left=${PAD},bottom=${PAD},right=${padRight}]`
				},
				children: [
					...kids.filter((k) => shown.has(k.id)).map(node),
					...(loose ? [{ id: `${item.id}#loose`, width: loose.width, height: loose.height }] : [])
				]
			};
		};
		const graph = elkLayout({
			id: 'root',
			layoutOptions: {
				...spacing(g),
				'elk.algorithm': 'layered',
				'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
				'elk.direction': opts.direction,
				'elk.padding': '[top=0,left=0,bottom=0,right=0]',
				// The canvas routes its own lines, but ELK routing them the same way keeps room for them.
				'elk.edgeRouting': 'ORTHOGONAL',
				'elk.layered.considerModelOrder.strategy': opts.fileOrder ? 'NODES_AND_EDGES' : 'NONE',
				'elk.layered.nodePlacement.strategy': opts.placement
			},
			children: top.map(node),
			edges
		});
		const read = (n: ElkNode) => {
			const kids = n.children ?? [];
			if (!kids.length) return;
			const right = sizes.get(n.id)?.right ?? 0;
			const at = new Map(kids.map((c) => [c.id, { x: c.x! - PAD, y: c.y! - HEADER }]));
			// The packed siblings go where their stand-in went.
			const loose = packed.get(n.id);
			const p = at.get(`${n.id}#loose`);
			if (loose && p) {
				at.delete(`${n.id}#loose`);
				for (const [id, q] of loose.at) at.set(id, { x: p.x + q.x, y: p.y + q.y });
			}
			blocks.set(n.id, {
				width: n.width! - right - 2 * PAD - (inner.get(n.id) ?? 0),
				height: n.height! - HEADER - PAD,
				at
			});
			sizes.set(n.id, { width: n.width! - right, height: n.height!, right: right || undefined });
			for (const c of kids) read(c);
		};
		const kids = graph.children!;
		kids.forEach(read);
		const x0 = Math.min(...kids.map((c) => c.x!));
		const y0 = Math.min(...kids.map((c) => c.y!));
		return {
			width: Math.max(...kids.map((c) => c.x! + c.width!)) - x0,
			height: Math.max(...kids.map((c) => c.y! + c.height!)) - y0,
			at: new Map(kids.map((c) => [c.id, { x: c.x! - x0, y: c.y! - y0 }]))
		};
	};
	const loose = components(roots).loose;
	blocks.set(
		'',
		loose.length === 1
			? run(roots, systemGap)
			: pack(
					loose.map((c) => run(c, systemGap)),
					systemGap
				)
	);

	place(roots, { x: 0, y: 0, ...blocks.get('')! });
	return out;
}

const modelOf = (model: Model, id: string) => model.fields.get(id)?.modelId ?? id;
/** Whether a card has a row for a field or logic unit. */
const shows = (b: LandscapeBox, id: string) =>
	!!(b.fields?.some((f) => f.id === id) || b.logic?.rows.some((r) => r.id === id));

/**
 * The card a link from box `from` ends on, for the model or field `to`: a sibling if there
 * is one; else, of the cards showing the field, the nearest. A logic unit has one card, its
 * module's logic card; an api has none.
 */
export function linkTarget(
	model: Model,
	boxes: LandscapeBox[],
	from: LandscapeBox,
	to: string
): LandscapeBox | undefined {
	if (model.elements.get(to)?.def.kind === 'logic-unit') return boxes.find((o) => shows(o, to));
	const el = modelOf(model, to);
	const cards = boxes.filter((o) => o.view && o.elementId === el);
	const dist = (o: LandscapeBox) =>
		Math.hypot(
			o.absX + o.width / 2 - (from.absX + from.width / 2),
			o.absY + o.height / 2 - (from.absY + from.height / 2)
		);
	const score = (o: LandscapeBox) =>
		(o.parentId === from.parentId ? 0 : 2e9) +
		(model.fields.has(to) && !shows(o, to) ? 1e9 : 0) +
		dist(o);
	return cards.sort((a, b) => score(a) - score(b))[0];
}
