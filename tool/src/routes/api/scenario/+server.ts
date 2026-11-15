import { error, json } from '@sveltejs/kit';
import { serverConfig } from '#lib/server/context.ts';
import { deleteScenario, writeScenario } from '#lib/server/scenarios.ts';
import type { RequestHandler } from './$types';

/** Writes a scenario file: created, or a change appended or removed. */
export const PUT: RequestHandler = async ({ request }) => {
	const { path, text } = (await request.json()) as { path: string; text: string };
	try {
		await writeScenario((await serverConfig()).root, path, text);
	} catch (e) {
		error(400, (e as Error).message);
	}
	return json({ ok: true });
};

/** Discards a scenario: deletes its file. */
export const DELETE: RequestHandler = async ({ url }) => {
	try {
		await deleteScenario((await serverConfig()).root, url.searchParams.get('path') ?? '');
	} catch (e) {
		error(400, (e as Error).message);
	}
	return json({ ok: true });
};
