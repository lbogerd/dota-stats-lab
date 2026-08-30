# Neutral camp parser replay notes

The pre-schema probe used archived TI 2026 match `8943142948` from
`/home/xub/dota-stats-archives/ti2026` on 2026-08-30.

- 28 `CDOTA_NeutralSpawner` entities used the exact paths
  `CBodyComponent.m_cellX`, `CBodyComponent.m_cellY`,
  `CBodyComponent.m_vecX`, `CBodyComponent.m_vecY`, and `m_Type`. One creation
  contained values `120`, `166`, `172.0`, `76.0`, and `1`, producing world
  coordinates `-852.0`, `4940.0` with the hero sampler conversion. The
  creation checkpoint stores the initial `m_Type` plus those computed
  `worldX` and `worldY` values; it does not retain the four source components.
- 995 `CDOTA_BaseNPC_Creep_Neutral` entities exposed exact paths
  `m_iHealth`, `m_lifeState`, `m_iTeamNum`, `m_bIsSummoned`, and
  `m_hNeutralSpawner`. A creation contained `300`, `0`, `4`, `false`, and
  `15991383`.
- 906 creeps had non-invalid spawner handles and 89 had handle `16777215`.
  The 906 valid links used 28 distinct handles; all 28 resolved to an observed
  spawner and none were unresolved.
- At entity game time `123.20002890777596`, one creep changed health `4 -> 0`
  and life state `0 -> 1`. It later changed life state `1 -> 2` and was deleted
  at `129.26669603729238`, confirming that deletion is not the death signal.
- 14,425 positive team-4 damage rows had names beginning
  `npc_dota_neutral_`. Observed names included `npc_dota_neutral_wildkin`,
  `npc_dota_neutral_enraged_wildkin`, and
  `npc_dota_neutral_polar_furbolg_ursa_warrior`; direct hero rows exposed
  roster hero attacker names with `attackerHero=true` and `illusion=false`.
- Clarity timestamp `1012.10004` occurred with the pause-safe entity clock at
  `63.06669098663326`; later `1072.2334` occurred at `123.20002890777596`.
  The stable approximately 949-second offset disproved direct clock agreement:
  the source timestamp is the network timeline. Profile v4 therefore writes
  the current pause-safe `GameClock` value as combat `gameTime` and retains the
  Clarity source timestamp as `rawTime`.
- All 28 spawner creations preceded `GameClock` initialization. Their identity,
  creation-event, and checkpoint `gameTime` values are therefore null. The
  loader treats that value as pre-game existence without inventing a source
  clock time.

The one-off probe output was kept outside Git during implementation; the
durable evidence needed for the parser contract is summarized above.
