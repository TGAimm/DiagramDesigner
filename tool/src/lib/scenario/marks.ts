import type { Model } from '../model/model';
import type { Comparison } from './evaluate';
import { worse, type Level } from './impact';

/**
 * What the canvas marks for a comparison: a glyph on each changed item, a level on what it
 * breaks, the dropped items, and per element a count of marked items inside for closed boxes.
 */
export type Glyph = '+' | '−' | '~' | '↦';

/** What the canvas marks, read by the nodes so marks never rebuild them. */
export interface Marks {
	/** Items changed directly. */
	glyph: Map<string, Glyph>;
	/** Worst level by item: changed ones take the worst of what they break. */
	level: Map<string, Level>;
	/** Items gone in the after state, drawn struck in Diff mode. */
	dropped: Set<string>;
	/** Per element: how many marked items it holds, and the worst level, for closed boxes. */
	rollup: Map<string, { count: number; level: Level }>;
}

export const EMPTY: Marks = {
	glyph: new Map(),
	level: new Map(),
	dropped: new Set(),
	rollup: new Map()
};

/** Ids of everything owned by an element: its fields, api fields, inputs, params, indexes. */
function elementOf(model: Model, id: string): string | undefined {
	if (model.elements.has(id)) return id;
	const f = model.fields.get(id);
	if (f) return f.modelId;
	const af = model.apiFields.get(id);
	if (af) return af.apiId;
	const loc = model.ids.get(id)?.loc;
	if (!loc) return undefined;
	for (const [eid, el] of model.elements) if (el.loc.file === loc.file) return eid;
	return undefined;
}

export function marksOf(c: Comparison): Marks {
	const glyph = new Map<string, Glyph>();
	for (const e of c.diff.entries)
		glyph.set(
			e.id,
			e.change === 'added' ? '+' : e.change === 'dropped' ? '−' : e.movedFrom ? '↦' : '~'
		);
	const level = new Map(c.report.levelOf);
	for (const m of c.report.mentions) level.set(m.entity, worse(level.get(m.entity), 'check'));
	// Roll each marked item up to every element round it, counting it once per element.
	const rollup = new Map<string, { count: number; level: Level }>();
	const items = new Map<string, { element: string; level: Level }>();
	for (const id of glyph.keys()) {
		const element = elementOf(c.union, id) ?? elementOf(c.before, id);
		if (element) items.set(id, { element, level: level.get(id) ?? 'info' });
	}
	for (const i of c.report.impacts)
		if (i.level !== 'stopped') {
			const key = `${i.id}|${i.table ? 't' : ''}`;
			const prev = items.get(key);
			items.set(key, { element: i.element, level: worse(prev?.level, i.level) });
		}
	for (const m of c.report.mentions)
		items.set(`${m.entity}|m`, { element: m.entity, level: 'check' });
	for (const { element, level: l } of items.values()) {
		const seen = new Set<string>();
		for (let cur: string | undefined = element; cur && !seen.has(cur);) {
			seen.add(cur);
			const r = rollup.get(cur);
			rollup.set(cur, { count: (r?.count ?? 0) + 1, level: worse(r?.level, l) });
			cur = (c.union.elements.get(cur) ?? c.before.elements.get(cur))?.parentId;
		}
	}
	return { glyph, level, dropped: c.dropped, rollup };
}
