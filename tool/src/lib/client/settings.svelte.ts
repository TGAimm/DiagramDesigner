import { DEFAULT_LAYOUT, type LayoutOptions } from '#lib/landscape/layout.ts';

const LAYOUT_KEY = 'sdv-layout';
const FOLLOW_KEY = 'sdv-follow-calls';
const MINIMAP_KEY = 'sdv-minimap';
const REST_SHARE_KEY = 'sdv-rest-share';

/** Lines at rest inside a box show once it covers this share of the view (see open.ts). */
export const DEFAULT_REST_SHARE = 0.25;

function storedRestShare(): number {
	try {
		const n = Number(localStorage.getItem(REST_SHARE_KEY) ?? NaN);
		return n >= 0 && n <= 1 ? n : DEFAULT_REST_SHARE;
	} catch {
		return DEFAULT_REST_SHARE;
	}
}

function storedFollow(): boolean {
	try {
		return localStorage.getItem(FOLLOW_KEY) === '1';
	} catch {
		return false;
	}
}

function storedMinimap(): boolean {
	try {
		return localStorage.getItem(MINIMAP_KEY) !== '0';
	} catch {
		return true;
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
	layout = $state<LayoutOptions>(
		typeof localStorage === 'undefined' ? { ...DEFAULT_LAYOUT } : storedLayout()
	);

	setLayout(change: Partial<LayoutOptions>) {
		this.layout = { ...this.layout, ...change };
		try {
			localStorage.setItem(LAYOUT_KEY, JSON.stringify(this.layout));
		} catch {
			// Storage can be unavailable (private mode); the choice then lasts for the session.
		}
	}

	resetLayout() {
		this.setLayout(DEFAULT_LAYOUT);
	}

	/** Playing a unit, Step forward at a call with steps inside goes into it (see play.ts). */
	followCalls = $state(typeof localStorage === 'undefined' ? false : storedFollow());

	setFollowCalls(on: boolean) {
		this.followCalls = on;
		try {
			localStorage.setItem(FOLLOW_KEY, on ? '1' : '0');
		} catch {
			// As for the layout: the choice then lasts for the session.
		}
	}

	/** The minimap shows in the canvas corner; on by default. */
	minimap = $state(typeof localStorage === 'undefined' ? true : storedMinimap());

	setMinimap(on: boolean) {
		this.minimap = on;
		try {
			localStorage.setItem(MINIMAP_KEY, on ? '1' : '0');
		} catch {
			// As for the layout: the choice then lasts for the session.
		}
	}

	/**
	 * Module Dependency Lines between top-level modules always show; those inside a module once
	 * it covers this share of the view, so zoomed out the landscape shows how its top-level
	 * modules depend on each other, not every module's wiring.
	 */
	restShare = $state(typeof localStorage === 'undefined' ? DEFAULT_REST_SHARE : storedRestShare());

	setRestShare(share: number) {
		this.restShare = share;
		try {
			localStorage.setItem(REST_SHARE_KEY, String(share));
		} catch {
			// As for the layout: the choice then lasts for the session.
		}
	}
}

export const settings = new SettingsState();
