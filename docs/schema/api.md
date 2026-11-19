# api

One endpoint a module exposes. Drawn as a row on its parent's api rail, not as a
box.

```yaml
id: a2uivekzaq
parent: d8mg4xc8ef           # module
name: Place order            # shown on hover and in the inspector
method: POST                 # required: GET POST PUT PATCH DELETE HEAD OPTIONS
path: /orders/{orderNo}      # required; starts with /
auth: bearer                 # free text, optional
params:                      # path, query and header params (not the body)
  - { id: e4w0ttn1za, name: orderNo, in: path, type: string }
  - { id: hd2rj7c0qe, name: dryRun, in: query, type: bool, required: false, description: validate only }
request: { model: llns90zy3d, many: false, contentType: application/json }   # the body
responses:
  - { status: 201, model: llns90zy3d, description: Created }
  - { status: 400, description: Invalid order }             # no model: no body
```

- Give each param an `id` (`sdv id`) so a [scenario](scenario.md) can change or drop it.
- `external: true`: the api has callers the design doesn't show (see [scenario](scenario.md)).
- `when: { flag, is }`: the api exists only while the flag has that value (see [flag](flag.md)).
- Every `{name}` in `path` needs a `path` param, and every `path` param must be in `path`.
  Path params are always required.
- A status is listed once. `contentType` defaults to `application/json`; `many: true` means
  a list.

## Bodies

A request or response body is one of three things. A request needs one; a response without
`model` or `fields` has no body.

```yaml
# 1. The model, field for field (owned anywhere).
request: { model: llns90zy3d }

# 2. The model, trimmed: leave fields out with omit, or name the only ones kept with pick.
responses:
  - { status: 200, model: llns90zy3d, omit: [jzhfxrngck] }

# 3. A shape of its own, written on the api, so the module is not filled with one-off models.
request:
  fields:
    - { id: eav6yzcyxr, name: customer, type: uuid, required: true, to: [xbsmlwkerd] }
    - { id: b98ainkq8b, name: lines, model: ahwod9ofrf, many: true }
responses:
  - status: 200
    fields:
      - { id: vgxi4l3bdo, name: available, type: decimal, from: [bvr0hth4v4, xtqs0jed9v], derived: onHand - reserved }
```

- `omit` and `pick` name fields of `model`; give one of them, not both.
- Own-shape fields have the keys of a model field (`id`, `name`, `type` or `model`, `many`,
  `required`, `nullable`) plus `description`. Their ids share the design's id namespace.
- Traceability: a request field says which model fields its value goes into (`to`), a
  response field which fields it comes from (`from`, with `derived` when changed). Both name
  model fields, by id, so renaming either side breaks nothing silently. A field with neither
  (and holding no model) is warned about. `to` on a response or `from` on a request is an
  error.
- An own shape several endpoints share can become a model of its own; point at it with
  `model` (case 1).

## Rendering

- A box owning apis has one **rail** across its right border, listing method (coloured) and
  path per endpoint. The layout keeps room for the half outside the box.
- Rows are laid out at full size, then shrunk to fit the rail, however many endpoints there
  are. The rail is as tall as its rows, centred on the border. It lists
  them while it is on or near the screen and rows would read at 4px, or
  while its box or one of its apis is looked at or lit; until then it shows just "APIs", and
  clicking it zooms in until they read.
- Click an endpoint: a card beside its row shows params, request and responses. Models the
  bodies use are outlined (subtitle says which parts: `request`, `201`), rows a trimmed body
  leaves out are dimmed, and a line runs from the row to each, and to the units handling or
  calling it (see [Connections](README.md#connections)). Hovering a rail row draws the same.
  Hover an own-shape field to add its dashed lineage to the fields it comes from or goes into
  (arrow at the source); untraced fields are marked.
- Model rows sent into or returned by own-shape fields show an `API n` count. The field
  inspector lists **Fed by apis** and **Returned by apis**, saying whether a rename of the
  field changes the api (the model itself) or not (an own shape keeps its own names).
