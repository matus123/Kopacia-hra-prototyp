import type { AssetLoader } from "@/assets/asset-loader";
import type { Input } from "@/core/input";
import type { GameLoop } from "@/core/loop";
import type { Renderer } from "@/core/renderer";

export interface SceneContext {
	readonly renderer: Renderer;
	readonly input: Input;
	readonly assets: AssetLoader;
	readonly scenes: SceneManager;
	readonly loop: GameLoop;
}

export interface Scene {
	readonly name: string;
	/**
	 * Called once before the scene runs. Keep it fast - the screen is blank until
	 * it resolves. Long loads belong in a loading scene that renders progress
	 * while it waits (see `LoadingScene`).
	 */
	enter?(context: SceneContext): void | Promise<void>;
	/** Release leases and listeners here. */
	exit?(): void | Promise<void>;
	update(dt: number): void;
	render(alpha: number): void;
	/** Optional hook for canvas size changes. */
	resize?(width: number, height: number): void;
}

/** Runs one scene at a time and swaps between them. */
export class SceneManager {
	private context: SceneContext | null = null;
	private current: Scene | null = null;
	private queued: Scene | null = null;
	private swapping = false;

	get active(): Scene | null {
		return this.current;
	}

	attach(context: SceneContext): void {
		this.context = context;
	}

	/**
	 * Swaps to `next`. If a swap is already in flight the newest request wins,
	 * so a scene can hand off mid-transition without leaving two scenes live.
	 */
	async change(next: Scene): Promise<void> {
		this.queued = next;
		if (this.swapping) return;
		this.swapping = true;
		try {
			while (this.queued !== null) {
				const scene = this.queued;
				this.queued = null;
				await this.current?.exit?.();
				this.current = null;
				const context = this.context;
				if (context === null) {
					throw new Error("SceneManager.attach() must run before change()");
				}
				await scene.enter?.(context);
				// A scene that handed off during enter() already queued its successor.
				if (this.queued === null) {
					this.current = scene;
				}
			}
		} finally {
			this.swapping = false;
		}
	}

	update(dt: number): void {
		this.current?.update(dt);
	}

	render(alpha: number): void {
		this.current?.render(alpha);
	}

	resize(width: number, height: number): void {
		this.current?.resize?.(width, height);
	}
}
