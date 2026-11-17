import { existsSync, promises as fs } from 'node:fs';
import path from 'node:path';
import { entityKind } from '../src/lib/model/parse';
import { generateId } from '../src/lib/model/ids';
import { ENTITY_KINDS } from '../src/lib/model/schema';
import type { CliIO } from './sdv';

export async function runNew(
	positionals: string[],
	parent: string | undefined,
	io: CliIO,
	cwd: string
): Promise<number> {
	const [file] = positionals;
	const kind = file && entityKind(file);
	if (!kind || !(ENTITY_KINDS as readonly string[]).includes(kind)) {
		io.error(`usage: sdv new <name>.<kind>.yaml [--parent id]; kind is ${ENTITY_KINDS.join(', ')}`);
		return 2;
	}
	const abs = path.resolve(cwd, file);
	if (existsSync(abs)) {
		io.error(`${file} already exists`);
		return 1;
	}
	const lines = [`id: ${generateId()}`];
	if (parent) lines.push(`${kind === 'model' ? 'ownedBy' : 'parent'}: ${parent}`);
	lines.push(`name: ${path.basename(file).split('.')[0]}`);
	if (kind === 'api') lines.push('method: GET', 'path: /');
	if (kind === 'trigger') lines.push('schedule: { every: 1h }');
	await fs.mkdir(path.dirname(abs), { recursive: true });
	await fs.writeFile(abs, lines.join('\n') + '\n');
	io.log(`created ${path.relative(cwd, abs)}`);
	return 0;
}

/** Prints fresh ids, one per line, for model fields. */
export function runId(positionals: string[], io: CliIO): number {
	const count = positionals.length ? Number(positionals[0]) : 1;
	if (!Number.isInteger(count) || count < 1) {
		io.error('usage: sdv id [count]');
		return 2;
	}
	for (let i = 0; i < count; i++) io.log(generateId());
	return 0;
}
