# หม่าล่าแคมโบร๋ — Project Notes

QR-code ordering + kitchen display system for the mala buffet shop "หม่าล่าแคมโบร๋".
Stack: Next.js (App Router, JavaScript) + Supabase + Vercel.

## ⚠️ Next.js version note — READ BEFORE BUILDING DYNAMIC ROUTES

This project is on **Next.js 14 + React 18** (see `package.json`). In Next 14, `params`
is a plain object; in Next 15+ it becomes a `Promise`. To stay forward-compatible,
read `params` only in a **Server Component** page and `await` it (awaiting a plain
object is harmless), then pass the values to a client component as props:

```js
export default async function TablePage({ params }) {
  const { tableId } = await params; // ✅ works on Next 14 and 15+
  return <TableClient tableId={tableId} />;
}
```

❌ Do **not** use `use(params)` from `react` — React 18.3 does not export `use`,
so it throws at runtime. That pattern is only valid after upgrading to Next 15 / React 19.

Apply this in every future page under a dynamic segment (e.g. `/order/[tableId]`).

## Database schema (already exists in Supabase — reference only, do not recreate)

- **sessions**: `id`, `table_number`, `adult_count`, `child_count`, `status`, `created_at`
- **menu_categories**: `id`, `name`, `sort_order`
- **menu_items**: `id`, `category_id`, `name`
- **orders**: `id`, `session_id`, `table_number`, `items` (jsonb), `status`, `created_at`

## Pricing (buffet, per head)

- Adult: **229 บาท**
- Child: **129 บาท**

Used later to calculate the bill total from `sessions.adult_count` / `sessions.child_count`.

## Environment variables

Set these in `.env.local` (local) and in the Vercel project settings (production):

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

See `.env.local.example`.

## Realtime setup required for the kitchen screen

`app/kitchen/KitchenClient.js` subscribes to `postgres_changes` on the `orders`
table via `supabase.channel(...)`. This only works if Realtime replication is
turned on for that table in Supabase:

1. Open the Supabase Dashboard → your project → **Database** → **Replication**.
2. Find the `supabase_realtime` publication and toggle it **on** for the
   `orders` table (older dashboard versions: **Database → Publications** →
   edit `supabase_realtime` → check `orders`).
3. No restart needed — new inserts/updates on `orders` start broadcasting
   immediately once the toggle is on.

Without this step, the kitchen screen still works on page load (it fetches
existing orders normally), but new orders won't appear until the page is
manually refreshed.

## Current pages

- `/` — shows shop name and links to the pages below
- `/generate-qr` — staff opens a table and gets a QR code for it; also lists open
  tables with their bill total and a "ปิดโต๊ะ / ชำระเงิน" button that opens a
  bill popup with a PromptPay QR (`promptpay-qr` package; set `PROMPTPAY_ID` at
  the top of the file) and then sets `sessions.status` to `'closed'`
- `/order/[sessionId]` also shows the table's own orders with live status
  (Realtime on `orders`, filtered by `session_id`)
- `/kitchen` has a "เปิดเสียงแจ้งเตือน" button; after one click it plays a
  Web Audio ding on each new order (browsers block audio before a click)
- `/order/[sessionId]` — customer ordering page (Server Component page.js +
  OrderClient.js, following the params-as-Promise pattern above)
- `/kitchen` — kitchen display (Server Component page.js + KitchenClient.js),
  live order queue via Supabase Realtime — see the Realtime setup note above

## Getting started

```bash
npm install
npm run dev
```
