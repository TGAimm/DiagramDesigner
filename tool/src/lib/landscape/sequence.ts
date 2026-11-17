import { flagOn, type Model } from '../model/model';
import type { LogicStep } from '../model/schema';
import { scheduleWords } from '../model/schedule';

/** A line of text under a lifeline's name; clicking one with a target goes there. */
export interface LifelineSub {
	text: string;
	/** An api's HTTP method, which colours it. */
	method?: string;
	/** A trigger, marked with its glyph. */
	trigger?: boolean;
	/** Id of the api or element it stands for. */
	target?: string;
}

/**
 * A column of a unit's sequence: who calls it, the unit, then each unit, api owner or model
 * its steps touch, in first-use order.
 */
export interface Lifeline {
	key: string;
	kind: 'caller' | 'self' | 'unit' | 'owner' | 'model';
	name: string;
	target?: string;
	subs: LifelineSub[];
}

export interface SeqMessage {
	row: number;
	/** Lifeline indexes. */
	from: number;
	to: number;
	tone: 'input' | 'call' | 'return' | 'read' | 'write' | 'fail';
	dashed: boolean;
	text: string;
	method?: string;
	/** The api, unit or model it names. */
	target?: string;
	/** In a flag branch the shown state doesn't take. */
	dim?: boolean;
}

/** An alt, loop or flag box, from its header row to its last row. */
export interface SeqFrag {
	label: 'alt' | 'loop' | 'flag';
	guard: string;
	top: number;
	bottom: number;
	depth: number;
	dividers: { row: number; guard: string; dim?: boolean }[];
	/** Its first branch is one the shown flag state doesn't take. */
	dim?: boolean;
}

export interface Sequence {
	lifelines: Lifeline[];
	messages: SeqMessage[];
	/** Work the unit does itself, written beside its lifeline. */
	notes: { row: number; text: string; dim?: boolean }[];
	frags: SeqFrag[];
	rows: number;
}

/**
 * What a unit is started with: its inputs' names, else what the triggers starting it pass
 * (their `with`), else `()`.
 */
export function inputText(model: Model, unitId: string): string {
	const info = model.elements.get(unitId)!;
	const passed = (info.logic?.handles ?? []).flatMap(
		(id) => model.elements.get(id)?.def.with ?? []
	);
	return (info.def.inputs ?? []).map((f) => f.name).join(', ') || passed.join(' | ') || '()';
}

/** A unit's sequence diagram, read from its steps. Steps naming unknown ids are left out. */
export function sequenceOf(model: Model, unitId: string): Sequence {
	const info = model.elements.get(unitId)!;
	const def = info.def;
	const el = (id: string) => model.elements.get(id);
	const path = (id: string | undefined) => {
		const names: string[] = [];
		for (let e = id ? el(id) : undefined; e; e = e.parentId ? el(e.parentId) : undefined)
			names.unshift(e.name);
		return names.join(' › ');
	};
	const route = (id: string) => `${el(id)!.def.method} ${el(id)!.def.path}`;
	const callers = [...model.elements.values()].filter((e) => e.logic?.calls.includes(unitId));
	const lifelines: Lifeline[] = [
		{
			key: 'caller',
			kind: 'caller',
			name: 'Caller',
			subs: [
				...(info.logic?.handles ?? []).map((id) =>
					el(id)!.def.kind === 'trigger'
						? {
								text: `${el(id)!.name} · ${scheduleWords(el(id)!.def.schedule)}`,
								trigger: true,
								target: id
							}
						: { text: route(id), method: el(id)!.def.method, target: id }
				),
				...callers.map((c) => ({ text: `ƒ ${c.name}`, target: c.id }))
			]
		},
		{ key: 'self', kind: 'self', name: info.name, subs: [{ text: 'this unit' }] }
	];
	const lane = (key: string, make: () => Omit<Lifeline, 'key'>) => {
		const i = lifelines.findIndex((l) => l.key === key);
		if (i >= 0) return i;
		lifelines.push({ key, ...make() });
		return lifelines.length - 1;
	};
	const known = (id: string | undefined) => !!id && (model.ids.has(id) || model.elements.has(id));

	const messages: SeqMessage[] = [];
	const notes: Sequence['notes'] = [];
	const frags: SeqFrag[] = [];
	let row = 0;
	// Inside a flag branch the shown state doesn't take.
	let dim = false;
	const msg = (
		m: Omit<SeqMessage, 'row' | 'from' | 'dashed'> & { from?: number; dashed?: boolean }
	) => messages.push({ from: 1, dashed: false, ...m, row: row++, ...(dim ? { dim } : {}) });
	/** What a call or read gets back, dashed from the lane it went to. */
	const ret = (from: number, text: string | undefined) => {
		if (text) msg({ from, to: 1, tone: 'return', dashed: true, text });
	};
	const withNote = (text: string, s: LogicStep) => (s.note ? `${text} · ${s.note}` : text);

	msg({
		from: 0,
		to: 1,
		tone: 'input',
		text: inputText(model, unitId)
	});
	const walk = (steps: LogicStep[] | undefined, depth: number) => {
		for (const s of steps ?? []) {
			if (s.call !== undefined) {
				const t = el(s.call);
				if (!t) continue;
				if (t.def.kind === 'api') {
					const owner = t.parentId ?? t.id;
					const to = lane(owner, () => ({
						kind: 'owner',
						name: el(owner)!.name,
						subs: [{ text: path(el(owner)!.parentId) || 'api' }]
					}));
					const args = s.with ? ` (${s.with})` : '';
					msg({
						to,
						tone: 'call',
						text: withNote(route(t.id) + args, s),
						method: t.def.method,
						target: t.id
					});
					ret(to, s.gets);
				} else {
					const to = lane(t.id, () => ({
						kind: 'unit',
						name: el(t.parentId ?? '')?.name ?? '',
						subs: [{ text: t.name, target: t.id }]
					}));
					msg({ to, tone: 'call', text: withNote(`${t.name}(${s.with ?? ''})`, s), target: t.id });
					ret(to, s.gets);
				}
			} else if (s.read !== undefined || s.write !== undefined) {
				const id = (s.read ?? s.write)!;
				if (!known(id)) continue;
				const field = model.fields.get(id);
				const m = el(field?.modelId ?? id);
				if (!m) continue;
				const to = lane(m.id, () => ({
					kind: 'model',
					name: m.name,
					target: m.id,
					subs: [{ text: m.storedIn ? `in ${path(m.storedIn)}` : path(m.parentId) }]
				}));
				const verb = s.read !== undefined ? 'reads' : 'writes';
				const what = `${verb}${field ? ` ${field.def.name}` : ''}${s.with ? ` (${s.with})` : ''}`;
				msg({
					to,
					tone: s.read !== undefined ? 'read' : 'write',
					text: withNote(what, s),
					target: id
				});
				ret(to, s.gets);
			} else if (s.if !== undefined || s.each !== undefined) {
				const f: SeqFrag = {
					label: s.if !== undefined ? 'alt' : 'loop',
					guard: s.if !== undefined ? `[${s.if}]` : `[each ${s.each}]`,
					top: row++,
					bottom: 0,
					depth,
					dividers: []
				};
				frags.push(f);
				walk(s.if !== undefined ? s.then : s.do, depth + 1);
				if (s.else) {
					f.dividers.push({ row: row++, guard: '[else]' });
					walk(s.else, depth + 1);
				}
				f.bottom = row - 1;
			} else if (s.flag !== undefined) {
				// Both branches are drawn, so setting the flag never moves a lifeline; the one the
				// state doesn't take is dimmed.
				const name = el(s.flag)?.name ?? s.flag;
				const on = flagOn(model, s.flag);
				const branches = (['on', 'off'] as const).filter((v) => s[v]);
				const f: SeqFrag = { label: 'flag', guard: '', top: row++, bottom: 0, depth, dividers: [] };
				frags.push(f);
				const outer = dim;
				branches.forEach((v, i) => {
					const off = outer || (v === 'on') !== on;
					if (i === 0) {
						f.guard = `[${name} ${v}]`;
						if (off) f.dim = true;
					} else f.dividers.push({ row: row++, guard: `[${v}]`, ...(off ? { dim: true } : {}) });
					dim = off;
					walk(s[v], depth + 1);
				});
				dim = outer;
				f.bottom = row - 1;
			} else if (s.return !== undefined) {
				msg({ to: 0, tone: 'return', dashed: true, text: withNote(s.return, s) });
			} else if (s.fail !== undefined) {
				msg({ to: 0, tone: 'fail', dashed: true, text: withNote(`fails ${s.fail}`, s) });
			} else if (s.note !== undefined)
				notes.push({ row: row++, text: s.note, ...(dim ? { dim } : {}) });
		}
	};
	walk(def.steps, 0);
	return { lifelines, messages, notes, frags, rows: row };
}

/** Sequence diagram sizes in px, shared with SequenceDiagram. */
export const SEQ = {
	/** Between two lifelines. */
	col: 150,
	/** From the edge to the first lifeline's centre. */
	edge: 70,
	headW: 124,
	row: 30,
	/** Height of one line under a lifeline's name. */
	sub: 15
};

/** How wide a sequence is drawn. */
export const sequenceWidth = (seq: Sequence) => 2 * SEQ.edge + (seq.lifelines.length - 1) * SEQ.col;
