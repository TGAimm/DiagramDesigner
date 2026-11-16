import { json } from '@sveltejs/kit';
import { building } from '$app/env';
import { clientConfig } from '#lib/config.ts';
import { serverConfig } from '#lib/server/context.ts';
import { readDesign } from '#lib/server/files.ts';
import { currentRoot, ref } from '#lib/server/landscape.ts';
import type { RequestHandler } from './$types';

// The static build snapshots the design into a JSON file.
export const prerender = true;

export const GET: RequestHandler = async () => {
	const config = await serverConfig();
	// The static build takes SDV_ROOT or the config's root, never the last landscape opened.
	const root = await currentRoot({ recent: !building });
	const files = root ? await readDesign(root) : [];
	// The snapshot carries the landscape's name only, not a path on the build machine.
	const landscape = root ? (building ? { name: ref(root).name } : ref(root)) : null;
	return json({ files, config: clientConfig(config), landscape });
};
