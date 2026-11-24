import type { ElementInfo, Model } from './model';

/**
 * Whether a logic unit or api runs.
 * - `live`: something starts it: a trigger, an outside caller (an `external` api or module),
 *   or live code calling or rendering it.
 * - `dead`: it says so (`dead: <why>`), or only dead code calls it (`callers`).
 * - `unreached`: nothing in the design starts or calls it, and it does not say it is dead.
 */
export interface Reach {
	state: 'live' | 'dead' | 'unreached';
	/** `dead` written on it. */
	why?: string;
	/** For dead code not marked dead: the units and apis calling it, none of them live. */
	callers: string[];
}

const runs = (e: ElementInfo) => e.def.kind === 'logic-unit' || e.def.kind === 'api';

/** Whether an api is called from outside the design: it, or a module round it, is external. */
function outsideCalls(model: Model, api: ElementInfo) {
	for (let cur: ElementInfo | undefined = api; cur; cur = model.elements.get(cur.parentId ?? ''))
		if (cur.def.external) return true;
	return false;
}

/** Each logic unit's and api's reach, by id, following the links of the model's flag state. */
export function reachOf(model: Model): Map<string, Reach> {
	// What each unit or api starts: an api or trigger its handlers, a unit what it calls.
	const next = new Map<string, string[]>();
	const callers = new Map<string, string[]>();
	const link = (from: string, to: string) => {
		next.set(from, [...(next.get(from) ?? []), to]);
		callers.set(to, [...(callers.get(to) ?? []), from]);
	};
	for (const e of model.elements.values()) {
		if (!e.logic) continue;
		for (const h of e.logic.handles) link(h, e.id);
		for (const c of e.logic.calls) link(e.id, c);
	}
	const live = new Set<string>();
	const queue: string[] = [];
	const start = (id: string) => {
		const e = model.elements.get(id);
		if (!e || live.has(id) || e.def.dead !== undefined) return;
		live.add(id);
		queue.push(id);
	};
	for (const e of model.elements.values())
		if (e.def.kind === 'trigger' || (e.def.kind === 'api' && outsideCalls(model, e))) start(e.id);
	while (queue.length) for (const to of next.get(queue.pop()!) ?? []) start(to);

	const out = new Map<string, Reach>();
	for (const e of model.elements.values()) {
		if (!runs(e)) continue;
		const by = [...new Set(callers.get(e.id) ?? [])].filter((c) => model.elements.has(c));
		if (live.has(e.id)) out.set(e.id, { state: 'live', callers: [] });
		else if (e.def.dead !== undefined)
			out.set(e.id, { state: 'dead', why: e.def.dead, callers: by });
		else out.set(e.id, { state: by.length ? 'dead' : 'unreached', callers: by });
	}
	return out;
}

/** Live code calling or starting a unit or api marked dead. */
export function liveCallersOf(model: Model, reach: Map<string, Reach>, id: string): string[] {
	const out: string[] = [];
	for (const e of model.elements.values()) {
		if (!e.logic) continue;
		const isLive = reach.get(e.id)?.state === 'live';
		if (isLive && e.logic.calls.includes(id)) out.push(e.id);
	}
	const el = model.elements.get(id);
	for (const h of el?.logic?.handles ?? []) {
		const t = model.elements.get(h);
		if (t?.def.kind === 'trigger' || reach.get(h)?.state === 'live') out.push(h);
	}
	return out;
}
