import type { Input } from "@/core/input";
import type { Renderer, SpriteSheet } from "@/core/renderer";
import { TILE_SIZE, type World } from "@/game/world";

const WIDTH = 20;
const HEIGHT = 30;
const SPRITE_WIDTH = 24;
const SPRITE_HEIGHT = 32;

const ACCELERATION = 1400;
const MAX_SPEED = 170;
const GROUND_FRICTION = 1500;
const AIR_FRICTION = 260;
const GRAVITY = 1250;
const JUMP_SPEED = 400;
const MAX_FALL_SPEED = 620;
/** Frames of grace after walking off a ledge where a jump still works. */
const COYOTE_TIME = 0.1;

export class Player {
	x: number;
	y: number;
	vx = 0;
	vy = 0;
	facing: 1 | -1 = 1;
	onGround = false;
	digging = false;

	private prevX: number;
	private prevY: number;
	private animTime = 0;
	private coyote = 0;

	constructor(x: number, y: number) {
		this.x = x;
		this.y = y;
		this.prevX = x;
		this.prevY = y;
	}

	get centerX(): number {
		return this.x + WIDTH / 2;
	}

	get centerY(): number {
		return this.y + HEIGHT / 2;
	}

	update(dt: number, world: World, input: Input): void {
		this.prevX = this.x;
		this.prevY = this.y;

		const direction = input.axis(["arrowleft", "a"], ["arrowright", "d"]);
		if (direction !== 0) {
			this.vx += direction * ACCELERATION * dt;
			this.facing = direction > 0 ? 1 : -1;
		} else {
			const friction = (this.onGround ? GROUND_FRICTION : AIR_FRICTION) * dt;
			this.vx = Math.abs(this.vx) <= friction ? 0 : this.vx - Math.sign(this.vx) * friction;
		}
		this.vx = clamp(this.vx, -MAX_SPEED, MAX_SPEED);

		this.coyote = this.onGround ? COYOTE_TIME : Math.max(0, this.coyote - dt);
		if (input.wasPressed("space", "arrowup", "w") && this.coyote > 0) {
			this.vy = -JUMP_SPEED;
			this.coyote = 0;
			this.onGround = false;
		}

		// Resting on the ground means *no* vertical integration at all. Adding
		// gravity every frame and letting the collision snap it back is what makes
		// a standing player drift a fraction of a pixel down and jump back up -
		// a one-pixel shake once the renderer rounds it.
		if (this.onGround && this.vy >= 0) {
			this.vy = 0;
		} else {
			this.vy = Math.min(this.vy + GRAVITY * dt, MAX_FALL_SPEED);
		}

		this.moveAxis(world, this.vx * dt, 0);
		this.moveAxis(world, 0, this.vy * dt);

		// Probe one pixel below instead of trusting the collision result: a player
		// resting flush against a tile does not overlap it, so only the probe can
		// tell "standing still on ground" from "falling".
		this.onGround = this.vy >= 0 && world.overlapsSolid(this.x, this.y + 1, WIDTH, HEIGHT);
		if (this.onGround) this.vy = 0;

		const moving = Math.abs(this.vx) > 8;
		this.animTime = moving || this.digging ? this.animTime + dt : 0;
	}

	/** Centre point as of the rendered (interpolated) position, not the last update. */
	renderCenter(alpha: number): { x: number; y: number } {
		return {
			x: lerp(this.prevX, this.x, alpha) + WIDTH / 2,
			y: lerp(this.prevY, this.y, alpha) + HEIGHT / 2,
		};
	}

	render(renderer: Renderer, sheet: SpriteSheet, alpha: number): void {
		// Interpolate between the last two fixed updates so motion stays smooth
		// on displays that refresh faster than the simulation.
		const x = lerp(this.prevX, this.x, alpha) - (SPRITE_WIDTH - WIDTH) / 2;
		const y = lerp(this.prevY, this.y, alpha) - (SPRITE_HEIGHT - HEIGHT);
		renderer.drawFrame(sheet, this.frame(), x, y, { flipX: this.facing < 0 });
	}

	private frame(): number {
		if (this.digging) return 3;
		if (!this.onGround) return 1;
		if (Math.abs(this.vx) <= 8) return 0;
		return 1 + (Math.floor(this.animTime * 9) % 2);
	}

	/** Moves along one axis and stops at the first solid tile it hits. */
	private moveAxis(world: World, dx: number, dy: number): void {
		if (dx === 0 && dy === 0) return;
		const steps = Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / (TILE_SIZE / 2)) || 1;
		const stepX = dx / steps;
		const stepY = dy / steps;

		for (let i = 0; i < steps; i++) {
			const nextX = this.x + stepX;
			const nextY = this.y + stepY;
			if (!world.overlapsSolid(nextX, nextY, WIDTH, HEIGHT)) {
				this.x = nextX;
				this.y = nextY;
				continue;
			}
			if (dx !== 0) {
				// Snap flush against the wall instead of stopping a fraction short.
				this.x =
					stepX > 0
						? Math.floor((this.x + WIDTH + stepX) / TILE_SIZE) * TILE_SIZE - WIDTH
						: Math.floor((this.x + stepX) / TILE_SIZE) * TILE_SIZE + TILE_SIZE;
				this.vx = 0;
			}
			if (dy !== 0) {
				this.y =
					stepY > 0
						? Math.floor((this.y + HEIGHT + stepY) / TILE_SIZE) * TILE_SIZE - HEIGHT
						: Math.floor((this.y + stepY) / TILE_SIZE) * TILE_SIZE + TILE_SIZE;
				this.vy = 0;
			}
			return;
		}
	}
}

export const PLAYER_SIZE = { width: WIDTH, height: HEIGHT };

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}

function lerp(from: number, to: number, t: number): number {
	return from + (to - from) * t;
}
