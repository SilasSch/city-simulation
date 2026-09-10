# Central Square assets

The Central Square client projection uses **procedural, license-free Phaser
textures** generated at runtime (`central-square-textures.ts`): grass, path,
plaza, wall, roof, and character sprites. No third-party art packs.

Layout and interaction coordinates remain shared with the server via
`@city/game-protocol` (`WORLD_INTERACTION_OBJECTS`, colliders). Phaser still
owns presentation only.

Portal cues for `central-square-east` are rendered from `WORLD_ZONE_PORTALS`
via shared `renderZonePortals` (`world-map-layout.ts`).
