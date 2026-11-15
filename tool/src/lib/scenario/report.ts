import type { Diagnostic } from '../model/diagnostics';
import { formatDiagnostic } from '../model/diagnostics';
import type { Evaluation, Summary } from './evaluate';
import type { Impact, Level } from './impact';
import { changeGlyph, changeLabel, changeTarget, impactLabel, itemLabel, whereOf } from './labels';
import type { Scenario } from './scenario';

/** `1 changed · 1 added — 5 breaking · 3 affected · 2 to check`: the one summary line. */
export function summaryLine(s: Summary): string {
	const what = [
		s.changed && `${s.changed} changed`,
		s.added && `${s.added} added`,
		s.dropped && `${s.dropped} dropped`,
		s.moved && `${s.moved} moved`
	].filter(Boolean);
	const effect = [
		s.breaking && `${s.breaking} breaking`,
		s.affected && `${s.affected} affected`,
		s.check && `${s.check} to check`
	].filter(Boolean);
	return `${what.join(' · ') || 'no changes'}${effect.length ? ` — ${effect.join(' · ')}` : ''}`;
}

/** A markdown report of a scenario for reviewers: the changes, then what they break. */
export function scenarioReport(scenario: Scenario, ev: Evaluation, errors: Diagnostic[]): string {
	const { before, after } = ev;
	const out: string[] = [`## ${scenario.name}`, ''];
	if (scenario.description) out.push(scenario.description, '');
	out.push(summaryLine(ev.summary), '', '### Changes', '');
	scenario.changes.forEach((c, i) => {
		const r = ev.results[i];
		const level = ev.report.levelOf.get(changeTarget(c));
		const note =
			r.status !== 'ok' ? ` — **${r.status}**: ${r.message}` : level ? ` — ${level}` : '';
		out.push(`${i + 1}. ${changeGlyph(c)} ${changeLabel(before, after, c)}${note}`);
	});
	const section = (title: string, pick: (i: Impact) => boolean) => {
		const items = ev.report.impacts.filter(pick);
		if (!items.length) return;
		out.push('', `### ${title}`, '');
		for (const i of items) {
			const model = before.elements.has(i.element) ? before : after;
			const where = whereOf(model, i.element);
			const flags = [
				i.data === 'loss' && 'data loss',
				i.data === 'backfill' && 'backfill',
				i.external && 'plus unmodelled consumers'
			].filter(Boolean);
			out.push(
				`- **${impactLabel(model, i)}**${where ? ` (${where})` : ''} — ${i.reason}; from ${itemLabel(before.fields.has(i.cause) || before.elements.has(i.cause) ? before : after, i.cause)}${flags.length ? ` [${flags.join(', ')}]` : ''}`
			);
		}
	};
	const level = (l: Level, depth: 1 | 2) => (i: Impact) => i.level === l && i.depth === depth;
	section('Breaking', level('breaking', 1));
	section('Affected', (i) => i.depth === 2);
	section('To check', level('check', 1));
	if (ev.report.mentions.length) {
		out.push('', '### Mentions of old names', '');
		for (const m of ev.report.mentions)
			out.push(
				`- ${itemLabel(before, m.entity)} \`${m.path.join('.')}\`: "${m.text}"${m.to ? ` → "${m.to}"` : ''}`
			);
	}
	section('Stopped', level('stopped', 1));
	section('Information', level('info', 1));
	if (errors.length) {
		out.push('', '### Errors after applying', '');
		for (const d of errors) out.push(`- ${formatDiagnostic(d)}`);
	}
	return out.join('\n') + '\n';
}
