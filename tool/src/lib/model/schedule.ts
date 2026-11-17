import { CronExpressionParser } from 'cron-parser';
import cronstrue from 'cronstrue';
import type { Schedule } from './schema';

/**
 * A trigger's schedule: a 5-field cron, an interval (`every`) or a one-off time (`at`). Cron in
 * words comes from cronstrue and its next runs from cron-parser, so no wording is kept here.
 */

/** A duration: a whole number and a unit, `30s`, `15m`, `2h`, `1d`. */
const DURATION = /^([1-9]\d*)(s|m|h|d)$/;
/** A local date and time, read in the schedule's `tz`. */
const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::\d{2})?$/;
const UNITS = { s: 'second', m: 'minute', h: 'hour', d: 'day' } as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const isDuration = (s: string) => DURATION.test(s);

const validZone = (tz: string) => {
	try {
		new Intl.DateTimeFormat('en', { timeZone: tz });
		return true;
	} catch {
		return false;
	}
};

/** What is wrong with a schedule, each with the key it is on. */
export function scheduleProblems(s: Schedule): { key: string; message: string }[] {
	const out: { key: string; message: string }[] = [];
	const given = (['cron', 'every', 'at'] as const).filter((k) => s[k] !== undefined);
	if (given.length !== 1)
		out.push({
			key: given[1] ?? 'cron',
			message: `a schedule needs exactly one of cron, every and at${given.length ? `; this one has ${given.join(' and ')}` : ''}`
		});
	if (s.cron !== undefined) {
		const parts = s.cron.trim().split(/\s+/).length;
		if (parts !== 5)
			out.push({
				key: 'cron',
				message: `cron needs 5 fields (minute hour day month weekday); this one has ${parts}`
			});
		else
			try {
				CronExpressionParser.parse(s.cron);
			} catch (e) {
				out.push({ key: 'cron', message: `cron "${s.cron}": ${(e as Error).message}` });
			}
	}
	if (s.every !== undefined && !isDuration(s.every))
		out.push({ key: 'every', message: `every "${s.every}" is not a duration such as 15m or 2h` });
	if (s.at !== undefined && !LOCAL_TIME.test(s.at))
		out.push({ key: 'at', message: `at "${s.at}" is not a time such as 2026-12-01T00:00` });
	if (s.tz !== undefined && !validZone(s.tz))
		out.push({ key: 'tz', message: `tz "${s.tz}" is not a time zone such as Europe/Copenhagen` });
	if (s.tz !== undefined && s.every !== undefined)
		out.push({ key: 'tz', message: `tz goes with cron or at, not every` });
	return out;
}

const plural = (n: number, unit: string) => (n === 1 ? unit : `${n} ${unit}s`);

/** A duration in words: `15 minutes`, `hour`. */
export function durationWords(d: string): string {
	const m = DURATION.exec(d);
	return m ? plural(Number(m[1]), UNITS[m[2] as keyof typeof UNITS]) : d;
}

/** A schedule in words: `At 03:00`, `Every 15 minutes`, `Once, 1 Dec 2026 at 00:00`. */
export function scheduleWords(s: Schedule | undefined): string {
	if (!s) return '';
	if (s.cron !== undefined)
		try {
			return cronstrue.toString(s.cron, {
				use24HourTimeFormat: true,
				throwExceptionOnParseError: true
			});
		} catch {
			return s.cron;
		}
	if (s.every !== undefined) return `Every ${durationWords(s.every)}`;
	const m = s.at !== undefined ? LOCAL_TIME.exec(s.at) : null;
	if (m) return `Once, ${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]} at ${m[4]}:${m[5]}`;
	return s.at ?? '';
}

/** The next `n` runs of a cron schedule after `now`, as `18 Nov 03:00` in its time zone. */
export function nextRuns(s: Schedule, n: number, now = new Date()): string[] {
	if (s.cron === undefined) return [];
	const tz = s.tz ?? 'UTC';
	const fmt = new Intl.DateTimeFormat('en-GB', {
		timeZone: tz,
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
		hourCycle: 'h23'
	});
	try {
		return CronExpressionParser.parse(s.cron, { tz, currentDate: now })
			.take(n)
			.map((d) => fmt.format(d.toDate()).replace(',', ''));
	} catch {
		return [];
	}
}
