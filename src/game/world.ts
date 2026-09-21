import type { Renderer, SpriteSheet } from "@/core/renderer";

export const TILE_SIZE = 32;

export const Tile = {
	Empty: 0,
	Dirt: 1,
	Stone: 2,
	Gold: 3,
	Bedrock: 4,
} as const;

export type TileId = (typeof Tile)[keyof typeof Tile];

/** Column in tileset.png for each tile. */
const ATLAS_COLUMN: Record<TileId, number> = {
	[Tile.Empty]: -1,
	[Tile.Dirt]: 0,
	[Tile.Stone]: 1,
	[Tile.Gold]: 2,
	[Tile.Bedrock]: 3,
};

/** Seconds of digging each tile costs. `Infinity` means undiggable. */
export const DIG_TIME: Record<TileId, number> = {
	[Tile.Empty]: 0,
	[Tile.Dirt]: 0.25,
	[Tile.Stone]: 0.75,
	[Tile.Gold]: 1.1,
	[Tile.Bedrock]: Number.POSITIVE_INFINITY,
};

export const SKY_ROWS = 4;

export class World {
	readonly tiles: Uint8Array;

	constructor(
		readonly width: number,
		readonly height: number,
		seed = 20260921,
	) {
		this.tiles = new Uint8Array(width * height);
		this.generate(seed);
	}

	get pixelWidth(): number {
		return this.width * TILE_SIZE;
	}

	get pixelHeight(): number {
		return this.height * TILE_SIZE;
	}

	/** Out of bounds reads as Bedrock at the edges and Empty above the sky. */
	at(x: number, y: number): TileId {
		if (y < 0) return Tile.Empty;
		if (x < 0 || x >= this.width || y >= this.height) return Tile.Bedrock;
		return (this.tiles[y * this.width + x] ?? Tile.Empty) as TileId;
	}

	set(x: number, y: number, tile: TileId): void {
		if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
		this.tiles[y * this.width + x] = tile;
	}

	isSolid(x: number, y: number): boolean {
		return this.at(x, y) !== Tile.Empty;
	}

	/** True if a world-space box overlaps any solid tile. */
	overlapsSolid(x: number, y: number, width: number, height: number): boolean {
		const minX = Math.floor(x / TILE_SIZE);
		const maxX = Math.floor((x + width - 1) / TILE_SIZE);
		const minY = Math.floor(y / TILE_SIZE);
		const maxY = Math.floor((y + height - 1) / TILE_SIZE);
		for (let ty = minY; ty <= maxY; ty++) {
			for (let tx = minX; tx <= maxX; tx++) {
				if (this.isSolid(tx, ty)) return true;
			}
		}
		return false;
	}

	/** Draws only the tiles the camera can see. */
	render(renderer: Renderer, sheet: SpriteSheet): void {
		const { camera } = renderer;
		const startX = Math.max(0, Math.floor(camera.x / TILE_SIZE));
		const startY = Math.max(0, Math.floor(camera.y / TILE_SIZE));
		const endX = Math.min(
			this.width - 1,
			Math.floor((camera.x + renderer.width / camera.zoom) / TILE_SIZE),
		);
		const endY = Math.min(
			this.height - 1,
			Math.floor((camera.y + renderer.height / camera.zoom) / TILE_SIZE),
		);

		for (let y = startY; y <= endY; y++) {
			for (let x = startX; x <= endX; x++) {
				const column = ATLAS_COLUMN[this.at(x, y)];
				if (column < 0) continue;
				renderer.drawFrame(sheet, column, x * TILE_SIZE, y * TILE_SIZE);
			}
		}
	}

	private generate(seed: number): void {
		let state = seed >>> 0;
		const random = (): number => {
			state = (state * 1664525 + 1013904223) >>> 0;
			return state / 0x100000000;
		};

		for (let y = 0; y < this.height; y++) {
			for (let x = 0; x < this.width; x++) {
				const depth = (y - SKY_ROWS) / (this.height - SKY_ROWS);
				let tile: TileId = Tile.Empty;
				if (y >= this.height - 1 || x === 0 || x === this.width - 1) {
					tile = Tile.Bedrock;
				} else if (y >= SKY_ROWS) {
					const stoneChance = Math.min(0.9, depth * 1.4);
					tile = random() < stoneChance ? Tile.Stone : Tile.Dirt;
					if (random() < 0.02 + depth * 0.05) tile = Tile.Gold;
					// Small caves, more of them the deeper you go.
					if (y > SKY_ROWS + 2 && random() < 0.05 + depth * 0.06) tile = Tile.Empty;
				}
				this.set(x, y, tile);
			}
		}

		// Carve a clear landing pad so the player never spawns inside rock.
		for (let y = 0; y < SKY_ROWS + 1; y++) {
			for (let x = 1; x < this.width - 1; x++) {
				this.set(x, y, Tile.Empty);
			}
		}
	}
}
