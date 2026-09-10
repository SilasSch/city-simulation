# Market Lane assets

`market-lane` is the second static zone (v0.8). Shared spawn, bounds and
colliders live in `@city/game-protocol` (`MARKET_LANE_*`, `WORLD_ZONE_COLLIDERS`).

Zone portals (`WORLD_ZONE_PORTALS`) and server-authoritative `world-transition`
are implemented in #66. Client map/art and richer portal cues remain in #67 —
until then the Phaser stage keeps Central Square geometry with a zone banner /
background tint when `zoneId` switches.
