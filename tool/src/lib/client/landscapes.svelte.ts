import type { FolderInfo, FolderListing, LandscapeEntry, LandscapeRef } from '../server/landscape';

export interface LandscapesResponse {
	current: LandscapeRef | null;
	recent: LandscapeEntry[];
	examples: LandscapeEntry[];
}

async function call<T>(url: string, init?: RequestInit): Promise<T> {
	const res = await fetch(url, init);
	if (!res.ok) {
		let message = `${init?.method ?? 'GET'} ${url} failed: ${res.status}`;
		try {
			message = ((await res.json()) as { message?: string }).message ?? message;
		} catch {
			/* not JSON */
		}
		throw new Error(message);
	}
	return res.json() as Promise<T>;
}

/**
 * Opening, switching and closing landscapes. The dev server holds the open one; after a
 * switch the page reloads, so every view starts afresh on the new design (flags at
 * production, no focus). Other tabs reload on the server's `sdv:landscape` event.
 */
export class Landscapes {
	/** The server can switch landscapes (not in the static build). */
	available = $state(false);
	recent = $state.raw<LandscapeEntry[]>([]);
	examples = $state.raw<LandscapeEntry[]>([]);
	menuOpen = $state(false);
	dialogOpen = $state(false);
	error = $state<string | null>(null);
	#switching = false;

	async refresh(): Promise<void> {
		try {
			const body = await call<LandscapesResponse>('/api/landscapes');
			this.recent = body.recent;
			this.examples = body.examples;
			this.available = true;
		} catch {
			this.available = false;
		}
	}

	async open(path: string): Promise<void> {
		this.error = null;
		try {
			await call('/api/landscapes/current', {
				method: 'PUT',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ path })
			});
			this.#reload();
		} catch (e) {
			this.error = (e as Error).message;
			throw e;
		}
	}

	async close(): Promise<void> {
		await call('/api/landscapes/current', { method: 'DELETE' });
		this.#reload();
	}

	async forget(path: string): Promise<void> {
		await call(`/api/landscapes/recent?path=${encodeURIComponent(path)}`, { method: 'DELETE' });
		await this.refresh();
	}

	folders(path: string | null): Promise<FolderListing> {
		const q = path ? `?path=${encodeURIComponent(path)}` : '';
		return call<FolderListing>(`/api/landscapes/folders${q}`);
	}

	folder(path: string): Promise<FolderInfo> {
		return call<FolderInfo>(`/api/landscapes/folder?path=${encodeURIComponent(path)}`);
	}

	/** Another tab (or this one) switched the landscape on the server. */
	onServerSwitch(): void {
		this.#reload();
	}

	#reload() {
		if (this.#switching) return;
		this.#switching = true;
		location.reload();
	}
}

export const landscapes = new Landscapes();
