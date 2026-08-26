# Valve item snapshots

Run `pnpm catalog:items:update` from the repository root after a Dota patch. The command stores the exact bytes from the Valve item-list response in this directory and regenerates `src/web/dota-items.generated.json`. The filename contains a sequence number, the game patch, and the first 12 characters of the source SHA-256 hash. The sequence number defines snapshot order.

Review the reported item and image changes, then run `pnpm catalog:items:verify`. Commit the new snapshot and generated catalog together.

Do not edit a snapshot or the generated catalog. Add a documented entry to `../overrides.json` only when an item ID needs a compatibility correction.
