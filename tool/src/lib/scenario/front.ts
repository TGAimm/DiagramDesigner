import { apiBodies, type Model } from '../model/model';
import type { LogicStep } from '../model/schema';
import { holdersOf } from '../landscape/layout';
import { flagKeys, stateOf, type FlagState } from '../model/flags';
import { diffModels, type Diff } from './diff';
import { impactOf, ownerOf, type ImpactReport } from './impact';

/**
 * How far a change reaches between two states of the design: a flag off and on, or the design
 * before and after a scenario. Each item the change reaches either carries it on (`changed`),
 * can't take it (`breaking`, `check`: the chain stops there, as fixing the break usually fixes
 * what lies past it), or takes it without changing what it hands on (`stopped`). Only `changed`
 * passes the change on, by two kinds of difference: what runs (an api, unit, trigger or channel
 * that runs in one state only, its steps with it) and what is written (a field written in one
 * state only, its `from` copies with it). Judgments of contracts (a field renamed, an api gone)
 * come from the impact engine and always stop. A changed unit is drawn with its way in: the
 * apis and triggers starting it, through the units calling it when nothing else does.
 */
export type FrontLevel = 'way-in' | 'stopped' | 'changed' | 'check' | 'breaking';

const RANK: Record<FrontLevel, number> = {
	'way-in': 0,
	stopped: 1,
	changed: 2,
	check: 3,
	breaking: 4
};

export interface Outcome {
	/** The item: an element, a model field or an api field. */
	id: string;
	/** The element it is drawn in. */
	element: string;
	level: FrontLevel;
	reason: string;
	/** The item named: an api by its route, a field as Model.field. */
	label: string;
}

export interface Front {
	outcomes: Outcome[];
	/** Worst level by item. */
	level: Map<string, FrontLevel>;
	/** The elements drawn: models, apis, units, triggers and channels. */
	keep: Set<string>;
	/** Units whose steps differ between the states (in a flag focus, those checking the key). */
	stepped: Set<string>;
}

/** A diff and impact report of the same two states, and the state the impacts happen in. */
export interface Judged {
	diff: Diff;
	report: ImpactReport;
	at: string;
}

const RUNNING = ['api', 'logic-unit', 'trigger', 'channel'];
const DRAWN = new Set(['model', ...RUNNING]);
const LINKS = ['calls', 'reads', 'writes', 'sends'] as const;
type Link = (typeof LINKS)[number];
const VERB: Record<Link, string> = {
	calls: 'calls',
	reads: 'reads',
	writes: 'writes',
	sends: 'sends on'
};
const STEP_TEXT = ['with', 'gets', 'if', 'each', 'note'] as const;

const push = <K, V>(m: Map<K, Set<V>>, k: K, v: V) => m.set(k, (m.get(k) ?? new Set()).add(v));
const some = <T>(xs: Iterable<T> | undefined, p: (x: T) => boolean) => {
	for (const x of xs ?? []) if (p(x)) return true;
	return false;
};

/** Who calls, handles, sends on and writes what, in one state. */
function linksOf(m: Model) {
	const callers = new Map<string, Set<string>>();
	const handlers = new Map<string, Set<string>>();
	const senders = new Map<string, Set<string>>();
	/** Units writing a field, or its model (every field of it). */
	const unitWrites = new Map<string, Set<string>>();
	/** Apis of the model's own system taking a field in (`to`, or a request that is the model). */
	const apiWrites = new Map<string, Set<string>>();
	const fieldsOf = (id: string) =>
		m.fields.has(id) ? [id] : (m.elements.get(id)?.def.fields ?? []).map((f) => f.id);
	for (const [id, el] of m.elements) {
		for (const t of el.logic?.calls ?? []) push(callers, t, id);
		for (const t of el.logic?.handles ?? []) push(handlers, t, id);
		for (const t of el.logic?.sends ?? []) push(senders, t, id);
		for (const t of el.logic?.writes ?? []) for (const f of fieldsOf(t)) push(unitWrites, f, id);
		if (el.def.kind !== 'api') continue;
		const own = (f: string) => systemOf(m, m.fields.get(f)?.modelId ?? '') === systemOf(m, id);
		for (const { part, body } of apiBodies(el.def)) {
			if (part !== 'request') continue;
			for (const f of body.fields ?? [])
				for (const t of f.to ?? []) if (own(t)) push(apiWrites, t, id);
			if (body.model)
				for (const f of fieldsOf(body.model))
					if (own(f) && !body.omit?.includes(f) && (!body.pick || body.pick.includes(f)))
						push(apiWrites, f, id);
		}
	}
	return { callers, handlers, senders, unitWrites, apiWrites };
}
type Links = ReturnType<typeof linksOf>;

/** The top system an element sits in. */
function systemOf(m: Model, id: string): string | undefined {
	let e = m.elements.get(id);
	while (e?.parentId && m.elements.get(e.parentId)) e = m.elements.get(e.parentId);
	return e?.id;
}

const external = (m: Model, id: string) => {
	for (let e = m.elements.get(id); e; e = e.parentId ? m.elements.get(e.parentId) : undefined)
		if (e.def.external) return true;
	return false;
};

/**
 * What runs and what is written in state `m`. Something nothing in either state starts is
 * started from outside and runs whenever it is there: an api nothing calls, a unit nothing
 * handles or calls, a trigger on a schedule or on a channel or table nothing in the design
 * feeds. Anything else runs when something running starts it; a field is written when
 * something running writes it, or it is copied (`from`) from a written field.
 */
function flowOf(m: Model, own: Links, either: Links[], states: Model[]) {
	const any = (k: keyof Links, id: string) => either.some((l) => l[k].has(id));
	const runs = new Set<string>();
	const written = new Set<string>();
	const runningIn = (xs: Set<string> | undefined) => some(xs, (x) => runs.has(x));
	const fieldsOf = (ids: string[]) =>
		ids.flatMap((id) =>
			m.fields.has(id) ? [id] : (m.elements.get(id)?.def.fields ?? []).map((f) => f.id)
		);
	const starts = (id: string): boolean => {
		const el = m.elements.get(id)!;
		switch (el.def.kind) {
			case 'api':
				return external(m, id) || !any('callers', id) || runningIn(own.callers.get(id));
			case 'logic-unit': {
				// What it handles as written: in a state leaving that out, nothing starts it.
				const hs = el.def.handles ?? [];
				const handled = hs.length || states.some((x) => x.elements.get(id)?.def.handles?.length);
				if (!any('callers', id) && !handled) return true;
				return hs.some((h) => runs.has(h)) || runningIn(own.callers.get(id));
			}
			case 'channel':
				return !any('senders', id) || runningIn(own.senders.get(id));
			case 'trigger': {
				const on = el.def.on;
				if (on?.channel)
					return !any('senders', on.channel) || runningIn(own.senders.get(on.channel));
				if (on?.model) {
					const fs = fieldsOf(el.listens ?? [on.model]);
					const fed = fs.some((f) => any('unitWrites', f) || any('apiWrites', f));
					return !fed || fs.some((f) => written.has(f));
				}
				return true;
			}
		}
		return false;
	};
	const writes = (id: string): boolean => {
		const def = m.fields.get(id)!.def;
		if (def.derived && !def.from?.length) return true;
		return (
			runningIn(own.unitWrites.get(id)) ||
			runningIn(own.apiWrites.get(id)) ||
			some(def.from, (s) => written.has(s))
		);
	};
	for (let grew = true; grew;) {
		grew = false;
		for (const [id, el] of m.elements)
			if (RUNNING.includes(el.def.kind) && !runs.has(id) && starts(id)) {
				runs.add(id);
				grew = true;
			}
		for (const id of m.fields.keys())
			if (!written.has(id) && writes(id)) {
				written.add(id);
				grew = true;
			}
	}
	return { runs, written };
}

/** Every step's free text, however deep. */
function textOf(steps: LogicStep[] | undefined, out: string[] = []): string[] {
	for (const s of steps ?? []) {
		for (const k of STEP_TEXT) if (typeof s[k] === 'string') out.push(s[k] as string);
		for (const k of ['then', 'else', 'do', 'on', 'off'] as const) textOf(s[k], out);
	}
	return out;
}

const mentions = (text: string[], name: string) => {
	const word = new RegExp(
		`(?<![A-Za-z0-9_])${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`
	);
	return text.some((t) => word.test(t));
};

/**
 * The front of the change from state `states[0]` to `states[1]`, `at` saying each state in
 * reasons ("with newOrderFlow off"). `judged` are impact reports between them.
 */
export function frontOf(states: [Model, Model], at: [string, string], judged: Judged[]): Front {
	const outcomes: Outcome[] = [];
	const add = (o: Omit<Outcome, 'label'>) => outcomes.push({ ...o, label: label(o.id) });
	const both = states.map(linksOf) as [Links, Links];
	const flows = states.map((m, i) => flowOf(m, both[i], both, states)) as ReturnType<
		typeof flowOf
	>[];
	const el = (id: string) => states[1].elements.get(id) ?? states[0].elements.get(id);
	const field = (id: string) => states[1].fields.get(id) ?? states[0].fields.get(id);
	const label = (id: string): string => {
		const e = el(id);
		if (e) return e.def.kind === 'api' ? `${e.def.method} ${e.def.path}` : e.name;
		const f = field(id);
		if (f) return `${el(f.modelId)?.name ?? f.modelId}.${f.def.name}`;
		const af = states[1].apiFields.get(id) ?? states[0].apiFields.get(id);
		return af ? `${label(af.apiId)} · ${af.def.name}` : id;
	};
	const elementOf = (id: string) =>
		field(id)?.modelId ??
		states[1].apiFields.get(id)?.apiId ??
		states[0].apiFields.get(id)?.apiId ??
		id;
	const runsIn = (s: number, id: string) => flows[s].runs.has(id);
	const ids = new Set([...states[0].elements.keys(), ...states[1].elements.keys()]);

	// What runs in one state only, or whose steps differ.
	const stepped = new Set<string>();
	/** What a unit's steps do in a state where it runs; nothing where it doesn't. */
	const doing = (s: number, id: string): Record<Link, string[]> => {
		const l = runsIn(s, id) ? states[s].elements.get(id)?.logic : undefined;
		return {
			calls: l?.calls ?? [],
			reads: l?.reads ?? [],
			writes: l?.writes ?? [],
			sends: l?.sends ?? []
		};
	};
	for (const id of ids) {
		const kind = el(id)!.def.kind;
		if (!RUNNING.includes(kind)) continue;
		const r = [runsIn(0, id), runsIn(1, id)];
		if (r[0] !== r[1]) {
			const s = r[1] ? 1 : 0;
			add({
				id,
				element: id,
				level: 'changed',
				reason: states[1 - s].elements.has(id) ? `runs only ${at[s]}` : `there only ${at[s]}`
			});
		}
		if (kind !== 'logic-unit') continue;
		const lo = states[0].elements.get(id)?.logic;
		const hi = states[1].elements.get(id)?.logic;
		const differs =
			lo && hi && LINKS.some((k) => [...lo[k]].sort().join() !== [...hi[k]].sort().join());
		if (differs) {
			stepped.add(id);
			const what: string[] = [];
			for (const s of [0, 1])
				for (const k of LINKS) {
					const other = new Set((s ? lo : hi)![k]);
					const only = (s ? hi : lo)![k].filter((t) => !other.has(t));
					if (only.length) what.push(`${VERB[k]} ${only.map(label).join(', ')} ${at[s]}`);
				}
			add({ id, element: id, level: 'changed', reason: what.join('; ') });
		}
	}

	// What the change itself touches: added, dropped or changed.
	const done = new Set(outcomes.map((o) => o.id));
	for (const { diff, at: where } of judged)
		for (const e of diff.entries) {
			if (done.has(e.id)) continue;
			done.add(e.id);
			const owner = e.kind === 'element' ? e.id : ownerOf(states[0], states[1], e.id);
			if (owner)
				add({ id: e.id, element: owner, level: 'changed', reason: `${e.change} ${where}` });
		}

	// Where its steps go in one state only: on, or settled there.
	for (const id of ids) {
		if (el(id)!.def.kind !== 'logic-unit') continue;
		const d = [doing(0, id), doing(1, id)];
		for (const s of [0, 1]) {
			const m = states[s];
			for (const k of LINKS) {
				const other = new Set(d[1 - s][k]);
				for (const t of d[s][k]) {
					if (other.has(t)) continue;
					const target = elementOf(t);
					if (!m.elements.has(target)) {
						if (el(target))
							add({
								id,
								element: id,
								level: 'breaking',
								reason: `${VERB[k]} ${label(t)}, which isn't there ${at[s]}`
							});
						continue;
					}
					if (k === 'calls' || k === 'sends') {
						if (runsIn(0, target) && runsIn(1, target))
							add({
								id: target,
								element: target,
								level: 'stopped',
								reason:
									k === 'calls'
										? `runs either way: only ${label(id)}'s call changes`
										: `carries messages either way: only ${label(id)} sending changes`
							});
						continue;
					}
					// Reads and writes: settled where every field is written either way.
					const fs = m.fields.has(t) ? [t] : (m.elements.get(t)?.def.fields ?? []).map((f) => f.id);
					const settled = fs.filter(
						(f) =>
							flows[0].written.has(f) === flows[1].written.has(f) && states[1 - s].fields.has(f)
					);
					if (settled.length && settled.length === fs.length)
						add({
							id: target,
							element: target,
							level: 'stopped',
							reason:
								k === 'writes'
									? `${settled.length === 1 ? label(settled[0]) : label(target)} written either way`
									: `read ${at[s]}, and written as before`
						});
				}
			}
		}
	}

	// Apis left with nothing handling them.
	for (const s of [0, 1])
		for (const [id, e] of states[s].elements) {
			if (e.def.kind !== 'api') continue;
			const known = both[1 - s].handlers.get(id);
			if (known?.size && !some(both[s].handlers.get(id), (u) => states[s].elements.has(u)))
				add({ id, element: id, level: 'breaking', reason: `nothing handles it ${at[s]}` });
		}

	// What is written in one state only, and who reads it there.
	const holders = states.map(holdersOf);
	for (const [id, f] of states[0].fields) {
		if (!states[1].fields.has(id)) continue;
		const w = [flows[0].written.has(id), flows[1].written.has(id)];
		if (w[0] === w[1]) continue;
		const lost = w[0] ? 1 : 0;
		const m = states[lost];
		const name = f.def.name;
		const optional = !!m.fields.get(id)!.def.nullable;
		const severe: FrontLevel = optional ? 'check' : 'breaking';
		const nothing = `nothing writes ${label(id)} ${at[lost]}`;
		add({ id, element: f.modelId, level: 'changed', reason: `written only ${at[1 - lost]}` });
		const modelId = f.modelId;
		const whole = new Set<string>([modelId]);
		for (const queue = [modelId]; queue.length;)
			for (const h of holders[lost].get(queue.shift()!) ?? [])
				if (!whole.has(h)) {
					whole.add(h);
					queue.push(h);
				}
		const from = outcomes.length;
		for (const [uid, u] of m.elements) {
			if (!runsIn(lost, uid)) continue;
			if (u.def.kind === 'logic-unit') {
				if (u.logic?.reads.includes(id)) {
					add({ id: uid, element: uid, level: severe, reason: `reads ${name}, but ${nothing}` });
					continue;
				}
				const takes =
					u.logic?.reads.some((t) => whole.has(t)) ||
					[...(u.def.inputs ?? []), ...(u.def.outputs ?? [])].some(
						(x) => x.model && whole.has(x.model)
					);
				if (!takes) continue;
				add(
					mentions(textOf(u.def.steps), name)
						? { id: uid, element: uid, level: 'check', reason: `mentions ${name}, but ${nothing}` }
						: {
								id: uid,
								element: uid,
								level: 'stopped',
								reason: `takes ${label(modelId)} whole and names no ${name}`
							}
				);
				continue;
			}
			if (u.def.kind !== 'api') continue;
			for (const { part, body } of apiBodies(u.def)) {
				const out = part !== 'request';
				const carries =
					out &&
					body.model &&
					whole.has(body.model) &&
					(body.model !== modelId ||
						(!body.omit?.includes(id) && (!body.pick || body.pick.includes(id))));
				if (carries) {
					add({ id: uid, element: uid, level: severe, reason: `returns ${name}, but ${nothing}` });
				}
				for (const af of body.fields ?? []) {
					if (out && af.from?.includes(id)) {
						add({
							id: af.id ?? uid,
							element: uid,
							level: severe,
							reason: `returns ${name}, but ${nothing}`
						});
					}
					if (!out && af.to?.includes(id) && systemOf(m, uid) !== systemOf(m, modelId)) {
						add({
							id: af.id ?? uid,
							element: uid,
							level: 'check',
							reason: `maps ${af.name} into ${label(id)}, but nothing in ${label(systemOf(m, modelId) ?? '')} writes it ${at[lost]}`
						});
					}
				}
			}
		}
		// The field carries the worst of what its readers make of it.
		const worst = outcomes
			.slice(from)
			.map((o) => o.level)
			.reduce<FrontLevel | undefined>(
				(w, l) => ((l === 'breaking' || l === 'check') && (!w || RANK[l] > RANK[w]) ? l : w),
				undefined
			);
		if (worst) add({ id, element: modelId, level: worst, reason: nothing });
		// Copies still written from another source settle.
		for (const [gid, g] of m.fields)
			if (g.def.from?.includes(id) && flows[lost].written.has(gid))
				add({
					id: gid,
					element: g.modelId,
					level: 'stopped',
					reason: `still written from another source ${at[lost]}`
				});
	}

	// Contracts, judged by the impact engine: each stops.
	for (const { report, at: where } of judged)
		for (const i of report.impacts) {
			const level: FrontLevel = i.level === 'breaking' || i.level === 'check' ? i.level : 'stopped';
			const element = i.table ? i.id : elementOf(i.id) === i.id ? i.element : elementOf(i.id);
			add({ id: i.id, element, level, reason: `${i.reason} ${where}` });
		}

	// The way in of each changed unit: what starts it, through the units calling it.
	const changed = new Set(outcomes.filter((o) => o.level === 'changed').map((o) => o.element));
	const way = new Set<string>();
	const climb = (id: string, seen: Set<string>) => {
		if (seen.has(id)) return;
		seen.add(id);
		const hs = new Set(states.flatMap((m) => m.elements.get(id)?.logic?.handles ?? []));
		for (const h of hs) way.add(h);
		if (hs.size) return;
		for (const l of both)
			for (const c of l.callers.get(id) ?? []) {
				way.add(c);
				climb(c, seen);
			}
	};
	for (const id of changed) if (el(id)?.def.kind === 'logic-unit') climb(id, new Set());
	for (const id of way)
		if (!changed.has(id)) add({ id, element: id, level: 'way-in', reason: 'starts what changes' });

	const level = new Map<string, FrontLevel>();
	for (const o of outcomes) {
		const prev = level.get(o.id);
		if (!prev || RANK[o.level] > RANK[prev]) level.set(o.id, o.level);
	}
	const keep = new Set(
		outcomes.map((o) => o.element).filter((id) => DRAWN.has(el(id)?.def.kind ?? ''))
	);
	return { outcomes: dedupe(outcomes), level, keep, stepped };
}

const dedupe = (os: Outcome[]) => {
	const seen = new Set<string>();
	return os.filter((o) => {
		const k = `${o.id}|${o.level}|${o.reason}`;
		return !seen.has(k) && !!seen.add(k);
	});
};

/**
 * Where the front ends, worst first: what breaks, then what to check, then where it stops. Each
 * item once, under its worst level, with every reason it has there.
 */
export function endsOf(front: Front): Outcome[] {
	const order: FrontLevel[] = ['breaking', 'check', 'stopped'];
	const byId = new Map<string, Outcome>();
	for (const o of front.outcomes) {
		if (!order.includes(o.level) || front.level.get(o.id) !== o.level) continue;
		const prev = byId.get(o.id);
		byId.set(o.id, prev ? { ...prev, reason: `${prev.reason}; ${o.reason}` } : o);
	}
	return [...byId.values()].sort((x, y) => order.indexOf(x.level) - order.indexOf(y.level));
}

/** The front of flipping a flag key: every definition off, then on, other flags as `flags`. */
export function flagFront(
	data: Record<string, unknown>,
	all: Model,
	key: string,
	flags: FlagState
): Front {
	const defs = flagKeys(all).get(key) ?? [];
	const name = all.elements.get(defs[0] ?? '')?.name ?? key;
	const at = (on: boolean) => `with ${name} ${on ? 'on' : 'off'}`;
	const set = (on: boolean) =>
		stateOf(data, new Map([...flags, ...defs.map((d) => [d, on] as const)])).model;
	const [off, on] = [set(false), set(true)];
	const judge = (b: Model, a: Model, where: string): Judged => {
		const diff = diffModels(b, a);
		return { diff, report: impactOf(b, a, diff), at: where };
	};
	return frontOf(
		[off, on],
		[at(false), at(true)],
		[judge(off, on, at(true)), judge(on, off, at(false))]
	);
}

/** The front of a scenario's changes (or one of them), from its comparison. */
export const scenarioFront = (c: {
	before: Model;
	after: Model;
	diff: Diff;
	report: ImpactReport;
}): Front =>
	frontOf(
		[c.before, c.after],
		['before the scenario', 'with the scenario'],
		[{ diff: c.diff, report: c.report, at: 'with the scenario' }]
	);

/** What a comparison changes directly, and what its impacts reach: a scenario focus's Direct. */
export function changedOf(c: { before: Model; after: Model; diff: Diff; report: ImpactReport }) {
	const out = new Set<string>();
	for (const e of c.diff.entries)
		out.add(e.kind === 'element' ? e.id : (ownerOf(c.before, c.after, e.id) ?? e.id));
	for (const i of c.report.impacts) out.add(i.table ? i.id : i.element);
	return out;
}
