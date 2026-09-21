import { AssetLoader } from "@/assets/asset-loader";
import { Input } from "@/core/input";
import { GameLoop } from "@/core/loop";
import { Renderer } from "@/core/renderer";
import { type Scene, type SceneContext, SceneManager } from "@/core/scene";

/** Wires renderer, input, assets, scenes and the loop together. */
export class Game {
	readonly renderer: Renderer;
	readonly input: Input;
	readonly assets: AssetLoader;
	readonly scenes = new SceneManager();
	readonly loop: GameLoop;

	private readonly resizeObserver: ResizeObserver;
	private readonly onVisibilityChange = (): void => {
		// A hidden tab throttles rAF; stopping outright keeps the accumulator clean.
		if (document.hidden) this.loop.stop();
		else if (this.started) this.loop.start();
	};
	private started = false;

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new Renderer(canvas, { pixelArt: true, background: "#0d0f16" });
		this.input = new Input(canvas);
		this.assets = new AssetLoader();
		this.loop = new GameLoop({
			update: (dt) => {
				this.scenes.update(dt);
				this.input.endFrame();
			},
			render: (alpha) => {
				this.renderer.beginFrame();
				this.scenes.render(alpha);
			},
		});

		this.resizeObserver = new ResizeObserver(() => {
			this.renderer.resize();
			this.scenes.resize(this.renderer.width, this.renderer.height);
		});
		this.resizeObserver.observe(canvas);
		document.addEventListener("visibilitychange", this.onVisibilityChange);
	}

	get context(): SceneContext {
		return {
			renderer: this.renderer,
			input: this.input,
			assets: this.assets,
			scenes: this.scenes,
			loop: this.loop,
		};
	}

	async start(initialScene: Scene): Promise<void> {
		this.scenes.attach(this.context);
		this.started = true;
		await this.scenes.change(initialScene);
		this.loop.start();
	}

	destroy(): void {
		this.started = false;
		this.loop.stop();
		this.resizeObserver.disconnect();
		document.removeEventListener("visibilitychange", this.onVisibilityChange);
		this.input.dispose();
		this.assets.collect();
	}
}
