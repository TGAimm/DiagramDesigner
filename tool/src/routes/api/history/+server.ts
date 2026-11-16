import { error, json } from '@sveltejs/kit';
import { requireRoot } from '#lib/server/context.ts';
import { designHistory } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

/** Commits touching the design, newest first. */
export const GET: RequestHandler = async () => {
	const entries = await designHistory(await requireRoot());
	if (!entries) error(404, 'The design is not in a git repository');
	return json({ entries });
};
