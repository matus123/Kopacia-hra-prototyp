# Kopacia hra

A browser game on `<canvas>`, in TypeScript. Vite builds and serves it, Biome lints and
formats it, and images go through a reference-counted loader so a level can free its art
when it leaves the screen.

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Dev server with hot reload on http://localhost:5173 |
| `npm run build` | Typecheck, then bundle into `dist/` |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run lint` | Biome: lint + format check |
| `npm run lint:fix` | Biome: apply safe fixes and format |
| `npm run typecheck` | `tsc --noEmit` |

`node scripts/gen-placeholder-art.mjs` regenerates the placeholder PNGs in `src/images/`.
Nothing at runtime depends on it - delete the script once real art arrives.

## Layout

```
src/
  main.ts               entry point: builds the Game, starts the first scene
  core/
    game.ts             wires renderer + input + assets + scenes + loop
    loop.ts             fixed-timestep loop (deterministic updates, free-running render)
    renderer.ts         Canvas 2D: camera, sprite sheets, DPR, text
    input.ts            keyboard + pointer, with one-frame "just pressed" edges
    scene.ts            Scene interface and the manager that swaps scenes
  assets/
    manifest.ts         every image, declared once
    asset-loader.ts     loads, caches, ref-counts and frees images
  game/
    world.ts            tile grid: generation, collision queries, drawing
    player.ts           movement, gravity, tile collision
    scenes/             loading screen and the playable scene
  images/               PNG source art (imported, so Vite fingerprints it)
```

## Canvas 2D, not WebGL

This uses the 2D context. For a tile-based digging game that is the right trade:
`drawImage` of a sprite sheet is hardware-accelerated in every current browser, and a
screenful of tiles plus a few hundred sprites runs at 60fps without the shader,
batching and texture-atlas machinery WebGL demands.

Reach for WebGL when you actually hit one of these: thousands of sprites per frame,
per-pixel lighting or shader effects, or heavy per-frame rotation and scaling. To keep
that door open, game code never touches `CanvasRenderingContext2D` directly - it only
calls `Renderer`. Swapping in WebGL means reimplementing `src/core/renderer.ts` against
the same methods, not rewriting the game. If you go there, [PixiJS](https://pixijs.com)
is the sane middle ground: it keeps a `drawImage`-shaped API over WebGL/WebGPU.

## Images: declare once, lease while you need them

Every image lives in `src/assets/manifest.ts` as a real `import`, so the build fingerprints
the file, copies it into `dist/` and **fails if it goes missing** - no string paths that
rot silently.

```ts
export const IMAGE_MANIFEST = {
  tileset: { url: tilesetUrl, group: "world", frame: { width: 32, height: 32 } },
} as const satisfies Record<string, ImageDefinition>;
```

`group` is the unload unit - roughly "one screen worth of art". The keys are a literal
union, so `assets.image("tilset")` is a compile error.

### Loading

`AssetLoader.load()` fetches without claiming anything - good for warming the cache. The
`LoadingScene` does exactly that and renders a progress bar:

```ts
await assets.load(keysInGroup("world"), ({ ratio }) => drawBar(ratio));
```

### Holding and releasing

`acquire()` loads *and* takes a reference, returning a lease. While a lease is alive, that
image cannot be freed:

```ts
// scene enter()
this.lease = await assets.acquire(["tileset", "player", "sky"]);

// scene exit()
this.lease.release();   // drop the claim
assets.collect();       // free everything no lease holds
```

Two scenes that need the same tileset each hold their own lease; the image is fetched and
decoded once and survives until both release it. That is the whole point of the reference
count - scenes do not need to know about each other.

`unloadGroup("world")` is the blunt version: it frees a group regardless of leases. Use it
when tearing down a level whose scenes are already gone. `assets.stats()` feeds the debug
overlay (press <kbd>F3</kbd>).

Images decode via `createImageBitmap` off the main thread when the browser supports it,
with an `HTMLImageElement` fallback, and `close()` is called on disposal so the memory
actually goes back.

## The demo scene

`PlayScene` is a small vertical-slice digging game - keep it, gut it, or replace it. It
exercises the whole stack: tile generation, AABB collision, a follow camera clamped to
world bounds, pointer picking through `screenToWorld`, and interpolated rendering.

Controls: <kbd>A</kbd>/<kbd>D</kbd> move, <kbd>W</kbd> jump, click or <kbd>E</kbd> to dig,
<kbd>R</kbd> new world, <kbd>F3</kbd> debug overlay.

## Notes on the loop

Updates run at a fixed 60Hz with an accumulator, rendering runs per animation frame and
receives `alpha` (0..1) so entities can interpolate between the last two updates - see
`Player.render`. Physics therefore behaves identically on a 60Hz and a 144Hz display. A
long stall (backgrounded tab, breakpoint) is clamped to 0.25s rather than simulated, so
the game never tries to catch up on 30 seconds of missed time at once.
