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

/** A design state compared with another: what changed, and what that breaks. */
export interface Comparison {
	before: Model;
	after: Model;
	diff: Diff;
	report: ImpactReport;
	summary: Summary;
}

/** A scenario applied over the design. */
export interface Evaluation extends Comparison {
	results: ChangeResult[];
	/** The after state with what is dropped left in, so Diff mode can draw it struck. */
	union: Model;
	dropped: Set<string>;
}

const dataOf = (docs: Docs) =>
	Object.fromEntries(Object.entries(docs).map(([f, d]) => [f, d.toJS() ?? {}]));

/**
 * Applies changes over the design's documents. `locate` positions diagnostics in files the
 * changes leave untouched.
 */
export function evaluate(
	docs: Record<string, Document>,
	before: Model,
	changes: Change[],
	locate?: Locator
): Evaluation {
	const applied = applyChanges(docs, changes);
	const kept = applyChanges(docs, changes, { keepDropped: true });
	const at: Locator = (file, path, key) =>
		applied.touched.has(file) ? undefined : locate?.(file, path, key);
	const after = buildModel(dataOf(applied.docs), at);
	const union = buildModel(dataOf(kept.docs));
	return { ...compare(before, after), results: applied.results, union, dropped: kept.dropped };
}

/** Errors in the after state that the design does not already have. */
export function newErrors(before: Model, after: Model) {
	const known = new Set(before.diagnostics.map((d) => `${d.code}|${d.message}`));
	return after.diagnostics.filter(
		(d) => d.severity === 'error' && !known.has(`${d.code}|${d.message}`)
	);
}

export function compare(before: Model, after: Model): Comparison {
	const diff = diffModels(before, after);
	const report = impactOf(before, after, diff);
	return { before, after, diff, report, summary: summarize(before, after, diff, report) };
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
