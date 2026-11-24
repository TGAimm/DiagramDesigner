import { describe, expect, it } from 'vitest';
import { loadDesign } from '../../src/lib/model/loader';
import { loadStrings } from './helpers';

const unit = (id: string, extra: string[] = []) =>
	[`id: ${id}`, 'parent: m', 'inputs: []', 'outputs: []', ...extra].join('\n');

const base: Record<string, string> = {
	's/s.module.yaml': 'id: s\n',
	's/m.module.yaml': 'id: m\nparent: s\n',
	's/click.trigger.yaml': 'id: click\nparent: m\nby: { user: clicks Add to cart }\n',
	's/add.logic-unit.yaml': unit('add', ['handles: [click]', 'steps: [{ call: save }]']),
	's/save.logic-unit.yaml': unit('save'),
	's/old.logic-unit.yaml': unit('old', ['dead: replaced by add', 'steps: [{ call: helper }]']),
	's/helper.logic-unit.yaml': unit('helper'),
	's/stray.logic-unit.yaml': unit('stray', ['steps: [{ call: helper }]'])
};
const load = (extra: Record<string, string> = {}) =>
	loadDesign(Object.entries({ ...base, ...extra }).map(([path, text]) => ({ path, text }))).model;
const warnings = (m: ReturnType<typeof load>) =>
	m.diagnostics.map((d) => [d.code, d.message]).filter(([c]) => c !== 'logic-unused');

describe('reach', () => {
	it('runs what a trigger starts, and what that calls', () => {
		const m = load();
		expect(m.reach!.get('add')!.state).toBe('live');
		expect(m.reach!.get('save')!.state).toBe('live');
	});

	it('takes dead code from dead: and from having only dead callers', () => {
		const m = load();
		expect(m.reach!.get('old')).toEqual({ state: 'dead', why: 'replaced by add', callers: [] });
		expect(m.reach!.get('helper')).toEqual({
			state: 'dead',
			callers: ['old', 'stray']
		});
	});

	it('warns only where nothing starts or calls a unit, and where live code uses dead code', () => {
		expect(warnings(load())).toEqual([
			[
				'unreached',
				'nothing starts or calls logic unit "stray"; add a trigger, or dead: <why>'
			]
		]);
		const m = load({
			's/save.logic-unit.yaml': unit('save', ['dead: unused', 'steps: [{ call: old }]'])
		});
		expect(warnings(m)).toContainEqual([
			'dead-reached',
			'logic unit "save" is marked dead, but add still uses it'
		]);
		expect(m.reach!.get('old')!.state).toBe('dead');
	});

	it('runs an api called from outside: external on it or a module round it', () => {
		const api = (extra = '') =>
			`id: a\nparent: m\nmethod: GET\npath: /a\nresponses: [{ status: 204 }]\n${extra}`;
		const handler = unit('h', ['handles: [a]']);
		const none = load({ 's/a.api.yaml': api(), 's/h.logic-unit.yaml': handler }).reach!;
		expect(none.get('a')!.state).toBe('unreached');
		expect(none.get('h')).toEqual({ state: 'dead', callers: ['a'] });
		expect(
			load({ 's/a.api.yaml': api('external: true'), 's/h.logic-unit.yaml': handler }).reach!.get(
				'h'
			)!.state
		).toBe('live');
		expect(
			load({
				's/m.module.yaml': 'id: m\nparent: s\nexternal: true\n',
				's/a.api.yaml': api(),
				's/h.logic-unit.yaml': handler
			}).reach!.get('h')!.state
		).toBe('live');
	});

	it('follows render steps', () => {
		const m = load({
			's/add.logic-unit.yaml': unit('add', ['handles: [click]', 'steps: [{ render: save }]'])
		});
		expect(m.reach!.get('save')!.state).toBe('live');
	});

	it('checks by: exactly one of user, framework and outside, and only on triggers', () => {
		const codes = (files: Record<string, string>) =>
			loadStrings({ ...base, ...files }).model.diagnostics.map((d) => d.code);
		expect(
			codes({ 's/click.trigger.yaml': 'id: click\nparent: m\nby: { user: a, outside: b }\n' })
		).toContain('trigger-by');
		expect(
			codes({
				's/click.trigger.yaml': 'id: click\nparent: m\nby: { user: a }\nschedule: { every: 1h }\n'
			})
		).toContain('trigger-source');
		expect(codes({ 's/save.logic-unit.yaml': unit('save', ['by: { user: a }']) })).toContain(
			'trigger-only'
		);
		expect(codes({ 's/m.module.yaml': 'id: m\nparent: s\ndead: x\n' })).toContain('dead-only');
	});
});
