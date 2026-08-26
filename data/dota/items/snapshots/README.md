# Valve item snapshots

The update command stores the exact bytes from the Valve item-list response in this directory. The filename contains a sequence number, the game patch, and the first 12 characters of the source SHA-256 hash. The sequence number defines snapshot order.

Do not edit a snapshot. Add a documented entry to `overrides.json` when one item ID gets a different internal name in a later snapshot.
