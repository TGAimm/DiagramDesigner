import { flagOn, type Model } from '../model/model';
import type { LogicStep } from '../model/schema';
import { inputText } from './sequence';

/** A branch to pick at a choice: its button text, and the short word under its mark. */
export interface PlayOption {
	label: string;
	short: string;
}

/**
 * One step of a run, on the path the choices made so far lead down. Its ends are element
 * ids (a unit, api, model or field); a step the unit takes alone (a note, a choice, an input
 * with no caller) has the unit at both ends.
 */
export interface PlayStep {
	/** Names the step in its run, for choices and steps into; stable while choices change. */
	key: string;
	kind: 'input' | 'call' | 'gets' | 'read' | 'write' | 'note' | 'choice' | 'return' | 'fail';
	text: string;
	/** An api's HTTP method, which starts `text` and colours it. */
	method?: string;
	from: string;
	to: string;
	/** The units stepped into to get here, the started unit first. */
	frame: string[];
	/** At a choice: the guard and the branches, and the one picked if any. */
	choice?: { label: 'alt' | 'loop'; guard: string; options: PlayOption[]; picked?: number };
	/** At a call: the unit with steps that Step into goes into, and how many steps it has. */
	into?: string;
	intoSteps?: number;
	/** At such a call: stepped into, so the steps after it are the inner unit's. */
	entered?: boolean;
}

export interface Run {
	steps: PlayStep[];
	/** The path stops at a choice not yet made, so what follows is unknown. */
	pending: boolean;
}

/** A unit's run to the first choice not yet made, or to its end. */
export function runOf(
	model: Model,
	unitId: string,
	choices: Record<string, number>,
	into: Set<string>
): Run {
	const el = (id: string) => model.elements.get(id);
	const route = (id: string) => `${el(id)!.def.method} ${el(id)!.def.path}`;
	const known = (id: string | undefined) => !!id && (model.ids.has(id) || model.elements.has(id));
	const hasSteps = (id: string | undefined) => !!id && !!el(id)?.def.steps?.length;
	const withNote = (text: string, s: LogicStep) => (s.note ? `${text} · ${s.note}` : text);
	/** The unit with steps a call goes into: the callee, or the unit handling the api. */
	const intoOf = (id: string, frame: string[]) => {
		const t =
			el(id)?.def.kind === 'api'
				? [...model.elements.values()].find((e) => e.logic?.handles.includes(id) && hasSteps(e.id))
						?.id
				: id;
		return hasSteps(t) && !frame.includes(t!) ? t : undefined;
	};

	const steps: PlayStep[] = [];
	const push = (s: Omit<PlayStep, 'frame'>, frame: string[]) => steps.push({ ...s, frame });
	// Thrown to stop at a choice not yet made, or at the started unit's end.
	const STOP = Symbol('stop');
	let pending = false;

	/** Plays one unit's steps; returns true once it has returned or failed. */
	const unit = (id: string, caller: string | undefined, frame: string[], prefix: string) => {
		const self = id;
		const ret = (kind: 'return' | 'fail', key: string, text: string) => {
			push({ key, kind, text, from: self, to: caller ?? self }, frame);
			if (frame.length === 1) throw STOP;
			return true;
		};
		const walk = (list: LogicStep[] | undefined, path: string): boolean => {
			for (const [i, s] of (list ?? []).entries()) {
				const key = `${path}.${i}`;
				if (s.call !== undefined) {
					const t = el(s.call);
					if (!t) continue;
					const isApi = t.def.kind === 'api';
					// A message trigger is sent, not called: the run goes on without stepping in or
					// waiting for anything back.
					const sends = t.def.kind === 'trigger';
					const target = sends ? undefined : intoOf(t.id, frame);
					const args = s.with ? ` (${s.with})` : '';
					push(
						{
							key,
							kind: 'call',
							text: withNote(
								isApi
									? route(t.id) + args
									: sends
										? `sends ${t.name}${args}`
										: `${t.name}(${s.with ?? ''})`,
								s
							),
							method: isApi ? t.def.method : undefined,
							from: self,
							to: t.id,
							...(target && {
								into: target,
								intoSteps: el(target)!.def.steps!.length,
								entered: into.has(key)
							})
						},
						frame
					);
					// Stepped into, the inner unit's return stands for what the call gets.
					if (target && into.has(key)) unit(target, self, [...frame, target], `${key}>`);
					else if (s.gets && !sends)
						push({ key: `${key}<`, kind: 'gets', text: s.gets, from: t.id, to: self }, frame);
				} else if (s.read !== undefined || s.write !== undefined) {
					const target = (s.read ?? s.write)!;
					if (!known(target)) continue;
					const field = model.fields.get(target);
					const verb = s.read !== undefined ? 'reads' : 'writes';
					push(
						{
							key,
							kind: s.read !== undefined ? 'read' : 'write',
							text: withNote(
								`${verb} ${field ? field.def.name : el(target)!.name}${s.with ? ` (${s.with})` : ''}`,
								s
							),
							from: self,
							to: target
						},
						frame
					);
					if (s.gets)
						push({ key: `${key}<`, kind: 'gets', text: s.gets, from: target, to: self }, frame);
				} else if (s.if !== undefined) {
					const options = s.else
						? [
								{ label: s.if, short: 'then' },
								{ label: 'else', short: 'else' }
							]
						: [
								{ label: 'yes', short: 'yes' },
								{ label: 'no', short: 'no' }
							];
					const picked = choose(key, { label: 'alt', guard: `[${s.if}]`, options }, frame, self);
					if (walk(picked === 0 ? s.then : s.else, `${key}${picked === 0 ? 't' : 'e'}`))
						return true;
				} else if (s.flag !== undefined) {
					// The shown flag state picks the branch: nothing to ask.
					const on = flagOn(model, s.flag);
					if (walk(on ? s.on : s.off, `${key}${on ? 'n' : 'f'}`)) return true;
				} else if (s.each !== undefined) {
					const options = [
						{ label: 'once more', short: 'more' },
						{ label: 'done', short: 'done' }
					];
					// A loop goes round as often as it is asked to, up to a bound.
					for (let round = 1; round <= 20; round++) {
						const k = `${key}#${round}`;
						const guard = `[each ${s.each}]${round > 1 ? ` ×${round}` : ''}`;
						if (choose(k, { label: 'loop', guard, options }, frame, self) !== 0) break;
						if (walk(s.do, `${k}d`)) return true;
					}
				} else if (s.return !== undefined) return ret('return', key, withNote(s.return, s));
				else if (s.fail !== undefined) return ret('fail', key, withNote(`fails ${s.fail}`, s));
				else if (s.note !== undefined)
					push({ key, kind: 'note', text: s.note, from: self, to: self }, frame);
			}
			return false;
		};
		walk(el(id)!.def.steps, prefix);
	};
	/** Adds a choice step and returns the branch picked, or stops the run if none is. */
	const choose = (
		key: string,
		c: { label: 'alt' | 'loop'; guard: string; options: PlayOption[] },
		frame: string[],
		self: string
	) => {
		const picked = choices[key];
		push(
			{ key, kind: 'choice', text: c.guard, from: self, to: self, choice: { ...c, picked } },
			frame
		);
		if (picked === undefined) {
			pending = true;
			throw STOP;
		}
		return picked;
	};

	const def = el(unitId)!;
	const caller =
		def.logic?.handles[0] ??
		[...model.elements.values()].find((e) => e.logic?.calls.includes(unitId))?.id;
	try {
		push(
			{
				key: 'in',
				kind: 'input',
				text: inputText(model, unitId),
				from: caller ?? unitId,
				to: unitId
			},
			[unitId]
		);
		unit(unitId, caller, [unitId], 's');
	} catch (e) {
		if (e !== STOP) throw e;
	}
	return { steps, pending };
}

/**
 * Whether Step forward goes into the call at `step`: at a call with steps inside not answered
 * yet, while following calls. A call stepped over on purpose (`over`) stays stepped over.
 */
export const forwardGoesInto = (step: PlayStep, over: readonly string[], follow: boolean) =>
	follow && !!step.into && !step.entered && !over.includes(step.key);

/** The call step `i`'s unit was stepped into from, or -1 in the unit started in. */
export function callOf(run: Run, i: number): number {
	const depth = run.steps[i].frame.length;
	return run.steps.findLastIndex((s, k) => k < i && s.frame.length < depth);
}

/** Where Step out lands from step `i`: the first step back in the unit that called this one. */
export function stepOutOf(run: Run, i: number): number {
	const depth = run.steps[i].frame.length;
	const j = run.steps.findIndex((s, k) => k > i && s.frame.length < depth);
	return j >= 0 ? j : run.steps.length - 1;
}
