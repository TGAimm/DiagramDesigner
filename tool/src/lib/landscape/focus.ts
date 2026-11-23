import type { ElementInfo, Model } from '../model/model';
import { flagKeys } from '../model/flags';
import type { LogicStep, ModelField } from '../model/schema';
import { edgesOf, type Edge } from './connections';
import { FOLD, holdersOf, viewFields } from './layout';
import type { Front } from '../scenario/front';

/** Every kind of element, or only the data models. */
export type FocusMode = 'all' | 'data';
/**
 * Which side of the subject's dependencies to show: what it uses (depends on), what uses it
 * (depends on it), or both.
 */
export type FocusSides = 'both' | 'uses' | 'usedBy';
/** One step on each side shown, or on along the same side until the chain ends. */
export type FocusReach = 'direct' | 'chain';

export interface Focus {
	/** Element or model field id; with `flag`, a flag key. */
	id: string;
	mode: FocusMode;
	sides: FocusSides;
	reach: FocusReach;
	/** The subject is a flag key: what depends on its definitions (see `focusOnFlag`). */
	flag?: true;
	/** The subject is the shown scenario (`id` its path), or with `change` one of its changes. */
	scenario?: true;
	change?: number;
}

/** A focus on `id` as it opens: everything, both sides, one step each. */
export const focusOf = (id: string, rest: Partial<Focus> = {}): Focus => ({
	id,
	mode: 'all',
	sides: 'both',
	reach: 'direct',
	...rest
});

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

type Side = 'uses' | 'usedBy';
const SIDES: Record<FocusSides, Side[]> = {
	both: ['uses', 'usedBy'],
	uses: ['uses'],
	usedBy: ['usedBy']
};

/**
 * A design's connections as a focus walks them: between models, apis, units, triggers and
 * channels (`data`: models only), a field's or body field's counting for what holds it. Every
 * connection has a direction (`from` depends on `to`, see `Edge`): `uses` follows it, `usedBy`
 * goes against it.
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
	const next: Record<Side, Map<string, Set<string>>> = { uses: new Map(), usedBy: new Map() };
	const join = (side: Side, a: string, b: string) => {
		if (a !== b) next[side].set(a, (next[side].get(a) ?? new Set()).add(b));
	};
	for (const e of followed) {
		join('uses', unitOf(e.from), unitOf(e.to));
		join('usedBy', unitOf(e.to), unitOf(e.from));
	}
	/** What a field, or anything of an element's own, connects to on one side, by any kind. */
	const touching = (leaf: string, side: Side) => {
		const at = (x: string) => (model.fields.has(leaf) ? x === leaf : unitOf(x) === leaf);
		return edges
			.flatMap((e) => (side === 'uses' ? (at(e.from) ? [e.to] : []) : at(e.to) ? [e.from] : []))
			.map(unitOf);
	};
	/** Adds to `keep` what lies within `steps` of `frontier` on one side, never turning back. */
	const walk = (keep: Set<string>, frontier: Iterable<string>, side: Side, steps: number) => {
		let at = [...frontier];
		const seen = new Set(at);
		for (; steps > 0 && at.length; steps--) {
			const out: string[] = [];
			for (const u of at)
				for (const v of next[side].get(u) ?? [])
					if (!seen.has(v)) {
						seen.add(v);
						keep.add(v);
						out.push(v);
					}
			at = out;
		}
	};
	return { kind, keeps, followed, touching, walk };
}

/** Everything inside element `id`, however deep, and the models stored there. */
function contentsOf(model: Model, id: string): string[] {
	const out: string[] = [];
	const inside = new Set<string>();
	const deep = (e: string) => {
		inside.add(e);
		for (const c of model.elements.get(e)?.childIds ?? []) {
			out.push(c);
			deep(c);
		}
	};
	deep(id);
	for (const [m, info] of model.elements)
		if (info.def.kind === 'model' && info.storedIn && inside.has(info.storedIn)) out.push(m);
	return out;
}

/**
 * The design cut down to a subject's dependencies: what it uses and what uses it (`sides`),
 * one step each (`direct`) or on along the same side until the chain ends (`chain`). A chain
 * never turns back, so it never spreads into the other dependents of what it reaches. A step
 * joins two models, apis, units, triggers or channels (a field's counts for its model); `data`
 * keeps models only, and apis and units never bridge two of them. A field, or an api or unit in
 * a data focus, starts from its own connections. A system or module shows what it holds and its
 * boundary: what its contents use and what uses them, one step, whatever `sides` and `reach`.
 * The boxes round what is kept stay; a model shows once, where it is owned. A neighbour's
 * connecting fields come first, the rest behind its fold row, which comes no later than `FOLD`
 * rows in, as on any card.
 */
export function focusOn(model: Model, focus: Focus): Focused {
	const { kind, keeps, followed, touching, walk } = graphOf(model, focus.mode);

	if (kind(focus.id) === 'module') {
		const inside = new Set(contentsOf(model, focus.id).filter(keeps));
		const keep = new Set(inside);
		for (const side of SIDES.both) walk(keep, inside, side, 1);
		return cut(model, keep, followed);
	}

	const field = model.fields.get(focus.id);
	const subject = field ? field.modelId : kind(focus.id) === 'model' ? focus.id : undefined;
	const steps = focus.reach === 'chain' ? Infinity : 1;
	const keep = new Set<string>(subject ? [subject] : []);
	for (const side of SIDES[focus.sides]) {
		if (!field && keeps(focus.id)) {
			keep.add(focus.id);
			walk(keep, [focus.id], side, steps);
			continue;
		}
		// A field, or an api or unit in a data focus: its own connections are the first step.
		const first = touching(focus.id, side).filter((u) => keeps(u) && u !== subject);
		for (const u of first) keep.add(u);
		walk(keep, first, side, steps - 1);
	}
	return cut(model, keep, followed, subject);
}

/** Every step in `steps`, however deep, the branches of flag steps too. */
function* stepsIn(steps: LogicStep[] | undefined): Generator<LogicStep> {
	for (const s of steps ?? []) {
		yield s;
		for (const k of ['then', 'else', 'do', 'on', 'off'] as const) yield* stepsIn(s[k]);
	}
}

/** What depends on a flag key, by the part each plays (see `flagRoles`). */
export interface FlagRoles {
	/** Units with a flag step on one of the key's definitions. */
	checks: Set<string>;
	/** What the off and the on branches of those steps call, read, write or send. */
	off: Set<string>;
	on: Set<string>;
	/** Apis, units, triggers and channels gated on one of the definitions. */
	gated: Set<string>;
	/** What calls or handles a gated item, or listens on a gated channel. */
	around: Set<string>;
}

/**
 * What depends on a flag key, in a design holding every branch and gated item: the units with a
 * flag step on one of its definitions, what either branch of such a step calls, reads, writes or
 * sends, the apis, units, triggers and channels gated on it, and what calls or handles one of
 * those or listens on a gated channel. That is what flipping the key changes, or can break.
 */
export function flagRoles(model: Model, key: string): FlagRoles {
	const defs = new Set(flagKeys(model).get(key) ?? []);
	const roles: FlagRoles = {
		checks: new Set(),
		off: new Set(),
		on: new Set(),
		gated: new Set(),
		around: new Set()
	};
	const holder = (id: string) => model.fields.get(id)?.modelId ?? id;
	for (const [id, e] of model.elements) {
		if (e.def.when && defs.has(e.def.when.flag)) roles.gated.add(id);
		if (e.def.kind !== 'logic-unit') continue;
		for (const s of stepsIn(e.def.steps)) {
			if (s.flag === undefined || !defs.has(s.flag)) continue;
			roles.checks.add(id);
			for (const branch of ['off', 'on'] as const)
				for (const b of stepsIn(s[branch]))
					for (const t of [b.call, b.send, b.read, b.write])
						if (t !== undefined && model.elements.has(holder(t))) roles[branch].add(holder(t));
		}
	}
	for (const g of roles.gated) {
		for (const [id, e] of model.elements)
			if (e.logic?.calls.includes(g) || e.logic?.handles.includes(g)) roles.around.add(id);
		for (const p of model.ports.values())
			if (p.channel === g) for (const t of p.triggers) roles.around.add(t);
	}
	return roles;
}

/** Everything that depends on a flag key: every part of `flagRoles`. */
export function flagReach(model: Model, key: string): Set<string> {
	const r = flagRoles(model, key);
	return new Set([...r.checks, ...r.off, ...r.on, ...r.gated, ...r.around]);
}

/**
 * The design cut down to what depends on a flag key: `direct`, what `flagRoles` finds; `chain`
 * (All), the front of flipping it (see `frontOf`): what the flip changes, up to where it breaks
 * or settles, with the way in of each changed unit. A data focus keeps the models these touch.
 * `model` holds every branch and gated item, so both states of the key are laid out alike;
 * `cutLike` draws one state in that layout.
 */
export function focusOnFlag(model: Model, focus: Focus, front?: Front): Focused {
	const roles = flagRoles(model, focus.id);
	const direct = [...roles.checks, ...roles.off, ...roles.on, ...roles.gated, ...roles.around];
	return focusOnChange(model, focus, focus.reach === 'chain' && front ? front.keep : direct);
}

/**
 * The design cut down to a change: `ids` (what it reaches) that `model` holds. A data focus
 * keeps the models among them, and those the others touch.
 */
export function focusOnChange(model: Model, focus: Focus, ids: Iterable<string>): Focused {
	const { keeps, followed, touching } = graphOf(model, focus.mode);
	const reach = [...ids].filter((id) => model.elements.has(id));
	const keep = new Set(
		focus.mode === 'data'
			? reach.flatMap((id) =>
					keeps(id) ? [id] : [...touching(id, 'uses'), ...touching(id, 'usedBy')].filter(keeps)
				)
			: reach.filter(keeps)
	);
	return cut(model, keep, followed);
}

/** `model`, another state of the design `focused` was cut from, cut the same way. */
export function cutLike(focused: Focused, model: Model): Focused {
	const keep = new Set([...focused.keep].filter((id) => model.elements.has(id)));
	return cut(model, keep, focused.followed);
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
