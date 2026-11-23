/** Whether the search box is open; the topbar and ⌘K / Ctrl+K open it, the canvas draws it. */
export const search = $state({ open: false });

/** A flag key the Flags menu asks the canvas to focus on; the canvas takes it and clears it. */
export const flagAsk = $state<{ key: string | null }>({ key: null });

/** A focus the Changes panel asks of the canvas: the shown scenario (`all`) or one change of it,
 *  by index; the canvas takes it and clears it. */
export const scenarioAsk = $state<{ change: number | 'all' | null }>({ change: null });

/** Something a pane beside the canvas asks it to go to, by id; the canvas takes it and clears it. */
export const goAsk = $state<{ id: string | null }>({ id: null });
