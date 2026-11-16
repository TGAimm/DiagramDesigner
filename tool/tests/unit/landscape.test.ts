import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	closeLandscape,
	currentRoot,
	folderInfo,
	forgetRecent,
	listFolder,
	onLandscapeChange,
	openLandscape,
	readRecent,
	resetLandscapeState,
	scanEntityFiles
} from '../../src/lib/server/landscape';
import { FIXTURE_ROOT } from './helpers';

let home: string;
let work: string;
const saved = { SDV_HOME: process.env.SDV_HOME, SDV_ROOT: process.env.SDV_ROOT };

/** A folder under the scratch dir holding a copy of the fixture design. */
function landscape(name: string): string {
	const dir = path.join(work, name);
	cpSync(FIXTURE_ROOT, dir, { recursive: true });
	return dir;
}

beforeEach(() => {
	home = mkdtempSync(path.join(tmpdir(), 'sdv-home-'));
	work = mkdtempSync(path.join(tmpdir(), 'sdv-work-'));
	process.env.SDV_HOME = home;
	delete process.env.SDV_ROOT;
	resetLandscapeState();
});

afterEach(() => {
	resetLandscapeState();
	for (const [k, v] of Object.entries(saved)) {
		if (v === undefined) delete process.env[k];
		else process.env[k] = v;
	}
});

describe('the open landscape', () => {
	it('starts on SDV_ROOT over the last landscape opened', async () => {
		const a = landscape('a');
		const b = landscape('b');
		await openLandscape(a);
		resetLandscapeState();
		expect(await currentRoot({ env: { SDV_ROOT: b, SDV_HOME: home } })).toBe(b);
	});

	it('starts on the last landscape opened, unless told not to', async () => {
		const a = landscape('a');
		await openLandscape(a);
		resetLandscapeState();
		expect(await currentRoot()).toBe(a);
		resetLandscapeState();
		expect(await currentRoot({ recent: false })).not.toBe(a);
	});

	it('starts on none when the folder is gone', async () => {
		expect(await currentRoot({ env: { SDV_ROOT: path.join(work, 'missing') } })).toBeNull();
	});

	it('tells listeners when it opens and closes', async () => {
		const a = landscape('a');
		const b = landscape('b');
		await openLandscape(a);
		const seen: [string | null, string | null][] = [];
		onLandscapeChange((root, prev) => seen.push([root, prev]));
		await openLandscape(b);
		await openLandscape(b);
		await closeLandscape();
		expect(seen).toEqual([
			[b, a],
			[null, b]
		]);
		expect(await currentRoot()).toBeNull();
	});

	it('refuses what is not a folder', async () => {
		await expect(openLandscape(path.join(work, 'missing'))).rejects.toThrow('Not a folder');
	});
});

describe('recent landscapes', () => {
	it('keeps the last 10 opened, newest first, once each', async () => {
		const dirs = Array.from({ length: 12 }, (_, i) => landscape(`l${i}`));
		for (const d of dirs) await openLandscape(d);
		await openLandscape(dirs[5]);
		const recent = await readRecent();
		expect(recent).toHaveLength(10);
		expect(recent[0]).toBe(dirs[5]);
		expect(recent[1]).toBe(dirs[11]);
		expect(recent.filter((p) => p === dirs[5])).toHaveLength(1);
	});

	it('forgets a folder', async () => {
		const a = landscape('a');
		const b = landscape('b');
		await openLandscape(a);
		await openLandscape(b);
		await forgetRecent(a);
		expect(await readRecent()).toEqual([b]);
	});
});

describe('browsing folders', () => {
	it('marks folders holding entity files, skipping hidden and build folders', async () => {
		landscape('design');
		mkdirSync(path.join(work, 'empty'));
		mkdirSync(path.join(work, '.hidden'));
		mkdirSync(path.join(work, 'node_modules'));
		const listing = await listFolder(work);
		expect(listing.dirs.map((d) => d.name)).toEqual(['design', 'empty']);
		expect(listing.dirs[0].files).toBeGreaterThan(0);
		expect(listing.dirs[1].files).toBe(0);
		expect(listing.parent).toBe(path.dirname(work));
		expect(listing.crumbs.at(-1)!.path).toBe(work);
	});

	it('counts systems: module files without a parent', async () => {
		const dir = path.join(work, 'tiny');
		mkdirSync(path.join(dir, 'a'), { recursive: true });
		writeFileSync(path.join(dir, 'a/a.module.yaml'), 'id: aaaaaaaaaa\nname: A\n');
		writeFileSync(path.join(dir, 'a/b.module.yaml'), 'id: bbbbbbbbbb\nparent: aaaaaaaaaa\n');
		const info = await folderInfo(dir);
		expect(info).toMatchObject({ name: 'tiny', files: 2, systems: 1, partial: false });
	});

	it('stops a big walk early and says so', async () => {
		const dir = landscape('design');
		const { paths, partial } = await scanEntityFiles(dir, 3);
		expect(partial).toBe(true);
		expect(paths.length).toBeLessThanOrEqual(3);
	});
});
