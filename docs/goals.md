# Goals

Open goals only. **Remove a goal once it is achieved**; keep this list lean.

## Change impact

- Select a field or model; highlight everything affected across the landscape by following
  `from`, `ref`, `model` and `models` edges in reverse.
- Lay out the union of before and after in Before and After modes too, so switching modes keeps
  every box in place.
- Scenario edits beyond model fields and models: api fields, params, logic units, moves.

## Flags

- Hover a key in the Flags menu to light where it is checked and what it gates; click its name
  for a flag inspector (definitions, checked by, gates, the splits validation found).
- Retire a flag as a scenario: drop its definitions, keep one branch of each flag step, drop
  what is gated to the other value (needs scenario edits of steps, apis and units).

## APIs

- API models use `from` for every field, so impact flows from database to API consumers.

## Authoring

- `sdv derive <model id>`: new model copying the source's fields, each with `from` set, so an
  unchanged copy costs nothing to write.
- In-app editor for small fixes: rename, reconnect a line, add/remove a field, change a type.

## Canvas

- Attach flow, sequence and class/ER diagrams to elements and connections; open on click/zoom.
- Link connections between systems to the data models they carry.
- Remember which boxes are open.

## References

- Cardinality at line ends from `required`/`nullable` (1 vs 0..1, crow's foot for `many`).
- Trace the whole `from` chain of a field, upstream and downstream, not just one hop.
- Keyboard navigation in the inspector: step between linked rows, Enter to follow.
