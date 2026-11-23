# flag

A feature flag, defined in the module whose code checks it. The code acts on it in
two ways: a **flag step** in a [logic unit](logic-unit.md) picks a branch of its sequence, and
a **gate** (`when`) makes an [api](api.md), logic unit, [trigger](trigger.md) or [channel](channel.md) exist only in one state. Calls between
systems come from steps, so flipping a flag moves lines too.

```yaml
# webshop/new-order-flow.flag.yaml
id: d9vbifruws
parent: xmv85uqqsk        # module defining it
name: newOrderFlow
key: new-order-flow       # required: the name the code asks the flag service for
default: off              # what production runs: on | off; default off
```

- On and off only. `key` pairs definitions: one flag in the flag service, checked by two
  systems, is two flag files with the same `key`, one under each.
- `family` (optional) names keys that are one flag per something, such as one per
  country: `family: UseNewBilling.<country>` on each of `UseNewBilling.DK`,
  `UseNewBilling.SE` and so on. The Flags menu groups them under it.
- `meta.description`, when given, is shown under the key in the Flags menu (its first
  sentence) and in full in the flag's pane; other `meta` entries are listed there as facts.
- A flag step or gate may only name a flag defined in its own module, or one round it, as
  the code can only check flags its system defines.

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

- Errors: a flag without `key`; `key`, `default` or `family` on another kind; `when` on anything but an
  api, logic unit, trigger or channel; a flag step or `when` naming something that isn't a flag, or a flag
  defined outside its module; a flag step with neither `on` nor `off`.
- Warnings: a flag nothing checks; one key on by default in one place and off in another
  (production is split); each way of setting one key's definitions, away from their
  defaults, that breaks something (`flag-split`). With one definition, that is a flip a
  caller in another system doesn't follow: a missing definition.

## Rendering

- Flags are never boxes. The topbar's **Flags** menu lists one row per key: its name, the
  key when it differs, the systems checking it and its description's first sentence. Its
  switch sets every definition; a split shows it half-set and tagged. Keys of one `family`
  are grouped under it. What the state breaks is listed at the bottom, and Reset to
  production sets every flag back. Clicking a row focuses on the key.
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
- A key can be focused (its row in the Flags menu, or its hit in search). The canvas keeps
  what depends on it: the units with a flag step on it (picked), what either branch calls,
  reads, writes or sends (the branch taken now lit as their ends), what is gated on it, and
  what calls or handles a gated item. Chain goes on both ways: up from the units checking it
  and what is gated, through what uses them (who gets the new behaviour), and down from what
  the branches switch to, through what they use (where each branch leads). The cut is laid out
  with both states in, so flipping the key with the focus bar's Off · On (production marked),
  or switching Before · Diff · After, moves no box. Lines at rest only the other state draws
  are drawn too, dashed and toned down. Entering or leaving the focus leaves the flag state
  alone.
- Beside the canvas, the flag's pane: its description and facts, where each definition lives
  with its own Off · On (how a split is made) and the splits validation found, every flag step
  on it with what each branch does (also those that only note work, which no line shows), what
  is gated on it, and the other keys of its family.
