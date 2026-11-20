# channel

A queue or topic messages travel on, as a source of events [triggers](trigger.md) listen to.
The app knows a channel by its role only: Service Bus, Kafka, a Dapr pub/sub or SQS stay in
`via` and `meta`. A unit's `send` step puts a message on it; a trigger listens to one of its
events.

```yaml
# pbc-platform/service-bus/sbq-ax-price.channel.yaml
id: k3hq8sz0pa
parent: sb4m1n2s0e          # module: Service Bus, the module that owns it
name: sbq-ax-price
type: queue                 # queue | topic; required
carries: c7mq0a9xke         # optional: the model its messages are
via: pbc-product-sbq-component
retries: 10                 # optional: deliveries before a message is dead-lettered
external: true              # optional: senders outside the design
```

- `type`: a **queue** gives each message to one receiver; a **topic** a copy to each
  subscription.
- Events, fixed per type: `received` (a message arrived) and `dead-lettered` (given up on after
  its retries). A topic raises both per subscription. Retries are not an event: a failed run
  goes back to the same trigger until they are spent. A system with its own retry queue models
  that queue as a channel of its own.
- `retries` is the default for every trigger on the channel; a trigger's own overrides it.
- Put it in the module that owns it: a broker module (`Service Bus`) when several systems use
  it, else the receiver.
- `when: { flag, is }`: the channel exists only while the flag has that value.
- `sdv new x.channel.yaml` writes `type: queue` to start from.

## Sending

A logic unit's `send: <channel>` step sends a message, without waiting; `with` says what it
passes, and it gets nothing back. The sender names the channel, never who receives, so a
topic's subscribers come and go without touching any sender.

## Validation

- Errors: no `type` (`channel-kind`); `type`, `carries` or `via` on another kind
  (`channel-only`); `carries` naming something that is not a model; a `send` naming anything
  but a channel (`logic-target`).
- Warnings: nothing in the design sends on it and it is not `external` (`channel-unsent`); no
  trigger listens to it (`channel-unheard`). Nothing handling `dead-lettered` is no warning:
  most queues have no such handler, so the card says so instead.

## Rendering

- A card of its own in its module, a pipe: 3 px corners where messages come in (left), round
  where they leave (right), a 1.5 px fuchsia line, QUEUE or TOPIC after its name, and under it
  what it carries and its retries.
- A row per event, its **port**: `received` and `dead-lettered` on a queue; on a topic a
  `received` row per subscription, and its `dead-lettered` while something listens to it. Each
  row names the triggers listening, or `none`, muted.
- Lines: a send from each sending unit to the card (solid), and an event line (dashed,
  fuchsia when lit) from each trigger row to the port it listens to, arrow at the port.
- Hover the card: its sends in and every event line out. Hover a trigger on it: the whole way
  a message comes lights, sender, channel, event, trigger and the unit it starts.
- Click a port: the channel's card (kind, carries, via, retries, gate, Sent by, and each event
  with the triggers on it and the units those start).
- In a sender's sequence a send goes to the channel's lifeline (solid, open arrowhead,
  nothing back), with what it starts noted beside the unit. Play offers to follow it into the
  unit the first receiving trigger starts, as Into does at a call.
- Search lists channels in their own group; a focus on one brings its senders and triggers.
- Impact: a change to the carried model reaches every sender and handler; dropping a channel
  breaks its sends and the triggers on it.
