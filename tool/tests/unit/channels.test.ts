import { mkdtempSync, readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { runMigrate } from '../../cli/migrate';
import { edgesOf } from '../../src/lib/landscape/connections';
import { focusOnRun } from '../../src/lib/landscape/focus';
import { layoutLandscape } from '../../src/lib/landscape/layout';
import { runOf } from '../../src/lib/landscape/play';
import { searchLandscape } from '../../src/lib/landscape/search';
import { sequenceOf } from '../../src/lib/landscape/sequence';
import { raised } from '../../src/lib/model/events';
import { evaluate } from '../../src/lib/scenario/evaluate';
import { loadStrings } from './helpers';

// DEX exports prices: it writes the export file and sends a message naming it on a queue;
// Price receives it, and reads the file. A dead-letter handler and a row trigger round it off.
const base = {
	'dex/dex.module.yaml': 'id: dex\nname: Dexcore\n',
	'dex/export.logic-unit.yaml': [
		'id: export',
		'parent: dex',
		'name: exportPrices',
		'inputs: []',
		'outputs: []',
		'steps:',
		'  - { write: ax-file, does: create }',
		'  - { send: ax-price, with: "area, blobPath" }'
	].join('\n'),
	'pbc/pbc.module.yaml': 'id: pbc\nname: Platform\n',
	'pbc/bus.module.yaml': 'id: bus\nparent: pbc\nname: Service Bus\n',
	'pbc/blob.module.yaml': 'id: blob\nparent: pbc\nname: Blob\nstore: files\n',
	'pbc/db.module.yaml': 'id: db\nparent: pbc\nname: Database\n',
	'pbc/msg.model.yaml':
		'id: msg\nownedBy: bus\nname: AX import message\nfields: [{ id: msg-path, name: blobPath, type: string }]\n',
	'pbc/ax-file.model.yaml':
		'id: ax-file\nownedBy: blob\nstoredIn: blob\nname: AX price export\nfields: [{ id: ax-amount, name: Amount, type: double }]\n',
	'pbc/price.model.yaml':
		'id: price\nownedBy: db\nstoredIn: db\nname: Price\nfields: [{ id: price-amount, name: Amount, type: double }, { id: price-note, name: Note, type: string }]\n',
	'pbc/ax-price.channel.yaml':
		'id: ax-price\nparent: bus\nname: sbq-ax-price\ntype: queue\ncarries: msg\nvia: dapr\nretries: 10\n',
	'pbc/receive.trigger.yaml': [
		'id: receive',
		'parent: db',
		'name: ReceiveAxPriceEvent',
		'on: { channel: ax-price, event: received }',
		'with: ServiceBusMessage'
	].join('\n'),
	'pbc/dead.trigger.yaml':
		'id: dead\nparent: db\nname: AxPriceDead\non: { channel: ax-price, event: dead-lettered }\n',
	'pbc/changed.trigger.yaml':
		'id: changed\nparent: db\nname: PriceChanged\non: { model: price, event: updated, fields: [price-amount] }\n',
	'pbc/import.logic-unit.yaml': [
		'id: import',
		'parent: db',
		'name: importPrices',
		'handles: [receive]',
		'inputs: []',
		'outputs: []',
		'steps:',
		'  - { read: ax-file }',
		'  - { write: price-amount, does: update }'
	].join('\n'),
	'pbc/park.logic-unit.yaml':
		'id: park\nparent: db\nname: park\nhandles: [dead]\ninputs: []\noutputs: []\nsteps: [{ note: log it }]\n',
	'pbc/react.logic-unit.yaml':
		'id: react\nparent: db\nname: react\nhandles: [changed]\ninputs: []\noutputs: []\nsteps: [{ note: recalc }]\n'
};
const load = (extra: Record<string, string> = {}) => loadStrings({ ...base, ...extra }).model;
const codes = (extra: Record<string, string>) => load(extra).diagnostics.map((d) => d.code);

describe('channels', () => {
	it('give each event a port that triggers listen to', () => {
		const model = load();
		expect(model.diagnostics).toEqual([]);
		expect([...model.ports.values()]).toEqual([
			{ id: 'ax-price:received', channel: 'ax-price', event: 'received', triggers: ['receive'] },
			{
				id: 'ax-price:dead-lettered',
				channel: 'ax-price',
				event: 'dead-lettered',
				triggers: ['dead']
			}
		]);
		expect(model.elements.get('receive')!.listens).toEqual(['ax-price:received']);
		expect(model.elements.get('changed')!.listens).toEqual(['price-amount']);
		expect(model.elements.get('export')!.logic!.sends).toEqual(['ax-price']);
		const edges = edgesOf(model);
		expect(edges).toContainEqual({ kind: 'sends', from: 'export', to: 'ax-price' });
		expect(edges).toContainEqual({ kind: 'on', from: 'receive', to: 'ax-price:received' });
		expect(edges).toContainEqual({ kind: 'on', from: 'changed', to: 'price-amount' });
	});

	it('give a topic a port per subscription', () => {
		const model = load({
			'pbc/ax-price.channel.yaml': 'id: ax-price\nparent: bus\nname: prices\ntype: topic\n',
			'pbc/receive.trigger.yaml':
				'id: receive\nparent: db\nname: R\non: { channel: ax-price, subscription: price, event: received }\n'
		});
		expect([...model.ports.keys()]).toEqual([
			'ax-price:AxPriceDead:received',
			'ax-price:AxPriceDead:dead-lettered',
			'ax-price:price:received'
		]);
	});

	it('check what a trigger listens to', () => {
		const trig = (on: string) => ({
			'pbc/receive.trigger.yaml': `id: receive\nparent: db\non: ${on}\n`
		});
		expect(codes(trig('{ channel: ax-price, event: updated }'))).toContain('trigger-event');
		expect(codes(trig('{ model: price, event: received }'))).toContain('trigger-event');
		expect(codes(trig('{ channel: ax-price, model: price, event: received }'))).toContain(
			'trigger-on'
		);
		expect(codes(trig('{ channel: ax-price, subscription: s, event: received }'))).toContain(
			'trigger-on'
		);
		expect(codes(trig('{ channel: price, event: received }'))).toContain('trigger-on');
		expect(codes(trig('{ model: msg, event: created }'))).toContain('trigger-on');
		expect(codes(trig('{ model: price, event: created, fields: [price-amount] }'))).toContain(
			'trigger-on'
		);
		expect(codes(trig('{ model: price, event: updated, fields: [ax-amount] }'))).toContain(
			'unknown-field'
		);
		expect(codes(trig('{ model: price, event: created, path: "*.json" }'))).toContain('trigger-on');
		expect(codes(trig('{ model: ax-file, event: created, path: "*.json" }'))).not.toContain(
			'trigger-on'
		);
		expect(
			codes(trig('{ channel: ax-price, event: received }\nschedule: { every: 1h }'))
		).toContain('trigger-source');
		expect(codes(trig('{ channel: ax-price, event: received }\noverlap: skip'))).toContain(
			'trigger-overlap'
		);
	});

	it('check channels, sends and writes', () => {
		expect(codes({ 'pbc/ax-price.channel.yaml': 'id: ax-price\nparent: bus\n' })).toContain(
			'channel-kind'
		);
		expect(codes({ 'pbc/bus.module.yaml': 'id: bus\nparent: pbc\ntype: queue\n' })).toContain(
			'channel-only'
		);
		expect(codes({ 'pbc/db.module.yaml': 'id: db\nparent: pbc\nstore: tape\n' })).toContain(
			'schema'
		);
		expect(
			codes({
				'pbc/ax-price.channel.yaml': 'id: ax-price\nparent: bus\ntype: queue\nstore: files\n'
			})
		).toContain('module-store');
		const step = (s: string) => ({
			'dex/export.logic-unit.yaml': `id: export\nparent: dex\ninputs: []\noutputs: []\nsteps: [${s}]\n`
		});
		expect(codes(step('{ send: price }'))).toContain('logic-target');
		expect(codes(step('{ send: ax-price, gets: ack }'))).toContain('logic-step');
		expect(codes(step('{ read: price, does: create }'))).toContain('logic-step');
		expect(codes(step('{ call: receive }'))).toContain('step-send');
		// Nothing sends on it: a warning, unless it is external.
		expect(codes(step('{ note: x }'))).toContain('channel-unsent');
		expect(
			codes({
				...step('{ note: x }'),
				'pbc/ax-price.channel.yaml': 'id: ax-price\nparent: bus\ntype: queue\nexternal: true\n'
			})
		).not.toContain('channel-unsent');
		expect(
			codes({
				'pbc/receive.trigger.yaml': 'id: receive\nparent: db\nschedule: { every: 1h }\n',
				'pbc/dead.trigger.yaml': 'id: dead\nparent: db\nschedule: { every: 1h }\n'
			})
		).toContain('channel-unheard');
	});

	it('are cards of their own, a row per event, and files are drawn as files', () => {
		const boxes = layoutLandscape(load()).boxes;
		const card = boxes.find((b) => b.id === 'ax-price')!;
		expect(card.parentId).toBe('bus');
		expect(card.channel!.rows).toEqual([
			{
				id: 'ax-price:received',
				name: 'received',
				signature: 'ReceiveAxPriceEvent',
				glyph: 'received'
			},
			{
				id: 'ax-price:dead-lettered',
				name: 'dead-lettered',
				signature: 'AxPriceDead',
				glyph: 'dead-lettered'
			}
		]);
		const triggers = boxes.find((b) => b.id === 'db#triggers')!;
		expect(triggers.triggers!.rows.find((r) => r.id === 'receive')).toEqual({
			id: 'receive',
			name: 'ReceiveAxPriceEvent',
			signature: 'sbq-ax-price · received',
			glyph: 'received'
		});
		expect(triggers.triggers!.rows.find((r) => r.id === 'changed')!.signature).toBe(
			'Price · updated (Amount)'
		);
		expect(boxes.find((b) => b.elementId === 'ax-file' && b.view === 'table')!.files).toBe(true);
		expect(boxes.find((b) => b.elementId === 'price' && b.view === 'table')!.files).toBeUndefined();
	});

	it('are found by search', () => {
		expect(searchLandscape(load(), 'sbq').map((g) => [g.kind, g.hits.map((h) => h.id)])).toEqual([
			['channel', ['ax-price']]
		]);
	});

	it('take sends in a sequence, which say what they start', () => {
		const model = load();
		const seq = sequenceOf(model, 'export');
		const send = seq.messages.find((m) => m.target === 'ax-price')!;
		expect(seq.lifelines[send.to].name).toBe('sbq-ax-price');
		expect([send.async, send.text]).toEqual([true, 'sends (area, blobPath)']);
		expect(seq.notes.map((n) => n.text)).toEqual(['starts ReceiveAxPriceEvent → importPrices']);
		const handler = sequenceOf(model, 'import');
		expect(handler.lifelines[0].subs).toEqual([
			{
				text: 'ReceiveAxPriceEvent · sbq-ax-price · received',
				trigger: true,
				glyph: 'received',
				target: 'receive'
			},
			{ text: 'ƒ exportPrices', target: 'export' }
		]);
		// The import's write of Amount raises PriceChanged.
		expect(handler.notes.map((n) => n.text)).toEqual(['starts PriceChanged → react']);
		expect(raised(model, { write: 'price-note', does: 'update' }, 'price').triggers).toEqual([]);
		expect(raised(model, { write: 'price' }, 'price')).toEqual({
			triggers: ['changed'],
			sure: false
		});
	});

	it('let Play follow a message into the unit it starts', () => {
		const model = load();
		const steps = runOf(model, 'export', {}, new Set()).steps;
		const send = steps.find((s) => s.to === 'ax-price')!;
		expect([send.kind, send.text, send.into]).toEqual([
			'call',
			'sends on sbq-ax-price (area, blobPath)',
			'import'
		]);
		const inside = runOf(model, 'export', {}, new Set([send.key])).steps;
		expect(inside.some((s) => s.from === 'import' && s.to === 'ax-file')).toBe(true);
		const kept = focusOnRun(model, 'export').model.elements;
		for (const id of ['ax-price', 'receive', 'import']) expect(kept.has(id), id).toBe(true);
	});

	it('break their senders and listeners when dropped', () => {
		const sources = Object.entries(base).map(([p, text]) => ({ path: p, text }));
		const design = loadStrings(base);
		const docs = Object.fromEntries(Object.entries(design.parsed).map(([f, p]) => [f, p.doc]));
		const ev = evaluate(docs, design, [{ drop: 'ax-price' }]);
		const reasons = ev.report.impacts.map((i) => `${i.id}: ${i.reason}`);
		expect(reasons).toContain('export: sends on a channel that is gone');
		expect(reasons).toContain('receive: listens to a channel that is gone');
		void sources;
	});
});

describe('sdv migrate triggers', () => {
	it('turns message sources into channels and calls into sends', async () => {
		const dir = mkdtempSync(path.join(tmpdir(), 'sdv-migrate-'));
		const files: Record<string, string> = {
			's/s.module.yaml': 'id: s\n',
			's/m.module.yaml': 'id: m\nparent: s\n',
			's/m/stock.trigger.yaml':
				'id: stock\nparent: m\nname: stockChanged\n# comment kept\nmessage: { queue: erp-stock, via: erp-bus }\nwith: lines\n',
			's/m/apply.logic-unit.yaml':
				'id: apply\nparent: m\nhandles: [stock]\ninputs: []\noutputs: []\nsteps: [{ note: x }]\n',
			's/m/ext.trigger.yaml':
				'id: ext\nparent: m\nname: ext\nmessage: { topic: t, subscription: sub }\n',
			's/m/push.logic-unit.yaml':
				'id: push\nparent: m\ninputs: []\noutputs: []\nsteps:\n  - if: x\n    then: [{ call: stock, with: lines }]\n'
		};
		for (const [p, text] of Object.entries(files)) {
			mkdirSync(path.dirname(path.join(dir, p)), { recursive: true });
			writeFileSync(path.join(dir, p), text);
		}
		const log: string[] = [];
		const code = await runMigrate(['triggers'], dir, {
			log: (m) => log.push(m),
			error: (m) => log.push(m)
		});
		expect(code).toBe(0);
		expect(log[0]).toMatch(/2 trigger\(s\) onto 2 channel\(s\)/);
		const channels = readdirSync(path.join(dir, 's/m')).filter((f) => f.endsWith('.channel.yaml'));
		expect(channels.sort()).toEqual(['erp-stock.channel.yaml', 't.channel.yaml']);
		const stock = readFileSync(path.join(dir, 's/m/erp-stock.channel.yaml'), 'utf8');
		expect(stock).toMatch(/parent: m\nname: erp-stock\ntype: queue\nvia: erp-bus\n$/);
		const topic = readFileSync(path.join(dir, 's/m/t.channel.yaml'), 'utf8');
		expect(topic).toMatch(/type: topic\nexternal: true\n$/);
		const id = /id: (\w+)/.exec(stock)![1];
		const trig = readFileSync(path.join(dir, 's/m/stock.trigger.yaml'), 'utf8');
		expect(trig).toBe(
			`id: stock\nparent: m\nname: stockChanged\n# comment kept\non: { channel: ${id}, event: received }\nwith: lines\n`
		);
		expect(readFileSync(path.join(dir, 's/m/ext.trigger.yaml'), 'utf8')).toMatch(
			/on: \{ channel: \w+, subscription: sub, event: received \}/
		);
		expect(readFileSync(path.join(dir, 's/m/push.logic-unit.yaml'), 'utf8')).toContain(
			`then: [{ send: ${id}, with: lines }]`
		);
		const after = loadStrings(
			Object.fromEntries(
				[...Object.keys(files), 's/m/erp-stock.channel.yaml', 's/m/t.channel.yaml'].map((p) => [
					p,
					readFileSync(path.join(dir, p), 'utf8')
				])
			)
		).model;
		expect(after.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
		expect(after.diagnostics.map((d) => d.code)).not.toContain('trigger-message-legacy');
	});
});
