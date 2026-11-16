import { error, json } from '@sveltejs/kit';
import { forgetRecent } from '#lib/server/landscape.ts';
import type { RequestHandler } from './$types';

/** Removes a folder from the recent landscapes. */
export const DELETE: RequestHandler = async ({ url }) => {
	const path = url.searchParams.get('path');
	if (!path) error(400, 'path is required');
	await forgetRecent(path);
	return json({ ok: true });
};
