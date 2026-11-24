# trigger

What starts a [logic unit](logic-unit.md) when no request or call does. An [api](api.md) is a
unit's entry point for a request; a trigger is its entry point for everything else. It has
exactly one source: a **schedule** (it runs at set times), **on**, one event of one source it
listens to: a [channel](channel.md) (a queue or topic) or a stored [model](model.md) (a table
or a file), or **by**, someone or something outside the design's code. A unit lists it in
`handles`, as it lists an api.

```yaml
# webshop/purge-old-carts.trigger.yaml
id: ko6tg89ikq
parent: lht4l7njny               # module: CartService
name: purgeOldCarts
schedule: { cron: '0 3 * * *', tz: Europe/Copenhagen }   # the source
overlap: skip                    # skip | queue | allow; default skip
timeout: 10m
retries: 3
with: carts older than 30 days   # free text: what a run passes the unit

# webshop/purge-carts.logic-unit.yaml
handles: [ko6tg89ikq]
```

```yaml
# product-pbc/price/triggers/receive-ax-price-event.trigger.yaml
id: syyt704d8o
parent: lyuj1q0her               # module: Price, which receives it
name: ReceiveAxPriceEvent
on: { channel: k3hq8sz0pa, event: received }
with: ServiceBusMessage

# more of on
on: { channel: k3hq8sz0pa, event: dead-lettered }                # failed for good
on: { channel: t0p1cad0ed, subscription: ProductGroupEntityListener,
      event: received, filter: entity type Item }                # one subscription of a topic
on: { model: ziygb1l2gb, event: updated, fields: [rtdhe3ps8e] }  # a row's Amount changed
on: { model: u2jjx8u76s, event: created, path: "ax-data/*.json" } # a file landed
```

```yaml
# by: who starts it, when no schedule or event in the design does; exactly one key
by: { user: clicks Add to cart }                    # a person, in a page or an app
by: { framework: Vue mounts the app }               # the runtime the code runs in
by: { outside: Azure Function timer in another repo } # code or a system the design does not show
with: the product shown and the quantity picked
```

A `by` trigger makes a page handler, a component the framework builds, or a callback from
outside a live entry point, so it is not dead code (see [logic-unit](logic-unit.md#dead-code)).

## Sources and their events

| Source | Events | Raised by |
| --- | --- | --- |
| schedule | runs on its schedule | time |
| channel, a queue | `received`, `dead-lettered` | a unit's `send`, or senders outside |
| channel, a topic | `received`, `dead-lettered`, per subscription | a unit's `send` |
| stored model, a table | `created`, `updated` (optionally of `fields`), `deleted` | a unit's `write`, or writers outside |
| stored model, a file | `created`, `updated`, `deleted` (optionally under a `path`) | a unit's `write` |

The words are the app's; a product's own (INSERT, BlobCreated, EntityAdded) go in `filter`,
the channel's `via` or `meta`. A model is a file when the module it is stored in says
`store: files` (see [module](module.md)).

- `schedule` holds exactly one of `cron` (5 fields: minute hour day month weekday), `every`
  (a number and `s`, `m`, `h` or `d`: `15m`) and `at` (once, a local time:
  `2026-12-01T00:00`). `tz` is the IANA zone of `cron` and `at`; default UTC.
- `on` holds exactly one of `channel` and `model`, and an `event` from that source's list.
  `subscription`: topics only; default the trigger's name. `fields`: a table's `updated`
  only; a change to any of them raises it. `path`: files only, a glob. `filter`: free text,
  any source. A `model` must be stored (it has `storedIn`): a class raises nothing.
- The trigger sits in the module that receives.
- A unit's `write` raises the stored model's events by itself; `does: create | update |
  delete` (or a list) on the write says which, and without it a write may raise any of them.
- `overlap` (schedule only): a run due while the last one is still going is skipped (default),
  queued, or allowed to run alongside. `timeout` is a duration; `retries` a count (on a channel
  trigger, the channel's unless set here). Unset means not stated.
- `when: { flag, is }`: the trigger exists only while the flag has that value (see [flag](flag.md)).
- `timeout`, `retries`, `with` and `when` are for every source.
- `sdv new x.trigger.yaml` writes `schedule: { every: 1h }` to start from.

### Before channels: `message`

`message: { queue | topic, subscription, via }` named a queue or topic in words, and a step
`call: <trigger>` sent it. It still loads, with a warning (`trigger-message-legacy`), and its
row reads `Queue erp-stock`. `sdv migrate triggers` turns each distinct queue or topic into a
channel (with its `via`, and `external: true` when nothing in the design sends it), each
`message:` into `on: { channel, event: received }` and each such `call` into a `send`, keeping
the rest of every file as it is.

## Validation

- Errors: not exactly one of `schedule`, `on`, `by` and `message` (`trigger-source`);
  `by` without exactly one of `user`, `framework` and `outside` (`trigger-by`); not exactly
  one of `cron`, `every` and `at`, a cron that is not 5 valid fields, a malformed `every` or
  `at`, an unknown `tz`, or `tz` with `every` (`trigger-schedule`); `on` without exactly one of
  `channel` and `model`, naming the wrong kind or an unstored model, `subscription` off a topic,
  `fields` off a table's `updated`, `path` off a file (`trigger-on`); an event the source does
  not raise (`trigger-event`); `overlap` without a schedule (`trigger-overlap`); a malformed
  `timeout`; a `call` to a schedule or to a trigger on a channel or model (`trigger-call`,
  `step-send`); trigger keys on another kind.
- Warnings: a trigger no unit handles; a unit with required inputs handled by a trigger with
  no `with` (nothing can fill them); a trigger still on `message`.

## Rendering

- A module's triggers share one **Triggers** card, the first box inside it, above the Logic
  card: one row per trigger, its glyph (a clock for a schedule, its event's for `on`: inbox,
  ban, plus, pencil, trash), its name, and its source in words: a schedule (`At 03:00`, `Every
  15 minutes`; cron in words comes from cronstrue, 24-hour clock) or its event
  (`sbq-ax-price · received`, `EntityAdded › Product grouping · received`,
  `Price · updated (Amount)`).
- Not on the border: that is where a module meets its outside callers (apis). A trigger starts
  work from inside the system.
- Identity: 6 px corners, a 1.5 px violet line and a tinted name bar ruled off in it.
- Lines: the dotted **handles** line to each unit it starts; for `on`, the dashed **event**
  line to the channel's port, or the stored model or field, arrow at that source. Hovering a
  trigger on a channel lights the senders' sends into the channel too.
- Click a row: the trigger card. A schedule shows its schedule in words and as written, the
  time zone, the next three runs, and overlap; `on` shows the event, the source's kind, what it
  carries, path and filter, **Listens to** (the channel or model), **Sent by** (a channel's
  senders) or **Written by** (a model's writers), and **On failure** (the retries, then
  dead-lettered, and whatever handles that). All show timeout, `with`, the gate and **Handled
  by**.
- In a unit's sequence a trigger is listed under the caller with its source, followed by the
  units sending it, and its `with` is the first message when the unit takes no inputs. Play
  starts from its row. A write raising events notes what it starts (`may start` without
  `does`).
