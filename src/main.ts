import "@/style.css";
import { Game } from "@/core/game";
import { LoadingScene } from "@/game/scenes/loading-scene";
import { PlayScene } from "@/game/scenes/play-scene";

const canvas = document.querySelector<HTMLCanvasElement>("#game");
if (canvas === null) {
	throw new Error('No <canvas id="game"> in the document');
}

const game = new Game(canvas);
void game.start(new LoadingScene("world", () => new PlayScene()));

// Keep the running game across hot reloads instead of stacking listeners.
if (import.meta.hot) {
	import.meta.hot.dispose(() => game.destroy());
}
