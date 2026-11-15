import type { DataPath, Diagnostic } from './diagnostics';
import { buildModel, flagOn, flagStateOf, type Locator, type Model } from './model';
import type { LogicStep } from './schema';

/**
 * Feature flags. A flag state is a design: each flag on or off, every gated api or unit whose
 * `when` doesn't hold left out, and every flag step replaced by the branch it takes. Such a
 * state is built and compared like any other, so a flip, or a split (one key's definitions
 * disagreeing), shows what it breaks.
 */

export type FlagState = Map<string, boolean>;

type Data = Record<string, unknown>;
type Gate = { flag: string; is: 'on' | 'off' };

/** The design's data in one flag state, and which files that changed. */
export function pruneFlags(data: Data, state: FlagState): { data: Data; touched: Set<string> } {
	const out: Data = {};
	const touched = new Set<string>();
	const inline = (steps: LogicStep[] | undefined): LogicStep[] | undefined => {
		if (!Array.isArray(steps)) return steps;
		let changed = false;
		const next = steps.flatMap((s) => {
			if (s?.flag !== undefined && state.has(s.flag)) {
				changed = true;
				return inline(state.get(s.flag) ? s.on : s.off) ?? [];
			}
			const sub: Partial<LogicStep> = {};
			for (const k of ['then', 'else', 'do'] as const) {
				const inner = inline(s?.[k]);
				if (inner !== s?.[k]) sub[k] = inner;
			}
			if (!Object.keys(sub).length) return [s];
			changed = true;
			return [{ ...s, ...sub }];
		});
		return changed ? next : steps;
	};
	for (const [file, d] of Object.entries(data)) {
		const e = d as { when?: Gate; steps?: LogicStep[] } | undefined;
		const gate = e?.when;
		if (gate && state.has(gate.flag) && state.get(gate.flag) !== (gate.is === 'on')) {
			touched.add(file);
			continue;
		}
		const steps = inline(e?.steps);
		if (steps !== e?.steps) {
			touched.add(file);
			out[file] = { ...e, steps };
		} else out[file] = d;
	}
	return { data: out, touched };
}

/** One flag state of the design, built: gated items gone, flag steps replaced. */
export function stateOf(data: Data, state: FlagState, locate?: Locator) {
	const pruned = pruneFlags(data, state);
	const at: Locator = (file, path, key) =>
		pruned.touched.has(file) ? undefined : locate?.(file, path, key);
	return {
		data: pruned.data,
		model: buildModel(pruned.data, at, Object.fromEntries(state))
	};
}

/** Apis and units a model holds but its flag state leaves out: drawn hidden, room kept. */
export function gatedOff(model: Model): Set<string> {
	const out = new Set<string>();
	for (const [id, el] of model.elements) {
		const gate = el.def.when;
		if (gate && model.elements.get(gate.flag)?.def.kind === 'flag')
			if (flagOn(model, gate.flag) !== (gate.is === 'on')) out.add(id);
	}
	return out;
}

/** Something a flag state breaks, shown on `at` (a unit or api). */
export interface FlagFinding {
	level: 'breaking' | 'check';
	at: string;
	message: string;
}

/** Call targets in steps, as written; links leave out the ones that name nothing. */
export function callsIn(steps: LogicStep[] | undefined, out = new Set<string>()) {
	for (const s of steps ?? []) {
		if (s.call) out.add(s.call);
		for (const k of ['then', 'else', 'do', 'on', 'off'] as const) callsIn(s[k], out);
	}
	return out;
}

/**
 * What a flag state breaks. `all` is the whole design (every branch, everything gated),
 * `defaults` and `state` are built flag states: the first says what production does, the
 * second is checked.
 */
export function flagFindings(all: Model, defaults: Model, state: Model): FlagFinding[] {
	const out: FlagFinding[] = [];
	const el = (id: string) => all.elements.get(id);
	const systemOf = (id: string) => {
		let e = el(id);
		while (e?.parentId && el(e.parentId)) e = el(e.parentId);
		return e?.name ?? id;
	};
	const label = (id: string) => {
		const e = el(id)!;
		return e.def.kind === 'api' ? `${e.def.method} ${e.def.path}` : e.name;
	};
	/** Why an item is gone: "(which) ERP has only when its newOrderFlow is on". */
	const only = (id: string) => {
		const gate = el(id)?.def.when;
		const flag = gate && el(gate.flag);
		return flag
			? `${systemOf(id)} has only when its ${flag.name} is ${gate.is}`
			: `${systemOf(id)} doesn't have`;
	};
	for (const [id, unit] of state.elements) {
		if (unit.def.kind !== 'logic-unit') continue;
		for (const t of callsIn(unit.def.steps))
			if (el(t) && !state.elements.has(t))
				out.push({
					level: 'breaking',
					at: id,
					message: `${unit.name} calls ${label(t)}, which ${only(t)}`
				});
	}
	const handlers = (m: Model, api: string) =>
		[...m.elements.values()].filter((u) => u.def.handles?.includes(api));
	for (const [id, api] of state.elements) {
		if (api.def.kind !== 'api') continue;
		const known = handlers(all, id);
		if (known.length && !handlers(state, id).length)
			out.push({
				level: 'breaking',
				at: id,
				message: `${label(id)} has no unit handling it: ${known.map((u) => `${u.name}, which ${only(u.id)}`).join('; ')}`
			});
	}
	const modelOf = (m: Model, id: string) => m.fields.get(id)?.modelId ?? id;
	const touching = (m: Model, verb: 'reads' | 'writes') => {
		const by = new Map<string, string[]>();
		for (const [id, u] of m.elements)
			for (const t of u.logic?.[verb] ?? []) {
				const model = modelOf(m, t);
				by.set(model, [...(by.get(model) ?? []), id]);
			}
		return by;
	};
	const writes = touching(state, 'writes');
	const writtenAtDefaults = touching(defaults, 'writes');
	for (const [model, readers] of touching(state, 'reads')) {
		if (writes.has(model) || !writtenAtDefaults.has(model)) continue;
		const name = el(model)?.name ?? model;
		for (const r of new Set(readers))
			out.push({
				level: 'check',
				at: r,
				message: `${state.elements.get(r)!.name} reads ${name}, which nothing writes in this state`
			});
	}
	return out;
}

/** Definitions of each flag key, by key. */
export function flagKeys(model: Model): Map<string, string[]> {
	const out = new Map<string, string[]>();
	for (const [id, el] of model.elements)
		if (el.def.kind === 'flag' && el.def.key)
			out.set(el.def.key, [...(out.get(el.def.key) ?? []), id]);
	return out;
}

/** Where a flag is defined: its system or module, with the path down to it. */
export function flagHome(model: Model, id: string) {
	const names: string[] = [];
	for (let e = model.elements.get(model.elements.get(id)?.parentId ?? ''); e;) {
		names.unshift(e.name);
		e = e.parentId ? model.elements.get(e.parentId) : undefined;
	}
	return names.join(' › ');
}

/** At most this many definitions of one key are combined; more are checked one at a time. */
const MAX_COMBINED = 5;

/**
 * A warning for each way of setting one key's definitions, other than their defaults, that
 * breaks something: a split, or a flip a caller elsewhere doesn't follow. Other flags stay
 * at their defaults.
 */
export function flagSplits(all: Model, data: Data): Diagnostic[] {
	const keys = flagKeys(all);
	if (!keys.size) return [];
	const defaults = flagStateOf(all, {});
	const base = stateOf(data, defaults).model;
	const out = new Map<string, Diagnostic>();
	for (const [key, defs] of keys) {
		const combos: Map<string, boolean>[] = [];
		if (defs.length <= MAX_COMBINED)
			for (let mask = 1; mask < 1 << defs.length; mask++)
				combos.push(
					new Map(defs.map((d, i) => [d, mask & (1 << i) ? !defaults.get(d) : !!defaults.get(d)]))
				);
		else for (const d of defs) combos.push(new Map([[d, !defaults.get(d)]]));
		for (const combo of combos) {
			const state = new Map([...defaults, ...combo]);
			const how = defs
				.map((d) => `${state.get(d) ? 'on' : 'off'} in ${flagHome(all, d)}`)
				.join(', ');
			for (const f of flagFindings(all, base, stateOf(data, state).model)) {
				const message = `breaks with ${key} ${how}: ${f.message}`;
				const loc = all.elements.get(f.at)?.loc;
				out.set(message, {
					severity: 'warning',
					code: 'flag-split',
					message,
					file: loc?.file,
					path: loc?.path as DataPath | undefined
				});
			}
		}
	}
	return [...out.values()];
}
