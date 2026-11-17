import { LOGIC_KEYS, type Model } from '../model/model';
import { bodyModels } from './apis';
import { cardRows, linkTarget, type LandscapeBox } from './layout';

/**
 * Every kind of connection. A field refers to a key (`ref`), holds a model (`model`) or
 * derives from a source (`from`); a unit reads, writes or calls; an api is handled by a unit
 * and its bodies use models (`body`); a trigger is handled by the units it starts.
 */
export type LinkKind = 'ref' | 'model' | 'from' | 'reads' | 'writes' | 'calls' | 'handles' | 'body';

/**
 * One connection between two leaves: a field, model, logic unit, api or api field. `from`
 * depends on `to`, so the arrow points at `to`, and change impact follows edges backwards.
 */
export interface Edge {
	kind: LinkKind;
	from: string;
	to: string;
}

export const edgeKey = (e: Edge) => `${e.kind}:${e.from}>${e.to}`;

/** Every connection in the design, each once. Ends that name nothing known are left out. */
export function edgesOf(model: Model): Edge[] {
	const out = new Map<string, Edge>();
	const known = (id: string) =>
		model.fields.has(id) || model.elements.has(id) || model.apiFields.has(id);
	const add = (kind: LinkKind, from: string, to: string) => {
		const e = { kind, from, to };
		if (known(from) && known(to) && from !== to) out.set(edgeKey(e), e);
	};
	for (const [id, { def: f }] of model.fields) {
		if (f.ref) add('ref', id, f.ref);
		if (f.model) add('model', id, f.model);
		for (const to of f.from ?? []) add('from', id, to);
	}
	for (const [id, info] of model.elements) {
		// An api or trigger depends on the unit handling it, as a caller on its callee.
		for (const kind of info.logic ? LOGIC_KEYS : [])
			for (const to of info.logic![kind])
				if (kind === 'handles') add(kind, to, id);
				else add(kind, id, to);
		if (info.def.kind === 'api') for (const u of bodyModels(model, id)) add('body', id, u.model);
	}
	// A response field derives from model fields; a request field is the source of the
	// model fields it goes into.
	for (const [id, { def: f }] of model.apiFields) {
		for (const to of f.from ?? []) add('from', id, to);
		for (const from of f.to ?? []) add('from', from, id);
	}
	return [...out.values()];
}

/** The api an api, or a field of an api's own shape, belongs to. */
export const apiOf = (model: Model, leaf: string) =>
	model.apiFields.get(leaf)?.apiId ??
	(model.elements.get(leaf)?.def.kind === 'api' ? leaf : undefined);

/**
 * The box a leaf is drawn in, seen from box `near`: a field or model on the nearest card
 * showing it (see `linkTarget`), a unit or trigger on its card, an api or api field on the box of
 * the element owning the api.
 */
export function homeOf(
	model: Model,
	boxes: LandscapeBox[],
	near: LandscapeBox,
	leaf: string
): LandscapeBox | undefined {
	const api = apiOf(model, leaf);
	if (!api) return linkTarget(model, boxes, near, leaf);
	const owner = model.elements.get(api)?.parentId;
	return boxes.find((b) => b.id === owner);
}

/** The leaves drawn in a box itself: its rows, its model, its own apis and their fields. */
export function leavesOf(model: Model, b: LandscapeBox): string[] {
	const apis = b.apis ?? [];
	return [
		...(b.view ? [b.elementId] : []),
		...(b.fields ?? []).map((f) => f.id),
		...(cardRows(b) ?? []).map((r) => r.id),
		...apis,
		...[...model.apiFields].filter(([, f]) => apis.includes(f.apiId)).map(([id]) => id)
	];
}

/** A box and every box inside it. */
export function within(boxes: LandscapeBox[], id: string): LandscapeBox[] {
	const ids = new Set([id]);
	// Parents precede their children (see `layoutLandscape`).
	for (const b of boxes) if (b.parentId && ids.has(b.parentId)) ids.add(b.id);
	return boxes.filter((b) => ids.has(b.id));
}

/** A line between two sibling boxes standing for every connection between their insides. */
export interface RestLine {
	id: string;
	source: string;
	target: string;
	/** The box both sit in; none for two top-level boxes. */
	parentId?: string;
	/** The kinds of the connections merged, each once. */
	kinds: LinkKind[];
	/** How many connections it merges. */
	count: number;
}

/**
 * The lines drawn at rest. Each end of every connection is lifted to the child of the box
 * both ends share, so a line always joins two siblings and never crosses a border; the
 * connections landing on one pair, one way, merge into one line. A connection between a box
 * and something inside it, or inside one box, has no line at rest.
 */
export function restLines(model: Model, boxes: LandscapeBox[], edges: Edge[]): RestLine[] {
	const byId = new Map(boxes.map((b) => [b.id, b]));
	const chain = (b: LandscapeBox) => {
		const out = [b.id];
		for (let p = b.parentId; p; p = byId.get(p)?.parentId) out.push(p);
		return out;
	};
	const from = new Map<string, Edge[]>();
	for (const e of edges) from.set(e.from, [...(from.get(e.from) ?? []), e]);
	const lines = new Map<string, RestLine & { keys: Set<string> }>();
	for (const a of boxes)
		for (const leaf of leavesOf(model, a))
			for (const e of from.get(leaf) ?? []) {
				const b = homeOf(model, boxes, a, e.to);
				if (!b || b === a) continue;
				const ca = chain(a);
				const cb = chain(b);
				const shared = ca.find((id) => cb.includes(id));
				if (shared === a.id || shared === b.id) continue;
				const source = shared ? ca[ca.indexOf(shared) - 1] : ca.at(-1)!;
				const target = shared ? cb[cb.indexOf(shared) - 1] : cb.at(-1)!;
				const id = `${source}>${target}`;
				let l = lines.get(id);
				if (!l) {
					l = { id, source, target, parentId: shared, kinds: [], count: 0, keys: new Set() };
					lines.set(id, l);
				}
				l.keys.add(edgeKey(e));
				if (!l.kinds.includes(e.kind)) l.kinds.push(e.kind);
			}
	return [...lines.values()].map(({ keys, ...l }) => ({ ...l, count: keys.size }));
}
