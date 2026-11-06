# Node neighbors management

Settings → Personalization includes a Neighbors editor beneath Node Bulletin. Each ordered row contains a URL and a plain-text description. Add item and Save sit together on the right, with Remove beside each row. Success shows only the standard green checkmark modal, as with Bulletin.

Saving replaces `nodeNeighbors` in Node's `_node_settings.json`:

```json
{
  "nodeNeighbors": [
    { "url": "https://rivet.tube", "description": "Indie film, animation, and art" },
    { "url": "https://gearhead.tube", "description": "Electronics, tools, and making" }
  ]
}
```

The Client posts to `/settings/node/personalize/neighbors`, forwarding to Node's authenticated `/settings/personalize/neighbors` endpoint. Existing configurations default to an empty array, and the existing authenticated settings response includes the saved array.

Up to 50 neighbors are accepted. Each entry requires a complete HTTP(S) URL of at most 2048 characters and a description of 1–1000 characters. Surrounding whitespace is trimmed. Completely blank draft rows are skipped; partially completed rows must be completed or removed. Saving with no rows clears the list. Failed saves preserve the draft. No home page rendering is included.

Tests cover authentication, validation, Client forwarding, ordered JSON persistence, reloads, clearing, literal markup in descriptions, draft retention, and desktop/mobile layout.
