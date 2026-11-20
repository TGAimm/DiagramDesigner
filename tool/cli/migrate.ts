import { promises as fs } from 'node:fs';
import path from 'node:path';
import { isMap, isScalar, isSeq, parseDocument, type Document, type Node } from 'yaml';
import { generateId } from '../src/lib/model/ids';
import { entityKind } from '../src/lib/model/parse';
import { readDesign } from '../src/lib/server/files';
import type { CliIO } from './sdv';

/** A trigger with an old `message:` source, and the file it is in. */
interface Old {
	file: string;
	id: string;
	name: string;
	parent?: string;
	kind: 'queue' | 'topic';
	channel: string;
	subscription?: string;
	via?: string;
	/** Where `message: …` is written, start to end, in the file's text. */
	range: [number, number];
}

/** A replacement in a file's text: `[start, end)` becomes `text`. */
type Splice = [number, number, string];

const slug = (s: string) =>
	s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '') || 'channel';

/** A YAML scalar, quoted only when it has to be. */
const plain = (s: string) =>
	/^[A-Za-z0-9][\w .()/-]*$/.test(s) && !/: | #/.test(s) ? s : JSON.stringify(s);

const apply = (text: string, splices: Splice[]) =>
	[...splices]
		.sort((a, b) => b[0] - a[0])
		.reduce((t, [s, e, r]) => t.slice(0, s) + r + t.slice(e), text);

/** Every map in a steps list, nested ones too (then, else, do, on, off). */
function stepMaps(node: unknown, visit: (m: Node) => void) {
	if (isSeq(node)) for (const n of node.items) stepMaps(n, visit);
	else if (isMap(node)) {
		visit(node);
		for (const p of node.items) stepMaps(p.value, visit);
	}
}

/**
 * `sdv migrate triggers`: turns every trigger's old `message:` source into a channel and `on`.
 * Each distinct queue or topic becomes one channel file (its `type`, `via`, and `external: true`
 * when nothing in the design sends it), in the module of the triggers on it, or the nearest
 * module round them all. Each `message:` becomes `on: { channel, event: received }` (with its
 * subscription on a topic, when it is not the trigger's name), and each step calling a migrated
 * trigger sends on its channel instead. Only those keys are rewritten; the rest of each file,
 * comments and all, stays as it is.
 */
export async function runMigrate(
	positionals: string[],
	root: string,
	io: CliIO,
	dryRun = false
): Promise<number> {
	if (positionals[0] !== 'triggers') {
		io.error('usage: sdv migrate triggers [--dry-run]');
		return 2;
	}
	const texts = new Map<string, string>();
	const docs = new Map<string, Document>();
	for (const f of await readDesign(root))
		if (entityKind(f.path)) {
			texts.set(f.path, f.text);
			docs.set(f.path, parseDocument(f.text));
		}
	const dataOf = (file: string) => docs.get(file)?.toJS() as Record<string, unknown> | undefined;

	// Modules: their parents, and where their files are, to place a channel.
	const modules = new Map<string, { parent?: string; file: string }>();
	for (const [file] of docs) {
		const d = dataOf(file);
		if (entityKind(file) === 'module' && typeof d?.id === 'string')
			modules.set(d.id, { parent: d.parent as string | undefined, file });
	}
	const chain = (id: string | undefined) => {
		const out: string[] = [];
		for (let m = id; m && !out.includes(m); m = modules.get(m)?.parent) out.push(m);
		return out;
	};

	const olds: Old[] = [];
	for (const [file, doc] of docs) {
		if (entityKind(file) !== 'trigger' || !isMap(doc.contents)) continue;
		const d = dataOf(file);
		const m = d?.message as Record<string, unknown> | undefined;
		const pair = doc.contents.items.find((p) => isScalar(p.key) && p.key.value === 'message');
		const start = (pair?.key as Node | undefined)?.range?.[0];
		const end = (pair?.value as Node | undefined)?.range?.[1];
		if (!d || !m || (m.queue === undefined) === (m.topic === undefined)) continue;
		if (start === undefined || end === undefined) continue;
		olds.push({
			file,
			id: String(d.id),
			name: String(d.name ?? path.basename(file).split('.')[0]),
			parent: d.parent as string | undefined,
			kind: m.queue !== undefined ? 'queue' : 'topic',
			channel: String(m.queue ?? m.topic),
			subscription: m.subscription !== undefined ? String(m.subscription) : undefined,
			via: m.via !== undefined ? String(m.via) : undefined,
			range: [start, end]
		});
	}
	if (!olds.length) {
		io.log('No trigger has a message source; nothing to migrate.');
		return 0;
	}

	const byTrigger = new Set(olds.map((o) => o.id));
	const groups = new Map<string, Old[]>();
	for (const o of olds) {
		const key = `${o.kind}:${o.channel}`;
		groups.set(key, [...(groups.get(key) ?? []), o]);
	}
	// Each step calling a migrated trigger: where its `call` key and value are written.
	const calls: { file: string; trigger: string; key: [number, number]; value: [number, number] }[] =
		[];
	for (const [file, doc] of docs) {
		if (entityKind(file) !== 'logic-unit' || !isMap(doc.contents)) continue;
		stepMaps(doc.contents.get('steps', true), (m) => {
			if (!isMap(m)) return;
			const call = m.items.find((p) => isScalar(p.key) && p.key.value === 'call');
			if (!call || !isScalar(call.value) || !isScalar(call.key)) return;
			const id = String(call.value.value);
			if (byTrigger.has(id) && call.key.range && call.value.range)
				calls.push({
					file,
					trigger: id,
					key: [call.key.range[0], call.key.range[1]],
					value: [call.value.range[0], call.value.range[1]]
				});
		});
	}
	const sent = new Set(calls.map((c) => c.trigger));

	const written: string[] = [];
	const write = async (file: string, text: string) => {
		written.push(file);
		if (dryRun) return;
		const abs = path.join(root, file);
		await fs.mkdir(path.dirname(abs), { recursive: true });
		await fs.writeFile(abs, text);
	};
	const splices = new Map<string, Splice[]>();
	const splice = (file: string, s: Splice) => splices.set(file, [...(splices.get(file) ?? []), s]);

	const channelOf = new Map<string, string>();
	for (const [, group] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
		const first = group[0];
		const id = generateId();
		for (const o of group) channelOf.set(o.id, id);
		// The module round every trigger on it: theirs when they share one.
		const chains = group.map((o) => chain(o.parent));
		const parent = chains[0].find((m) => chains.every((c) => c.includes(m)));
		const mod = parent ? modules.get(parent) : undefined;
		// Beside the files of what is in that module, else beside the first trigger.
		const inside = mod?.file.replace(/\.module\.yaml$/, '');
		const folder =
			inside && [...docs.keys()].some((f) => f.startsWith(`${inside}/`))
				? inside
				: path.posix.dirname(first.file);
		let file = `${folder}/${slug(first.channel)}.channel.yaml`;
		for (let n = 2; docs.has(file) || written.includes(file); n++)
			file = `${folder}/${slug(first.channel)}-${n}.channel.yaml`;
		const via = group.find((o) => o.via)?.via;
		const lines = [
			`id: ${id}`,
			...(parent ? [`parent: ${parent}`] : []),
			`name: ${plain(first.channel)}`,
			`type: ${first.kind}`,
			...(via ? [`via: ${plain(via)}`] : []),
			...(group.some((o) => sent.has(o.id)) ? [] : ['external: true'])
		];
		await write(file, lines.join('\n') + '\n');
		for (const o of group) {
			const sub =
				o.kind === 'topic' && o.subscription !== undefined && o.subscription !== o.name
					? `, subscription: ${plain(o.subscription)}`
					: '';
			splice(o.file, [...o.range, `on: { channel: ${id}${sub}, event: received }`]);
		}
	}
	for (const c of calls) {
		splice(c.file, [...c.key, 'send']);
		splice(c.file, [...c.value, channelOf.get(c.trigger)!]);
	}
	for (const [file, s] of splices) await write(file, apply(texts.get(file)!, s));
	io.log(
		`${dryRun ? 'Would migrate' : 'Migrated'} ${olds.length} trigger(s) onto ${groups.size} channel(s); ${written.length} file(s) ${dryRun ? 'to write' : 'written'}.`
	);
	return 0;
}
