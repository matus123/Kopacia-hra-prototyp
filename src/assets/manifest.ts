import playerUrl from "@/images/player.png";
import skyUrl from "@/images/sky.png";
import tilesetUrl from "@/images/tileset.png";

/**
 * Every image the game can use, declared once.
 *
 * The URLs come from real `import` statements, so Vite fingerprints the files,
 * copies them into `dist/` and fails the build if one goes missing. Nothing is
 * fetched here - the manifest only says what *could* be loaded, and the
 * `AssetLoader` decides when bytes actually move.
 *
 * Need auto-discovery instead of one import per file? Swap the imports for:
 *   const urls = import.meta.glob("@/images/*.png", { eager: true, query: "?url", import: "default" });
 * You lose the literal-key typing below, so keep the explicit list while it fits.
 */
export interface ImageDefinition {
	readonly url: string;
	/** Load/unload happens per group, so a group is usually "one screen worth of art". */
	readonly group: string;
	/** Grid size, for images that are sprite sheets. */
	readonly frame?: { readonly width: number; readonly height: number };
}

export const IMAGE_MANIFEST = {
	tileset: {
		url: tilesetUrl,
		group: "world",
		frame: { width: 32, height: 32 },
	},
	player: {
		url: playerUrl,
		group: "world",
		frame: { width: 24, height: 32 },
	},
	sky: {
		url: skyUrl,
		group: "world",
	},
} as const satisfies Record<string, ImageDefinition>;

export type ImageKey = keyof typeof IMAGE_MANIFEST;
export type AssetGroup = (typeof IMAGE_MANIFEST)[ImageKey]["group"];

export const imageKeys = Object.keys(IMAGE_MANIFEST) as ImageKey[];

export function keysInGroup(group: AssetGroup): ImageKey[] {
	return imageKeys.filter((key) => IMAGE_MANIFEST[key].group === group);
}
