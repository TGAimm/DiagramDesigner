import { error, json } from '@sveltejs/kit';
import { listFolder } from '#lib/server/landscape.ts';
import type { RequestHandler } from './$types';

/** A folder's subfolders with the entity files in each; no path: the drives (Windows) or `/`. */
export const GET: RequestHandler = async ({ url }) => {
	try {
		return json(await listFolder(url.searchParams.get('path')));
	} catch (e) {
		error(400, (e as Error).message);
	}
};
