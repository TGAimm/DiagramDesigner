# module

Every box: a system (ERP, Webshop) or a part of one (service, component, database). Modules
nest.

```yaml
id: iatbgcla3c
parent: fghfo41tiv     # optional: the module round it; none = a root
name: Database
external: true         # optional: used by consumers the design doesn't show
models: [li65oa3wga]   # optional: models owned elsewhere, drawn inside as dashed references
```

- A module with no `parent` is a **root**: the app calls it a system and draws it as one
  (a neutral frame with its name above it, system icon); search lists roots as Systems and offers them to start
  from. Everything below a root is drawn as a module. Grouping systems under a new root makes
  that root the system.
- Each root has its own folder, and everything in it lives under that folder. Two roots in
  one folder is an error; a file outside its root's folder is a warning.
- Moving a box is a change of `parent`: none lifts it to a root (see [scenario](scenario.md)).

Children: modules, triggers (rows of one Triggers card), logic-units (rows of one Logic card),
apis (listed on a rail across the right border), models (via `ownedBy`, drawn as classes), and models stored here (via their
`storedIn`, drawn as stored tables). Listing a model this module already owns or stores is a
warning.
