import { error, json } from '@sveltejs/kit';
import { closeLandscape, openLandscape } from '#lib/server/landscape.ts';
import type { RequestHandler } from './$types';

/** Opens a folder as the landscape. */
export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json().catch(() => ({}))) as { path?: unknown };
	if (typeof body.path !== 'string' || !body.path) error(400, 'path is required');
	try {
		return json({ current: await openLandscape(body.path) });
	} catch (e) {
		error(400, (e as Error).message);
	}
};

/** Closes the landscape. */
export const DELETE: RequestHandler = async () => {
	await closeLandscape();
	return json({ current: null });
};
