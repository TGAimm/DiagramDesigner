import { callsIn } from '../model/flags';
import { apiBodies, type ApiPart, type Model } from '../model/model';
import type { DataPath } from '../model/diagnostics';
import type { LogicStep } from '../model/schema';
import { holdersOf } from '../landscape/layout';
import type { Diff, DiffEntry } from './diff';

/**
 * What a change breaks. Each consumer of a changed item is judged by how it finds the item
 * (by id, by wire or column name, or in free text) and which way data flows through it (into
 * the design, out of it, or both), so a rename that only id-bound consumers see breaks
 * nothing, while the same rename on a body that is the model itself changes the wire.
 */

export type Severity = 'breaking' | 'check' | 'info';
export type Level = Severity | 'stopped';

const RANK: Record<Level, number> = { breaking: 3, check: 2, info: 1, stopped: 0 };
export const worse = (a: Level | undefined, b: Level): Level =>
	a === undefined || RANK[b] > RANK[a] ? b : a;

export interface Impact {
	/** The affected item: a model field, api field, api, logic unit, or a model (its table). */
	id: string;
	/** The element it is drawn in: for roll-ups on closed boxes. */
	element: string;
	/** A model's stored table rather than its class. */
	table?: boolean;
	/** For an api: which body. */
	part?: ApiPart;
	level: Level;
	reason: string;
	/** Id of the changed item it follows from. */
	cause: string;
	/** 1: uses the changed item; 2: calls an api or unit that does. */
	depth: 1 | 2;
	/** Stored data: needs a backfill, or is lost. */
	data?: 'backfill' | 'loss';
	/** Behind an `external` boundary: plus consumers the design does not show. */
	external?: boolean;
}

/** Free text naming a renamed or dropped item by its old name. */
export interface Mention {
	cause: string;
	/** Entity whose file holds the text. */
	entity: string;
	/** Data path of the text in that file. */
	path: DataPath;
	text: string;
	old: string;
	/** For a rename: the text with the new name. */
	to?: string;
}

export interface ImpactReport {
	impacts: Impact[];
	mentions: Mention[];
	/** Worst level by item id: changed items take the worst of their impacts. */
	levelOf: Map<string, Level>;
}

type Exposure = { api: string; part: ApiPart; how: string; stoppedBy?: 'omit' | 'pick' };

/** Lookups over one state of the design. */
function context(model: Model) {
	const holders = holdersOf(model);
	const unitsTouching = new Map<string, { unit: string; verb: 'reads' | 'writes' }[]>();
	const callers = new Map<string, string[]>();
	const refsTo = new Map<string, string[]>();
	const derivedFrom = new Map<string, string[]>();
	const ioOf = new Map<string, string[]>();
	const push = <T>(m: Map<string, T[]>, k: string, v: T) => m.set(k, [...(m.get(k) ?? []), v]);
	for (const [id, el] of model.elements) {
		for (const verb of ['reads', 'writes'] as const)
			for (const t of el.logic?.[verb] ?? []) push(unitsTouching, t, { unit: id, verb });
		for (const t of el.logic?.calls ?? []) push(callers, t, id);
		for (const io of [...(el.def.inputs ?? []), ...(el.def.outputs ?? [])])
			if (io.model) push(ioOf, io.model, id);
	}
	// The units sending or receiving the messages of a channel carrying a model.
	const messagesOf = new Map<string, string[]>();
	for (const [id, el] of model.elements) {
		if (el.def.kind !== 'channel' || !el.def.carries) continue;
		const units = new Set<string>();
		for (const [u, x] of model.elements) if (x.logic?.sends.includes(id)) units.add(u);
		for (const p of model.ports.values())
			if (p.channel === id)
				for (const t of p.triggers)
					for (const [u, x] of model.elements) if (x.logic?.handles.includes(t)) units.add(u);
		for (const u of units) push(messagesOf, el.def.carries, u);
	}
	for (const [id, f] of model.fields) {
		if (f.def.ref) push(refsTo, f.def.ref, id);
		for (const src of f.def.from ?? []) push(derivedFrom, src, id);
	}
	const apiFieldsOn = new Map<string, string[]>();
	for (const [id, f] of model.apiFields)
		for (const t of [...(f.def.to ?? []), ...(f.def.from ?? [])]) push(apiFieldsOn, t, id);

	/** Bodies carrying a model's fields: the model itself, or a model holding it. */
	const exposures = (modelId: string, fieldId?: string): Exposure[] => {
		const via = new Map<string, string | undefined>([[modelId, undefined]]);
		const queue = [modelId];
		while (queue.length) {
			const m = queue.shift()!;
			for (const h of holders.get(m) ?? [])
				if (!via.has(h)) {
					via.set(h, m);
					queue.push(h);
				}
		}
		const name = (id: string) => model.elements.get(id)?.name ?? id;
		const holds = (id: string) =>
			`returns ${name(id)}, which holds ${name(modelId)}${id === modelId ? '' : '[]'}`;
		const out: Exposure[] = [];
		for (const [api, el] of model.elements) {
			if (el.def.kind !== 'api') continue;
			for (const { part, body } of apiBodies(el.def)) {
				if (body.model && via.has(body.model)) {
					const own = body.model === modelId;
					const stoppedBy =
						own && fieldId
							? body.pick && !body.pick.includes(fieldId)
								? 'pick'
								: body.omit?.includes(fieldId)
									? 'omit'
									: undefined
							: undefined;
					out.push({ api, part, how: own ? 'the model itself' : holds(body.model), stoppedBy });
				}
				for (const f of body.fields ?? [])
					if (f.model && via.has(f.model))
						out.push({ api, part, how: `its field ${f.name} holds ${name(modelId)}` });
			}
		}
		return out;
	};

	const external = (id: string | undefined): boolean => {
		for (let cur = id; cur; cur = model.elements.get(cur)?.parentId)
			if (model.elements.get(cur)?.def.external) return true;
		return false;
	};

	return {
		model,
		holders,
		unitsTouching,
		callers,
		refsTo,
		derivedFrom,
		ioOf,
		messagesOf,
		apiFieldsOn,
		exposures,
		external
	};
}
type Ctx = ReturnType<typeof context>;

const isStoredField = (f: { model?: string; stored?: boolean }) => !f.model && f.stored !== false;

const STEP_TEXT = ['with', 'gets', 'if', 'each', 'note'] as const;

export function impactOf(before: Model, after: Model, diff: Diff): ImpactReport {
	const b = context(before);
	const a = context(after);
	/** Units calling `id` before that still do after: one re-pointed elsewhere is not hit. */
	const stillCalling = (id: string) =>
		(b.callers.get(id) ?? []).filter((u) => callsIn(after.elements.get(u)?.def.steps).has(id));
	const impacts = new Map<string, Impact>();
	const mentions: Mention[] = [];

	const add = (ctx: Ctx, i: Omit<Impact, 'external' | 'depth'> & { depth?: 1 | 2 }) => {
		const impact: Impact = { depth: 1, ...i };
		if (ctx.external(i.element)) impact.external = true;
		const key = `${i.id}|${i.table ? 't' : ''}|${i.part ?? ''}|${i.cause}`;
		const prev = impacts.get(key);
		if (!prev || RANK[impact.level] > RANK[prev.level]) impacts.set(key, impact);
	};

	const removed = new Set(diff.entries.filter((e) => e.change !== 'changed').map((e) => e.id));
	const ownerGone = (e: DiffEntry) => {
		const owner = e.kind === 'element' ? undefined : ownerOf(before, after, e.id);
		return owner !== undefined && removed.has(owner);
	};

	for (const e of diff.entries) {
		if (ownerGone(e)) continue;
		if (e.kind === 'field') fieldRules(e);
		else if (e.kind === 'element') elementRules(e);
		else if (e.kind === 'api-field') apiFieldRules(e);
		else if (e.kind === 'logic-field') logicFieldRules(e);
		else partRules(e);
	}

	// ------------------------------------------------------------------ model fields
	function fieldRules(e: DiffEntry) {
		const fb = before.fields.get(e.id);
		const fa = after.fields.get(e.id);
		const key = (k: string) => e.keys.find((x) => x.key === k);
		const retype = ['type', 'model', 'many'].some((k) => key(k));
		const turned = (k: 'nullable' | 'required' | 'pk', to: boolean) =>
			!!key(k) && !!fa?.def[k] === to && !!fb?.def[k] !== to;
		const storedNow = (k: 'before' | 'after') => {
			const f = k === 'before' ? fb : fa;
			return !!f && isStoredField(f.def);
		};

		if (e.change === 'dropped' || (e.movedFrom && fb)) {
			const moving = e.change === 'changed';
			leaves(
				e,
				fb!.modelId,
				moving ? `moves to ${after.elements.get(fa!.modelId)?.name}` : undefined
			);
		}
		if (e.change === 'added' || (e.movedFrom && fa)) joins(e, fa!.modelId);
		if (e.change !== 'changed') return;

		const modelId = fa!.modelId;
		const name = e.renamedFrom;
		// The table.
		const store = after.elements.get(modelId)?.storedIn;
		if (store && storedNow('after')) {
			const table = (level: Level, reason: string, data?: 'backfill' | 'loss') =>
				add(a, { id: modelId, element: store, table: true, level, reason, cause: e.id, data });
			if (name) table('breaking', `stored column: needs a rename migration`);
			if (retype) table('check', `stored column changes type: check existing rows`, 'backfill');
			if (turned('required', true) || turned('nullable', false))
				table('check', `existing rows need a value`, 'backfill');
			if (turned('pk', true)) table('check', `existing rows must be unique`, 'backfill');
			if (key('stored') && !storedNow('before'))
				table(
					fa!.def.nullable ? 'info' : 'check',
					`a new column`,
					fa!.def.nullable ? undefined : 'backfill'
				);
		}
		if (store && key('stored') && storedNow('before') && !storedNow('after'))
			add(a, {
				id: modelId,
				element: store,
				table: true,
				level: 'breaking',
				reason: 'stored column dropped: its data is lost',
				cause: e.id,
				data: 'loss'
			});

		// Bodies carrying the model.
		for (const x of b.exposures(modelId, e.id)) {
			const body = (level: Level, reason: string) =>
				add(b, { id: x.api, element: x.api, part: x.part, level, reason, cause: e.id });
			if (x.stoppedBy) {
				if (name || retype) body('stopped', `left out with ${x.stoppedBy}`);
				continue;
			}
			const req = x.part === 'request';
			if (name) body('breaking', `${x.how}: the field's wire name changes`);
			if (retype) body('breaking', `${x.how}: the field's type changes`);
			if (turned('nullable', true)) body(req ? 'info' : 'breaking', `${x.how}: it may now be null`);
			if (turned('nullable', false))
				body(req ? 'breaking' : 'info', `${x.how}: it no longer takes null`);
			if (turned('required', true)) body(req ? 'breaking' : 'info', `${x.how}: it is now required`);
			if (turned('required', false))
				body(req ? 'info' : 'check', `${x.how}: it may now be left out`);
		}

		// Own-shape api fields mapping it.
		for (const id of b.apiFieldsOn.get(e.id) ?? []) {
			const af = before.apiFields.get(id)!;
			const own = (level: Level, reason: string) =>
				add(b, { id, element: af.apiId, part: af.part, level, reason, cause: e.id });
			const req = af.part === 'request';
			if (name) own('stopped', 'own shape, keeps its own name');
			if (retype) own('check', 'the type changes on the way');
			if (turned('nullable', true) && !req && !af.def.nullable)
				own('breaking', 'it may now be null');
			if ((turned('required', true) || turned('nullable', false)) && req)
				own('check', 'the value must now be given');
		}

		// Fields derived from it, and keys to it.
		for (const id of b.derivedFrom.get(e.id) ?? []) {
			const g = before.fields.get(id)!;
			const derived = (level: Level, reason: string) =>
				add(b, { id, element: g.modelId, level, reason, cause: e.id });
			if (name) derived('stopped', 'comes from it by id');
			if (retype)
				derived(
					'check',
					g.def.derived ? `derived (${g.def.derived}): can't verify` : 'copies it; its type changed'
				);
			if (turned('nullable', true) && !g.def.nullable)
				derived('check', 'its source may now be null');
		}
		for (const id of b.refsTo.get(e.id) ?? []) {
			const r = before.fields.get(id)!;
			const ref = (level: Level, reason: string) =>
				add(b, { id, element: r.modelId, level, reason, cause: e.id });
			if (name) ref('stopped', 'keys it by id');
			if (retype) ref('breaking', 'key types no longer match');
		}
		if (retype && fb!.def.pk)
			for (const id of b.refsTo.get(modelId) ?? [])
				add(b, {
					id,
					element: before.fields.get(id)!.modelId,
					level: 'breaking',
					reason: 'key types no longer match',
					cause: e.id
				});

		// Logic.
		for (const { unit, verb } of b.unitsTouching.get(e.id) ?? []) {
			if (name)
				add(b, {
					id: unit,
					element: unit,
					level: 'stopped',
					reason: `${verb} it by id`,
					cause: e.id
				});
			if (retype)
				add(b, {
					id: unit,
					element: unit,
					level: 'check',
					reason: `${verb} it; its type changed`,
					cause: e.id
				});
		}
		if (retype) touchModel(modelId, 'changes a field', 'check', e.id);
		if (name) mention(e, fb!.modelId, name, e.name);
	}

	/** A field leaves its model: dropped, or moved to another. */
	function leaves(e: DiffEntry, modelId: string, moving?: string) {
		const why = moving ?? 'is gone';
		const store = before.elements.get(modelId)?.storedIn;
		const fb = before.fields.get(e.id)!;
		if (store && isStoredField(fb.def))
			add(b, {
				id: modelId,
				element: store,
				table: true,
				level: 'breaking',
				reason: moving
					? `stored column ${moving}: its data must move`
					: 'stored column: its data is dropped',
				cause: e.id,
				data: 'loss'
			});
		for (const x of b.exposures(modelId, e.id)) {
			if (x.stoppedBy)
				add(b, {
					id: x.api,
					element: x.api,
					part: x.part,
					level: 'stopped',
					reason: `left out with ${x.stoppedBy}`,
					cause: e.id
				});
			else
				add(b, {
					id: x.api,
					element: x.api,
					part: x.part,
					level: 'breaking',
					reason: `${x.how}: the field ${why}`,
					cause: e.id
				});
		}
		if (moving) return;
		for (const id of b.apiFieldsOn.get(e.id) ?? []) {
			const af = before.apiFields.get(id)!;
			add(b, {
				id,
				element: af.apiId,
				part: af.part,
				level: 'breaking',
				reason: 'maps a field that is gone',
				cause: e.id
			});
		}
		for (const id of b.derivedFrom.get(e.id) ?? [])
			add(b, {
				id,
				element: before.fields.get(id)!.modelId,
				level: 'breaking',
				reason: 'loses a source',
				cause: e.id
			});
		for (const id of b.refsTo.get(e.id) ?? [])
			add(b, {
				id,
				element: before.fields.get(id)!.modelId,
				level: 'breaking',
				reason: 'keys a field that is gone',
				cause: e.id
			});
		for (const { unit, verb } of b.unitsTouching.get(e.id) ?? [])
			add(b, {
				id: unit,
				element: unit,
				level: 'breaking',
				reason: `${verb} a field that is gone`,
				cause: e.id
			});
		touchModel(modelId, 'loses a field', 'check', e.id);
		mention(e, modelId, fb.def.name);
	}

	/** A field joins a model: added, or moved here. */
	function joins(e: DiffEntry, modelId: string) {
		const fa = after.fields.get(e.id)!;
		const store = after.elements.get(modelId)?.storedIn;
		if (store && isStoredField(fa.def)) {
			const backfill = !fa.def.nullable;
			add(a, {
				id: modelId,
				element: store,
				table: true,
				level: backfill ? 'check' : 'info',
				reason: backfill
					? 'a new column that takes no null: existing rows need a value'
					: 'a new column',
				cause: e.id,
				...(backfill ? { data: 'backfill' as const } : {})
			});
		}
		for (const x of a.exposures(modelId, e.id)) {
			if (x.stoppedBy) {
				add(a, {
					id: x.api,
					element: x.api,
					part: x.part,
					level: 'stopped',
					reason: `left out with ${x.stoppedBy}`,
					cause: e.id
				});
				continue;
			}
			const required = x.part === 'request' && fa.def.required;
			add(a, {
				id: x.api,
				element: x.api,
				part: x.part,
				level: required ? 'breaking' : 'info',
				reason: required ? `${x.how}: a new required field` : `${x.how}: a new field in the body`,
				cause: e.id
			});
		}
	}

	/** Logic units handling a whole model whose field changed. */
	function touchModel(modelId: string, what: string, level: Level, cause: string) {
		const name = before.elements.get(modelId)?.name;
		for (const { unit, verb } of b.unitsTouching.get(modelId) ?? [])
			add(b, { id: unit, element: unit, level, reason: `${verb} ${name}, which ${what}`, cause });
		for (const unit of b.ioOf.get(modelId) ?? [])
			add(b, {
				id: unit,
				element: unit,
				level,
				reason: `takes or returns ${name}, which ${what}`,
				cause
			});
		for (const unit of b.messagesOf.get(modelId) ?? [])
			add(b, {
				id: unit,
				element: unit,
				level,
				reason: `sends or receives ${name} messages, which ${what}`,
				cause
			});
	}

	// ------------------------------------------------------------------ entities
	function elementRules(e: DiffEntry) {
		const xb = before.elements.get(e.id);
		const xa = after.elements.get(e.id);
		const kind = (xb ?? xa)!.def.kind;
		const key = (k: string) => e.keys.find((x) => x.key === k);
		const callers = (level: Level, reason: string) => {
			for (const unit of stillCalling(e.id))
				add(b, { id: unit, element: unit, level, reason, cause: e.id });
		};
		if (e.change === 'dropped') {
			if (kind === 'model') {
				const store = xb!.storedIn;
				if (store)
					add(b, {
						id: e.id,
						element: store,
						table: true,
						level: 'breaking',
						reason: 'stored table: its data is dropped',
						cause: e.id,
						data: 'loss'
					});
				for (const x of b.exposures(e.id))
					add(b, {
						id: x.api,
						element: x.api,
						part: x.part,
						level: 'breaking',
						reason: `${x.how}: the model is gone`,
						cause: e.id
					});
				for (const [id, f] of before.fields) {
					if (f.modelId === e.id) continue;
					const src = f.def.from?.some((s) => before.fields.get(s)?.modelId === e.id);
					const keyed = f.def.ref === e.id || before.fields.get(f.def.ref ?? '')?.modelId === e.id;
					const holds = f.def.model === e.id;
					if (src || keyed || holds)
						add(b, {
							id,
							element: f.modelId,
							level: 'breaking',
							reason: holds
								? 'holds a model that is gone'
								: keyed
									? 'keys a model that is gone'
									: 'loses a source',
							cause: e.id
						});
				}
				for (const [, x] of before.elements)
					for (const verb of ['reads', 'writes'] as const)
						if (x.logic?.[verb].some((t) => t === e.id || before.fields.get(t)?.modelId === e.id))
							add(b, {
								id: x.id,
								element: x.id,
								level: 'breaking',
								reason: `${verb} a model that is gone`,
								cause: e.id
							});
				for (const unit of b.ioOf.get(e.id) ?? [])
					add(b, {
						id: unit,
						element: unit,
						level: 'breaking',
						reason: 'takes or returns a model that is gone',
						cause: e.id
					});
			}
			if (kind === 'api') callers('breaking', 'calls an api that is gone');
			if (kind === 'logic-unit') callers('breaking', 'calls a unit that is gone');
			if (kind === 'trigger') callers('breaking', 'sends a message that is gone');
			// A channel or stored model gone: what sends on it and what listens to it break.
			for (const [, x] of before.elements) {
				if (kind === 'channel' && x.logic?.sends.includes(e.id))
					add(b, {
						id: x.id,
						element: x.id,
						level: 'breaking',
						reason: 'sends on a channel that is gone',
						cause: e.id
					});
				const on = x.def.kind === 'trigger' ? x.def.on : undefined;
				if (on && (on.channel ?? on.model) === e.id)
					add(b, {
						id: x.id,
						element: x.id,
						level: 'breaking',
						reason: `listens to a ${kind} that is gone`,
						cause: e.id
					});
			}
			return;
		}
		if (e.change !== 'changed') return;
		if (kind === 'model' && xa!.storedIn) {
			if (e.renamedFrom && xb!.storedIn === xa!.storedIn)
				add(a, {
					id: e.id,
					element: xa!.storedIn,
					table: true,
					level: 'breaking',
					reason: 'stored table: needs a rename migration',
					cause: e.id
				});
			if (key('storedIn'))
				add(a, {
					id: e.id,
					element: xa!.storedIn,
					table: true,
					level: 'breaking',
					reason: 'its data moves to another store',
					cause: e.id,
					data: 'loss'
				});
		}
		if (kind === 'api') {
			if (key('method') || key('path')) callers('breaking', 'the route changes');
			if (key('request') || key('responses')) callers('check', 'a body changes');
		}
	}

	// ------------------------------------------------------------------ api own-shape fields
	function apiFieldRules(e: DiffEntry) {
		const f = (e.change === 'added' ? after : before).apiFields.get(e.id)!;
		const fa = after.apiFields.get(e.id);
		const ctx = e.change === 'added' ? a : b;
		const req = f.part === 'request';
		const body = (level: Level, reason: string) =>
			add(ctx, { id: f.apiId, element: f.apiId, part: f.part, level, reason, cause: e.id });
		const key = (k: string) => e.keys.find((x) => x.key === k);
		const turned = (k: 'nullable' | 'required', to: boolean) =>
			!!key(k) && !!fa?.def[k] === to && !!f.def[k] !== to;
		if (e.change === 'dropped')
			body(
				req ? 'check' : 'breaking',
				req ? `field ${e.name} is gone: callers may still send it` : `field ${e.name} is gone`
			);
		if (e.change === 'added')
			body(
				req && f.def.required ? 'breaking' : 'info',
				req && f.def.required ? `a new required field ${e.name}` : `a new field ${e.name}`
			);
		if (e.change !== 'changed') return;
		if (e.renamedFrom) body('breaking', `field ${e.renamedFrom}: the wire name changes`);
		if (['type', 'model', 'many'].some((k) => key(k)))
			body('breaking', `field ${e.name}: the type changes`);
		if (turned('nullable', true))
			body(req ? 'info' : 'breaking', `field ${e.name} may now be null`);
		if (turned('required', true))
			body(req ? 'breaking' : 'info', `field ${e.name} is now required`);
		if (e.renamedFrom) mentionAt(e, f.apiId, e.renamedFrom, e.name);
	}

	// ------------------------------------------------------------------ logic inputs/outputs
	function logicFieldRules(e: DiffEntry) {
		const unit = ownerOf(before, after, e.id) ?? '';
		const io = ioEntry(e.change === 'added' ? after : before, e.id);
		if (!io) return;
		const input = io.io === 'inputs';
		const level: Level = e.change === 'added' && input && io.field.required ? 'breaking' : 'check';
		const reason =
			e.change === 'added'
				? input
					? `must now pass ${e.name}`
					: `gets ${e.name} back too`
				: e.change === 'dropped'
					? `${input ? 'passes' : 'uses'} ${e.name}, which is gone`
					: `${input ? 'passes' : 'uses'} ${e.renamedFrom ?? e.name}, which changed`;
		for (const caller of b.callers.get(unit) ?? [])
			add(b, { id: caller, element: caller, level, reason, cause: e.id });
		if (e.renamedFrom) mentionAt(e, unit, e.renamedFrom, e.name);
	}

	// ------------------------------------------------------------------ params and indexes
	function partRules(e: DiffEntry) {
		const m = e.change === 'added' ? after : before;
		const owner = ownerOf(before, after, e.id)!;
		const el = m.elements.get(owner)!;
		const param = el.def.params?.find((p) => p.id === e.id);
		const index = el.def.indexes?.find((ix) => ix.id === e.id);
		const ctx = e.change === 'added' ? a : b;
		if (param) {
			const required =
				param.in === 'path' ||
				after.elements.get(owner)?.def.params?.find((p) => p.id === e.id)?.required;
			const level: Level = e.change === 'added' && !required ? 'info' : 'breaking';
			const reason =
				e.change === 'added'
					? `a new ${required ? 'required ' : ''}param ${e.name}`
					: e.change === 'dropped'
						? `param ${e.name} is gone`
						: `param ${e.renamedFrom ?? e.name} changes`;
			add(ctx, { id: owner, element: owner, level, reason, cause: e.id });
		}
		if (index && el.storedIn !== undefined) {
			const store = el.storedIn;
			const unique =
				e.change !== 'dropped' &&
				after.elements.get(owner)?.def.indexes?.find((ix) => ix.id === e.id)?.unique;
			if (
				unique &&
				(e.change === 'added' || e.keys.some((k) => k.key === 'unique' || k.key === 'fields'))
			)
				add(ctx, {
					id: owner,
					element: store,
					table: true,
					level: 'check',
					reason: `unique index ${e.name}: existing rows must be unique`,
					cause: e.id,
					data: 'backfill'
				});
		}
	}

	// ------------------------------------------------------------------ free text
	function mention(e: DiffEntry, modelId: string, old: string, to?: string) {
		const units = new Set<string>();
		for (const { unit } of [
			...(b.unitsTouching.get(e.id) ?? []),
			...(b.unitsTouching.get(modelId) ?? [])
		])
			units.add(unit);
		for (const u of b.ioOf.get(modelId) ?? []) units.add(u);
		for (const x of b.exposures(modelId, e.id)) {
			if (x.stoppedBy) continue;
			for (const u of b.callers.get(x.api) ?? []) units.add(u);
			for (const [id, el] of before.elements) if (el.def.handles?.includes(x.api)) units.add(id);
		}
		for (const u of units) stepsText(e, u, old, to);
		for (const id of b.derivedFrom.get(e.id) ?? []) {
			const g = before.fields.get(id)!;
			textAt(e, g.modelId, [...g.loc.path, 'derived'], g.def.derived, old, to);
		}
		for (const id of b.apiFieldsOn.get(e.id) ?? []) {
			const f = before.apiFields.get(id)!;
			textAt(e, f.apiId, [...f.loc.path, 'derived'], f.def.derived, old, to);
			textAt(e, f.apiId, [...f.loc.path, 'description'], f.def.description, old, to);
		}
	}

	/** Text naming an api field or logic field: its own entity's steps. */
	function mentionAt(e: DiffEntry, entity: string, old: string, to?: string) {
		stepsText(e, entity, old, to);
		for (const u of b.callers.get(entity) ?? []) stepsText(e, u, old, to);
	}

	function stepsText(e: DiffEntry, unit: string, old: string, to?: string) {
		const walk = (steps: LogicStep[] | undefined, path: DataPath) =>
			steps?.forEach((s, i) => {
				for (const k of STEP_TEXT) textAt(e, unit, [...path, i, k], s[k], old, to);
				walk(s.then, [...path, i, 'then']);
				walk(s.else, [...path, i, 'else']);
				walk(s.do, [...path, i, 'do']);
			});
		walk(before.elements.get(unit)?.def.steps, ['steps']);
	}

	function textAt(
		e: DiffEntry,
		entity: string,
		path: DataPath,
		text: string | undefined,
		old: string,
		to?: string
	) {
		if (!text) return;
		const word = new RegExp(
			`(?<![A-Za-z0-9_])${old.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`,
			'g'
		);
		if (!word.test(text)) return;
		if (
			mentions.some(
				(m) => m.entity === entity && m.path.join('.') === path.join('.') && m.cause === e.id
			)
		)
			return;
		mentions.push({
			cause: e.id,
			entity,
			path,
			text,
			old,
			...(to ? { to: text.replace(word, to) } : {})
		});
	}

	// ------------------------------------------------------------------ callers of what broke
	for (const i of [...impacts.values()]) {
		if (i.depth !== 1 || (i.level !== 'breaking' && i.level !== 'check')) continue;
		const api =
			before.elements.get(i.id)?.def.kind === 'api' ? i.id : before.apiFields.get(i.id)?.apiId;
		if (!api) continue;
		const def = before.elements.get(api)!.def;
		for (const unit of stillCalling(api))
			add(b, {
				id: unit,
				element: unit,
				level: i.level,
				reason: `calls ${def.method} ${def.path}`,
				cause: i.cause,
				depth: 2
			});
	}

	const list = [...impacts.values()];
	const levelOf = new Map<string, Level>();
	for (const i of list) {
		levelOf.set(i.id, worse(levelOf.get(i.id), i.level));
		if (i.level !== 'stopped') levelOf.set(i.cause, worse(levelOf.get(i.cause), i.level));
	}
	return { impacts: list, mentions, levelOf };
}

/** The entity an id-carrying item sits in, in either state. */
export function ownerOf(before: Model, after: Model, id: string): string | undefined {
	for (const m of [before, after]) {
		const f = m.fields.get(id);
		if (f) return f.modelId;
		const af = m.apiFields.get(id);
		if (af) return af.apiId;
		for (const [eid, el] of m.elements) {
			if ([...(el.def.inputs ?? []), ...(el.def.outputs ?? [])].some((x) => x.id === id))
				return eid;
			if (el.def.params?.some((p) => p.id === id) || el.def.indexes?.some((ix) => ix.id === id))
				return eid;
		}
	}
	return undefined;
}

function ioEntry(model: Model, id: string) {
	for (const el of model.elements.values())
		for (const io of ['inputs', 'outputs'] as const) {
			const field = el.def[io]?.find((x) => x.id === id);
			if (field) return { io, field };
		}
	return undefined;
}
