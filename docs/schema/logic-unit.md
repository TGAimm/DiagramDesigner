# logic-unit

A unit of code inside a module: class, function, handler. Say what it takes and returns,
what invokes it, and the steps it takes, in order. What it reads, writes and calls comes from
the steps, so change impact can follow it without saying anything twice.

```yaml
id: mfj6c1l8c6
parent: lht4l7njny               # must be a module
name: addToCart
handles: [jibntgqh1p]            # apis whose requests start it
inputs:                          # required; [] for none
  - { id: kp8dv9ndf8, name: productId, type: uuid, required: true }
  - { id: axpx7vf6ma, name: quantity, type: int, required: true }
outputs:                         # required; [] for none
  - { id: n7b3iuewr4, name: line, model: a6ub2b7rpa }
fails:
  - { name: outOfStock, description: not enough stock }
steps:                           # the sequence, top to bottom
  - { call: tl04zzurg3, with: sessionId, gets: cart }
  - { call: fdqktz9kjr, with: productId, gets: available }
  - if: available < quantity
    then:
      - { fail: outOfStock }
    else:
      - { write: a6ub2b7rpa, note: "insert, or add to quantity" }
      - { return: line }
```

- `inputs` and `outputs` are fields with the keys of an api's own-shape field: `id`, `name`,
  `type` or `model`, `many`, `required`, `nullable`, `description`. Ids share the design's
  id namespace (`sdv id`).
- Step kinds, one per step: `call` (a unit or api, in any system), `read` and `write` (a
  model, or one field), `if` with `then`/`else`, `each` with `do`, `return` (an output's
  name), `fail` (a fail's name). A step with only `note` is work the unit does itself; on
  other steps `note` adds a remark. `with` and `gets` go on `call` and `read`; they, and
  conditions, are free text.
- Errors: a missing `inputs` or `outputs`; a step naming the wrong kind or nothing; a step
  with two kinds; a `return` or `fail` naming nothing declared. Warnings, when there are
  steps: an output never returned, a fail never raised.
- `steps` is optional: a unit without them is shown by its signature only.
- Only logic units have these keys.

## Rendering

- A module's units share one **Logic** card, the first box inside the module: one row per
  unit, its name and signature, `(productId, quantity) → Cart Line` (an output that is a
  model goes by the model's name). Nothing else: the rest is behind a click.
- Hover a row to draw what its steps read and write (arrow at the model), call (dotted, arrow
  at the callee) and the apis it handles (dotted, from the api's rail row), and light those
  rows (see [Connections](README.md#connections)).
- Click a row: the unit card opens beside it (over the canvas, centred, if there is no room)
  with typed inputs, outputs and fails, then the steps as a **sequence diagram**. Lifelines:
  the caller (apis it handles, units calling it), the unit, then each unit, api owner or model
  it touches, in first-use order; a model shows the store holding it. Calls are solid with
  their `gets` returned dashed; reads and writes go to the model; returns and fails go back to
  the caller; `if` and `each` draw alt and loop boxes. Click a name or message to go there.
- **Play** beside the card's Sequence heading walks the board one step at a time: the card
  closes, a player docks under the canvas, and each step moves the camera to both its ends
  (no further in than 100%, no further out than where their rows are drawn; else to the
  receiver) and draws it there as one labelled line. Nothing advances on its own: step
  forward or back, pick a branch at an `if` or `each` (the guard is written beside the row),
  step into a called unit with steps (or the unit handling a called api) and out again. The
  track has a mark per step on the chosen path; hover one for its message, click or drag to
  jump. Keys: ← →, 1 2 for branches, I / O, Home, Esc.
- A field's inspector lists **Read by logic** and **Written by logic**, including units that
  name its whole model. An api's card lists **Handled by** and **Called by**.
