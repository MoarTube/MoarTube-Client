# Node bulletin management

In Settings → Personalization, Node Bulletin provides ordered text rows with Add item, Remove, and Save controls. Saving replaces the entire bulletin. Empty draft rows are skipped; removing every row and saving clears the bulletin. Failed saves preserve the draft for retry.

The Client posts `{ "nodeBulletin": ["Welcome to this node.", "Join the conversation."] }` to `/settings/node/personalize/bulletin`, forwarding the authenticated request to Node's `/settings/personalize/bulletin`.

Node persists `nodeBulletin` as a JSON array of strings in `_node_settings.json`. Existing installations without this property default to `[]`. Entries remain in their submitted order; surrounding whitespace is trimmed. Each entry must contain 1–1000 characters, with at most 50 entries. Content is plain text.

The existing authenticated settings response includes the array so Client reloads restore saved entries. No home page or public bulletin rendering is included in this change. The future home page can use this stored array as its source.

Validation covers the actual Client proxy route, authenticated Node routes with real file persistence, and the browser editor at desktop and mobile widths. It also checks invalid payloads, clearing, save errors, and markup remaining inert in saved bulletin text.
