import { describe, expect, it } from 'vitest';
import { edgesOf } from '../../src/lib/landscape/connections';
import { layoutLandscape } from '../../src/lib/landscape/layout';
import { runOf } from '../../src/lib/landscape/play';
import { searchLandscape } from '../../src/lib/landscape/search';
import { sequenceOf } from '../../src/lib/landscape/sequence';
import { nextRuns, scheduleWords } from '../../src/lib/model/schedule';
import { messageWords } from '../../src/lib/model/message';
import { loadStrings } from './helpers';

const base = {
	's/s.module.yaml': 'id: s\n',
	's/m.module.yaml': 'id: m\nparent: s\n',
	's/cart.model.yaml': 'id: cart\nownedBy: m\nfields: [{ id: cart-id, name: id, type: uuid }]\n',
	's/nightly.trigger.yaml': [
		'id: nightly',
		'parent: m',
		'name: purgeOldCarts',
		"schedule: { cron: '0 3 * * *', tz: Europe/Copenhagen }",
		'with: carts older than 30 days'
	].join('\n'),
	's/purge.logic-unit.yaml': [
		'id: purge',
		'parent: m',
		'name: purgeCarts',
		'handles: [nightly]',
		'inputs: []',
		'outputs: []',
		'steps: [{ write: cart }]'
	].join('\n')
};
const load = (extra: Record<string, string> = {}) => loadStrings({ ...base, ...extra }).model;
const codes = (extra: Record<string, string>) => load(extra).diagnostics.map((d) => d.code);

describe('triggers', () => {
	it('start the units handling them', () => {
		const model = load();
		expect(model.diagnostics).toEqual([]);
		expect(model.elements.get('purge')!.logic!.handles).toEqual(['nightly']);
		// The trigger depends on the unit it starts, as an api on the unit handling it.
		expect(edgesOf(model)).toContainEqual({ kind: 'handles', from: 'nightly', to: 'purge' });
	});

	it('need exactly one well-formed source', () => {
		const trigger = (schedule: string) => ({
			's/nightly.trigger.yaml': `id: nightly\nparent: m\nschedule: ${schedule}\n`
		});
		expect(codes({ 's/nightly.trigger.yaml': 'id: nightly\nparent: m\n' })).toContain(
			'trigger-source'
		);
		for (const bad of [
			"{ cron: '0 3 * * *', every: 1h }",
			"{ cron: '0 3 * * * *' }",
			"{ cron: '99 * * * *' }",
			'{ every: 15 }',
			'{ every: 15m, tz: UTC }',
			'{ at: tomorrow }',
			"{ cron: '0 3 * * *', tz: Mars/Olympus }"
		])
			expect(codes(trigger(bad)), bad).toContain('trigger-schedule');
		expect(codes(trigger('{ every: 15m }'))).not.toContain('trigger-schedule');
	});

	it('keep their keys to themselves, and timeouts are durations', () => {
		expect(codes({ 's/m.module.yaml': 'id: m\nparent: s\nretries: 2\n' })).toContain(
			'trigger-only'
		);
		expect(
			codes({
				's/nightly.trigger.yaml': 'id: nightly\nparent: m\nschedule: { every: 1h }\ntimeout: soon\n'
			})
		).toContain('trigger-timeout');
	});

	it('warn when nothing handles them, or they cannot fill a unit’s inputs', () => {
		expect(
			codes({ 's/purge.logic-unit.yaml': 'id: purge\nparent: m\ninputs: []\noutputs: []\n' })
		).toContain('trigger-unused');
		expect(
			codes({
				's/nightly.trigger.yaml': 'id: nightly\nparent: m\nschedule: { every: 1h }\n',
				's/purge.logic-unit.yaml': [
					'id: purge',
					'parent: m',
					'handles: [nightly]',
					'inputs: [{ id: purge-age, name: age, type: int, required: true }]',
					'outputs: []'
				].join('\n')
			})
		).toContain('trigger-inputs');
	});

	it('read in words, with their next runs in their time zone', () => {
		expect(scheduleWords({ cron: '0 6 * * 1-5' })).toBe('At 06:00, Monday through Friday');
		expect(scheduleWords({ every: '15m' })).toBe('Every 15 minutes');
		expect(scheduleWords({ every: '1h' })).toBe('Every hour');
		expect(scheduleWords({ at: '2026-12-01T00:00' })).toBe('Once, 1 Dec 2026 at 00:00');
		expect(
			nextRuns({ cron: '0 3 * * *', tz: 'Europe/Copenhagen' }, 2, new Date('2026-11-17T12:00Z'))
		).toEqual(['18 Nov 03:00', '19 Nov 03:00']);
	});

	it('share one card, first in their module, a row each with its schedule', () => {
		const boxes = layoutLandscape(load()).boxes;
		const inM = boxes.filter((b) => b.parentId === 'm');
		expect(inM.map((b) => b.id)).toEqual(['m#triggers', 'm#logic', 'cart']);
		expect(inM[0].triggers!.rows).toEqual([
			{ id: 'nightly', name: 'purgeOldCarts', signature: 'At 03:00', glyph: 'trigger' }
		]);
		expect(boxes.some((b) => b.elementId === 'nightly')).toBe(false);
	});

	it('are found by search', () => {
		const groups = searchLandscape(load(), 'purgeold');
		expect(groups.map((g) => [g.kind, g.hits.map((h) => h.id)])).toEqual([
			['trigger', ['nightly']]
		]);
	});

	it('are the caller of a unit they start, passing what with says', () => {
		const model = load();
		const seq = sequenceOf(model, 'purge');
		expect(seq.lifelines[0].subs).toEqual([
			{ text: 'purgeOldCarts · At 03:00', trigger: true, glyph: 'trigger', target: 'nightly' }
		]);
		expect(seq.messages[0].text).toBe('carts older than 30 days');
		const first = runOf(model, 'purge', {}, new Set()).steps[0];
		expect([first.from, first.to, first.text]).toEqual([
			'nightly',
			'purge',
			'carts older than 30 days'
		]);
	});
});

describe('message triggers', () => {
	const msg = {
		...base,
		's/stock.trigger.yaml': [
			'id: stock',
			'parent: m',
			'name: stockChanged',
			'message: { queue: erp-stock, via: erp-bus }',
			'with: AX stock lines',
			'retries: 3'
		].join('\n'),
		's/apply.logic-unit.yaml': [
			'id: apply',
			'parent: m',
			'name: applyStock',
			'handles: [stock]',
			'inputs: []',
			'outputs: []',
			'steps: [{ write: cart }]'
		].join('\n'),
		's/o.module.yaml': 'id: o\nparent: s\nname: Other\n',
		's/push.logic-unit.yaml': [
			'id: push',
			'parent: o',
			'name: pushStock',
			'inputs: []',
			'outputs: []',
			'steps: [{ call: stock, with: lines }, { note: done }]'
		].join('\n')
	};
	const loadM = (extra: Record<string, string> = {}) => loadStrings({ ...msg, ...extra }).model;
	const codesM = (extra: Record<string, string>) => loadM(extra).diagnostics.map((d) => d.code);
	const trigger = (body: string) => ({ 's/stock.trigger.yaml': `id: stock\nparent: m\n${body}\n` });

	it('are sent by the units calling them, and ask to be migrated', () => {
		const model = loadM();
		expect(model.diagnostics.map((d) => d.code)).toEqual(['trigger-message-legacy']);
		expect(model.elements.get('push')!.logic!.calls).toEqual(['stock']);
		expect(edgesOf(model)).toContainEqual({ kind: 'calls', from: 'push', to: 'stock' });
		expect(edgesOf(model)).toContainEqual({ kind: 'handles', from: 'stock', to: 'apply' });
	});

	it('need exactly one source, and exactly one of queue and topic', () => {
		expect(codesM(trigger('message: { queue: q }\nschedule: { every: 1h }'))).toContain(
			'trigger-source'
		);
		expect(codesM(trigger('retries: 1'))).toContain('trigger-source');
		for (const bad of ['{ via: dapr }', '{ queue: q, topic: t }', '{ queue: q, subscription: s }'])
			expect(codesM(trigger(`message: ${bad}`)), bad).toContain('trigger-message');
		expect(codesM(trigger('message: { topic: t, subscription: s }'))).toEqual([
			'trigger-message-legacy'
		]);
		expect(codesM(trigger('message: { queue: q }\noverlap: skip'))).toContain('trigger-overlap');
		expect(codesM({ 's/m.module.yaml': 'id: m\nparent: s\nmessage: { queue: q }\n' })).toContain(
			'trigger-only'
		);
	});

	it('can be called; a schedule cannot, and a message gets nothing back', () => {
		const push = (step: string) => ({
			's/push.logic-unit.yaml': `id: push\nparent: o\ninputs: []\noutputs: []\nsteps: [${step}]\n`
		});
		expect(codesM(push('{ call: nightly }'))).toContain('trigger-call');
		expect(codesM(push('{ call: stock, gets: ack }'))).toContain('trigger-call');
		expect(codesM(push('{ call: stock }'))).not.toContain('trigger-call');
	});

	it('read as their queue or topic, with an envelope on their row', () => {
		expect(messageWords({ queue: 'erp-stock' })).toBe('Queue erp-stock');
		expect(messageWords({ topic: 'orders', subscription: 'billing' })).toBe(
			'Topic orders › billing'
		);
		const card = layoutLandscape(loadM()).boxes.find((b) => b.id === 'm#triggers')!;
		expect(card.triggers!.rows).toEqual([
			{ id: 'nightly', name: 'purgeOldCarts', signature: 'At 03:00', glyph: 'trigger' },
			{ id: 'stock', name: 'stockChanged', signature: 'Queue erp-stock', glyph: 'message' }
		]);
	});

	it('are sent async in a sender’s sequence, and Play goes on without waiting', () => {
		const model = loadM();
		const seq = sequenceOf(model, 'push');
		const send = seq.messages[1];
		expect(seq.lifelines[send.to].name).toBe('m');
		expect([send.tone, send.async, send.text, send.target]).toEqual([
			'call',
			true,
			'sends stockChanged (lines)',
			'stock'
		]);
		expect(seq.messages.filter((m) => m.tone === 'return')).toEqual([]);
		const steps = runOf(model, 'push', {}, new Set()).steps;
		expect(steps.map((s) => [s.kind, s.to])).toEqual([
			['input', 'push'],
			['call', 'stock'],
			['note', 'push']
		]);
		expect(steps[1].into).toBeUndefined();
	});

	it('are the caller of their handler, which lists who sends them', () => {
		const seq = sequenceOf(loadM(), 'apply');
		expect(seq.lifelines[0].subs).toEqual([
			{ text: 'stockChanged · Queue erp-stock', trigger: true, glyph: 'message', target: 'stock' },
			{ text: 'ƒ pushStock', target: 'push' }
		]);
		expect(seq.messages[0].text).toBe('AX stock lines');
	});
});
