import type { Model } from '../model/model';
import { sameValue } from './apply';

/**
 * Two states of the design compared by id: same id with a new name is a rename, with a new
 * owner a move, an id only before is a drop, an id only after an add.
 */

/** What an id names: an entity, a model field, an api's own-shape field, a logic unit's input
 * or output, or an api param or model index. */
export type ItemKind = 'element' | 'field' | 'api-field' | 'logic-field' | 'part';

export interface Item {
	id: string;
	kind: ItemKind;
	name: string;
	/** Entity it sits in (the model, api or logic unit); for entities their parent. */
	owner?: string;
	/** Compared key by key, without name and owner. */
	props: Record<string, unknown>;
}

export interface KeyChange {
	key: string;
	before: unknown;
	after: unknown;
}

export interface DiffEntry {
	id: string;
	kind: ItemKind;
	change: 'added' | 'dropped' | 'changed';
	name: string;
	/** Changed only: the old name, when renamed. */
	renamedFrom?: string;
	/** Changed only: the old owner, when moved. */
	movedFrom?: string;
	keys: KeyChange[];
}

export interface Diff {
	entries: DiffEntry[];
	byId: Map<string, DiffEntry>;
}

const omit = (o: object, keys: string[]) =>
	Object.fromEntries(Object.entries(o).filter(([k]) => !keys.includes(k)));

/** Everything with an id, as comparable items. */
export function itemsOf(model: Model): Map<string, Item> {
	const out = new Map<string, Item>();
	const put = (
		id: string,
		kind: ItemKind,
		name: string,
		owner: string | undefined,
		props: object
	) => out.set(id, { id, kind, name, owner, props: omit(props, ['id', 'name']) });
	for (const [id, el] of model.elements) {
		const def = el.def;
		const props: Record<string, unknown> = {
			...omit(def, ['fields', 'inputs', 'outputs', 'params', 'indexes', 'request', 'responses']),
			storedIn: el.storedIn,
			models: el.refIds
		};
		if (def.request) props.request = omit(def.request, ['fields']);
		if (def.responses) props.responses = def.responses.map((r) => omit(r, ['fields']));
		if (def.params) props.params = def.params.filter((p) => !p.id);
		if (def.indexes) props.indexes = def.indexes.filter((ix) => !ix.id);
		put(id, 'element', el.name, el.parentId, props);
		for (const io of ['inputs', 'outputs'] as const)
			def[io]?.forEach((f) => put(f.id, 'logic-field', f.name, `${id}:${io}`, f));
		def.params?.forEach((p) => p.id && put(p.id, 'part', p.name, id, { list: 'params', ...p }));
		def.indexes?.forEach(
			(ix) => ix.id && put(ix.id, 'part', ix.name, id, { list: 'indexes', ...ix })
		);
	}
	for (const [id, f] of model.fields) put(id, 'field', f.def.name, f.modelId, f.def);
	for (const [id, f] of model.apiFields)
		put(id, 'api-field', f.def.name, `${f.apiId}:${f.part}`, f.def);
	return out;
}

export function diffModels(before: Model, after: Model): Diff {
	const a = itemsOf(before);
	const b = itemsOf(after);
	const entries: DiffEntry[] = [];
	for (const [id, x] of a) {
		const y = b.get(id);
		if (!y) {
			entries.push({ id, kind: x.kind, change: 'dropped', name: x.name, keys: [] });
			continue;
		}
		const keys: KeyChange[] = [];
		for (const key of new Set([...Object.keys(x.props), ...Object.keys(y.props)]))
			if (!sameValue(x.props[key], y.props[key]))
				keys.push({ key, before: x.props[key], after: y.props[key] });
		const renamed = x.name !== y.name;
		const moved = x.owner !== y.owner;
		if (renamed || moved || keys.length)
			entries.push({
				id,
				kind: y.kind,
				change: 'changed',
				name: y.name,
				...(renamed ? { renamedFrom: x.name } : {}),
				...(moved ? { movedFrom: x.owner } : {}),
				keys
			});
	}
	for (const [id, y] of b)
		if (!a.has(id)) entries.push({ id, kind: y.kind, change: 'added', name: y.name, keys: [] });
	return { entries, byId: new Map(entries.map((e) => [e.id, e])) };
}
