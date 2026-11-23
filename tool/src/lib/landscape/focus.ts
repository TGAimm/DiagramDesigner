import type { ElementInfo, Model } from '../model/model';
import { flagKeys } from '../model/flags';
import type { LogicStep, ModelField } from '../model/schema';
import { edgesOf, type Edge } from './connections';
import { FOLD, holdersOf, viewFields } from './layout';

/** Everything relevant to the subject, or only the data models related to it. */
export type FocusMode = 'all' | 'data';
/** How many hops from the subject; `all` follows every connection. */
export type FocusDepth = 1 | 2 | 'all';

export interface Focus {
	/** Element or model field id; with `flag`, a flag key. */
	id: string;
	mode: FocusMode;
	depth: FocusDepth;
	/** The subject is a flag key: what its definitions reach (see `focusOnFlag`). */
	flag?: true;
}

export interface Focused {
	/** The design cut down to the focus, laid out and drawn like the whole one. */
	model: Model;
	/** Rows each neighbour card shows folded: those connecting to the focus, up to `FOLD`, by model id. */
	foldAt: Map<string, number>;
	/** What is kept, and the connections that put a neighbour's rows first, so `cutLike` can
	 *  cut another state of the design the same way. */
	keep: Set<string>;
	followed: Edge[];
}

/** The connections a mode follows: data models are joined by ref, holds and lineage only. */
const DATA = new Set<Edge['kind']>(['ref', 'model', 'from']);

/**
 * A design's connections as a focus walks them: between models, apis, units, triggers and
 * channels (`data`: models only), a field's or body field's counting for what holds it.
 */
function graphOf(model: Model, mode: FocusMode) {
	const kind = (id: string) => model.elements.get(id)?.def.kind;
	const keeps = (id: string) =>
		mode === 'data'
			? kind(id) === 'model'
			: ['model', 'api', 'logic-unit', 'trigger', 'channel'].includes(kind(id)!);
	const unitOf = (leaf: string) =>
		model.fields.get(leaf)?.modelId ??
		model.apiFields.get(leaf)?.apiId ??
		model.ports.get(leaf)?.channel ??
		leaf;

	const edges = edgesOf(model);
	const followed = edges.filter(
		(e) => (mode === 'all' || DATA.has(e.kind)) && keeps(unitOf(e.from)) && keeps(unitOf(e.to))
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
	/** Adds to `keep` what lies within `hops` of `frontier`. */
	const walk = (keep: Set<string>, frontier: string[], hops: number) => {
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
	};
	return { kind, keeps, followed, touching, walk };
}

/**
 * The design cut down to a subject and what connects to it, either way, within `depth` hops. A
 * hop joins two models, apis or logic units (a field's hop counts for its model); `data` keeps
 * models only, and apis and units never bridge two of them. The boxes round what is kept stay;
 * a model shows once, where it is owned. A neighbour's connecting fields come first, the rest
 * behind its fold row, which comes no later than `FOLD` rows in, as on any card.
 */
export function focusOn(model: Model, focus: Focus): Focused {
	const { kind, keeps, followed, touching, walk } = graphOf(model, focus.mode);

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
	} else if (kind(focus.id) === 'module') start = deep(focus.id).filter(keeps);
	else if (keeps(focus.id)) start = [focus.id];
	// An api or unit in a data focus: the models it touches.
	else start = touching(focus.id).filter(keeps);

	const keep = new Set(start);
	let hops = focus.depth === 'all' ? Infinity : focus.depth;
	if (ring) {
		for (const u of ring) keep.add(u);
		hops--;
	}
	walk(keep, ring ?? start, hops);
	return cut(model, keep, followed, subject);
}

/** Every step in `steps`, however deep, the branches of flag steps too. */
function* stepsIn(steps: LogicStep[] | undefined): Generator<LogicStep> {
	for (const s of steps ?? []) {
		yield s;
		for (const k of ['then', 'else', 'do', 'on', 'off'] as const) yield* stepsIn(s[k]);
	}
}

/**
 * What a flag key reaches, in a design holding every branch and gated item: the units with a
 * flag step on one of its definitions, what either branch of such a step calls, reads, writes
 * or sends, the apis, units, triggers and channels gated on it, and what calls or handles one
 * of those or listens on a gated channel. That is what flipping the key changes, or can break.
 */
export function flagReach(model: Model, key: string): Set<string> {
	const defs = new Set(flagKeys(model).get(key) ?? []);
	const out = new Set<string>();
	const holder = (id: string) => model.fields.get(id)?.modelId ?? id;
	const gated: string[] = [];
	for (const [id, e] of model.elements) {
		if (e.def.when && defs.has(e.def.when.flag)) {
			out.add(id);
			gated.push(id);
		}
		if (e.def.kind !== 'logic-unit') continue;
		for (const s of stepsIn(e.def.steps)) {
			if (s.flag === undefined || !defs.has(s.flag)) continue;
			out.add(id);
			for (const b of stepsIn([...(s.on ?? []), ...(s.off ?? [])]))
				for (const t of [b.call, b.send, b.read, b.write])
					if (t !== undefined && model.elements.has(holder(t))) out.add(holder(t));
		}
	}
	for (const g of gated) {
		for (const [id, e] of model.elements)
			if (e.logic?.calls.includes(g) || e.logic?.handles.includes(g)) out.add(id);
		for (const p of model.ports.values())
			if (p.channel === g) for (const t of p.triggers) out.add(t);
	}
	return out;
}

/**
 * The design cut down to what a flag key reaches (see `flagReach`) and, past depth 1, what lies
 * within `depth - 1` more hops of it; a data focus starts from the models those touch. `model`
 * holds every branch and gated item, so both states of the key are laid out alike; `cutLike`
 * draws one state in that layout.
 */
export function focusOnFlag(model: Model, focus: Focus): Focused {
	const { keeps, followed, touching, walk } = graphOf(model, focus.mode);
	const reach = [...flagReach(model, focus.id)];
	const start = new Set(
		focus.mode === 'data'
			? reach.flatMap((id) => (keeps(id) ? [id] : touching(id).filter(keeps)))
			: reach.filter(keeps)
	);
	const keep = new Set(start);
	walk(keep, [...start], focus.depth === 'all' ? Infinity : focus.depth - 1);
	return cut(model, keep, followed);
}

/** `model`, another state of the design `focused` was cut from, cut the same way. */
export function cutLike(focused: Focused, model: Model): Focused {
	return cut(model, focused.keep, focused.followed);
}

/**
 * The design cut down to what a played unit's run can touch, on every branch: the unit, what
 * starts it (the apis it handles, the units calling it), and what its steps read, write or
 * call. A called unit with steps, or one with steps handling a called api, adds what its own
 * steps touch, however deep. A model's fields read or written come first.
 */
export function focusOnRun(model: Model, unitId: string): Focused {
	const el = (id: string) => model.elements.get(id);
	const keep = new Set([unitId, ...(el(unitId)?.logic?.handles ?? [])]);
	for (const e of model.elements.values()) if (e.logic?.calls.includes(unitId)) keep.add(e.id);
	const played = new Set<string>();
	const play = (id: string) => {
		if (played.has(id)) return;
		played.add(id);
		keep.add(id);
		const links = el(id)?.logic;
		if (!links) return;
		for (const t of [...links.reads, ...links.writes]) keep.add(model.fields.get(t)?.modelId ?? t);
		// A message sent: its channel, the triggers receiving it, and the units those start.
		for (const c of links.sends) {
			keep.add(c);
			for (const p of model.ports.values())
				if (p.channel === c && p.event === 'received')
					for (const t of p.triggers) {
						keep.add(t);
						for (const h of model.elements.values())
							if (h.logic?.handles.includes(t)) {
								keep.add(h.id);
								if (h.def.steps?.length) play(h.id);
							}
					}
		}
		for (const t of links.calls) {
			keep.add(t);
			if (el(t)?.def.kind !== 'api') {
				if (el(t)?.def.steps?.length) play(t);
			} else
				for (const h of model.elements.values())
					if (h.logic?.handles.includes(t) && h.def.steps?.length) play(h.id);
		}
	};
	play(unitId);
	const followed = edgesOf(model).filter(
		(e) => (e.kind === 'reads' || e.kind === 'writes') && played.has(e.from)
	);
	return cut(model, keep, followed);
}

/**
 * The design cut down to `keep` and the boxes round it. A kept model other than the subject
 * lists the rows it draws (see `viewFields`) with a `followed` connection to something kept
 * first, the rest behind its fold row.
 */
function cut(model: Model, keep: Set<string>, followed: Edge[], subject?: string): Focused {
	const kind = (id: string) => model.elements.get(id)?.def.kind;
	const unitOf = (leaf: string) =>
		model.fields.get(leaf)?.modelId ??
		model.apiFields.get(leaf)?.apiId ??
		model.ports.get(leaf)?.channel ??
		leaf;
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
		if (first.length < drawn.size) foldAt.set(id, Math.min(FOLD, Math.max(1, first.length)));
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
		foldAt,
		keep,
		followed
	};
}
