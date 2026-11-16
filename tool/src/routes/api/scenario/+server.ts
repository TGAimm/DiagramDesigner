import { error, json } from '@sveltejs/kit';
import { requireRoot } from '#lib/server/context.ts';
import { deleteScenario, writeScenario } from '#lib/server/scenarios.ts';
import type { RequestHandler } from './$types';

/** Writes a scenario file: created, or a change appended or removed. */
export const PUT: RequestHandler = async ({ request }) => {
	const { path, text } = (await request.json()) as { path: string; text: string };
	const root = await requireRoot();
	try {
		await writeScenario(root, path, text);
	} catch (e) {
		error(400, (e as Error).message);
	}
	return json({ ok: true });
};

/** Discards a scenario: deletes its file. */
export const DELETE: RequestHandler = async ({ url }) => {
	const root = await requireRoot();
	try {
		await deleteScenario(root, url.searchParams.get('path') ?? '');
	} catch (e) {
		error(400, (e as Error).message);
	}
	return json({ ok: true });
};
