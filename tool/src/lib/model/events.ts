import type { Model } from './model';
import type { DataEvent, LogicStep, WriteOp } from './schema';

const EVENT_OF: Record<WriteOp, DataEvent> = {
	create: 'created',
	update: 'updated',
	delete: 'deleted'
};

/**
 * The triggers a write step raises on model `modelId`: those listening to an event of the model
 * that the write does (its `does`; without it, any), and for `updated` with `fields`, only when
 * the write names the whole model or one of those fields. `sure` is false when the write does
 * not say what it does, so it only may raise them.
 */
export function raised(
	model: Model,
	step: LogicStep,
	modelId: string
): { triggers: string[]; sure: boolean } {
	const does = step.does === undefined ? undefined : [step.does].flat();
	const events = new Set(does ? does.map((d) => EVENT_OF[d]) : Object.values(EVENT_OF));
	const target = step.write;
	const triggers = [...model.elements.values()]
		.filter((t) => {
			const on = t.def.kind === 'trigger' ? t.def.on : undefined;
			if (!on || on.model !== modelId || !events.has(on.event as DataEvent)) return false;
			if (on.event !== 'updated' || !on.fields?.length || target === modelId) return true;
			return on.fields.includes(target ?? '');
		})
		.map((t) => t.id);
	return { triggers, sure: !!does };
}

/** The triggers a send on channel `channelId` starts: those on its received events. */
export const receivers = (model: Model, channelId: string) =>
	[...model.ports.values()]
		.filter((p) => p.channel === channelId && p.event === 'received')
		.flatMap((p) => p.triggers);

/** The units a trigger starts, by id. */
export const startedBy = (model: Model, triggerId: string) =>
	[...model.elements.values()].filter((u) => u.logic?.handles.includes(triggerId)).map((u) => u.id);
