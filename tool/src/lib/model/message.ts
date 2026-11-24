import type { By, Element, Message, TriggerOn } from './schema';
import type { Model } from './model';
import { scheduleWords } from './schedule';

/**
 * A trigger's source in words: the old message source (a queue, or a topic read through a
 * subscription), or the event of a channel or stored model it listens to.
 */

/** What is wrong with a message source, each with the key it is on. */
export function messageProblems(m: Message): { key: string; message: string }[] {
	const out: { key: string; message: string }[] = [];
	if ((m.queue === undefined) === (m.topic === undefined))
		out.push({
			key: m.queue === undefined ? 'queue' : 'topic',
			message: `a message needs exactly one of queue and topic${m.queue !== undefined ? '; this one has both' : ''}`
		});
	if (m.subscription !== undefined && m.topic === undefined)
		out.push({ key: 'subscription', message: 'subscription goes with topic, not queue' });
	return out;
}

/** A message source in words: `Queue erp-stock`, `Topic orders › billing`. */
export function messageWords(m: Message | undefined): string {
	if (!m) return '';
	if (m.queue !== undefined) return `Queue ${m.queue}`;
	if (m.topic !== undefined)
		return `Topic ${m.topic}${m.subscription !== undefined ? ` › ${m.subscription}` : ''}`;
	return '';
}

/**
 * The event a trigger listens to in words: `sbq-ax-price · received`, `EntityAdded › Product
 * grouping · received`, `Price · updated (Amount)`.
 */
export function onWords(model: Model, on: TriggerOn | undefined, self?: string): string {
	if (!on) return '';
	const src = model.elements.get(on.channel ?? on.model ?? '');
	const name = src?.name ?? on.channel ?? on.model ?? '';
	const sub =
		src?.def.type === 'topic' && (on.subscription ?? self) ? ` › ${on.subscription ?? self}` : '';
	const fields = on.fields?.length
		? ` (${on.fields.map((f) => model.fields.get(f)?.def.name ?? f).join(', ')})`
		: '';
	return `${name}${sub} · ${on.event}${fields}`;
}

/** Who starts a `by` trigger, as a word for the card: User, Framework, Outside. */
export const BY_WORDS = { user: 'User', framework: 'Framework', outside: 'Outside the design' };

/** Which of user, framework and outside a `by` trigger names, and its text. */
export function byOf(by: By | undefined): { who: keyof typeof BY_WORDS; how: string } | undefined {
	const who = (['user', 'framework', 'outside'] as const).find((k) => by?.[k] !== undefined);
	return who && { who, how: by![who]! };
}

/** A `by` source in words: `User · clicks Add to cart`. */
export function byWords(by: By | undefined): string {
	const b = byOf(by);
	return b ? `${BY_WORDS[b.who]} · ${b.how}` : '';
}

/** A trigger's source in words, whichever it is: its schedule, its event, who starts it, or its old message. */
export const triggerWords = (def: Element, model?: Model, name?: string): string =>
	def.on && model
		? onWords(model, def.on, name)
		: def.by
			? byWords(def.by)
			: def.message
				? messageWords(def.message)
				: scheduleWords(def.schedule);

/**
 * The glyph a trigger row wears: its event's, a person, sliders or an arrow out for `by`, a clock
 * for a schedule, an envelope for a message.
 */
export const triggerGlyph = (def: Element): string =>
	def.on
		? def.on.event
		: def.by
			? (byOf(def.by)?.who ?? 'trigger')
			: def.message
				? 'message'
				: 'trigger';
