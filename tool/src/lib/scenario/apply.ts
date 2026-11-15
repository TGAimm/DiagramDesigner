import { Document, isNode, isSeq, type Node } from 'yaml';
import type { DataPath } from '../model/diagnostics';
import { isAdd, isDrop, isSet, type Change } from './scenario';

/** Parsed YAML documents of the design, keyed by design-relative path. */
export type Docs = Record<string, Document>;

export type ChangeStatus = 'ok' | 'stale' | 'missing' | 'exists' | 'invalid';

export interface ChangeResult {
	status: ChangeStatus;
	/** Why a change was not applied. */
	message?: string;
	/** File the change landed in. */
	file?: string;
}

export interface Applied {
	docs: Docs;
	results: ChangeResult[];
	/** Files written, added or removed, for saving. */
	touched: Set<string>;
}

interface IdLoc {
	file: string;
	path: DataPath;
}

const LISTS = ['fields', 'params', 'indexes', 'inputs', 'outputs'] as const;

type Obj = Record<string, unknown>;
const items = (v: unknown): Obj[] => (Array.isArray(v) ? (v as Obj[]) : []);

/** Where every id of one file lives: the entity, and the items with ids in its lists. */
function indexFile(file: string, data: unknown, into: Map<string, IdLoc>) {
	if (!data || typeof data !== 'object') return;
	const d = data as Obj;
	const put = (id: unknown, path: DataPath) => {
		if (typeof id === 'string') into.set(id, { file, path });
	};
	put(d.id, []);
	for (const key of LISTS) items(d[key]).forEach((f, i) => put(f.id, [key, i]));
	items((d.request as Obj | undefined)?.fields).forEach((f, i) =>
		put(f.id, ['request', 'fields', i])
	);
	items(d.responses).forEach((r, j) =>
		items(r.fields).forEach((f, i) => put(f.id, ['responses', j, 'fields', i]))
	);
}

const toJS = (v: unknown) => (isNode(v) ? (v as Node).toJSON() : v);

export const sameValue = (a: unknown, b: unknown) =>
	JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

export const show = (v: unknown) => (v === undefined || v === null ? 'absent' : JSON.stringify(v));

/**
 * Applies changes in order to copies of the documents they touch. A change whose target is
 * gone, or whose `was` no longer matches, is skipped and reported; the rest still apply.
 */
export function applyChanges(source: Docs, changes: Change[]): Applied {
	const docs: Docs = { ...source };
	const touched = new Set<string>();
	const ids = new Map<string, IdLoc>();
	for (const [file, doc] of Object.entries(docs)) indexFile(file, doc.toJS(), ids);

	const own = (file: string) => {
		if (!touched.has(file)) {
			docs[file] = docs[file].clone();
			touched.add(file);
		}
		return docs[file];
	};
	const reindex = (file: string) => {
		for (const [id, loc] of ids) if (loc.file === file) ids.delete(id);
		if (docs[file]) indexFile(file, docs[file].toJS(), ids);
	};

	const apply = (c: Change): ChangeResult => {
		if (isSet(c)) {
			const loc = ids.get(c.set);
			if (!loc) return { status: 'missing', message: `"${c.set}" is not in the design` };
			if (c.key === 'id') return { status: 'invalid', message: 'ids are never changed' };
			const path = [...loc.path, ...(c.key !== undefined ? [c.key] : (c.path ?? []))];
			const cur = toJS(docs[loc.file].getIn(path));
			if (!sameValue(cur, c.was))
				return { status: 'stale', message: `is now ${show(cur)}, not ${show(c.was)}` };
			const doc = own(loc.file);
			if (c.to === undefined || c.to === null) doc.deleteIn(path);
			else {
				const node = doc.createNode(c.to);
				if (isNode(node) && 'flow' in node) (node as { flow: boolean }).flow = true;
				doc.setIn(path, node);
			}
			return { status: 'ok', file: loc.file };
		}
		if (isAdd(c)) {
			if (ids.has(c.add)) return { status: 'exists', message: `"${c.add}" is already used` };
			if (c.file && c.entity) {
				if (docs[c.file]) return { status: 'exists', message: `${c.file} already exists` };
				docs[c.file] = new Document({ id: c.add, ...c.entity });
				touched.add(c.file);
				reindex(c.file);
				return { status: 'ok', file: c.file };
			}
			const loc = c.in ? ids.get(c.in) : undefined;
			if (!loc || loc.path.length)
				return { status: 'missing', message: `model "${c.in}" is not in the design` };
			const doc = own(loc.file);
			let seq = doc.get('fields', true);
			if (!isSeq(seq)) {
				seq = doc.createNode([]);
				doc.set('fields', seq);
			}
			if (!isSeq(seq)) return { status: 'invalid', message: 'fields is not a list' };
			const node = doc.createNode({ id: c.add, ...c.field });
			(node as { flow: boolean }).flow = true;
			const list = seq.toJSON() as Obj[];
			const after = c.after ? list.findIndex((f) => f.id === c.after) : -1;
			seq.items.splice(after >= 0 ? after + 1 : seq.items.length, 0, node);
			reindex(loc.file);
			return { status: 'ok', file: loc.file };
		}
		if (isDrop(c)) {
			const loc = ids.get(c.drop);
			if (!loc) return { status: 'missing', message: `"${c.drop}" is not in the design` };
			if (!loc.path.length) {
				delete docs[loc.file];
				touched.add(loc.file);
				reindex(loc.file);
				return { status: 'ok', file: loc.file };
			}
			const doc = own(loc.file);
			const seq = doc.getIn(loc.path.slice(0, -1), true);
			if (isSeq(seq)) seq.items.splice(loc.path[loc.path.length - 1] as number, 1);
			reindex(loc.file);
			return { status: 'ok', file: loc.file };
		}
		return { status: 'invalid', message: 'unknown change' };
	};

	const results = changes.map(apply);
	return { docs, results, touched };
}
