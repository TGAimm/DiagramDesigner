# model

Any data structure: domain entity, code object, API DTO, stored table. Define it once, with
all its data, where it is owned; say where its data is stored with `storedIn`.

```yaml
id: llns90zy3d
ownedBy: d8mg4xc8ef    # required; a module. Never `parent`.
storedIn: iatbgcla3c   # optional; module holding its data (database, cache, files)
name: Order
fields:
  - { id: jxhrrx2cmz, name: id, type: uuid, pk: true }
  - { id: xbsmlwkerd, name: customerId, type: uuid, required: true, ref: wpbo4l3k21 }
  - { id: wmzkfdam0u, name: total, type: decimal, constraints: [min 0] }
  - { id: eqibk7xt0j, name: lines, model: ahwod9ofrf, many: true }        # OrderLine[]
  - { id: jzhfxrngck, name: lineCount, type: int, stored: false, from: [eqibk7xt0j], derived: count of lines }
indexes:
  - { id: pf3bzy2y2v, name: ix_order_customer, fields: [xbsmlwkerd], unique: false }
```

Other entities show a model owned elsewhere by listing it in their `models`.

## Class and stored views

A model is drawn as a **class** in its owner and as a **stored** table in its `storedIn`.
Each view shows only the fields that exist there:

| field | class | stored |
| --- | --- | --- |
| `model` (held object or list) | yes | no; the held model is its own table |
| `stored: false` (computed, transient) | yes | no |
| `ref` to a model holding this one (`orderId` on Order Line) | no; being held links them | yes |
| keys (`pk`, `pi`) and `indexes` | no | yes |

- Pure code or API shape: no `storedIn`; drawn once, as a class.
- Stored with no separate code object (a raw table): `storedIn` = `ownedBy`; drawn once, as a
  stored table.
- Shape that really differs from its source (API DTO, read model, legacy table): a separate
  model whose fields use `from`.

## Field keys

| key | meaning |
| --- | --- |
| `id` | required; unique across everything (`sdv id`) |
| `name` | required; unique within the model |
| `type` | primitive type, free text (`uuid`, `string`, `decimal`...) |
| `model` | id of a model this field holds (composition). Exactly one of `type`/`model`. |
| `many` | holds a list of `type`/`model` |
| `required` | must be given on create |
| `nullable` | may hold null (independent of `required`) |
| `pk` / `pi` | part of primary key / primary index. A `pk` field cannot be nullable. |
| `constraints` | free text: `[positive, max 200]`; an enum as `"enum Name: A, B, C"` |
| `ref` | foreign key: id of a model or field it holds the key of. Not with `model`. |
| `from` | lineage: ids of fields (any model) this value comes from |
| `derived` | free text: how the value is computed/changed from `from` |
| `stored` | `false`: exists in the class only, never stored. Not with `pk` |

`indexes[].fields` are ids of stored fields of the same model. Give each index an `id`
(`sdv id`) so a [scenario](scenario.md) can change or drop it.

## Composition

`model` (+ `many`) holds another model, as a class property holds an object. Write the held
model as its own model (Order Line), as code would; give it a `ref` back to its holder when
the stored form needs one.

In the owner, a model and the models only it holds (same owner, no other holder) are drawn
inside one boundary, named after the outer model. A model held from several places stands
alone. Point at a model in another unit by key (`ref`), not by holding it, unless it really is
part of this one.

## Lineage (`from`)

Every field in a derived model (DTO, read model) should say where it comes from, so change
impact can be traced.

- unchanged/renamed: one `from`
- modified: `from` + `derived`
- calculated: several `from` (or none) + `derived`
- dropped: source field with nothing pointing at it
- new source data: no `from`

```yaml
- { id: f5pyjr5xh9, name: summary, type: string, from: [qxc7jxeb84], derived: first 160 chars }
```

`from` must name fields, never models; cycles are errors.

## Rendering

- A card's kind shows in its line, corner, icon and name colour: a class is sky with 8px
  corners and says *Class*; a stored table is emerald, near-square (3px) with a ruled name bar,
  and says *Table*; logic is amber with 10px corners and a ring. A card drawn away from its
  owner adds *owned by …*; a referenced class (`models`) is dashed.
- Name, Type and Constraints columns are as wide as their widest cell, up to 240, 200 and
  240px; nothing wraps. A long name ends in …; a long type is cut at the front
  (`…Contracts.SendMessage`); constraints that do not fit fold into a `+n` badge. An enum
  constraint shows as `enum Name · 3`. The field inspector lists every constraint in full, an
  enum one value per line.
- Type column shows `Customer` / `OrderLine[]`. A link strip at the row end marks `ref` (→),
  `from` (dashed →, `ƒ` when `derived`), how many fields point at the field (count pill) and
  how many api fields send into or return it (`API n`, see [api](api.md)).
- Lines follow [Connections](README.md#connections): `ref` arrow at the key; `model` diamond
  at the holder; `from` dashed, arrow at the source. At rest, card to card.
- Hover a row: its connections light up, drawn to the nearest card showing the other end,
  even in another module or system. Click: pins them and opens an inspector (references,
  source, referenced by, feeds); click an entry to fly there. Esc closes.
