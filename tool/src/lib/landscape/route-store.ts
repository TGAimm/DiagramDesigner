import type { Routes, RouteStore } from './route-client.ts';

/**
 * Lines at rest kept in the browser, so opening a landscape again, or the page again, draws them
 * at once instead of routing them anew. Kept by a hash of their key (the lines and the boxes they
 * were routed among), the last few only.
 */

/** A 53-bit hash of `s`, as text (cyrb53). */
export function hash(s: string) {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < s.length; i++) {
		const c = s.charCodeAt(i);
		h1 = Math.imul(h1 ^ c, 2654435761);
		h2 = Math.imul(h2 ^ c, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** The storage it keeps to: localStorage in a page. */
type Storage = Pick<globalThis.Storage, 'getItem' | 'setItem' | 'removeItem'>;

const PREFIX = 'sdv-routes:';
const INDEX = 'sdv-routes';

/** Keeps the routes of the last `size` sets of lines at rest in `storage`. */
export function routeStore(storage: Storage, size = 8): RouteStore {
	const index = (): string[] => {
		try {
			const v = JSON.parse(storage.getItem(INDEX) ?? '[]');
			return Array.isArray(v) ? v : [];
		} catch {
			return [];
		}
	};
	/** Newest last; those past `size` dropped. */
	const touch = (h: string) => {
		const keep = [...index().filter((k) => k !== h), h];
		for (const k of keep.splice(0, Math.max(0, keep.length - size))) storage.removeItem(PREFIX + k);
		storage.setItem(INDEX, JSON.stringify(keep));
		return keep;
	};
	return {
		load(key) {
			const h = hash(key);
			const v = storage.getItem(PREFIX + h);
			if (!v) return undefined;
			touch(h);
			return new Map(JSON.parse(v)) as Routes;
		},
		save(key, routes) {
			const h = hash(key);
			const v = JSON.stringify([...routes]);
			const keep = touch(h);
			// Full: drop the oldest until it fits, or nothing else is left.
			for (;;)
				try {
					return storage.setItem(PREFIX + h, v);
				} catch (e) {
					const old = keep.shift();
					if (!old || old === h) throw e;
					storage.removeItem(PREFIX + old);
					storage.setItem(INDEX, JSON.stringify(keep));
				}
		}
	};
}
