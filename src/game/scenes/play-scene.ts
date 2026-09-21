import type { AssetLease } from "@/assets/asset-loader";
import { IMAGE_MANIFEST } from "@/assets/manifest";
import { type SpriteSheet, spriteSheet } from "@/core/renderer";
import type { Scene, SceneContext } from "@/core/scene";
import { Player } from "@/game/player";
import { DIG_TIME, SKY_ROWS, TILE_SIZE, Tile, type TileId, World } from "@/game/world";

const WORLD_WIDTH = 64;
const WORLD_HEIGHT = 48;
const ZOOM = 2;
/** How far the miner can reach, in tiles. */
const REACH = 3.5;

const TILE_VALUE: Record<TileId, number> = {
	[Tile.Empty]: 0,
	[Tile.Dirt]: 1,
	[Tile.Stone]: 3,
	[Tile.Gold]: 25,
	[Tile.Bedrock]: 0,
};

export class PlayScene implements Scene {
	readonly name = "play";

	private context!: SceneContext;
	private lease: AssetLease | null = null;
	private tileset!: SpriteSheet;
	private playerSheet!: SpriteSheet;
	private sky!: CanvasImageSource;

	private world = new World(WORLD_WIDTH, WORLD_HEIGHT);
	private player = spawnPlayer();
	private score = 0;
	private dug = 0;
	private target: { x: number; y: number } | null = null;
	private digProgress = 0;
	private showDebug = true;

	async enter(context: SceneContext): Promise<void> {
		this.context = context;
		// The loading scene already fetched these, so this resolves immediately -
		// but it is what keeps them alive while this scene is on screen.
		this.lease = await context.assets.acquire(["tileset", "player", "sky"]);

		const tilesetFrame = IMAGE_MANIFEST.tileset.frame;
		const playerFrame = IMAGE_MANIFEST.player.frame;
		this.tileset = spriteSheet(
			context.assets.image("tileset"),
			tilesetFrame.width,
			tilesetFrame.height,
		);
		this.playerSheet = spriteSheet(
			context.assets.image("player"),
			playerFrame.width,
			playerFrame.height,
		);
		this.sky = context.assets.image("sky");
		context.renderer.camera.zoom = ZOOM;
	}

	exit(): void {
		this.lease?.release();
		this.lease = null;
		// Anything no other scene leased is freed here.
		this.context.assets.collect();
	}

	update(dt: number): void {
		const { input } = this.context;

		this.player.digging = false;
		this.player.update(dt, this.world, input);
		this.updateDigging(dt);

		if (input.wasPressed("r")) this.restart();
		if (input.wasPressed("f3")) this.showDebug = !this.showDebug;
		if (this.player.y > this.world.pixelHeight + 200) this.restart();
	}

	render(alpha: number): void {
		const { renderer } = this.context;
		// Follow the interpolated player, not the last fixed update: a camera that
		// steps once per update while the sprite moves every frame makes the player
		// stutter against the background.
		this.updateCamera(alpha);

		// Parallax backdrop, drawn in screen space so it scrolls slower than the world.
		renderer.drawTiled(this.sky, renderer.camera.x * 0.35, renderer.camera.y * 0.2);

		renderer.withCamera(() => {
			this.world.render(renderer, this.tileset);
			this.player.render(renderer, this.playerSheet, alpha);
			this.renderTargetHighlight();
		});

		this.renderHud();
	}

	resize(): void {
		this.updateCamera(1);
	}

	private updateDigging(dt: number): void {
		const { input } = this.context;
		const target = this.pickTarget();
		this.target = target;

		const wantsToDig = input.pointer.down || input.isDown("e");
		if (target === null || !wantsToDig) {
			this.digProgress = 0;
			return;
		}

		const tile = this.world.at(target.x, target.y);
		const time = DIG_TIME[tile];
		if (!Number.isFinite(time)) {
			this.digProgress = 0;
			return;
		}

		this.player.digging = true;
		// Face what you are digging, unless it is straight up or down.
		const dx = target.x * TILE_SIZE + TILE_SIZE / 2 - this.player.centerX;
		if (Math.abs(dx) > TILE_SIZE / 2) this.player.facing = dx > 0 ? 1 : -1;

		this.digProgress += dt;
		if (this.digProgress >= time) {
			this.digProgress = 0;
			this.world.set(target.x, target.y, Tile.Empty);
			this.score += TILE_VALUE[tile];
			this.dug += 1;
		}
	}

	/** The tile under the pointer, or the one the miner faces when using the keyboard. */
	private pickTarget(): { x: number; y: number } | null {
		const { input, renderer } = this.context;
		let tileX: number;
		let tileY: number;

		if (input.pointer.inside) {
			const world = renderer.screenToWorld(input.pointer.x, input.pointer.y);
			tileX = Math.floor(world.x / TILE_SIZE);
			tileY = Math.floor(world.y / TILE_SIZE);
		} else if (input.isDown("s", "arrowdown")) {
			tileX = Math.floor(this.player.centerX / TILE_SIZE);
			tileY = Math.floor((this.player.y + 31) / TILE_SIZE);
		} else {
			tileX = Math.floor((this.player.centerX + this.player.facing * TILE_SIZE) / TILE_SIZE);
			tileY = Math.floor(this.player.centerY / TILE_SIZE);
		}

		if (!this.world.isSolid(tileX, tileY)) return null;

		const dx = (tileX + 0.5) * TILE_SIZE - this.player.centerX;
		const dy = (tileY + 0.5) * TILE_SIZE - this.player.centerY;
		if (Math.hypot(dx, dy) > REACH * TILE_SIZE) return null;

		return { x: tileX, y: tileY };
	}

	private renderTargetHighlight(): void {
		const { renderer } = this.context;
		const target = this.target;
		if (target === null) return;

		const x = target.x * TILE_SIZE;
		const y = target.y * TILE_SIZE;
		renderer.strokeRect(x, y, TILE_SIZE, TILE_SIZE, "rgba(255, 255, 255, 0.55)");

		const time = DIG_TIME[this.world.at(target.x, target.y)];
		if (this.digProgress > 0 && Number.isFinite(time)) {
			const ratio = Math.min(1, this.digProgress / time);
			renderer.fillRect(x, y + TILE_SIZE - 4, TILE_SIZE * ratio, 3, "#6ee7a8");
		}
	}

	private renderHud(): void {
		const { renderer, assets } = this.context;
		renderer.fillRect(0, 0, renderer.width, 30, "rgba(13, 15, 22, 0.78)");
		renderer.drawText(`SCORE ${this.score}`, 12, 8, { size: 14, color: "#f4d35e" });
		renderer.drawText(`TILES ${this.dug}`, 130, 8, { size: 14 });
		renderer.drawText(
			"move: A/D  jump: W  dig: click or E  restart: R  debug: F3",
			renderer.width - 12,
			8,
			{ size: 12, align: "right", color: "#8b93a7" },
		);

		if (!this.showDebug) return;
		const stats = assets.stats();
		const lines = [
			`fps ${Math.round(this.context.loop.fps)}`,
			`images ready ${stats.ready}/${stats.total}  leased ${stats.referenced}`,
			`camera ${Math.round(renderer.camera.x)}, ${Math.round(renderer.camera.y)}`,
		];
		lines.forEach((line, index) => {
			renderer.drawText(line, 12, renderer.height - 18 * (lines.length - index), {
				size: 12,
				color: "#8b93a7",
			});
		});
	}

	private updateCamera(alpha: number): void {
		const { renderer } = this.context;
		const viewWidth = renderer.width / renderer.camera.zoom;
		const viewHeight = renderer.height / renderer.camera.zoom;
		const center = this.player.renderCenter(alpha);
		renderer.camera.x = clamp(
			center.x - viewWidth / 2,
			0,
			Math.max(0, this.world.pixelWidth - viewWidth),
		);
		renderer.camera.y = clamp(
			center.y - viewHeight / 2,
			0,
			Math.max(0, this.world.pixelHeight - viewHeight),
		);
	}

	private restart(): void {
		this.world = new World(WORLD_WIDTH, WORLD_HEIGHT, (Math.random() * 0xffffffff) >>> 0);
		this.player = spawnPlayer();
		this.score = 0;
		this.dug = 0;
		this.digProgress = 0;
	}
}

function spawnPlayer(): Player {
	return new Player((WORLD_WIDTH / 2) * TILE_SIZE, (SKY_ROWS - 1) * TILE_SIZE);
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
