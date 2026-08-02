# Extension icons

`npm.cmd run extension:build` creates deterministic PNG icons at 16, 32, 48,
and 128 pixels in `dist/extension/icons`. Keeping the raster generation in the
build avoids remote assets and guarantees that the loadable extension always
contains Chrome-supported icon files.
