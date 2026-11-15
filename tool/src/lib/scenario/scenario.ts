import { z } from 'zod';
import { Document, isMap, isSeq, parseDocument, type YAMLMap } from 'yaml';
import { Id, Text } from '../model/schema';
import type { DataPath, Diagnostic } from '../model/diagnostics';
import { locate, type ParsedFile } from '../model/parse';
import { toDiagnostic, zodIssues } from '../model/validate-file';

/**
 * A scenario is a file of pending changes over the design: `<name>.scenario.yaml`. Changes
 * name their target by id, so they survive edits elsewhere; `was` on a `set` says what the
 * change expects to find, so a target changed underneath is reported as stale, never
 * overwritten.
 */

const Path = z.array(z.union([z.string(), z.number().int().min(0)]));

export const SetChange = z
	.strictObject({
		set: Id.describe('Id of the entity, field, param or index changed'),
		key: z.string().optional().describe('The key set on it'),
		path: Path.optional().describe('Instead of key: a path inside it, for items without ids'),
		was: z.unknown().optional().describe('Its value before; absent: the key was absent'),
		to: z.unknown().optional().describe('Its new value; absent: the key is removed')
	})
	.describe('Set (or remove) one key');

export const AddChange = z
	.strictObject({
		add: Id.describe('Id of the new field or entity'),
		in: Id.optional().describe('Field: id of the model it is added to'),
		after: Id.optional().describe('Field: id of the field it follows; default last'),
		field: z.record(z.string(), z.unknown()).optional().describe('Field: its keys, without id'),
		file: z.string().optional().describe('Entity: design-relative path of its new file'),
		entity: z.record(z.string(), z.unknown()).optional().describe('Entity: its keys, without id')
	})
	.describe('Add a field to a model, or a new entity file');

export const DropChange = z.strictObject({ drop: Id.describe('Id of what is removed') });

export const Change = z.union([SetChange, AddChange, DropChange]);
export type SetChange = z.infer<typeof SetChange>;
export type AddChange = z.infer<typeof AddChange>;
export type DropChange = z.infer<typeof DropChange>;
export type Change = z.infer<typeof Change>;

export const ScenarioFile = z
	.strictObject({
		name: Text,
		description: Text.optional(),
		changes: z.array(Change).optional()
	})
	.describe('Scenario: pending changes over the design (<name>.scenario.yaml)');
export type ScenarioFile = z.infer<typeof ScenarioFile>;

export interface Scenario {
	path: string;
	name: string;
	description?: string;
	changes: Change[];
	diagnostics: Diagnostic[];
}

export const isSet = (c: Change): c is SetChange => 'set' in c;
export const isAdd = (c: Change): c is AddChange => 'add' in c;
export const isDrop = (c: Change): c is DropChange => 'drop' in c;

/** Reads a parsed scenario file; invalid changes are dropped and reported. */
export function readScenario(parsed: ParsedFile): Scenario {
	const where = (p: DataPath, key?: string) => locate(parsed.doc, parsed.lines, p, key);
	const base = parsed.path.slice(parsed.path.lastIndexOf('/') + 1).split('.')[0];
	const diagnostics = [...parsed.diagnostics];
	const res = ScenarioFile.safeParse(parsed.data ?? {});
	if (!res.success) {
		for (const issue of zodIssues(res.error))
			diagnostics.push(toDiagnostic(parsed.path, issue, where));
		return { path: parsed.path, name: base, changes: [], diagnostics };
	}
	const changes: Change[] = [];
	res.data.changes?.forEach((c, i) => {
		const problem = isSet(c)
			? !c.key === !c.path && 'a set needs exactly one of key and path'
			: isAdd(c)
				? !(c.in && c.field) === !(c.file && c.entity) &&
					'an add needs in and field (a field), or file and entity (an entity)'
				: false;
		if (problem)
			diagnostics.push({
				severity: 'error',
				code: 'scenario',
				message: problem,
				file: parsed.path,
				...where(['changes', i]),
				path: ['changes', i]
			});
		else changes.push(c);
	});
	return {
		path: parsed.path,
		name: res.data.name,
		description: res.data.description,
		changes,
		diagnostics
	};
}

/** Text of a new scenario file. */
export function newScenarioText(name: string, description?: string): string {
	const doc = new Document({ name, ...(description ? { description } : {}), changes: [] });
	return stringify(doc);
}

/** Appends a change to a scenario file's text, keeping the rest of the file as written. */
export function appendChange(text: string, change: Change): string {
	const doc = parseOrNew(text);
	let seq = doc.get('changes', true);
	if (!isSeq(seq) || seq.flow) {
		const items = isSeq(seq) ? seq.toJSON() : [];
		seq = doc.createNode(items);
		doc.set('changes', seq);
	}
	if (!isSeq(seq)) throw new Error('changes is not a list');
	const node = doc.createNode(change) as YAMLMap;
	node.flow = true;
	seq.items.push(node);
	return stringify(doc);
}

/** Removes the change at `index` (default: the last one). */
export function removeChange(text: string, index?: number): string {
	const doc = parseOrNew(text);
	const seq = doc.get('changes', true);
	if (!isSeq(seq) || !seq.items.length) return text;
	seq.items.splice(index ?? seq.items.length - 1, 1);
	return stringify(doc);
}

/** Sets name or description of a scenario file. */
export function describeScenario(text: string, name: string, description?: string): string {
	const doc = parseOrNew(text);
	doc.set('name', name);
	if (description) doc.set('description', description);
	else doc.delete('description');
	return stringify(doc);
}

function parseOrNew(text: string): Document {
	const doc = parseDocument(text);
	return isMap(doc.contents) ? doc : new Document({ name: 'Scenario', changes: [] });
}

/**
 * Serializes a YAML document in the design's style: one line per flow collection, padded
 * flow maps (`{ a: 1 }`) and unpadded flow sequences (`[a, b]`).
 */
export function stringify(doc: Document): string {
	const text = doc.toString({ lineWidth: 0 });
	let out = '';
	let quote: string | null = null;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (quote) {
			out += c;
			if (c === quote && text[i - 1] !== '\\') quote = null;
		} else if (c === '"' || c === "'") {
			quote = c;
			out += c;
		} else if (c === '[' && text[i + 1] === ' ') {
			out += c;
			i++;
		} else if (!(c === ' ' && text[i + 1] === ']')) out += c;
	}
	return out;
}
