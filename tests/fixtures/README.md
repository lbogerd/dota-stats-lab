# TI 2026 replay list

`ti2026-replays.csv` contains 147 matches from the TI 2026 main tournament.
OpenDota league 19719 was the source for tournament membership. The first row
defines the `match_id` and `replay_url` columns.

The URLs are the URLs used to acquire the test data. Of the 147 URLs, 103 use
`replay413.dota2.com.cn` and 44 use the Valve alias. Replay URLs can expire.
This file is network test data, not a stable unit-test fixture. Replay files
must stay outside Git.

This example ingests only the first match in the file:

```sh
sed -n '2p' tests/fixtures/ti2026-replays.csv \
  | tr -d '"' \
  | while IFS=, read -r match_id replay_url; do
      DOTA_REPLAY_SOURCE="$replay_url" ./dota ingest "$match_id"
    done
```
