import { error } from '@sveltejs/kit';
import type { ResolvedConfig } from '../config';
import { loadConfig } from './config';
import { currentRoot } from './landscape';

let config: Promise<ResolvedConfig> | undefined;

/** Config for the dev server, loaded once per process. */
export function serverConfig(): Promise<ResolvedConfig> {
	config ??= loadConfig();
	return config;
}

/** The open landscape's folder; answers 409 when none is open. */
export async function requireRoot(): Promise<string> {
	const root = await currentRoot();
	if (!root) error(409, 'No landscape is open');
	return root;
}
