# Retail landscape: Fjeld Outdoor

A test landscape at the size and detail the viewer is meant for. Fjeld Outdoor is a fictional
Nordic outdoor-gear retailer: a webshop in four countries (DK, SE, NO, DE), 12 own stores, a
3PL warehouse, and a B2C customer base of about 400k. The stack is Microsoft-centred, and
bought products are joined by an own-built integration hub.

Bought products are modelled on their public APIs (field names, paths, objects), trimmed to
what Fjeld uses. Own-built systems are designed as a real team would build them.

## Systems

| folder | system | kind | modelled on |
| --- | --- | --- | --- |
| `erp` | ERP | SaaS | Microsoft Dynamics 365 Business Central (API v2.0) |
| `pim` | PIM | SaaS | Akeneo PIM (REST API v1) incl. asset manager |
| `commerce` | Commerce | SaaS | commercetools (HTTP API, Subscriptions) |
| `payments` | Payments | SaaS | Stripe (PaymentIntents, Refunds, Payouts, webhooks) |
| `shipping` | Shipping | SaaS | a Nordic shipping aggregator in the style of nShift / Shipmondo |
| `identity` | Identity | SaaS | Microsoft Entra External ID (customer sign-in, OIDC) |
| `crm` | CRM | SaaS | Dynamics 365 Sales (Dataverse Web API) |
| `marketing` | Marketing | SaaS | Klaviyo (profiles, lists, events, flows) |
| `service` | Customer Service | SaaS | Zendesk Support (tickets) + a returns portal |
| `search` | Search | SaaS | Algolia (indices, records, query) |
| `wms` | WMS | 3PL | a 3PL's warehouse system with CSV-over-SFTP and a small REST API |
| `pos` | POS | SaaS | a cloud store POS (registers, receipts, store stock) |
| `storefront` | Storefront | own-built | Next.js site + BFF (backend for frontend) |
| `integration` | Integration | own-built | Azure Service Bus + Azure Functions + SFTP + Blob storage |
| `data` | Data Platform | own-built | Microsoft Fabric lakehouse: bronze/silver/gold, Power BI |

Bought products never call each other. Every flow between them goes through **Integration**,
or through **Storefront** for live customer traffic, or is a direct call a product really
makes (WMS books labels with Shipping; Commerce Subscriptions and Stripe webhooks post to
Integration).

## Main flows

1. **Product content:** PIM → Integration (on PIM product-updated event, plus nightly full
   sync) → Commerce products and Search records.
2. **Prices and stock:** ERP items, sales prices and inventory → Integration (every 5 min,
   delta) → Commerce prices and inventory entries, and Search records. WMS stock snapshots
   (nightly file) → Integration → ERP item journal adjustments.
3. **Order to cash:** Storefront checkout → Commerce order + Stripe PaymentIntent → Commerce
   Subscription message `OrderCreated` → Service Bus topic `order-created` → Integration →
   ERP sales order → WMS outbound order (CSV via SFTP) → WMS picks, packs, books a label with
   Shipping → WMS shipment confirmation file → Integration → ERP posts shipment and invoice,
   Commerce order state `Shipped` + tracking, Marketing `Shipped` event. Stripe captures on
   shipment.
4. **Payments reconciliation:** Stripe payouts and balance transactions → Integration
   (daily) → ERP general journal lines.
5. **Customers:** Identity sign-up → Storefront creates the Commerce customer → Integration →
   CRM contact and Marketing profile (with consent); ERP customer only on first order.
6. **Returns:** Service returns portal → Integration → Commerce return info, ERP sales return
   order, WMS expected return; on receipt, Stripe refund and ERP credit memo.
7. **Stores:** POS sales → Integration (nightly) → ERP sales posting; ERP stock → POS store
   stock; click & collect orders from Commerce routed to a store's POS.
8. **Analytics:** Data Platform copies ERP, Commerce, Payments, CRM, WMS, POS and Marketing
   tables into bronze, cleans them in silver, and builds dims and facts in gold.

## How work starts

- Messages travel on channels in Integration › Service Bus (9 topics, 4 queues): publishers'
  units `send` on them, and each subscriber has an `on` trigger in its own module.
- Scheduled jobs have a schedule trigger beside the unit, with the cron the product runs.
- Pages, tills, handhelds and the ERP and Stripe clients start their units with
  `by: { user }` triggers.
- Vendor apis that clients outside the design call (admin tools, the ops team) are
  `external: true`.

## Conventions for things the schema can't say yet

Model the nearest thing, keep it valid, and mark the line or file with a `# GAP: <what>`
comment so the gap can be found with `grep -rn "# GAP" examples/retail`.

| real thing | write it as |
| --- | --- |
| Webhook (Stripe, Commerce Subscription over HTTP) | a real api on the receiver; the sender's unit `call`s it. No gap. |
| File exchange (CSV, EDI) | a model for the file layout, `storedIn` an SFTP/Blob module; producer `write`s it, consumer `read`s it. `# GAP: file interface` |
| Enum / status | `type: string`, `constraints: ["one of: a, b, c"]`, `# GAP: enum` |
| SaaS product | `meta: { vendor: <Vendor>, product: <Product>, kind: saas }` on the root module |
| Team ownership | `meta: { owner: <team> }` on the root module (teams: commerce-team, erp-team, integration-team, data-team, store-ops, cx-team) |
| GraphQL, gRPC | an api `POST /graphql` with `# GAP: GraphQL operation <name>` |

Anything else that doesn't fit: model it as best you can, add `# GAP:` and say why.

## Size

15 systems, 155 modules, 371 models, 240 apis, 231 logic units, 86 triggers, 13 channels,
3 flags: 1099 entity files.

## Scenarios and flags

- `scenarios/rename-item-no.scenario.yaml`: rename the ERP item number; reaches POS, WMS
  files and most of ERP.
- `scenarios/drop-order-number-metadata.scenario.yaml`: stop sending the order number to
  Stripe; breaks the payout reconciliation in Integration.
- Flag `new-checkout` (Storefront): Stripe Payment Element vs the legacy Checkout redirect.
- Flag `wms-api` (Integration and WMS): orders to the 3PL by REST instead of CSV files.
  Switching it in Integration only is the split `sdv validate` warns about.
