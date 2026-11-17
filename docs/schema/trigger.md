# trigger

What starts a [logic unit](logic-unit.md) when no request or call does. An [api](api.md) is a
unit's entry point for a request; a trigger is its entry point for everything else. Its one
kind so far is **schedule**. A unit lists it in `handles`, as it lists an api.

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

- `schedule` holds exactly one of `cron` (5 fields: minute hour day month weekday), `every`
  (a number and `s`, `m`, `h` or `d`: `15m`) and `at` (once, a local time:
  `2026-12-01T00:00`). `tz` is the IANA zone of `cron` and `at`; default UTC.
- `overlap`: a run due while the last one is still going is skipped (default), queued, or
  allowed to run alongside. `timeout` is a duration; `retries` a count. Unset means not stated.
- `when: { flag, is }`: the trigger exists only while the flag has that value (see [flag](flag.md)).
- The source key says what starts it. A later kind of trigger gets its own key beside
  `schedule`; `overlap`, `timeout`, `retries`, `with` and `when` are for every kind.
- `sdv new x.trigger.yaml` writes `schedule: { every: 1h }` to start from.

## Validation

- Errors: no `schedule`; not exactly one of `cron`, `every` and `at`; a cron that is not 5
  valid fields; a malformed `every`, `at` or `timeout`; an unknown `tz`, or `tz` with `every`;
  trigger keys on another kind.
- Warnings: a trigger no unit handles; a unit with required inputs handled by a trigger with
  no `with` (nothing can fill them).

## Rendering

- A module's triggers share one **Triggers** card, the first box inside it, above the Logic
  card: one row per trigger, its name and its schedule in words (`At 03:00`, `Every 15
  minutes`, `Once, 1 Dec 2026 at 00:00`). Cron in words comes from cronstrue, 24-hour clock.
- Not on the border: that is where a module meets its outside callers (apis). A trigger starts
  work from inside the system.
- Identity: 6 px corners, a 1.5 px violet line and a tinted name bar ruled off in it, which
  stays when the card is drawn as its frame. Lightning in the name bar, a clock on each row.
- Hover a row: its dotted **handles** line to each unit it starts. Click it: the trigger card
  with its schedule in words and as written, the time zone, the next three runs (cron),
  overlap, timeout, retries, `with`, its gate, and **Handled by**.
- In a unit's sequence a trigger is listed under the caller with its schedule, and its `with`
  is the first message when the unit takes no inputs. Play starts from its row.
