import type { Model } from '#lib/model/model.ts';

/** What a hit is; groups are listed in this order, following the landscape. */
export const HIT_KINDS = ['system', 'module', 'model', 'field', 'api', 'logic-unit'] as const;
export type HitKind = (typeof HIT_KINDS)[number];

export const HIT_GROUPS: Record<HitKind, string> = {
	system: 'SYSTEMS',
	module: 'MODULES',
	model: 'MODELS',
	field: 'FIELDS',
	api: 'APIS',
	'logic-unit': 'LOGIC UNITS'
};

/** Where the query sits in a text: [start, end). */
export type Mark = [number, number];

export interface Hit {
	kind: HitKind;
	/** Element or field id. */
	id: string;
	/** The name; an api's path. */
	text: string;
	mark?: Mark;
	/** Apis only. */
	method?: string;
	/** An api's name, when the query matched it and not the path. */
	alt?: { text: string; mark: Mark };
	/** Where it lives: the names of the boxes round it, outermost first. */
	at: string[];
}

export interface HitGroup {
	kind: HitKind;
	title: string;
	hits: Hit[];
}

const find = (text: string, q: string): Mark | undefined => {
	const i = text.toLowerCase().indexOf(q);
	return i < 0 ? undefined : [i, i + q.length];
};

/**
 * Finds systems, modules, models, fields, apis and logic units whose name holds the query
 * (any case); apis also by path. Within a group, the earlier the query sits in the text, the
 * higher the hit. With no query, lists the systems to start from. `hidden` apis and units
 * (gated off in the shown flag state) are not found.
 */
export function searchLandscape(model: Model, query: string, hidden?: Set<string>): HitGroup[] {
	const q = query.trim().toLowerCase();
	const where = (id: string | undefined): string[] => {
		const out: string[] = [];
		for (let e = id ? model.elements.get(id) : undefined; e; e = model.elements.get(e.parentId!))
			out.unshift(e.name);
		return out;
	};
	if (!q)
		return [
			{
				kind: 'system',
				title: HIT_GROUPS.system,
				hits: model.rootElementIds
					.map((id) => model.elements.get(id)!)
					.filter((e) => e.def.kind === 'system')
					.map((e) => ({ kind: 'system', id: e.id, text: e.name, at: [] }))
			}
		];

	const found: Record<HitKind, Hit[]> = {
		system: [],
		module: [],
		model: [],
		field: [],
		api: [],
		'logic-unit': []
	};
	for (const e of model.elements.values()) {
		const kind = e.def.kind;
		// Flags are listed in the Flags menu, not drawn; a hidden api or unit isn't there.
		if (kind === 'flag' || hidden?.has(e.id)) continue;
		const at = where(e.parentId);
		if (kind === 'api') {
			const path = e.def.path ?? '';
			const mark = find(path, q);
			const named = mark ? undefined : find(e.name, q);
			if (mark || named)
				found.api.push({
					kind,
					id: e.id,
					text: path,
					mark,
					method: e.def.method,
					alt: named && { text: e.name, mark: named },
					at
				});
			continue;
		}
		const mark = find(e.name, q);
		if (mark) found[kind].push({ kind, id: e.id, text: e.name, mark, at });
	}
	for (const [id, f] of model.fields) {
		const mark = find(f.def.name, q);
		if (mark) found.field.push({ kind: 'field', id, text: f.def.name, mark, at: where(f.modelId) });
	}

	const start = (h: Hit) => (h.mark ?? h.alt!.mark)[0];
	return HIT_KINDS.filter((k) => found[k].length).map((kind) => ({
		kind,
		title: HIT_GROUPS[kind],
		hits: found[kind].sort(
			(a, b) =>
				start(a) - start(b) ||
				a.text.localeCompare(b.text) ||
				a.at.join().localeCompare(b.at.join())
		)
	}));
}
