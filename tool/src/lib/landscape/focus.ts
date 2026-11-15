import type { ElementInfo, Model } from '../model/model';
import type { ModelField } from '../model/schema';
import { edgesOf, type Edge } from './connections';
import { holdersOf, viewFields } from './layout';

/** Everything relevant to the subject, or only the data models related to it. */
export type FocusMode = 'all' | 'data';
/** How many hops from the subject; `all` follows every connection. */
export type FocusDepth = 1 | 2 | 'all';

export interface Focus {
	/** Element or model field id. */
	id: string;
	mode: FocusMode;
	depth: FocusDepth;
}

export interface Focused {
	/** The design cut down to the focus, laid out and drawn like the whole one. */
	model: Model;
	/** Rows each neighbour card shows folded: those connecting to the focus, by model id. */
	foldAt: Map<string, number>;
}

/** The connections a mode follows: data models are joined by ref, holds and lineage only. */
const DATA = new Set<Edge['kind']>(['ref', 'model', 'from']);

/**
 * The design cut down to a subject and what connects to it, either way, within `depth` hops. A
 * hop joins two models, apis or logic units (a field's hop counts for its model); `data` keeps
 * models only, and apis and units never bridge two of them. The boxes round what is kept stay;
 * a model shows once, where it is owned. A neighbour's connecting fields come first, the rest
 * behind its fold row; the subject's card shows every row.
 */
export function focusOn(model: Model, focus: Focus): Focused {
	const kind = (id: string) => model.elements.get(id)?.def.kind;
	const keeps = (id: string) =>
		focus.mode === 'data'
			? kind(id) === 'model'
			: ['model', 'api', 'logic-unit'].includes(kind(id)!);
	const unitOf = (leaf: string) =>
		model.fields.get(leaf)?.modelId ?? model.apiFields.get(leaf)?.apiId ?? leaf;

	const edges = edgesOf(model);
	const followed = edges.filter(
		(e) =>
			(focus.mode === 'all' || DATA.has(e.kind)) && keeps(unitOf(e.from)) && keeps(unitOf(e.to))
	);
	const near = new Map<string, Set<string>>();
	const join = (a: string, b: string) => {
		if (a === b) return;
		near.set(a, (near.get(a) ?? new Set()).add(b));
		near.set(b, (near.get(b) ?? new Set()).add(a));
	};
	for (const e of followed) join(unitOf(e.from), unitOf(e.to));
	// What touches a field, or anything of an element's own, through any connection.
	const touching = (leaf: string) => {
		const at = (x: string) => (model.fields.has(leaf) ? x === leaf : unitOf(x) === leaf);
		return edges.flatMap((e) => (at(e.from) ? [e.to] : at(e.to) ? [e.from] : [])).map(unitOf);
	};

	// Where the walk starts, and the first ring when the subject is a field (its own links).
	const field = model.fields.get(focus.id);
	const subject = field ? field.modelId : kind(focus.id) === 'model' ? focus.id : undefined;
	const deep = (id: string): string[] =>
		(model.elements.get(id)?.childIds ?? []).flatMap((c) => [c, ...deep(c)]);
	let start: string[];
	let ring: string[] | undefined;
	if (subject) {
		start = [subject];
		if (field) ring = touching(focus.id).filter(keeps);
	} else if (kind(focus.id) === 'system' || kind(focus.id) === 'module')
		start = deep(focus.id).filter(keeps);
	else if (keeps(focus.id)) start = [focus.id];
	// An api or unit in a data focus: the models it touches.
	else start = touching(focus.id).filter(keeps);

	const keep = new Set(start);
	let frontier = ring ?? start;
	let hops = focus.depth === 'all' ? Infinity : focus.depth;
	if (ring) {
		for (const u of ring) keep.add(u);
		hops--;
	}
	for (; hops > 0 && frontier.length; hops--) {
		const next: string[] = [];
		for (const u of frontier)
			for (const v of near.get(u) ?? [])
				if (!keep.has(v)) {
					keep.add(v);
					next.push(v);
				}
		frontier = next;
	}

	// A neighbour's rows: those it draws (see `viewFields`) with a connection whose other end
	// is kept, first.
	const holders = new Map(
		[...holdersOf(model)].map(([id, hs]) => [id, new Set([...hs].filter((h) => keep.has(h)))])
	);
	const foldAt = new Map<string, number>();
	const fieldsOf = new Map<string, ModelField[]>();
	for (const id of keep) {
		const fields = model.elements.get(id)!.def.fields ?? [];
		if (kind(id) !== 'model' || id === subject) continue;
		const linked = new Set<string>();
		for (const e of followed) {
			const [a, b] = [unitOf(e.from), unitOf(e.to)];
			if (a === b) continue;
			if (a === id && keep.has(b) && model.fields.has(e.from)) linked.add(e.from);
			if (b === id && keep.has(a) && model.fields.has(e.to)) linked.add(e.to);
		}
		const info = model.elements.get(id)!;
		const view = info.storedIn === info.parentId ? 'table' : 'class';
		const drawn = new Set(viewFields(model, holders, id, view).map((f) => f.id));
		const first = fields.filter((f) => linked.has(f.id) && drawn.has(f.id));
		fieldsOf.set(id, [...first, ...fields.filter((f) => !linked.has(f.id))]);
		if (first.length < drawn.size) foldAt.set(id, Math.max(1, first.length));
	}

	// Every box round what is kept.
	const shown = new Set<string>();
	for (const id of keep)
		for (let e = model.elements.get(id); e && !shown.has(e.id); e = model.elements.get(e.parentId!))
			shown.add(e.id);
	const elements = new Map<string, ElementInfo>();
	for (const id of shown) {
		const info = model.elements.get(id)!;
		const fields = fieldsOf.get(id);
		elements.set(id, {
			...info,
			def: fields ? { ...info.def, fields } : info.def,
			childIds: info.childIds.filter((c) => shown.has(c)),
			refIds: [],
			storedIds: [],
			storedIn: info.storedIn === info.parentId ? info.storedIn : undefined
		});
	}
	return {
		model: {
			...model,
			elements,
			fields: new Map([...model.fields].filter(([, f]) => shown.has(f.modelId))),
			apiFields: new Map([...model.apiFields].filter(([, f]) => shown.has(f.apiId))),
			rootElementIds: model.rootElementIds.filter((id) => shown.has(id))
		},
		foldAt
	};
}
