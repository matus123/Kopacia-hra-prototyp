export interface PointerState {
	/** Position in CSS pixels relative to the canvas. */
	x: number;
	y: number;
	down: boolean;
	pressed: boolean;
	released: boolean;
	inside: boolean;
}

/**
 * Keyboard + pointer state, sampled per frame.
 *
 * `isDown` answers "held right now"; `wasPressed` answers "went down since the
 * last frame" and is cleared by `endFrame()`, which the game loop calls once
 * per update - so a press is never missed and never handled twice.
 */
export class Input {
	readonly pointer: PointerState = {
		x: 0,
		y: 0,
		down: false,
		pressed: false,
		released: false,
		inside: false,
	};

	private readonly down = new Set<string>();
	private readonly pressed = new Set<string>();
	private readonly released = new Set<string>();
	private readonly detach: Array<() => void> = [];

	constructor(private readonly target: HTMLElement) {
		this.listen(window, "keydown", (event) => {
			const key = normalize((event as KeyboardEvent).code);
			// Stop the browser scrolling the page out from under the game.
			if (SCROLL_KEYS.has(key)) event.preventDefault();
			if ((event as KeyboardEvent).repeat) return;
			this.down.add(key);
			this.pressed.add(key);
		});
		this.listen(window, "keyup", (event) => {
			const key = normalize((event as KeyboardEvent).code);
			this.down.delete(key);
			this.released.add(key);
		});
		// A lost focus must not leave keys stuck down.
		this.listen(window, "blur", () => this.reset());

		this.listen(target, "pointermove", (event) => this.trackPointer(event as PointerEvent));
		this.listen(target, "pointerdown", (event) => {
			const pointerEvent = event as PointerEvent;
			target.setPointerCapture?.(pointerEvent.pointerId);
			this.trackPointer(pointerEvent);
			this.pointer.down = true;
			this.pointer.pressed = true;
		});
		this.listen(window, "pointerup", (event) => {
			this.trackPointer(event as PointerEvent);
			this.pointer.down = false;
			this.pointer.released = true;
		});
		this.listen(target, "pointerleave", () => {
			this.pointer.inside = false;
		});
		this.listen(target, "contextmenu", (event) => event.preventDefault());
	}

	isDown(...keys: string[]): boolean {
		return keys.some((key) => this.down.has(normalize(key)));
	}

	wasPressed(...keys: string[]): boolean {
		return keys.some((key) => this.pressed.has(normalize(key)));
	}

	wasReleased(...keys: string[]): boolean {
		return keys.some((key) => this.released.has(normalize(key)));
	}

	/** -1, 0 or 1 from a pair of opposing keys. */
	axis(negative: string[], positive: string[]): number {
		return (this.isDown(...positive) ? 1 : 0) - (this.isDown(...negative) ? 1 : 0);
	}

	/** Clears the one-frame edges. The game loop calls this after each update. */
	endFrame(): void {
		this.pressed.clear();
		this.released.clear();
		this.pointer.pressed = false;
		this.pointer.released = false;
	}

	reset(): void {
		this.down.clear();
		this.pressed.clear();
		this.released.clear();
		this.pointer.down = false;
	}

	dispose(): void {
		for (const off of this.detach) off();
		this.detach.length = 0;
		this.reset();
	}

	private trackPointer(event: PointerEvent): void {
		const rect = this.target.getBoundingClientRect();
		this.pointer.x = event.clientX - rect.left;
		this.pointer.y = event.clientY - rect.top;
		this.pointer.inside =
			this.pointer.x >= 0 &&
			this.pointer.y >= 0 &&
			this.pointer.x < rect.width &&
			this.pointer.y < rect.height;
	}

	private listen(node: Window | HTMLElement, type: string, handler: (event: Event) => void): void {
		node.addEventListener(type, handler, { passive: false });
		this.detach.push(() => node.removeEventListener(type, handler));
	}
}

const SCROLL_KEYS = new Set([
	"arrowup",
	"arrowdown",
	"arrowleft",
	"arrowright",
	"space",
	"pageup",
	"pagedown",
]);

/** Accepts both `KeyboardEvent.code` ("KeyA", "Space") and plain names ("a", "space"). */
function normalize(key: string): string {
	const lower = key.toLowerCase();
	return lower.startsWith("key") || lower.startsWith("digit")
		? lower.replace(/^key|^digit/, "")
		: lower;
}
