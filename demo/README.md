# Demo app for testing Waymark

A small fake "invoices" app with every kind of element in `docs/TESTING.md`. Nothing is sent or stored.

## Run it

Waymark only works on `http://` or `https://` pages, so open it through a local server, not by double-clicking the files.

- With Node: `node demo/serve.mjs` (or `pnpm demo`), then open http://localhost:8080
- With Python: `cd demo && python3 -m http.server 8080`, then open http://localhost:8080

## What's where

| Page | Elements |
| --- | --- |
| Dashboard | buttons and links to other pages, an **Actions** dropdown menu, tabs, a canvas chart (⚠ canvas), plain text (⚠ low-confidence), a closed web component (⚠ closed-shadow) |
| New invoice | text, email, date and number fields, a **Payment terms** dropdown, radio buttons, a checkbox, a switch, a notes box, a **Preview** modal dialog, and **Create invoice**, which opens another page |
| Invoices | a search box, a status filter, a table where every row has a **View** button |
| Settings | a field, a switch, a checkbox, a save button |
| Open slow report | a button that appears after 2 seconds |
| Unrelated page | go here during a guide to see the **off track** card |

A good guide to record for section B: Dashboard → **Create invoice** → fill the form (name, payment terms, checkbox, switch) → **Create invoice** → **Go to invoices**.
