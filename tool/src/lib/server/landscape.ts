import { existsSync, promises as fs, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileKind } from '../model/parse';
import { loadConfig } from './config';

/**
 * The open landscape: the folder of entity files the dev server serves. It is held per process
 * and changed at runtime (open, close), so the model, history and scenario routes and the file
 * watcher all follow it. Recent landscapes are kept per user in `~/.sdv/recent.json`
 * (`SDV_HOME` overrides the folder).
 */

export interface LandscapeRef {
	/** Absolute folder path. */
	path: string;
	/** The folder's name. */
	name: string;
}

export interface LandscapeEntry extends LandscapeRef {
	exists: boolean;
	/** Entity files found; a lower bound when `partial`. */
	files: number;
	partial: boolean;
}

export interface FolderEntry extends LandscapeRef {
	files: number;
	partial: boolean;
}

export interface FolderListing {
	/** The folder listed; null for the machine's drives (Windows). */
	path: string | null;
	/** One folder up; null is the drives (Windows). Absent at the top. */
	parent?: string | null;
	/** From the top down; the first has a null path on Windows ("This PC"). */
	crumbs: { name: string; path: string | null }[];
	dirs: FolderEntry[];
	/** Entity files in the folder itself, as for `dirs`. */
	files: number;
	partial: boolean;
}

export interface FolderInfo {
	path: string;
	name: string;
	files: number;
	/** Root modules: module files without a parent. */
	systems: number;
	partial: boolean;
}

type Listener = (root: string | null, previous: string | null) => void;

interface State {
	/** undefined until first asked for. */
	root: string | null | undefined;
	init?: Promise<string | null>;
	listeners: Set<Listener>;
}

// The dev server loads this module twice (the routes through Vite, the watcher plugin through
// tsx), so the state lives on globalThis to be shared by both.
const KEY = Symbol.for('sdv.landscape');
const state: State = ((globalThis as Record<symbol, State>)[KEY] ??= {
	root: undefined,
	listeners: new Set()
});

const RECENT_MAX = 10;
const SCAN_SKIP = new Set(['node_modules', 'bin', 'obj', 'dist', 'build', 'target']);
const isWindows = process.platform === 'win32';

/** The examples that ship with the viewer: `<repo>/examples`. */
export const EXAMPLES_DIR = fileURLToPath(new URL('../../../../examples', import.meta.url));

export function sameDir(a: string, b: string): boolean {
	const na = path.resolve(a);
	const nb = path.resolve(b);
	return isWindows ? na.toLowerCase() === nb.toLowerCase() : na === nb;
}

function isDir(p: string): boolean {
	try {
		return statSync(p).isDirectory();
	} catch {
		return false;
	}
}

export function ref(p: string): LandscapeRef {
	const abs = path.resolve(p);
	return { path: abs, name: path.basename(abs) || abs };
}

// --- the open landscape ---------------------------------------------------------------------

export interface CurrentOptions {
	/** Consider the last landscape opened (off for the static build, which must be reproducible). */
	recent?: boolean;
	env?: Record<string, string | undefined>;
}

/**
 * The open landscape's folder, or null when none is. Decided on first call: `SDV_ROOT` if set,
 * else the last landscape opened, else the config's root; a folder that is gone means none.
 */
export function currentRoot(opts: CurrentOptions = {}): Promise<string | null> {
	if (state.root !== undefined) return Promise.resolve(state.root);
	state.init ??= (async () => {
		const env = opts.env ?? process.env;
		const config = await loadConfig({ env });
		let root: string | null = config.root;
		if (!env.SDV_ROOT && opts.recent !== false) {
			const last = (await readRecent()).find(isDir);
			if (last) root = last;
		}
		if (root && !isDir(root)) root = null;
		state.root ??= root;
		return state.root;
	})();
	return state.init;
}

/** Opens a folder as the landscape; remembered as the most recent one. */
export async function openLandscape(dir: string): Promise<LandscapeRef> {
	const abs = path.resolve(dir);
	if (!isDir(abs)) throw new Error(`Not a folder: ${abs}`);
	const previous = await currentRoot();
	state.root = abs;
	await remember(abs);
	if (!previous || !sameDir(previous, abs)) emit(abs, previous);
	return ref(abs);
}

/** Closes the landscape; the app shows its start screen. */
export async function closeLandscape(): Promise<void> {
	const previous = await currentRoot();
	state.root = null;
	if (previous) emit(null, previous);
}

/** Called with the new root (null: closed) whenever the landscape changes. */
export function onLandscapeChange(listener: Listener): () => void {
	state.listeners.add(listener);
	return () => state.listeners.delete(listener);
}

function emit(root: string | null, previous: string | null) {
	for (const l of state.listeners) l(root, previous);
}

/** Test hook: forget the open landscape and listeners. */
export function resetLandscapeState(): void {
	state.root = undefined;
	state.init = undefined;
	state.listeners.clear();
}

// --- recent landscapes ----------------------------------------------------------------------

function recentFile(env = process.env): string {
	return path.join(env.SDV_HOME ?? path.join(os.homedir(), '.sdv'), 'recent.json');
}

export async function readRecent(): Promise<string[]> {
	try {
		const body = JSON.parse(await fs.readFile(recentFile(), 'utf8')) as { landscapes?: unknown };
		return Array.isArray(body.landscapes)
			? body.landscapes.filter((p): p is string => typeof p === 'string')
			: [];
	} catch {
		return [];
	}
}

async function writeRecent(list: string[]): Promise<void> {
	const file = recentFile();
	await fs.mkdir(path.dirname(file), { recursive: true });
	await fs.writeFile(file, JSON.stringify({ landscapes: list }, null, 2) + '\n', 'utf8');
}

async function remember(abs: string): Promise<void> {
	const list = (await readRecent()).filter((p) => !sameDir(p, abs));
	await writeRecent([abs, ...list].slice(0, RECENT_MAX));
}

export async function forgetRecent(dir: string): Promise<void> {
	await writeRecent((await readRecent()).filter((p) => !sameDir(p, dir)));
}

/** Recent landscapes, newest first, with what is in them now. */
export async function recentLandscapes(): Promise<LandscapeEntry[]> {
	return Promise.all(
		(await readRecent()).map(async (p) => {
			const exists = isDir(p);
			const scan = exists ? await countEntityFiles(p) : { files: 0, partial: false };
			return { ...ref(p), exists, ...scan };
		})
	);
}

/** The examples that ship with the viewer that hold entity files. */
export async function exampleLandscapes(): Promise<LandscapeEntry[]> {
	let names: string[];
	try {
		names = (await fs.readdir(EXAMPLES_DIR, { withFileTypes: true }))
			.filter((e) => e.isDirectory() && !e.name.startsWith('.'))
			.map((e) => e.name)
			.sort();
	} catch {
		return [];
	}
	const all = await Promise.all(
		names.map(async (n) => {
			const p = path.join(EXAMPLES_DIR, n);
			return { ...ref(p), exists: true, ...(await countEntityFiles(p)) };
		})
	);
	return all.filter((e) => e.files > 0);
}

// --- browsing folders -----------------------------------------------------------------------

/**
 * Entity files under a folder, skipping hidden and build folders. The walk stops after
 * `budget` directory entries, so a huge tree answers quickly with a lower bound.
 */
export async function scanEntityFiles(
	dir: string,
	budget = 4000
): Promise<{ paths: string[]; partial: boolean }> {
	const paths: string[] = [];
	let left = budget;
	const queue = [dir];
	while (queue.length) {
		const d = queue.shift()!;
		let entries;
		try {
			entries = await fs.readdir(d, { withFileTypes: true });
		} catch {
			continue;
		}
		for (const e of entries) {
			if (left-- <= 0) return { paths, partial: true };
			if (e.name.startsWith('.') || SCAN_SKIP.has(e.name)) continue;
			const abs = path.join(d, e.name);
			if (e.isDirectory()) queue.push(abs);
			else if (fileKind(e.name) === 'entity') paths.push(abs);
		}
	}
	return { paths, partial: false };
}

async function countEntityFiles(dir: string): Promise<{ files: number; partial: boolean }> {
	const { paths, partial } = await scanEntityFiles(dir);
	return { files: paths.length, partial };
}

function windowsDrives(): string[] {
	const out: string[] = [];
	for (let c = 65; c <= 90; c++) {
		const d = `${String.fromCharCode(c)}:\\`;
		if (existsSync(d)) out.push(d);
	}
	return out;
}

function crumbsOf(abs: string): { name: string; path: string | null }[] {
	const chain: string[] = [];
	for (let p = abs; ; p = path.dirname(p)) {
		chain.unshift(p);
		if (path.dirname(p) === p) break;
	}
	const crumbs = chain.map((p) => ({
		name: path.basename(p) || p.replace(/[\\/]+$/, '') || p,
		path: p as string | null
	}));
	return isWindows ? [{ name: 'This PC', path: null }, ...crumbs] : crumbs;
}

/** A folder's subfolders, each with the entity files in it; no path lists the drives (Windows) or `/`. */
export async function listFolder(dir?: string | null): Promise<FolderListing> {
	if (!dir) {
		if (isWindows) {
			const dirs = windowsDrives().map((d) => ({
				path: d,
				name: d.slice(0, 2),
				files: 0,
				partial: false
			}));
			return {
				path: null,
				crumbs: [{ name: 'This PC', path: null }],
				dirs,
				files: 0,
				partial: false
			};
		}
		dir = '/';
	}
	const abs = path.resolve(dir);
	if (!isDir(abs)) throw new Error(`Not a folder: ${abs}`);
	const entries = await fs.readdir(abs, { withFileTypes: true }).catch(() => []);
	const names = entries
		.filter((e) => e.isDirectory() && !e.name.startsWith('.') && !SCAN_SKIP.has(e.name))
		.map((e) => e.name)
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
	const dirs = await Promise.all(
		names.map(async (name) => {
			const p = path.join(abs, name);
			return { path: p, name, ...(await countEntityFiles(p)) };
		})
	);
	const up = path.dirname(abs);
	const own = await countEntityFiles(abs);
	const listing: FolderListing = { path: abs, crumbs: crumbsOf(abs), dirs, ...own };
	if (up !== abs) listing.parent = up;
	else if (isWindows) listing.parent = null;
	return listing;
}

/** What a folder holds, for the open dialog's detail line. */
export async function folderInfo(dir: string): Promise<FolderInfo> {
	const abs = path.resolve(dir);
	if (!isDir(abs)) throw new Error(`Not a folder: ${abs}`);
	const { paths, partial } = await scanEntityFiles(abs, 50000);
	let systems = 0;
	await Promise.all(
		paths
			.filter((p) => p.endsWith('.module.yaml'))
			.map(async (p) => {
				const text = await fs.readFile(p, 'utf8').catch(() => '');
				if (!/^parent:/m.test(text)) systems++;
			})
	);
	return { ...ref(abs), files: paths.length, systems, partial };
}
