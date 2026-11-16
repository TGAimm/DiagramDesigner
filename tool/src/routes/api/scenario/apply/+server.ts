import { error, json } from '@sveltejs/kit';
import { requireRoot } from '#lib/server/context.ts';
import { applyScenario } from '#lib/server/scenarios.ts';
import type { RequestHandler } from './$types';

/** Writes a scenario's changes into the design and deletes the scenario file. */
export const POST: RequestHandler = async ({ request }) => {
	const { path } = (await request.json()) as { path: string };
	const root = await requireRoot();
	try {
		return json(await applyScenario(root, path));
	} catch (e) {
		error(409, (e as Error).message);
	}
};
