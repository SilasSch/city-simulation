# Central Square map assets

The Central Square map in `apps/client/src/app/central-square-map.ts` uses only
Phaser vector primitives, text, and system fonts. Its layout and simple shapes
were created specifically for this repository and are licensed under the same
terms as the project. No third-party images, tilesets, fonts, or generated
assets are bundled.

Keeping the map code-native avoids an asset-loading pipeline and makes the
static map content independent from the server-confirmed entity projection.
