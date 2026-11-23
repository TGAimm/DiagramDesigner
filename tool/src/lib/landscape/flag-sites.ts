import { flagKeys } from '../model/flags';
import type { Model } from '../model/model';
import type { LogicStep } from '../model/schema';

/** One flag step on a key: the unit taking it, under what conditions, and what each branch does. */
export interface FlagSite {
	unit: string;
	/** The definition the step names. */
	flag: string;
	/** The conditions round the step, outermost first: `if …`, `for each …`, `not …`. */
	context: string[];
	/** One line per step of each branch; none when the branch does nothing. */
	off: string[];
	on: string[];
}

/** A step in a line: what it calls, sends, reads or writes, its note, or the condition it opens. */
export function stepLine(model: Model, s: LogicStep): string {
	const el = (id: string) => model.elements.get(id);
	const named = (id: string) => {
		const f = model.fields.get(id);
		return f ? `${el(f.modelId)?.name ?? f.modelId}.${f.def.name}` : (el(id)?.name ?? id);
	};
	if (s.call !== undefined) {
		const t = el(s.call);
		if (t?.def.kind === 'api') return `calls ${t.def.method ?? ''} ${t.def.path ?? t.name}`.trim();
		if (t?.def.kind === 'trigger') return `sends ${t.name}`;
		const owner = t?.parentId ? el(t.parentId)?.name : undefined;
		return `calls ${owner ? `${owner} · ` : ''}${t?.name ?? s.call}`;
	}
	if (s.send !== undefined) return `sends on ${named(s.send)}`;
	if (s.read !== undefined) return `reads ${named(s.read)}`;
	if (s.write !== undefined) return `writes ${named(s.write)}`;
	if (s.if !== undefined) return `if ${s.if}`;
	if (s.each !== undefined) return `for each ${s.each}`;
	if (s.flag !== undefined) return `checks ${el(s.flag)?.name ?? s.flag}`;
	if (s.return !== undefined) return `returns ${s.return}`;
	if (s.fail !== undefined) return `fails: ${s.fail}`;
	return s.note ?? '';
}

/**
 * Every flag step on one of a key's definitions, unit by unit in the design's order: the
 * conditions it sits under and, per branch, a line for each of its steps. This is what flipping
 * the key changes, including what no line on the canvas shows (a branch that only notes work).
 */
export function flagSites(model: Model, key: string): FlagSite[] {
	const defs = new Set(flagKeys(model).get(key) ?? []);
	const out: FlagSite[] = [];
	const name = (id: string) => model.elements.get(id)?.name ?? id;
	for (const [id, e] of model.elements) {
		if (e.def.kind !== 'logic-unit') continue;
		const walk = (steps: LogicStep[] | undefined, context: string[]) => {
			for (const s of steps ?? []) {
				if (s.flag !== undefined && defs.has(s.flag))
					out.push({
						unit: id,
						flag: s.flag,
						context,
						off: (s.off ?? []).map((b) => stepLine(model, b)),
						on: (s.on ?? []).map((b) => stepLine(model, b))
					});
				if (s.if !== undefined) {
					walk(s.then, [...context, `if ${s.if}`]);
					walk(s.else, [...context, `not ${s.if}`]);
				}
				if (s.each !== undefined) walk(s.do, [...context, `for each ${s.each}`]);
				if (s.flag !== undefined && !defs.has(s.flag)) {
					walk(s.on, [...context, `${name(s.flag)} on`]);
					walk(s.off, [...context, `${name(s.flag)} off`]);
				}
			}
		};
		walk(e.def.steps, []);
	}
	return out;
}

/**
 * The part of each name the others in its family don't share, split on `.`, `:`, `-`, `_` and
 * spaces: `UseNewBilling.DK` among `UseNewBilling.SE` … is `DK`. A name that
 * is all shared, or alone, stays whole.
 */
export function familyParts(names: string[]): string[] {
	if (names.length < 2) return names;
	const split = names.map((n) => n.split(/([.:\-_ ]+)/));
	const words = split.map((s) => s.filter((_, i) => i % 2 === 0));
	const min = Math.min(...words.map((w) => w.length));
	let head = 0;
	while (head < min - 1 && words.every((w) => w[head] === words[0][head])) head++;
	let tail = 0;
	while (
		tail < min - head - 1 &&
		words.every((w) => w[w.length - 1 - tail] === words[0][words[0].length - 1 - tail])
	)
		tail++;
	return split.map((s, i) => {
		const w = words[i];
		const from = 2 * head;
		const to = s.length - 2 * tail;
		const part = s.slice(from, to).join('');
		return part && w.length > head + tail ? part : names[i];
	});
}
