# logic-unit

A unit of code inside a module: class, function, handler. Say what invokes it, what data it
touches and what it calls, so change impact can follow it.

```yaml
id: mfj6c1l8c6
parent: lht4l7njny               # must be a module
name: addToCart
handles: [jibntgqh1p]            # apis whose requests it handles
reads: [uzi5stl672]              # models, or single model fields
writes: [a6ub2b7rpa, dj8m2h65tb] # models, or single model fields
calls: [tl04zzurg3, fdqktz9kjr]  # logic units or apis, in any system
```

- All four keys are optional and take ids. Name a whole model unless only some fields matter;
  naming a model and one of its fields too is a warning.
- Only logic units have these keys.

## Rendering

- A module's units share one **Logic** card, the first box inside the module: one row per
  unit, with its handled apis (method), reads, writes and calls as badges. Columns no unit
  fills are left out.
- Hover or click a row to draw its reads (arrow at the unit), writes (arrow at the model) and
  calls (dotted, arrow at the callee) and light their rows. Apis it handles or calls are lit on
  their rail. Clicking a row opens an inspector with Handles, Reads, Writes, Calls and Called by.
- A field's inspector lists **Read by logic** and **Written by logic**, including units that
  name its whole model. An api's card lists **Handled by** and **Called by**.
