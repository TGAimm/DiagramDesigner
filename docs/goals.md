# Goals

Open goals only. **Remove a goal once it is achieved**; keep this list lean.

## Change impact

- Select a field or model; highlight everything affected across the landscape by following
  `from`, `ref`, `model` and `models` edges in reverse.
- Lay out the union of before and after in Before and After modes too, so switching modes keeps
  every box in place.
- Scenario edits beyond model fields and models: api fields, params, logic units, moves.

## Flags

- Hover a key in the Flags menu to light where it is checked and what it gates.
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

## Modelling gaps

Things real landscapes have that the schema cannot express yet, found by modelling
`examples/retail` (15 systems). Each is marked there with a `# GAP:` comment (about 500);
`grep -rn "# GAP" examples/retail` finds the concrete cases. The workarounds in use are in
`examples/retail/README.md`.

Interfaces and triggers:

- Async messaging: channels, their senders and the triggers on their events are drawn now
  (see [channel](schema/channel.md)); still missing are batch receive, sessions and ordering,
  and subscription filters beyond free text.
- Move `examples/retail`'s faked `POST /topics/...` apis to channels and `send` steps.
- Interfaces beyond HTTP: GraphQL operations, SQL endpoints, file exchange (CSV over SFTP:
  one row per line grouped into orders, error and archive files, folders owned by another
  system), hardware (card terminals, fiscal signing units).
- Move `examples/retail`'s scheduled units from `meta: { schedule }` to trigger entities,
  give its page, till and handheld handlers `by` triggers, and mark the vendor apis other
  systems call `external`; its `unreached` warnings name each unit and api left.
- Endpoints outside the landscape (carrier APIs) with no system to point at.
- Browser redirects that carry results in the Location query (OAuth `code`, `state`).
- Batch requests (`$batch`, multipart) holding other api calls; async work after the
  response (task ids); a call target held in data (retry re-send).
- Transaction boundaries: steps that commit or roll back together (ERP posting).
- A unit returning several outputs together.

Shapes:

- Embedded objects stored in a JSON column of their holder (a held model is always its own
  table today); free-form properties (`metadata`, attribute values).
- Polymorphic references (`{typeId, id}`, `regardingobjectid`, `source` ch_/re_/po_).
- Shared enums (`values` is per field), and state machines with allowed transitions.
- Envelopes: list/paging (`{data, has_more}`, OData `value`/`nextLink`), batch envelopes;
  response projection (`$select`, `$expand`); partial bodies (any subset of a model).
- Nested inline objects without a model of their own are written as dotted field names,
  not as a structure.
- Table inheritance; one table holding several document kinds (Sales Header: order, return).
- Runtime-typed custom fields; field names that vary per tenant; config records that drive
  behaviour (flows, segments, rules) as instances, not types.
- Constant fields; request fields checked but never stored (`client_secret`, `code`).
- Storage: split storage (metadata in DB, bytes in blob), caches with expiry (counted as a
  second source of truth), one shape in many indices/replicas, parameterised computed fields
  (FlowFields).

Lineage and impact:

- Request fields can't carry `from`, so lineage breaks where a unit fills one api's request
  from another's response (Integration's ERP order draft, deep inserts).
- Lineage is per field, not per path or row: shared value types (`Money.centAmount`) and EAV
  attribute values collapse many sources into one; no row filters (`where locale = en_GB`),
  no union/survivorship rules, no grouping keys in aggregates, false cycles between a total
  and its rows; no route (via Integration, via ERP).
- Fields named by string in config (search `facets`, `filters`) aren't reached by renames.
- Warehouse semantics: SCD2 history, as-of joins, grain, semi-additive measures, measures in
  filter context, row-level security, which fields a report uses.
- Ownership: two writers of one field; third-party SaaS vs own-built; teams and
  environments only in `meta`.
- Mentions of old names match common words: renaming `no` rewrites every "no." in notes.
