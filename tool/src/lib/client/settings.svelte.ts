/**
 * How much of the canvas is drawn. `adaptive` opens boxes and rails as their contents become
 * readable and folds long cards; `all` draws everything open and unfolded at every zoom.
 */
export type Detail = 'adaptive' | 'all';

const KEY = 'sdv-detail';

function stored(): Detail {
	try {
		return localStorage.getItem(KEY) === 'all' ? 'all' : 'adaptive';
	} catch {
		return 'adaptive';
	}
}

/** Per-browser viewer settings, kept in localStorage like the theme. */
class SettingsState {
	detail = $state<Detail>(typeof localStorage === 'undefined' ? 'adaptive' : stored());

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
