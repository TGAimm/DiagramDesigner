import type { Model } from '../model/model';
import { partLabel } from '../landscape/apis';
import { show } from './apply';
import type { Impact } from './impact';
import { isAdd, isDrop, isSet, type Change } from './scenario';

/** `ERP › Order`: the systems and modules round an element, outermost first. */
export function whereOf(model: Model, id: string): string {
	const names: string[] = [];
	for (let cur = model.elements.get(id)?.parentId; cur; cur = model.elements.get(cur)?.parentId)
		names.unshift(model.elements.get(cur)!.name);
	return names.join(' › ');
}

/** A short name for anything with an id, as the inspector and reports list it. */
export function itemLabel(model: Model, id: string): string {
	const el = model.elements.get(id);
	if (el?.def.kind === 'api') return `${el.def.method} ${el.def.path}`;
	if (el?.def.kind === 'logic-unit')
		return `${model.elements.get(el.parentId ?? '')?.name ?? ''} · ${el.name}`;
	if (el) return el.name;
	const f = model.fields.get(id);
	if (f) return `${model.elements.get(f.modelId)?.name}.${f.def.name}`;
	const af = model.apiFields.get(id);
	if (af) return `${itemLabel(model, af.apiId)} · ${partLabel(af.part)}.${af.def.name}`;
	for (const e of model.elements.values()) {
		const io = [...(e.def.inputs ?? []), ...(e.def.outputs ?? [])].find((x) => x.id === id);
		if (io) return `${e.name}(${io.name})`;
		const part = [...(e.def.params ?? []), ...(e.def.indexes ?? [])].find((x) => x.id === id);
		if (part) return `${e.name} · ${part.name}`;
	}
	return id;
}

/** What an impact names: an api body, a stored table, or the item itself. */
export function impactLabel(model: Model, i: Impact): string {
	if (i.table)
		return `${model.elements.get(i.element)?.name ?? ''} · ${model.elements.get(i.id)?.name ?? i.id}`;
	if (i.part !== undefined && model.elements.get(i.id)?.def.kind === 'api')
		return `${itemLabel(model, i.id)} · ${partLabel(i.part)}`;
	return itemLabel(model, i.id);
}

/** The id a change is about. */
export const changeTarget = (c: Change) => (isSet(c) ? c.set : isAdd(c) ? c.add : c.drop);

/** One line for a change, read against the design it applies to. */
export function changeLabel(before: Model, after: Model, c: Change): string {
	if (isSet(c)) {
		const name = itemLabel(before, c.set);
		if (c.key === 'name') return `${name} → ${show(c.to).replace(/^"|"$/g, '')}`;
		if (c.key) return `${name}: ${c.key} ${show(c.was)} → ${show(c.to)}`;
		return `${name}: ${c.path!.join('.')}`;
	}
	if (isAdd(c)) return c.field ? itemLabel(after, c.add) : `${c.file}`;
	if (isDrop(c)) return itemLabel(before, c.drop);
	return '';
}

/** The glyph a change shows: added, dropped, changed or moved. */
export function changeGlyph(c: Change): '+' | '−' | '~' | '↦' {
	if (isAdd(c)) return '+';
	if (isDrop(c)) return '−';
	return c.key === 'parent' || c.key === 'ownedBy' ? '↦' : '~';
}
