export interface LoopCallbacks {
	/** Called at a fixed rate. `dt` is always the same number of seconds. */
	update(dt: number): void;
	/** Called once per animation frame. `alpha` is 0..1 between the last two updates. */
	render(alpha: number): void;
}

export interface LoopOptions {
	/** Updates per second. 60 is a sane default for a 2D game. */
	readonly updatesPerSecond?: number;
	/**
	 * Largest real-time step the loop will simulate in one frame. Anything longer
	 * (a backgrounded tab, a breakpoint) is dropped rather than simulated, so the
	 * game never tries to catch up on 30 seconds at once.
	 */
	readonly maxFrameSeconds?: number;
}

/**
 * Fixed-timestep loop with an accumulator: physics is deterministic and
 * frame-rate independent, rendering runs as fast as the display allows.
 */
export class GameLoop {
	private readonly step: number;
	private readonly maxFrameSeconds: number;
	private accumulator = 0;
	private lastTime = 0;
	private frameHandle = 0;
	private running = false;

	/** Smoothed frames per second, for the debug overlay. */
	fps = 0;

	constructor(
		private readonly callbacks: LoopCallbacks,
		options: LoopOptions = {},
	) {
		this.step = 1 / (options.updatesPerSecond ?? 60);
		this.maxFrameSeconds = options.maxFrameSeconds ?? 0.25;
	}

	get isRunning(): boolean {
		return this.running;
	}

	start(): void {
		if (this.running) return;
		this.running = true;
		this.lastTime = performance.now();
		this.accumulator = 0;
		this.frameHandle = requestAnimationFrame(this.tick);
	}

	stop(): void {
		if (!this.running) return;
		this.running = false;
		cancelAnimationFrame(this.frameHandle);
	}

	private readonly tick = (now: number): void => {
		if (!this.running) return;
		this.frameHandle = requestAnimationFrame(this.tick);

		const elapsed = Math.min((now - this.lastTime) / 1000, this.maxFrameSeconds);
		this.lastTime = now;
		this.accumulator += elapsed;

		if (elapsed > 0) {
			this.fps += (1 / elapsed - this.fps) * 0.1;
		}

		while (this.accumulator >= this.step) {
			this.callbacks.update(this.step);
			this.accumulator -= this.step;
		}

		this.callbacks.render(this.accumulator / this.step);
	};
}
