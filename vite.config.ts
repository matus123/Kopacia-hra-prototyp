import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

export default defineConfig({
	base: "./",
	resolve: {
		alias: {
			"@": fileURLToPath(new URL("./src", import.meta.url)),
		},
	},
	server: {
		port: 5173,
		open: false,
	},
	build: {
		target: "es2022",
		outDir: "dist",
		sourcemap: true,
		assetsInlineLimit: 0,
	},
});
