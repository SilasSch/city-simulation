# Market Lane assets

`market-lane` is the second static zone (v0.8). Shared spawn, bounds and
colliders live in `@city/game-protocol` (`MARKET_LANE_*`, `WORLD_ZONE_COLLIDERS`).

The client projection uses **procedural, license-free Phaser textures**
generated at runtime (`market-lane-textures.ts`): cobble, dirt, stall, awning,
and crate tiles. Map layout (`market-lane-map.ts`) mirrors the protocol
stall/crate colliders. No third-party art packs.

Zone portals (`WORLD_ZONE_PORTALS`) are drawn on both Square and Lane maps via
`renderZonePortals` in `world-map-layout.ts`. The Phaser stage tears down and
rebuilds map art when the confirmed snapshot `zoneId` changes (no optimistic
swap).
