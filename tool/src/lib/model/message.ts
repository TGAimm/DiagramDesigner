import type { Element, Message } from './schema';
import { scheduleWords } from './schedule';

/**
 * A trigger's message source: a queue, or a topic read through a subscription. A logic unit
 * step calling the trigger sends one.
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

/** A trigger's source in words, whichever it is: its schedule or its message. */
export const triggerWords = (def: Element): string =>
	def.message ? messageWords(def.message) : scheduleWords(def.schedule);
