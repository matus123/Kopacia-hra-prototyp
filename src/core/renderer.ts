export interface Camera {
	x: number;
	y: number;
	zoom: number;
}

export interface RendererOptions {
	/** Nearest-neighbour scaling, no smoothing - what you want for pixel art. */
	readonly pixelArt?: boolean;
	/** Cap the device pixel ratio so 3x phones do not render 9x the pixels. */
	readonly maxPixelRatio?: number;
	readonly background?: string;
}

export interface SpriteSheet {
	readonly source: CanvasImageSource;
	readonly frameWidth: number;
	readonly frameHeight: number;
	readonly columns: number;
	readonly rows: number;
}

export interface DrawFrameOptions {
	readonly flipX?: boolean;
	readonly alpha?: number;
	/** Scale around the sprite's own top-left corner. */
	readonly scale?: number;
}

export function sourceSize(source: CanvasImageSource): { width: number; height: number } {
	if (source instanceof HTMLImageElement) {
		return { width: source.naturalWidth, height: source.naturalHeight };
	}
	if (source instanceof HTMLVideoElement) {
		return { width: source.videoWidth, height: source.videoHeight };
	}
	const sized = source as { width: number; height: number };
	return { width: sized.width, height: sized.height };
}

export function spriteSheet(
	source: CanvasImageSource,
	frameWidth: number,
	frameHeight: number,
): SpriteSheet {
	const { width, height } = sourceSize(source);
	return {
		source,
		frameWidth,
		frameHeight,
		columns: Math.max(1, Math.floor(width / frameWidth)),
		rows: Math.max(1, Math.floor(height / frameHeight)),
	};
}

/**
 * Canvas 2D renderer.
 *
 * Everything the game draws goes through here, so the 2D context never leaks
 * into game code. That is deliberate: if this ever needs WebGL, the swap is
 * this file plus whatever new calls the game wants - not a rewrite of the game.
 */
export class Renderer {
	readonly canvas: HTMLCanvasElement;
	readonly ctx: CanvasRenderingContext2D;
	readonly camera: Camera = { x: 0, y: 0, zoom: 1 };

	/** Size of the drawing surface in CSS pixels (what game code should reason about). */
	private viewWidth = 0;
	private viewHeight = 0;
	private pixelRatio = 1;

	private readonly pixelArt: boolean;
	private readonly maxPixelRatio: number;
	private readonly background: string;

	constructor(canvas: HTMLCanvasElement, options: RendererOptions = {}) {
		const ctx = canvas.getContext("2d", { alpha: false });
		if (ctx === null) {
			throw new Error("Canvas 2D context is unavailable");
		}
		this.canvas = canvas;
		this.ctx = ctx;
		this.pixelArt = options.pixelArt ?? true;
		this.maxPixelRatio = options.maxPixelRatio ?? 2;
		this.background = options.background ?? "#10121a";
		this.resize();
	}

	get width(): number {
		return this.viewWidth;
	}

	get height(): number {
		return this.viewHeight;
	}

	/** Matches the backing store to the element's CSS size. Cheap when nothing changed. */
	resize(): void {
		const rect = this.canvas.getBoundingClientRect();
		const cssWidth = Math.max(1, Math.round(rect.width || this.canvas.clientWidth || 1));
		const cssHeight = Math.max(1, Math.round(rect.height || this.canvas.clientHeight || 1));
		const ratio = Math.min(window.devicePixelRatio || 1, this.maxPixelRatio);
		const backingWidth = Math.round(cssWidth * ratio);
		const backingHeight = Math.round(cssHeight * ratio);

		this.viewWidth = cssWidth;
		this.viewHeight = cssHeight;
		this.pixelRatio = ratio;

		if (this.canvas.width !== backingWidth || this.canvas.height !== backingHeight) {
			this.canvas.width = backingWidth;
			this.canvas.height = backingHeight;
		}
	}

	/** Resets the transform to CSS pixels and paints the background. */
	beginFrame(): void {
		this.ctx.setTransform(this.pixelRatio, 0, 0, this.pixelRatio, 0, 0);
		this.ctx.imageSmoothingEnabled = !this.pixelArt;
		this.ctx.fillStyle = this.background;
		this.ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);
	}

	/** Runs `draw` with the camera transform applied. */
	withCamera(draw: () => void): void {
		const { ctx, camera } = this;
		// Device pixels per world pixel. The translation is rounded in *device*
		// pixels and baked straight into the matrix: rounding a world-space
		// translate before the scale quantises the camera to whole world pixels,
		// which at zoom 2 makes the whole world jump two screen pixels at a time.
		const scale = camera.zoom * this.pixelRatio;
		// Snap the camera to whole *world* pixels first. Sprites are drawn on that
		// same grid, so camera and sprites move in lockstep instead of sliding
		// against each other; then snap the resulting offset to whole device
		// pixels so the grid lands on real screen pixels.
		const offsetX = Math.round(-Math.round(camera.x) * scale);
		const offsetY = Math.round(-Math.round(camera.y) * scale);
		ctx.save();
		ctx.setTransform(scale, 0, 0, scale, offsetX, offsetY);
		draw();
		ctx.restore();
	}

	screenToWorld(screenX: number, screenY: number): { x: number; y: number } {
		return {
			x: screenX / this.camera.zoom + this.camera.x,
			y: screenY / this.camera.zoom + this.camera.y,
		};
	}

	drawImage(
		source: CanvasImageSource,
		x: number,
		y: number,
		width?: number,
		height?: number,
	): void {
		const size = sourceSize(source);
		this.ctx.drawImage(source, x, y, width ?? size.width, height ?? size.height);
	}

	/** Draws frame `index` of a sheet, counting left to right then top to bottom. */
	drawFrame(
		sheet: SpriteSheet,
		index: number,
		x: number,
		y: number,
		options: DrawFrameOptions = {},
	): void {
		const { ctx } = this;
		const frames = sheet.columns * sheet.rows;
		const frame = ((index % frames) + frames) % frames;
		const sx = (frame % sheet.columns) * sheet.frameWidth;
		const sy = Math.floor(frame / sheet.columns) * sheet.frameHeight;
		const scale = options.scale ?? 1;
		const w = sheet.frameWidth * scale;
		const h = sheet.frameHeight * scale;
		const alpha = options.alpha ?? 1;

		if (alpha !== 1) {
			ctx.save();
			ctx.globalAlpha = alpha;
		}
		if (options.flipX === true) {
			ctx.save();
			ctx.translate(Math.round(x) + w, Math.round(y));
			ctx.scale(-1, 1);
			ctx.drawImage(sheet.source, sx, sy, sheet.frameWidth, sheet.frameHeight, 0, 0, w, h);
			ctx.restore();
		} else {
			ctx.drawImage(
				sheet.source,
				sx,
				sy,
				sheet.frameWidth,
				sheet.frameHeight,
				Math.round(x),
				Math.round(y),
				w,
				h,
			);
		}
		if (alpha !== 1) {
			ctx.restore();
		}
	}

	/** Tiles an image across a screen-space rect - background/parallax fills. */
	drawTiled(source: CanvasImageSource, offsetX: number, offsetY: number): void {
		const { width, height } = sourceSize(source);
		const startX = -(((offsetX % width) + width) % width);
		const startY = -(((offsetY % height) + height) % height);
		for (let y = startY; y < this.viewHeight; y += height) {
			for (let x = startX; x < this.viewWidth; x += width) {
				this.ctx.drawImage(source, Math.round(x), Math.round(y), width, height);
			}
		}
	}

	fillRect(x: number, y: number, width: number, height: number, color: string): void {
		this.ctx.fillStyle = color;
		this.ctx.fillRect(x, y, width, height);
	}

	strokeRect(
		x: number,
		y: number,
		width: number,
		height: number,
		color: string,
		lineWidth = 1,
	): void {
		this.ctx.strokeStyle = color;
		this.ctx.lineWidth = lineWidth;
		this.ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1);
	}

	drawText(
		text: string,
		x: number,
		y: number,
		options: { color?: string; size?: number; align?: CanvasTextAlign; font?: string } = {},
	): void {
		const { ctx } = this;
		ctx.fillStyle = options.color ?? "#f4f6fb";
		ctx.font = `${options.size ?? 14}px ${options.font ?? "ui-monospace, monospace"}`;
		ctx.textAlign = options.align ?? "left";
		ctx.textBaseline = "top";
		ctx.fillText(text, x, y);
	}
}
