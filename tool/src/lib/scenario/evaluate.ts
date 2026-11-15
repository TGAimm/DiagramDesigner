import type { Document } from 'yaml';
import { buildModel, type Locator, type Model } from '../model/model';
import { applyChanges, type ChangeResult, type Docs } from './apply';
import { diffModels, type Diff, type DiffEntry } from './diff';
import { impactOf, ownerOf, type ImpactReport } from './impact';
import type { Change } from './scenario';

/** The counts on the topbar's one summary line. */
export interface Summary {
	changed: number;
	added: number;
	dropped: number;
	moved: number;
	breaking: number;
	affected: number;
	check: number;
}

/** One state of the design: its files' data and the model built from it. */
export interface State {
	model: Model;
	data: Record<string, unknown>;
}

/** A design state compared with another: what changed, and what that breaks. */
export interface Comparison {
	before: Model;
	after: Model;
	diff: Diff;
	report: ImpactReport;
	summary: Summary;
	/** The after state with what is dropped put back where it was, so Diff mode draws it. */
	union: Model;
	dropped: Set<string>;
}

/** A scenario applied over the design. */
export interface Evaluation extends Comparison {
	results: ChangeResult[];
}

const dataOf = (docs: Docs) =>
	Object.fromEntries(Object.entries(docs).map(([f, d]) => [f, d.toJS() ?? {}]));

/**
 * Applies changes over the design's documents. `locate` positions diagnostics in files the
 * changes leave untouched. `build` makes the after state from its data, e.g. in a flag state
 * (`before` is then in the same state).
 */
export function evaluate(
	docs: Record<string, Document>,
	before: State,
	changes: Change[],
	locate?: Locator,
	build?: (data: Record<string, unknown>) => State
): Evaluation {
	const applied = applyChanges(docs, changes);
	const at: Locator = (file, path, key) =>
		applied.touched.has(file) ? undefined : locate?.(file, path, key);
	const data = dataOf(applied.docs);
	const after = build ? build(data) : { model: buildModel(data, at), data };
	return { ...compare(before, after), results: applied.results };
}

/** Errors in the after state that the design does not already have. */
export function newErrors(before: Model, after: Model) {
	const known = new Set(before.diagnostics.map((d) => `${d.code}|${d.message}`));
	return after.diagnostics.filter(
		(d) => d.severity === 'error' && !known.has(`${d.code}|${d.message}`)
	);
}

export function compare(b: State, a: State): Comparison {
	const [before, after] = [b.model, a.model];
	const diff = diffModels(before, after);
	const report = impactOf(before, after, diff);
	const { data, dropped } = unionData(b, a, diff);
	return {
		before,
		after,
		diff,
		report,
		summary: summarize(before, after, diff, report),
		union: buildModel(data),
		dropped
	};
}

const clone = <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

/**
 * The after state's data with each dropped item put back where it was before: a dropped
 * entity's file, or a dropped field at its old place in its list.
 */
function unionData(b: State, a: State, diff: Diff) {
	const data: Record<string, unknown> = clone(a.data);
	const dropped = new Set<string>();
	const gone = topEntries(b.model, a.model, diff).filter((e) => e.change === 'dropped');
	for (const e of gone) {
		const loc = e.kind === 'element' ? b.model.elements.get(e.id)?.loc : b.model.ids.get(e.id)?.loc;
		if (!loc) continue;
		if (e.kind === 'element') {
			if (data[loc.file] !== undefined) continue;
			data[loc.file] = clone(b.data[loc.file]);
			dropped.add(e.id);
			continue;
		}
		const owner = ownerOf(b.model, a.model, e.id);
		const file = owner && a.model.elements.get(owner)?.loc.file;
		if (!file || data[file] === undefined) continue;
		let item: unknown = b.data[loc.file];
		for (const seg of loc.path) item = (item as Record<string | number, unknown>)?.[seg];
		let list: unknown = data[file];
		for (const seg of loc.path.slice(0, -2))
			list = (list as Record<string | number, unknown>)?.[seg];
		const key = loc.path[loc.path.length - 2];
		const host = list as Record<string | number, unknown[]> | undefined;
		if (!host || typeof host !== 'object' || item === undefined) continue;
		const arr = (host[key] ??= []);
		arr.splice(Math.min(loc.path[loc.path.length - 1] as number, arr.length), 0, clone(item));
		dropped.add(e.id);
	}
	return { data, dropped };
}

/** Top-level changes only: a field of an added or dropped model is part of that change. */
export function topEntries(before: Model, after: Model, diff: Diff): DiffEntry[] {
	const whole = new Set(diff.entries.filter((e) => e.change !== 'changed').map((e) => e.id));
	return diff.entries.filter((e) => {
		if (e.kind === 'element') return true;
		const owner = ownerOf(before, after, e.id);
		return !(owner && whole.has(owner));
	});
}

function summarize(before: Model, after: Model, diff: Diff, report: ImpactReport): Summary {
	const top = topEntries(before, after, diff);
	const worst = new Map<string, string>();
	const affected = new Set<string>();
	for (const i of report.impacts) {
		const key = `${i.id}|${i.table ? 't' : ''}|${i.part ?? ''}`;
		if (i.depth === 2) affected.add(i.id);
		else if (i.level === 'breaking') worst.set(key, 'breaking');
		else if (i.level === 'check' && worst.get(key) !== 'breaking') worst.set(key, 'check');
	}
	const values = [...worst.values()];
	return {
		changed: top.filter((e) => e.change === 'changed' && !e.movedFrom).length,
		added: top.filter((e) => e.change === 'added').length,
		dropped: top.filter((e) => e.change === 'dropped').length,
		moved: top.filter((e) => e.movedFrom).length,
		breaking: values.filter((v) => v === 'breaking').length,
		affected: affected.size,
		check: values.filter((v) => v === 'check').length + report.mentions.length
	};
}
