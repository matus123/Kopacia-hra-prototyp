import type { LoadProgress } from "@/assets/asset-loader";
import type { AssetGroup } from "@/assets/manifest";
import { keysInGroup } from "@/assets/manifest";
import type { Scene, SceneContext } from "@/core/scene";

/**
 * Warms the asset cache and renders a progress bar while it happens.
 *
 * It deliberately loads without taking a reference - the scene that comes next
 * calls `acquire()` and gets an instant hit, and owns the lease from there.
 */
export class LoadingScene implements Scene {
	readonly name = "loading";

	private context: SceneContext | null = null;
	private progress: LoadProgress = { loaded: 0, total: 0, ratio: 0 };
	private error: string | null = null;
	private done = false;
	private elapsed = 0;

	constructor(
		private readonly group: AssetGroup,
		private readonly next: (context: SceneContext) => Scene,
	) {}

	enter(context: SceneContext): void {
		this.context = context;
		context.assets
			.load(keysInGroup(this.group), (progress) => {
				this.progress = progress;
			})
			.then(() => {
				this.done = true;
			})
			.catch((cause: unknown) => {
				this.error = cause instanceof Error ? cause.message : String(cause);
				console.error("Asset loading failed", cause);
			});
	}

	update(dt: number): void {
		this.elapsed += dt;
		const context = this.context;
		// Hold the bar on screen briefly so a fast load does not just flicker.
		if (this.done && context !== null && this.elapsed > 2.35) {
			this.done = false;
			void context.scenes.change(this.next(context));
		}
	}

	render(): void {
		const context = this.context;
		if (context === null) return;
		const { renderer } = context;
		const width = Math.min(360, renderer.width - 64);
		const x = (renderer.width - width) / 2;
		const y = renderer.height / 2;

		renderer.drawText("KOPACIA HRA", renderer.width / 2, y - 48, {
			size: 24,
			align: "center",
			color: "#f4d35e",
		});

		if (this.error !== null) {
			renderer.drawText(`Loading failed: ${this.error}`, renderer.width / 2, y, {
				size: 13,
				align: "center",
				color: "#ff7b72",
			});
			return;
		}

		renderer.fillRect(x, y, width, 8, "#242838");
		renderer.fillRect(x, y, width * this.progress.ratio, 8, "#6ee7a8");
		renderer.drawText(
			`${this.progress.loaded} / ${Math.max(1, this.progress.total)} images`,
			renderer.width / 2,
			y + 18,
			{ size: 12, align: "center", color: "#8b93a7" },
		);
	}
}
