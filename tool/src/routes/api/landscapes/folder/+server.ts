import { error, json } from '@sveltejs/kit';
import { folderInfo } from '#lib/server/landscape.ts';
import type { RequestHandler } from './$types';

/** What a folder holds: entity files and systems. */
export const GET: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) error(400, 'path is required');
	try {
		return json(await folderInfo(path));
	} catch (e) {
		error(400, (e as Error).message);
	}
};
