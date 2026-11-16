import { error, json } from '@sveltejs/kit';
import { requireRoot } from '#lib/server/context.ts';
import { designAt } from '#lib/server/history.ts';
import type { RequestHandler } from './$types';

/** The design's files at a commit and at its parent (uncommitted changes: now and HEAD). */
export const GET: RequestHandler = async ({ params }) => {
	const root = await requireRoot();
	try {
		const [before, after] = await Promise.all([
			designAt(root, params.rev === 'working' ? 'HEAD' : `${params.rev}^`),
			designAt(root, params.rev)
		]);
		return json({ before, after });
	} catch (e) {
		error(400, (e as Error).message);
	}
};
