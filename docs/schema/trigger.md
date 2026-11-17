# trigger

What starts a [logic unit](logic-unit.md) when no request or call does. An [api](api.md) is a
unit's entry point for a request; a trigger is its entry point for everything else. Its source
key says which kind it is: **schedule** (it runs at set times) or **message** (it receives each
message on a queue or topic). A unit lists it in `handles`, as it lists an api.

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
# webshop/product-content-changed.trigger.yaml
id: z36jwku4qe
parent: wajh6e6nvm               # module: CatalogService, which receives it
name: productContentChanged
message: { topic: product-content, subscription: webshop, via: Service Bus }
retries: 5
with: sku and locale of the content saved

# webshop/refresh-product.logic-unit.yaml
handles: [z36jwku4qe]

# pim/save-content.logic-unit.yaml: a step that sends it
steps:
  - { call: z36jwku4qe, with: "sku, locale" }
```

- A trigger has exactly one source: `schedule` or `message`.
- `schedule` holds exactly one of `cron` (5 fields: minute hour day month weekday), `every`
  (a number and `s`, `m`, `h` or `d`: `15m`) and `at` (once, a local time:
  `2026-12-01T00:00`). `tz` is the IANA zone of `cron` and `at`; default UTC.
- `message` holds exactly one of `queue` and `topic`; `subscription` goes with `topic` only.
  `via` is free text: the broker or component it comes through (`pbc-product-sbq-component`,
  a Dapr pub/sub). The trigger sits in the module that receives the message.
- Sending: a unit's step `call: <message trigger>` sends that message, without waiting; it
  gets nothing back. A schedule can't be called.
- `overlap` (schedule only): a run due while the last one is still going is skipped (default),
  queued, or allowed to run alongside. `timeout` is a duration; `retries` a count. Unset means
  not stated.
- `when: { flag, is }`: the trigger exists only while the flag has that value (see [flag](flag.md)).
- `timeout`, `retries`, `with` and `when` are for both kinds.
- `sdv new x.trigger.yaml` writes `schedule: { every: 1h }` to start from.

## Validation

- Errors: neither or both of `schedule` and `message` (`trigger-source`); not exactly one of
  `cron`, `every` and `at`, a cron that is not 5 valid fields, a malformed `every` or `at`, an
  unknown `tz`, or `tz` with `every` (`trigger-schedule`); not exactly one of `queue` and
  `topic`, or `subscription` without `topic` (`trigger-message`); `overlap` on a message
  trigger (`trigger-overlap`); a malformed `timeout`; a `call` to a schedule trigger, or `gets`
  on a call to a message trigger (`trigger-call`); trigger keys on another kind.
- Warnings: a trigger no unit handles; a unit with required inputs handled by a trigger with
  no `with` (nothing can fill them).

## Rendering

- A module's triggers share one **Triggers** card, the first box inside it, above the Logic
  card: one row per trigger, its name and its source in words: a schedule (`At 03:00`, `Every
  15 minutes`, `Once, 1 Dec 2026 at 00:00`; cron in words comes from cronstrue, 24-hour clock)
  or a message (`Queue sbq-ax-stock`, `Topic orders › billing`).
- Not on the border: that is where a module meets its outside callers (apis). A trigger starts
  work from inside the system.
- Identity: 6 px corners, a 1.5 px violet line and a tinted name bar ruled off in it, which
  stays when the card is drawn as its frame. Lightning in the name bar; on each row a clock
  (schedule) or an envelope (message).
- Hover a row: its dotted **handles** line to each unit it starts, and the dotted **calls**
  line from each unit sending it (arrow at the trigger). Click it: the trigger card. A schedule
  shows its schedule in words and as written, the time zone, the next three runs (cron), and
  overlap; a message its kind, queue or topic, subscription and `via`, and **Sent by**. Both
  show timeout, retries, `with`, the gate, and **Handled by**.
- In a unit's sequence a trigger is listed under the caller with its source, followed by the
  units sending it (message), and its `with` is the first message when the unit takes no
  inputs. Play starts from its row.
- In a sender's sequence a send is an async message to the lifeline of the module receiving
  it: solid, an open arrowhead, nothing back. Play steps past it without stepping in.
