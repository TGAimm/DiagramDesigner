/**
 * How much of the canvas is drawn. `adaptive` opens boxes and rails as their contents become
 * readable and folds long cards; `all` draws everything open and unfolded at every zoom.
 */
export type Detail = 'adaptive' | 'all';

import { DEFAULT_LAYOUT, type LayoutOptions } from '#lib/landscape/layout.ts';

const KEY = 'sdv-detail';
const LAYOUT_KEY = 'sdv-layout';

function stored(): Detail {
	try {
		return localStorage.getItem(KEY) === 'all' ? 'all' : 'adaptive';
	} catch {
		return 'adaptive';
	}
}

function storedLayout(): LayoutOptions {
	try {
		return { ...DEFAULT_LAYOUT, ...JSON.parse(localStorage.getItem(LAYOUT_KEY) ?? '{}') };
	} catch {
		return { ...DEFAULT_LAYOUT };
	}
}

/** Per-browser viewer settings, kept in localStorage like the theme. */
class SettingsState {
	detail = $state<Detail>(typeof localStorage === 'undefined' ? 'adaptive' : stored());

	layout = $state<LayoutOptions>(
		typeof localStorage === 'undefined' ? { ...DEFAULT_LAYOUT } : storedLayout()
	);

	setLayout(change: Partial<LayoutOptions>) {
		this.layout = { ...this.layout, ...change };
		try {
			localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout));
		} catch {
			// As for the detail: the choice then lasts for the session.
		}
	}

	resetLayout() {
		this.setLayout(DEFAULT_LAYOUT);
	}

	setDetail(detail: Detail) {
		this.detail = detail;
		try {
			localStorage.setItem(KEY, detail);
		} catch {
			// Storage can be unavailable (private mode); the choice then lasts for the session.
		}
	}
}

export const settings = new SettingsState();
