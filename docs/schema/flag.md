# flag

A feature flag, defined in the system or module whose code checks it. The code acts on it in
two ways: a **flag step** in a [logic unit](logic-unit.md) picks a branch of its sequence, and
a **gate** (`when`) makes an [api](api.md) or logic unit exist only in one state. Calls between
systems come from steps, so flipping a flag moves lines too.

```yaml
# webshop/new-order-flow.flag.yaml
id: d9vbifruws
parent: xmv85uqqsk        # system or module defining it
name: newOrderFlow
key: new-order-flow       # required: the name the code asks the flag service for
default: off              # what production runs: on | off; default off
```

- On and off only. `key` pairs definitions: one flag in the flag service, checked by two
  systems, is two flag files with the same `key`, one under each.
- A flag step or gate may only name a flag defined in its own system or module, or one round
  it, as the code can only check flags its system defines.

```yaml
# a logic unit's steps
- flag: d9vbifruws
  on:
    - { call: e1tqkr5p8m, with: "cart lines", gets: order }
  off:
    - { call: a2uivekzaq, with: "cart lines, note", gets: order }

# an api or logic unit
when: { flag: xtql9q1573, is: on }   # exists only while the flag is on
```

## States

A flag state is a design: every flag on or off, each flag step replaced by the branch it
takes, each api or unit whose `when` doesn't hold left out. It is built and validated like
any other design and compared with the defaults (production) by the change-impact engine.

What a state breaks, besides the usual [impact](scenario.md#impact):

| finding | when |
| --- | --- |
| breaking | a unit calls an api or unit the state leaves out |
| breaking | an api is there but every unit handling it is left out |
| check | a unit reads a model nothing writes in the state, though something does in production |

## Validation

- Errors: a flag without `key`; `key` or `default` on another kind; `when` on anything but an
  api or logic unit; a flag step or `when` naming something that isn't a flag, or a flag
  defined outside its system or module; a flag step with neither `on` nor `off`.
- Warnings: a flag nothing checks; one key on by default in one place and off in another
  (production is split); each way of setting one key's definitions, away from their
  defaults, that breaks something (`flag-split`). With one definition, that is a flip a
  caller in another system doesn't follow: a missing definition.

## Rendering

- Flags are never boxes. The topbar's **Flags** menu lists one row per key: its switch sets
  every definition; opened, each definition is set alone (a split). A split is tagged, what
  the state breaks is listed under the keys, and Reset to production sets every flag back.
- At rest the canvas shows every flag at its default. With any flag set away from it, the
  topbar shows Before (production) · Diff · After and the summary line, as for scenarios:
  gated items gained `+`, lost struck, and what breaks with a severity bar.
- Layout runs on the whole design, every branch and gated item in, and only what the state
  holds is drawn. Setting a flag never moves a box; a gated-off rail or Logic row keeps its
  room.
- In a unit card a flag step is a `flag` box with its guard (`[newOrderFlow on]`). Both
  branches are drawn; the one the state doesn't take is dimmed. Play takes the branch the
  state picks without asking.
- A scenario or commit is compared in the flag state set now.
