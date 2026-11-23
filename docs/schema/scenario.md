# scenario

Pending changes over the design: `<name>.scenario.yaml`, kept in `scenarios/` under the design
root. Not an entity: the canvas shows the design with the scenario applied, and what that
breaks. Applying it writes the entity files and deletes the scenario file; commit both together.

```yaml
name: Tidy the cart
description: Shorter names before the app rewrite.
changes:
  - { set: dj8m2h65tb, key: name, was: quantity, to: qty }
  - { set: mh42gsuvpe, key: nullable, was: true }                 # no `to`: removes the key
  - { add: k2v8sd0q1e, in: a6ub2b7rpa, after: dj8m2h65tb, field: { name: giftNote, type: string } }
  - { drop: owts056ek0 }
  - { set: mfj6c1l8c6, path: [steps, 2, else, 0, note], was: "insert, or add to quantity", to: "insert, or add to qty" }
```

## Changes

Applied in order. Each names its target by id: an entity, a model field, an api's own-shape
field, a logic unit's input or output, an api param or a model index (give those an `id`).

| change | keys |
| --- | --- |
| `set` | `set` id; `key` on it, or `path` inside it (for items without ids, like steps); `was` its value before (absent: the key was absent); `to` its new value (absent: remove the key) |
| `add` | a field: `add` new id, `in` model id, optional `after` field id, `field` its keys. An entity: `add` new id, `file` path, `entity` its keys |
| `drop` | `drop` id: a field or item is removed from its list; an entity's file is deleted |

- A rename is a `set` of `name`; a move is a `set` of `parent` or `ownedBy` (or a field's
  model, by drop and add). Ids are never set.
- A `set` whose `was` no longer matches, or whose target is gone, is **stale**: skipped and
  reported, never forced. `sdv validate` warns about stale changes.
- New ids come from `sdv id` when the change is written, so later changes can name them.

## Impact

`sdv impact <file>` (and the canvas) compare the design before and after by id. What a change
breaks depends on how each user finds the item and which way data flows through it:

| user of a model field | finds it by | rename | drop | type, nullability |
| --- | --- | --- | --- | --- |
| `from`, `ref`, indexes, api `to`/`from`, `omit`/`pick`, logic `read`/`write` | id | stopped | breaking | follows the edge |
| api body that is the model (or holds it) | wire name | breaking | breaking, unless omitted | by direction |
| api own-shape field | its own name | stopped | breaking | by direction |
| stored table (`storedIn`) | column name | breaking (migration) | breaking (data loss) | check existing rows |
| free text (`with`, `gets`, conditions, `derived`, `note`) | text | check the mention | check the mention | can't verify |

- Direction: a request takes data in, so asking more (required, not nullable) breaks; a
  response hands data out, so promising less (nullable, optional) breaks.
- Callers of a broken api are **affected**, with the same severity. A caller whose steps no
  longer call it afterwards (re-pointed elsewhere) is not.
- Mentions of an old name in nearby free text are listed with a rewrite to the new name.
- `external: true` on a module or api: it has consumers the design doesn't show;
  impacts behind it say "plus unmodelled consumers".

## Focus on a change

A flag key, a scenario or one change of a scenario can be focused: the canvas keeps what the
change reaches, up to where it breaks or settles. Each item reached gets one outcome:

| outcome | when | the chain |
| --- | --- | --- |
| changed | it is added, dropped or changed; it runs in one state only; its steps differ; a field is written in one state only | goes on |
| breaking, check | it calls something the state leaves out, reads a field nothing writes there (check when nullable), returns one, or the impact rules judge it so | stops: fixing the break usually fixes what lies past it |
| stopped | it runs either way, its fields are written either way, or it takes a model whole and names no field of it | stops |

- Runs: an api nothing calls, a unit nothing handles or calls, a trigger on a schedule or on a
  channel or table nothing in the design feeds is started from outside and runs whenever it is
  there. Anything else runs when something running starts it.
- Written: a field is written by what runs in its model's own system (units writing it or its
  model, that system's apis taking it in with `to` or a request that is the model), or copied
  with `from` from a written field. An api of another system mapping into it is judged as a
  reader: it only claims the value gets there.
- A unit taking a model whole: stopped, unless its step text names the field (check).
- Contracts (a rename, a retype, an api gone) are judged by the rules above; each stops.
- A changed unit is drawn with its way in: the apis and triggers starting it, and the units
  calling it, up to the first api or trigger, when nothing else starts it.
- **Direct** keeps what is changed and what that touches; **All** keeps the whole front. A flag
  key's front is that of flipping every definition, other flags as set. A scenario's cut is laid
  out with both states in, so Before · Diff · After move no box.
- Focus from the Changes panel: **Focus** at its top for the whole scenario, the crosshair on a
  change row for that change alone. The panel, or the flag's pane, lists where it ends.
