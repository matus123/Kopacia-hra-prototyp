import {
	type AssetGroup,
	IMAGE_MANIFEST,
	type ImageKey,
	imageKeys,
	keysInGroup,
} from "@/assets/manifest";

export type LoadState = "idle" | "loading" | "ready" | "failed";

export interface LoadProgress {
	readonly loaded: number;
	readonly total: number;
	/** 0..1, and 1 when there is nothing to do. */
	readonly ratio: number;
}

/**
 * A claim on a set of images. While at least one lease holds a key, the loader
 * refuses to free it; `release()` drops the claim and lets the next unload sweep
 * reclaim the memory. Calling `release()` twice is a no-op.
 */
export interface AssetLease {
	readonly keys: readonly ImageKey[];
	release(): void;
}

interface Entry {
	state: LoadState;
	refs: number;
	image: ImageBitmap | HTMLImageElement | null;
	pending: Promise<void> | null;
	error: Error | null;
}

export interface AssetLoaderOptions {
	/**
	 * Decode off the main thread with `createImageBitmap`. Keep it on unless you
	 * need the raw `HTMLImageElement` (e.g. for CSS reuse).
	 */
	readonly preferBitmap?: boolean;
	/** How many images may be in flight at once. */
	readonly concurrency?: number;
}

/**
 * Loads images on demand, keeps them alive by reference count, and hands the
 * decoded result to the renderer as a `CanvasImageSource`.
 *
 * Typical use from a scene:
 *   const lease = await assets.acquire(["tileset", "player"], onProgress);
 *   ...
 *   lease.release();      // in the scene's exit()
 *   assets.collect();     // free everything no lease holds
 */
export class AssetLoader {
	private readonly entries = new Map<ImageKey, Entry>();
	private readonly preferBitmap: boolean;
	private readonly concurrency: number;

	constructor(options: AssetLoaderOptions = {}) {
		this.preferBitmap = options.preferBitmap ?? typeof createImageBitmap === "function";
		this.concurrency = Math.max(1, options.concurrency ?? 8);
		for (const key of imageKeys) {
			this.entries.set(key, { state: "idle", refs: 0, image: null, pending: null, error: null });
		}
	}

	/** Loads the keys if needed and takes a reference on each one. */
	async acquire(
		keys: readonly ImageKey[],
		onProgress?: (progress: LoadProgress) => void,
	): Promise<AssetLease> {
		const claimed = [...new Set(keys)];
		for (const key of claimed) {
			this.entry(key).refs += 1;
		}
		try {
			await this.load(claimed, onProgress);
		} catch (error) {
			for (const key of claimed) {
				this.entry(key).refs -= 1;
			}
			throw error;
		}
		return this.makeLease(claimed);
	}

	/** Same as `acquire`, for a whole group from the manifest. */
	acquireGroup(
		group: AssetGroup,
		onProgress?: (progress: LoadProgress) => void,
	): Promise<AssetLease> {
		return this.acquire(keysInGroup(group), onProgress);
	}

	/** Loads without taking a reference - for warm-up/prefetch during idle time. */
	async load(
		keys: readonly ImageKey[],
		onProgress?: (progress: LoadProgress) => void,
	): Promise<void> {
		const queue = [...new Set(keys)];
		const total = queue.length;
		let loaded = 0;

		const report = () => onProgress?.({ loaded, total, ratio: total === 0 ? 1 : loaded / total });
		report();

		const failures: Error[] = [];
		const worker = async (): Promise<void> => {
			for (let key = queue.shift(); key !== undefined; key = queue.shift()) {
				try {
					await this.loadOne(key);
				} catch (error) {
					failures.push(error instanceof Error ? error : new Error(String(error)));
				}
				loaded += 1;
				report();
			}
		};

		await Promise.all(Array.from({ length: Math.min(this.concurrency, total) }, () => worker()));

		if (failures.length > 0) {
			throw new AggregateError(failures, `Failed to load ${failures.length} image(s)`);
		}
	}

	/** The decoded image. Throws if it is not loaded - a bug, not a runtime condition. */
	image(key: ImageKey): CanvasImageSource {
		const entry = this.entry(key);
		if (entry.state !== "ready" || entry.image === null) {
			throw new Error(`Image "${key}" is not loaded (state: ${entry.state})`);
		}
		return entry.image;
	}

	/** The decoded image, or null while it is missing - for optional art. */
	tryImage(key: ImageKey): CanvasImageSource | null {
		const entry = this.entry(key);
		return entry.state === "ready" ? entry.image : null;
	}

	isReady(key: ImageKey): boolean {
		return this.entry(key).state === "ready";
	}

	stateOf(key: ImageKey): LoadState {
		return this.entry(key).state;
	}

	/** Frees every loaded image no lease is holding. Returns how many were freed. */
	collect(): number {
		let freed = 0;
		for (const [key, entry] of this.entries) {
			if (entry.refs <= 0 && entry.state === "ready") {
				this.dispose(key, entry);
				freed += 1;
			}
		}
		return freed;
	}

	/**
	 * Frees a group regardless of leases. Use when tearing down a level whose
	 * scenes are already gone; prefer `collect()` during normal play.
	 */
	unloadGroup(group: AssetGroup): number {
		let freed = 0;
		for (const key of keysInGroup(group)) {
			const entry = this.entry(key);
			if (entry.state === "ready") {
				entry.refs = 0;
				this.dispose(key, entry);
				freed += 1;
			}
		}
		return freed;
	}

	/** Snapshot for debug overlays. */
	stats(): { ready: number; loading: number; referenced: number; total: number } {
		let ready = 0;
		let loading = 0;
		let referenced = 0;
		for (const entry of this.entries.values()) {
			if (entry.state === "ready") ready += 1;
			if (entry.state === "loading") loading += 1;
			if (entry.refs > 0) referenced += 1;
		}
		return { ready, loading, referenced, total: this.entries.size };
	}

	private makeLease(keys: readonly ImageKey[]): AssetLease {
		let released = false;
		return {
			keys,
			release: () => {
				if (released) return;
				released = true;
				for (const key of keys) {
					const entry = this.entry(key);
					entry.refs = Math.max(0, entry.refs - 1);
				}
			},
		};
	}

	private loadOne(key: ImageKey): Promise<void> {
		const entry = this.entry(key);
		if (entry.state === "ready") return Promise.resolve();
		if (entry.pending !== null) return entry.pending;

		entry.state = "loading";
		entry.error = null;
		entry.pending = this.fetchImage(IMAGE_MANIFEST[key].url)
			.then((image) => {
				entry.image = image;
				entry.state = "ready";
			})
			.catch((cause: unknown) => {
				entry.state = "failed";
				entry.error = new Error(`Could not load image "${key}"`, { cause });
				throw entry.error;
			})
			.finally(() => {
				entry.pending = null;
			});

		return entry.pending;
	}

	private async fetchImage(url: string): Promise<ImageBitmap | HTMLImageElement> {
		const element = new Image();
		element.decoding = "async";
		element.src = url;

		await new Promise<void>((resolve, reject) => {
			element.addEventListener("load", () => resolve(), { once: true });
			element.addEventListener("error", () => reject(new Error(`404 or decode error: ${url}`)), {
				once: true,
			});
		});

		if (!this.preferBitmap) return element;
		try {
			return await createImageBitmap(element);
		} catch {
			// Some browsers refuse createImageBitmap for certain sources; the element works fine.
			return element;
		}
	}

	private dispose(key: ImageKey, entry: Entry): void {
		if (entry.image !== null && "close" in entry.image) {
			entry.image.close();
		}
		entry.image = null;
		entry.state = "idle";
		entry.error = null;
		this.entries.set(key, entry);
	}

	private entry(key: ImageKey): Entry {
		const entry = this.entries.get(key);
		if (entry === undefined) {
			throw new Error(`Unknown image key: "${key}"`);
		}
		return entry;
	}
}
