# X Art Stitcher

A zero-dependency userscript for **X (Twitter)** that automatically detects, unshuffles, and stitches split multi-image artist artworks directly in your feed — including **2×2 grids**, **1+2 panels**, and X's **5–20 image vertical-strip carousels**. Built for **ScriptCat**, Violentmonkey, and Tampermonkey on Firefox and Chromium browsers.

## Features

- **Automatic Split-Artwork Detection**: Uses box-filtered edge extraction, linear-extrapolation color matching, pooled 3-channel Pearson correlation (NCC), and smoothed along-seam gradient correlation to recognize real split illustrations while rejecting unrelated multi-image posts (including separate sketches on solid white/black backgrounds).
- **20-Image Carousel Support**: Passively indexes X's own GraphQL/XHR responses (with React Fiber and DOM fallbacks) so all slices of a virtualized multi-image carousel are stitched immediately without swiping through every slide.
- **Anti-AI / Scrambled Slice Recovery**: Evaluates tile permutations (exhaustive for `N <= 4`, greedy seam chaining for `N > 4`) to restore out-of-order slices automatically, plus an inline click-to-swap order editor for manual overrides.
- **Rich Layout Support**:
  - 2 images: Horizontal (`1×2`), Vertical (`2×1`)
  - 3 images: X's native `1L+2R`, `2L+1R`, `1T+2B`, `2T+1B`, plus `1×3` / `3×1`
  - 4 images: `2×2` grid, `1×4`, `4×1`
  - 5–20 images: Horizontal/vertical strips and geometrically valid `R×C` grids
- **Non-Destructive Inline Stitching**: Keeps X's React DOM subtree intact and toggles cleanly between original layout and stitched artwork.
- **Fullscreen Lightbox & Lossless Output**: Click any stitched image to zoom/pan up to 1:1 original pixels (`?name=orig`), download with customizable filename templates (`@{handle}_{tweetId}_{layout}`), or copy lossless PNG straight to the clipboard.

## Installation (ScriptCat / Violentmonkey / Tampermonkey)

1. Install [ScriptCat](https://docs.scriptcat.org/) (recommended on Firefox/Chrome), Violentmonkey, or Tampermonkey.
2. Open the raw userscript URL to install with automatic updates:
   `https://raw.githubusercontent.com/anfsity/x-art-stitcher/main/dist/x-art-stitcher.user.js`
3. Reload `x.com`. Configure options anytime from the ScriptCat menu (`X Art Stitcher Settings`) or the settings icon on any multi-image tweet.

## Development

Requires Node.js 20+ (zero external npm dependencies):

```bash
# Run functional and regression tests
npm test

# Bundle src/ into dist/x-art-stitcher.user.js
npm run build
```

## License

Licensed under the [Apache License, Version 2.0](LICENSE).
