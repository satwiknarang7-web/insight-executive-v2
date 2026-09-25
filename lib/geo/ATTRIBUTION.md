# Map data

Built by `scripts/build-geo.mjs`. Each map file records its own source and licence.

- **World** (`maps/WORLD.json`): [world-atlas](https://github.com/topojson/world-atlas) countries-110m, from Natural Earth. Public domain.
- **United States** (`maps/US.json`): [@svg-maps/usa.states-territories](https://www.npmjs.com/package/@svg-maps/usa.states-territories). Unlicense (public domain).
- **All other countries** (`maps/<ISO code>.json`): the matching [@svg-maps](https://github.com/VictorCazanave/svg-maps) package, CC BY 4.0. Authors are listed in each package; the map credit is shown under every map in the app.

Borders are drawn as each source draws them. Where borders are disputed, the source's depiction may differ from any government's official position.
