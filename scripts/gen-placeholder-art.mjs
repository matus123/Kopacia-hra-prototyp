// Generates the placeholder PNGs in src/images/.
// Replace those files with real art whenever you like - nothing depends on this script at runtime.

import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { deflateSync } from "node:zlib";

const OUT = fileURLToPath(new URL("../src/images/", import.meta.url));

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	return c >>> 0;
});
const crc32 = (buf) => {
	let c = 0xffffffff;
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
};

class Bitmap {
	constructor(w, h) {
		this.w = w;
		this.h = h;
		this.px = new Uint8Array(w * h * 4);
	}
	set(x, y, [r, g, b, a = 255]) {
		if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
		const i = (y * this.w + x) * 4;
		this.px[i] = r;
		this.px[i + 1] = g;
		this.px[i + 2] = b;
		this.px[i + 3] = a;
	}
	rect(x, y, w, h, color) {
		for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) this.set(i, j, color);
	}
	toPNG() {
		const raw = Buffer.alloc(this.h * (this.w * 4 + 1));
		for (let y = 0; y < this.h; y++) {
			raw[y * (this.w * 4 + 1)] = 0; // filter: none
			Buffer.from(this.px.buffer, y * this.w * 4, this.w * 4).copy(raw, y * (this.w * 4 + 1) + 1);
		}
		const ihdr = Buffer.alloc(13);
		ihdr.writeUInt32BE(this.w, 0);
		ihdr.writeUInt32BE(this.h, 4);
		ihdr[8] = 8; // bit depth
		ihdr[9] = 6; // RGBA
		return Buffer.concat([
			Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
			chunk("IHDR", ihdr),
			chunk("IDAT", deflateSync(raw, { level: 9 })),
			chunk("IEND", Buffer.alloc(0)),
		]);
	}
}

let seed = 1337;
const rnd = () => {
	seed = (seed * 1664525 + 1013904223) >>> 0;
	return seed / 0x100000000;
};
const shade = ([r, g, b], k) => [
	Math.max(0, Math.min(255, Math.round(r * k))),
	Math.max(0, Math.min(255, Math.round(g * k))),
	Math.max(0, Math.min(255, Math.round(b * k))),
	255,
];

const TILE = 32;

/** Atlas: one row of 32x32 tiles - dirt, stone, gold, bedrock. */
function tileset() {
	const kinds = [
		{ base: [134, 94, 58], speck: [96, 64, 38] },
		{ base: [120, 124, 132], speck: [88, 92, 100] },
		{ base: [120, 124, 132], speck: [88, 92, 100], ore: [232, 186, 62] },
		{ base: [52, 50, 60], speck: [34, 33, 40] },
	];
	const bmp = new Bitmap(TILE * kinds.length, TILE);
	kinds.forEach((kind, index) => {
		const ox = index * TILE;
		for (let y = 0; y < TILE; y++) {
			for (let x = 0; x < TILE; x++) {
				const grain = 0.88 + rnd() * 0.24;
				bmp.set(ox + x, y, shade(rnd() < 0.18 ? kind.speck : kind.base, grain));
			}
		}
		if (kind.ore) {
			for (let blob = 0; blob < 4; blob++) {
				const cx = 6 + Math.floor(rnd() * 20);
				const cy = 6 + Math.floor(rnd() * 20);
				const r = 2 + rnd() * 2;
				for (let y = -4; y <= 4; y++) {
					for (let x = -4; x <= 4; x++) {
						if (x * x + y * y <= r * r) {
							bmp.set(ox + cx + x, cy + y, shade(kind.ore, y < 0 ? 1.12 : 0.82));
						}
					}
				}
			}
		}
		// bevel: lit top/left edge, dark bottom/right edge
		for (let i = 0; i < TILE; i++) {
			bmp.set(ox + i, 0, shade(kind.base, 1.35));
			bmp.set(ox, i, shade(kind.base, 1.2));
			bmp.set(ox + i, TILE - 1, shade(kind.base, 0.6));
			bmp.set(ox + TILE - 1, i, shade(kind.base, 0.7));
		}
	});
	return bmp;
}

/** Miner: 4 frames of 24x32 - idle, walk A, walk B, dig. */
function player() {
	const frames = 4;
	const w = 24;
	const h = 32;
	const bmp = new Bitmap(w * frames, h);
	const skin = [226, 176, 132, 255];
	const suit = [58, 104, 168, 255];
	const helmet = [240, 188, 54, 255];
	const boot = [46, 44, 52, 255];
	for (let f = 0; f < frames; f++) {
		const ox = f * w;
		bmp.rect(ox + 6, 2, 12, 6, helmet);
		bmp.rect(ox + 16, 4, 3, 2, [255, 248, 206, 255]); // lamp
		bmp.rect(ox + 7, 8, 10, 6, skin);
		bmp.rect(ox + 5, 14, 14, 11, suit);
		const swing = f === 3 ? 4 : 0;
		bmp.rect(ox + 2, 15 + swing, 4, 8 - swing, skin); // back arm
		bmp.rect(ox + 18, 15 - swing, 4, 8, skin); // front arm
		const stride = f === 1 ? 2 : f === 2 ? -2 : 0;
		bmp.rect(ox + 6 + stride, 25, 5, 7, boot);
		bmp.rect(ox + 13 - stride, 25, 5, 7, boot);
		if (f === 3) {
			bmp.rect(ox + 20, 10, 3, 10, [150, 150, 158, 255]); // pickaxe shaft
			bmp.rect(ox + 17, 8, 7, 3, [196, 198, 206, 255]); // pickaxe head
		}
	}
	return bmp;
}

/** Seamless-ish parallax background strip. */
function sky() {
	const bmp = new Bitmap(256, 128);
	for (let y = 0; y < 128; y++) {
		const t = y / 127;
		const color = [Math.round(28 + t * 34), Math.round(34 + t * 28), Math.round(58 + t * 22), 255];
		bmp.rect(0, y, 256, 1, color);
	}
	for (let i = 0; i < 90; i++) {
		const x = Math.floor(rnd() * 256);
		const y = Math.floor(rnd() * 96);
		const v = 160 + Math.floor(rnd() * 95);
		bmp.set(x, y, [v, v, Math.min(255, v + 20), 255]);
	}
	return bmp;
}

mkdirSync(OUT, { recursive: true });
for (const [name, bmp] of Object.entries({ tileset: tileset(), player: player(), sky: sky() })) {
	writeFileSync(`${OUT}${name}.png`, bmp.toPNG());
	console.log(`wrote src/images/${name}.png (${bmp.w}x${bmp.h})`);
}
