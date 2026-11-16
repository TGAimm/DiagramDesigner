# Entity files

One entity per file: `<name>.<kind>.yaml`. Kinds: [module](module.md),
[model](model.md), [logic-unit](logic-unit.md), [api](api.md), [flag](flag.md). Pending changes over the design
live in [scenario](scenario.md) files. A module with no parent is a
root, drawn as a system; one folder per root, and everything in it lives under it.

## Common keys

```yaml
id: k3x9q0abcd     # required; generated, never edited; unique across all entities and fields
parent: <id>       # every kind except model (ownedBy); optional on modules (none = root)
name: Order        # display name; defaults to the file name
tags: [internal]
links: [{ label: Docs, url: https://... }]
meta: { owner: team-a }   # string values only
```

Unknown keys are errors. References are always ids, never names.

## CLI (from repo root)

- `npm run sdv -- new path/name.kind.yaml --parent <id>`: create with fresh id.
- `npm run sdv -- id 5`: 5 fresh ids (for model fields).
- `npm run sdv -- validate --root <dir>`: schema + reference checks, and stale scenario changes.
- `npm run sdv -- impact <file.scenario.yaml>`: what a scenario changes and breaks, as markdown.
- JSON Schema: `tool/schema/entity.schema.json` (regenerate: `npm --prefix tool run schema`).
- Source of truth: `tool/src/lib/model/schema.ts` (shape), `model.ts` (cross-file rules).

## Connections

Every link between two fields, models, logic units, apis or api fields is one connection,
drawn by one standard (`tool/src/lib/landscape/connections.ts`):

- **Direction:** the arrow points at what the start depends on: a `ref` at its key, `from` at
  its source, a unit's reads and writes at the model, a call at the callee, an api at the unit
  handling it and at the models its bodies use. A held model (`model`) has a UML diamond at
  the holder. So change impact follows arrows backwards.
- **Style:** solid for structure (ref, holds, reads, writes, bodies), dashed for lineage,
  dotted for calls and handles. Grey at rest, the kind's colour when lit; widths stay the
  same on screen at any zoom.
- **At rest:** each end is lifted to the child of the box both ends share, and connections
  landing on one pair, one way, merge into one line between the two boxes' name bars (1, 2–9,
  10+: thicker; hover for the count). So a line never crosses a border. Connections inside
  one card, or between a box and its own contents, have none.
- **Hover** a row, rail api, card name bar or box's name: its connections light up, one hop
  each way, to the far row. A box shows those leaving it; a card also lineage between its own
  rows, round its right side. **Click** pins them (a row or api opens its inspector, which lists the same
  connections); Esc unpins. An end off screen gets a wedge on the canvas edge; click it to go
  there.
- The **key** lists each kind; click one to hide it everywhere.
