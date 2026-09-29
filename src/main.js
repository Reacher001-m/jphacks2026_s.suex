import GameLoop from './core/GameLoop.js';
import MainGameScene from './scenes/MainGameScene.js';

const canvas = document.querySelector('#game-canvas');
if (!canvas) throw new Error('#game-canvas が見つかりません。');

const scene = new MainGameScene(canvas);
const gameLoop = new GameLoop({
  update: (deltaTime) => scene.update(deltaTime),
  render: () => scene.render(),
});

canvas.focus({ preventScroll: true });
scene.render();
gameLoop.start();

// タブが非表示の間は更新を止め、復帰時の大きな移動を防ぎます。
document.addEventListener('visibilitychange', () => {
  if (document.hidden) gameLoop.stop();
  else gameLoop.start();
});

window.addEventListener('pagehide', () => {
  gameLoop.stop();
  scene.dispose();
}, { once: true });
