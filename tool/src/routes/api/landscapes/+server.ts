import { json } from '@sveltejs/kit';
import { currentRoot, exampleLandscapes, recentLandscapes, ref } from '#lib/server/landscape.ts';
import type { RequestHandler } from './$types';

/** The open landscape, the recent ones and the examples that ship with the viewer. */
export const GET: RequestHandler = async () => {
	const root = await currentRoot();
	const [recent, examples] = await Promise.all([recentLandscapes(), exampleLandscapes()]);
	return json({ current: root ? ref(root) : null, recent, examples });
};
