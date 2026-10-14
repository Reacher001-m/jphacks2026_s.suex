import InputHandler from '../core/InputHandler.js';
import StageManager from '../core/StageManager.js';
import BossQuizScene from './BossQuizScene.js';
import STAGES from '../data/stages.js';

const COLORS = {
  background: '#101923',
  floor: '#172631',
  grid: 'rgba(157, 190, 196, 0.08)',
  wall: '#344955',
  wallTop: '#526b75',
  player: '#70e1c1',
  playerOutline: '#d5fff2',
  accent: '#f3c969',
  skillPotion: '#4aa8ff',
  lifePotion: '#ff5e68',
  locked: '#db7d59',
  unlocked: '#70e1c1',
  text: '#eff7f5',
  muted: '#a7b9b8',
};

/** 1画面のCanvasダンジョンとプレイヤー操作を管理します。 */
export default class MainGameScene {
  constructor(canvas) {
    if (!(canvas instanceof HTMLCanvasElement)) {
      throw new TypeError('MainGameSceneにはCanvas要素を指定してください。');
    }

    this.canvas = canvas;
    this.context = canvas.getContext('2d');
    if (!this.context) throw new Error('Canvas 2Dコンテキストを取得できません。');

    this.width = canvas.width;
    this.height = canvas.height;
    this.tileSize = 40;
    this.stageManager = new StageManager(STAGES);
    this.stage = this.stageManager.current;
    this.player = {
      x: (this.stage.start.x + 0.5) * this.tileSize,
      y: (this.stage.start.y + 0.5) * this.tileSize,
      radius: 13,
      facing: this.stage.start.facing,
      hp: 2,
      maxHp: 3,
      skillEnergy: 1,
    };
    this.inventory = { skillPotion: 0, lifePotion: 0 };
    this.loadStage(this.stage);
    this.lastShortcutMessage = '矢印キー / WASD で1マスずつ移動';

    this.input = new InputHandler({
      onMove: (direction, pressed) => this.handleMove(direction, pressed),
      onShortcut: (shortcut) => this.handleShortcut(shortcut),
    });
    this.input.attach(canvas);
    this.bossQuiz = new BossQuizScene({
      canvas,
      player: this.player,
      onRetry: () => this.resetRun(),
    });
    this.canvas.addEventListener('click', this.focusCanvas);
  }

  focusCanvas = () => {
    this.canvas.focus({ preventScroll: true });
  };

  handleMove(direction, pressed) {
    if (!pressed || this.bossQuiz.active) return;

    const offsets = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };
    const offset = offsets[direction];
    if (!offset) return;

    this.player.facing = direction;
    const tile = this.getPlayerTile();
    const nextX = tile.x + offset.x;
    const nextY = tile.y + offset.y;
    if (!this.canOccupy(nextX, nextY)) {
      this.lastShortcutMessage = 'そのマスには進めません';
      return;
    }

    this.recordUndo();
    this.player.x = (nextX + 0.5) * this.tileSize;
    this.player.y = (nextY + 0.5) * this.tileSize;
    this.collectNearbyItems();
    this.checkGoal();
  }

  handleShortcut({ action, modifier }) {
    if (action === 'undo') {
      this.undo();
      return;
    }
    if (action === 'redo') {
      this.redo();
      return;
    }

    const target = this.getTargetTile();
    const blockIndex = this.blocks.findIndex((block) => block.x === target.x && block.y === target.y);
    const block = this.blocks[blockIndex];
    const modifierLabel = modifier === 'Meta' ? 'Cmd' : 'Ctrl';

    if (action === 'copy' || action === 'cut') {
      if (!block) {
        this.lastShortcutMessage = `${modifierLabel}+${action === 'copy' ? 'C' : 'X'}: 前方に操作可能なブロックがありません`;
        return;
      }
      this.recordUndo();
      this.clipboard = { ...block };
      if (action === 'cut') this.blocks.splice(blockIndex, 1);
      if (action === 'copy' && this.stage.shortcutGate) this.shortcutGateOpen = true;
      this.lastShortcutMessage = action === 'copy'
        ? `${block.name}をコピーしました${this.shortcutGateOpen ? '。裏道ゲートが開きました' : ''}`
        : `${block.name}を切り取りました`;
      return;
    }

    if (action === 'paste') {
      if (!this.clipboard) {
        this.lastShortcutMessage = 'クリップボードにブロックがありません';
        return;
      }
      if (!this.isEmptyFloor(target.x, target.y)) {
        this.lastShortcutMessage = '前方が空きマスではないため配置できません';
        return;
      }
      this.recordUndo();
      this.blockIdSequence += 1;
      this.blocks.push({ ...this.clipboard, id: `block-${this.blockIdSequence}`, x: target.x, y: target.y });
      this.lastShortcutMessage = `${this.clipboard.name}を前方に配置しました`;
      return;
    }

    this.lastShortcutMessage = `${modifierLabel}+${action.toUpperCase()} はブロック操作ではありません`;
  }

  getPlayerTile() {
    return {
      x: Math.floor(this.player.x / this.tileSize),
      y: Math.floor(this.player.y / this.tileSize),
    };
  }

  loadStage(stage) {
    this.stage = stage;
    this.obstacles = stage.obstacles.map((obstacle) => ({ ...obstacle }));
    this.items = stage.items.map((item) => ({ ...item, collected: false }));
    this.blocks = stage.blocks.map((block) => ({ ...block }));
    this.initialBlocks = this.blocks.map((block) => ({ ...block }));
    this.blockIdSequence = this.blocks.length;
    this.goal = { ...stage.goal, radius: 19 };
    this.shortcutGateOpen = false;
    this.clipboard = null;
    this.undoStack = [];
    this.redoStack = [];
    this.player.x = (stage.start.x + 0.5) * this.tileSize;
    this.player.y = (stage.start.y + 0.5) * this.tileSize;
    this.player.facing = stage.start.facing;
  }

  getTargetTile() {
    const tile = this.getPlayerTile();
    const offsets = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };
    const offset = offsets[this.player.facing];
    return { x: tile.x + offset.x, y: tile.y + offset.y };
  }

  isFixedObstacle(tileX, tileY) {
    const isWall = this.obstacles.some((obstacle) => (
      tileX >= obstacle.x
      && tileX < obstacle.x + obstacle.width
      && tileY >= obstacle.y
      && tileY < obstacle.y + obstacle.height
    ));
    const gate = this.stage.shortcutGate;
    const isClosedGate = gate && !this.shortcutGateOpen && tileX === gate.x && tileY === gate.y;
    return isWall || isClosedGate;
  }

  isEmptyFloor(tileX, tileY) {
    const columns = this.width / this.tileSize;
    const rows = this.height / this.tileSize;
    if (tileX <= 0 || tileY <= 0 || tileX >= columns - 1 || tileY >= rows - 1) return false;
    if (this.isFixedObstacle(tileX, tileY)) return false;
    return !this.blocks.some((block) => block.x === tileX && block.y === tileY);
  }

  captureState() {
    return {
      x: this.player.x,
      y: this.player.y,
      facing: this.player.facing,
      blocks: this.blocks.map((block) => ({ ...block })),
      clipboard: this.clipboard ? { ...this.clipboard } : null,
      shortcutGateOpen: this.shortcutGateOpen,
    };
  }

  restoreState(state) {
    this.player.x = state.x;
    this.player.y = state.y;
    this.player.facing = state.facing;
    this.blocks = state.blocks.map((block) => ({ ...block }));
    this.clipboard = state.clipboard ? { ...state.clipboard } : null;
    this.shortcutGateOpen = state.shortcutGateOpen;
  }

  recordUndo() {
    this.undoStack.push(this.captureState());
    this.redoStack.length = 0;
  }

  undo() {
    if (this.undoStack.length === 0) {
      this.lastShortcutMessage = '取り消せる操作がありません';
      return;
    }
    this.redoStack.push(this.captureState());
    this.restoreState(this.undoStack.pop());
    this.lastShortcutMessage = '直前の操作を取り消しました';
  }

  redo() {
    if (this.redoStack.length === 0) {
      this.lastShortcutMessage = 'やり直せる操作がありません';
      return;
    }
    this.undoStack.push(this.captureState());
    this.restoreState(this.redoStack.pop());
    this.lastShortcutMessage = '操作をやり直しました';
  }

  update() {
    if (!this.bossQuiz.active) this.collectNearbyItems();
  }

  collectNearbyItems() {
    for (const item of this.items) {
      if (item.collected) continue;
      const itemX = (item.x + 0.5) * this.tileSize;
      const itemY = (item.y + 0.5) * this.tileSize;
      if (Math.hypot(this.player.x - itemX, this.player.y - itemY) > this.player.radius + 12) continue;

      item.collected = true;
      this.inventory[item.type] += 1;
      if (item.type === 'skillPotion') {
        this.player.skillEnergy += 2;
        this.lastShortcutMessage = '青いスキルポーションを入手！エナジー +2';
      } else {
        this.player.hp = Math.min(this.player.maxHp, this.player.hp + 1);
        this.lastShortcutMessage = '赤いライフポーションを入手！HP +1';
      }
    }
  }

  checkGoal() {
    const tile = this.getPlayerTile();
    if (tile.x !== this.goal.x || tile.y !== this.goal.y) return;

    if (this.stage.goalBlock && !this.blocks.some((block) => (
      block.x === this.stage.goalBlock.x && block.y === this.stage.goalBlock.y
    ))) {
      this.lastShortcutMessage = 'ゴールの紋章に木箱を配置してください';
      return;
    }

    const nextStage = this.stageManager.advance();
    if (nextStage) {
      this.loadStage(nextStage);
      this.lastShortcutMessage = `STAGE ${nextStage.number}開始: ${nextStage.name}`;
      return;
    }

    this.input.setEnabled(false);
    this.bossQuiz.start();
  }

  isGoalUnlocked() {
    return !this.stage.goalBlock || this.blocks.some((block) => (
      block.x === this.stage.goalBlock.x && block.y === this.stage.goalBlock.y
    ));
  }

  resetRun() {
    this.bossQuiz.stop();
    this.player.hp = this.player.maxHp;
    this.player.skillEnergy = 1;
    this.inventory.skillPotion = 0;
    this.inventory.lifePotion = 0;
    this.stage = this.stageManager.reset();
    this.loadStage(this.stage);
    this.lastShortcutMessage = 'ダンジョンに再挑戦！青いポーションを回収しよう';
    this.input.setEnabled(true);
    this.canvas.focus({ preventScroll: true });
  }

  canOccupy(tileX, tileY) {
    if (!this.isEmptyFloor(tileX, tileY)) return false;
    const goalTile = tileX === this.goal.x && tileY === this.goal.y;
    return !goalTile || this.blocks.every((block) => block.x !== tileX || block.y !== tileY);
  }

  render() {
    const { context: ctx, width, height, tileSize } = this;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    this.drawFloor(ctx);
    this.drawGoal(ctx);
    this.drawObstacles(ctx);
    this.drawShortcutGate(ctx);
    this.drawGoalSocket(ctx);
    this.drawBlocks(ctx);
    this.drawItems(ctx);
    this.drawTargetCursor(ctx);
    this.drawHud(ctx);
    this.drawPlayer(ctx);
    this.bossQuiz.render(ctx, width, height);
  }

  drawGoal(ctx) {
    const x = (this.goal.x + 0.5) * this.tileSize;
    const y = (this.goal.y + 0.5) * this.tileSize;
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, this.goal.radius, 0, Math.PI * 2);
    ctx.fillStyle = this.isGoalUnlocked() ? 'rgba(112, 225, 193, 0.22)' : 'rgba(243, 201, 105, 0.14)';
    ctx.fill();
    ctx.strokeStyle = this.isGoalUnlocked() ? '#70e1c1' : '#f3c969';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = this.isGoalUnlocked() ? '#70e1c1' : '#f3c969';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.isGoalUnlocked() ? 'GOAL' : 'LOCK', x, y + 4);
    ctx.restore();
  }

  drawShortcutGate(ctx) {
    const gate = this.stage.shortcutGate;
    if (!gate) return;
    const x = gate.x * this.tileSize;
    const y = gate.y * this.tileSize;
    ctx.fillStyle = this.shortcutGateOpen ? 'rgba(112, 225, 193, 0.18)' : 'rgba(219, 125, 89, 0.35)';
    ctx.fillRect(x + 3, y + 3, this.tileSize - 6, this.tileSize - 6);
    ctx.strokeStyle = this.shortcutGateOpen ? COLORS.unlocked : COLORS.locked;
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 4, y + 4, this.tileSize - 8, this.tileSize - 8);
    ctx.fillStyle = this.shortcutGateOpen ? COLORS.unlocked : COLORS.locked;
    ctx.font = '700 10px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(this.shortcutGateOpen ? 'OPEN' : 'COPY', x + this.tileSize / 2, y + this.tileSize / 2 + 3);
    ctx.textAlign = 'left';
  }

  drawGoalSocket(ctx) {
    if (!this.stage.goalBlock) return;
    const x = this.stage.goalBlock.x * this.tileSize;
    const y = this.stage.goalBlock.y * this.tileSize;
    ctx.save();
    ctx.strokeStyle = this.isGoalUnlocked() ? 'rgba(112, 225, 193, 0.35)' : 'rgba(243, 201, 105, 0.85)';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(x + 5, y + 5, this.tileSize - 10, this.tileSize - 10);
    ctx.setLineDash([]);
    if (!this.isGoalUnlocked()) {
      ctx.fillStyle = '#f3c969';
      ctx.font = '700 9px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PLACE', x + this.tileSize / 2, y + this.tileSize / 2 + 3);
    }
    ctx.restore();
  }

  drawFloor(ctx) {
    const { width, height, tileSize } = this;
    ctx.fillStyle = COLORS.floor;
    ctx.fillRect(tileSize, tileSize, width - tileSize * 2, height - tileSize * 2);

    ctx.beginPath();
    for (let x = tileSize; x <= width - tileSize; x += tileSize) {
      ctx.moveTo(x, tileSize);
      ctx.lineTo(x, height - tileSize);
    }
    for (let y = tileSize; y <= height - tileSize; y += tileSize) {
      ctx.moveTo(tileSize, y);
      ctx.lineTo(width - tileSize, y);
    }
    ctx.strokeStyle = COLORS.grid;
    ctx.lineWidth = 1;
    ctx.stroke();

    ctx.fillStyle = COLORS.wall;
    ctx.fillRect(0, 0, width, tileSize);
    ctx.fillRect(0, height - tileSize, width, tileSize);
    ctx.fillRect(0, tileSize, tileSize, height - tileSize * 2);
    ctx.fillRect(width - tileSize, tileSize, tileSize, height - tileSize * 2);
    ctx.strokeStyle = COLORS.wallTop;
    ctx.lineWidth = 2;
    ctx.strokeRect(tileSize, tileSize, width - tileSize * 2, height - tileSize * 2);
  }

  drawObstacles(ctx) {
    for (const obstacle of this.obstacles) {
      const x = obstacle.x * this.tileSize;
      const y = obstacle.y * this.tileSize;
      const width = obstacle.width * this.tileSize;
      const height = obstacle.height * this.tileSize;
      ctx.fillStyle = COLORS.wall;
      ctx.fillRect(x + 3, y + 3, width - 6, height - 6);
      ctx.fillStyle = COLORS.wallTop;
      ctx.fillRect(x + 6, y + 6, width - 12, 5);
    }
  }

  drawBlocks(ctx) {
    for (const block of this.blocks) {
      const x = block.x * this.tileSize;
      const y = block.y * this.tileSize;
      ctx.fillStyle = block.color;
      ctx.fillRect(x + 4, y + 4, this.tileSize - 8, this.tileSize - 8);
      ctx.strokeStyle = '#e8d1ae';
      ctx.lineWidth = 2;
      ctx.strokeRect(x + 7, y + 7, this.tileSize - 14, this.tileSize - 14);
      ctx.fillStyle = '#fff7e9';
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(block.name, x + this.tileSize / 2, y + this.tileSize / 2 + 4);
    }
    ctx.textAlign = 'left';
  }

  drawTargetCursor(ctx) {
    const target = this.getTargetTile();
    const x = target.x * this.tileSize;
    const y = target.y * this.tileSize;
    ctx.save();
    ctx.fillStyle = 'rgba(112, 225, 193, 0.08)';
    ctx.fillRect(x + 2, y + 2, this.tileSize - 4, this.tileSize - 4);
    ctx.strokeStyle = 'rgba(172, 255, 226, 0.78)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 3, y + 3, this.tileSize - 6, this.tileSize - 6);
    ctx.restore();
  }

  drawItems(ctx) {
    for (const item of this.items) {
      if (item.collected) continue;
      const x = (item.x + 0.5) * this.tileSize;
      const y = (item.y + 0.5) * this.tileSize;
      const isSkillPotion = item.type === 'skillPotion';

      ctx.save();
      ctx.shadowColor = isSkillPotion ? COLORS.skillPotion : COLORS.lifePotion;
      ctx.shadowBlur = 13;
      ctx.beginPath();
      ctx.arc(x, y, 10, 0, Math.PI * 2);
      ctx.fillStyle = isSkillPotion ? COLORS.skillPotion : COLORS.lifePotion;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.fillStyle = COLORS.text;
      ctx.font = '700 11px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(isSkillPotion ? 'S' : '+', x, y + 4);
      ctx.restore();
    }
    ctx.textAlign = 'left';
  }

  drawHud(ctx) {
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 17px system-ui, sans-serif';
    ctx.fillText('ショートカット・ダンジョン', 58, 31);

    ctx.textAlign = 'right';
    ctx.fillStyle = COLORS.accent;
    ctx.font = '600 15px system-ui, sans-serif';
    ctx.fillText(`STAGE ${this.stage.number}/${this.stageManager.total}`, this.width - 58, 30);
    ctx.textAlign = 'left';

    ctx.fillStyle = 'rgba(8, 16, 22, 0.9)';
    ctx.fillRect(48, 46, this.width - 96, 42);
    ctx.fillStyle = COLORS.text;
    ctx.font = '600 14px system-ui, sans-serif';
    ctx.fillText(`HP ${'♥'.repeat(this.player.hp)}${'♡'.repeat(this.player.maxHp - this.player.hp)}`, 62, 64);
    ctx.fillStyle = COLORS.skillPotion;
    ctx.fillText(`スキル ${this.player.skillEnergy}`, 170, 64);
    ctx.fillStyle = COLORS.muted;
    ctx.fillText(`所持: 青ポーション ${this.inventory.skillPotion}  赤ポーション ${this.inventory.lifePotion}`, 290, 64);
    ctx.fillStyle = COLORS.text;
    ctx.fillText(`クリップボード: ${this.clipboard ? this.clipboard.name : '空'}`, 590, 64);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText(this.stage.hint, 62, 81);

    ctx.fillStyle = 'rgba(8, 16, 22, 0.88)';
    ctx.fillRect(48, this.height - 34, this.width - 96, 22);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(this.lastShortcutMessage, 58, this.height - 19);
    ctx.textAlign = 'right';
    ctx.fillText('Ctrl+Z Undo / Ctrl+Y Redo', this.width - 58, this.height - 19);
    ctx.textAlign = 'left';
  }

  drawPlayer(ctx) {
    const { x, y, radius } = this.player;
    ctx.save();
    ctx.shadowColor = 'rgba(112, 225, 193, 0.55)';
    ctx.shadowBlur = 18;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = COLORS.player;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.lineWidth = 3;
    ctx.strokeStyle = COLORS.playerOutline;
    ctx.stroke();
    ctx.restore();
  }

  dispose() {
    this.input.detach();
    this.bossQuiz.dispose();
    this.canvas.removeEventListener('click', this.focusCanvas);
  }
}
