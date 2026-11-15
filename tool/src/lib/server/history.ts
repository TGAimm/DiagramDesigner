import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { parseDocument } from 'yaml';
import { fileKind } from '../model/parse';
import type { SourceFile } from '../model/loader';
import { readDesign } from './files';

const run = promisify(execFile);

/** One commit touching the design, newest first; `working` stands for uncommitted changes. */
export interface HistoryEntry {
	rev: string;
	short: string;
	/** Seconds since the epoch; absent for uncommitted changes. */
	time?: number;
	subject: string;
	/** The scenario this commit applied: the one whose file it deleted. */
	scenario?: { name: string; description?: string };
}

const git = async (cwd: string, args: string[]) =>
	(await run('git', args, { cwd, maxBuffer: 64 * 1024 * 1024 })).stdout;

/** The repository holding the design root, and the root's path inside it. */
async function repoOf(root: string): Promise<{ top: string; rel: string } | undefined> {
	try {
		const top = (await git(root, ['rev-parse', '--show-toplevel'])).trim();
		return { top, rel: path.relative(top, root).split(path.sep).join('/') || '.' };
	} catch {
		return undefined;
	}
}

/** Commits touching the design root, newest first, after any uncommitted changes. */
export async function designHistory(
	root: string,
	limit = 100
): Promise<HistoryEntry[] | undefined> {
	const repo = await repoOf(root);
	if (!repo) return undefined;
	const out: HistoryEntry[] = [];
	const status = await git(repo.top, ['status', '--porcelain', '--', repo.rel]);
	if (status.trim()) out.push({ rev: 'working', short: '', subject: 'Uncommitted changes' });
	const log = await git(repo.top, [
		'log',
		`-n${limit}`,
		'--format=%x1e%H%x1f%h%x1f%ct%x1f%s',
		'--name-status',
		'--',
		repo.rel
	]);
	for (const record of log.split('\x1e').slice(1)) {
		const [head, ...lines] = record.split('\n');
		const [rev, short, time, subject] = head.split('\x1f');
		const entry: HistoryEntry = { rev, short, time: Number(time), subject };
		const gone = lines
			.map((l) => l.split('\t'))
			.find(([s, file]) => s === 'D' && file && fileKind(file) === 'scenario');
		if (gone) {
			try {
				const doc = parseDocument(await git(repo.top, ['show', `${rev}^:${gone[1]}`])).toJS();
				if (doc?.name) entry.scenario = { name: String(doc.name), description: doc.description };
			} catch {
				// A root commit has no parent; leave the scenario out.
			}
		}
		out.push(entry);
	}
	return out;
}

/** The design's entity files at a revision (`working`: as on disk now). */
export async function designAt(root: string, rev: string): Promise<SourceFile[]> {
	if (rev === 'working')
		return (await readDesign(root)).filter((f) => fileKind(f.path) === 'entity');
	const repo = await repoOf(root);
	if (!repo) throw new Error('The design is not in a git repository');
	if (!/^[0-9a-f]{4,40}(\^)?$|^HEAD$/.test(rev)) throw new Error(`Bad revision: ${rev}`);
	const prefix = repo.rel === '.' ? '' : `${repo.rel}/`;
	let names: string[];
	try {
		names = (await git(repo.top, ['ls-tree', '-r', '--name-only', rev, '--', repo.rel]))
			.split('\n')
			.filter((n) => n && fileKind(n) === 'entity');
	} catch {
		return []; // before the first commit
	}
	const texts = await catFiles(
		repo.top,
		names.map((n) => `${rev}:${n}`)
	);
	return names.map((n, i) => ({ path: n.slice(prefix.length), text: texts[i] }));
}

/** Reads many blobs through one `git cat-file --batch`. */
function catFiles(cwd: string, specs: string[]): Promise<string[]> {
	return new Promise((resolve, reject) => {
		const p = spawn('git', ['cat-file', '--batch'], { cwd });
		const chunks: Buffer[] = [];
		p.stdout.on('data', (c: Buffer) => chunks.push(c));
		p.on('error', reject);
		p.on('close', () => {
			const buf = Buffer.concat(chunks);
			const out: string[] = [];
			let at = 0;
			for (let i = 0; i < specs.length; i++) {
				const nl = buf.indexOf(10, at);
				const header = buf.subarray(at, nl).toString();
				const size = Number(header.split(' ')[2]);
				if (header.endsWith('missing') || Number.isNaN(size)) {
					out.push('');
					at = nl + 1;
					continue;
				}
				out.push(buf.subarray(nl + 1, nl + 1 + size).toString('utf8'));
				at = nl + 1 + size + 1;
			}
			resolve(out);
		});
		p.stdin.end(specs.join('\n') + '\n');
	});
}
