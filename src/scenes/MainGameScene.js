import InputHandler from '../core/InputHandler.js';
import BossQuizScene from './BossQuizScene.js';

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
    this.player = {
      x: this.width / 2,
      y: this.height / 2,
      radius: 13,
      speed: 220,
      hp: 2,
      maxHp: 3,
      skillEnergy: 1,
    };
    this.inventory = { skillPotion: 0, lifePotion: 0 };
    this.movement = new Set();
    this.tileSize = 40;
    this.obstacles = [
      { x: 7, y: 4, width: 1, height: 5 },
      { x: 4, y: 10, width: 5, height: 1 },
      { x: 16, y: 3, width: 3, height: 1 },
      { x: 17, y: 11, width: 4, height: 1 },
      { x: 2, y: 5, width: 2, height: 1 },
    ];
    this.items = [
      { type: 'skillPotion', x: 6, y: 5, collected: false },
      { type: 'lifePotion', x: 5, y: 12, collected: false },
    ];
    this.gimmicks = [
      {
        type: 'copyDoor', x: 13, y: 7, width: 1, height: 5,
        action: 'copy', label: 'Ctrl+C', description: 'コピー扉', solved: false,
      },
      {
        type: 'pasteBridge', x: 16, y: 7, width: 3, height: 1,
        action: 'paste', label: 'Ctrl+V', description: '橋のギャップ', solved: false,
      },
    ];
    this.goal = { x: 21, y: 2, radius: 19 };
    this.lastShortcutMessage = '移動: 矢印キー / WASD';

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
    if (pressed) this.movement.add(direction);
    else this.movement.delete(direction);
  }

  handleShortcut({ action, modifier }) {
    const labels = {
      copy: 'コピー',
      paste: '貼り付け',
      cut: '切り取り',
      undo: '元に戻す',
      redo: 'やり直し',
      selectAll: 'すべて選択',
      save: '保存',
      print: '印刷',
    };
    const nearbyGimmick = this.gimmicks.find((gimmick) => (
      !gimmick.solved && this.isNearGimmick(gimmick)
    ));

    if (nearbyGimmick) {
      if (nearbyGimmick.action !== action) {
        this.lastShortcutMessage = `${nearbyGimmick.description}: ${nearbyGimmick.label} を入力してください`;
        return;
      }
      if (this.player.skillEnergy <= 0) {
        this.lastShortcutMessage = 'スキルエナジー不足です。青いポーションを探そう';
        return;
      }

      this.player.skillEnergy -= 1;
      nearbyGimmick.solved = true;
      const modifierLabel = modifier === 'Meta' ? 'Cmd' : 'Ctrl';
      this.lastShortcutMessage = `${modifierLabel}+${action.toUpperCase()} 成功！${nearbyGimmick.description}を解除`;
      return;
    }

    this.lastShortcutMessage = `${modifier}+キーを検知: ${labels[action] ?? action}`;
  }

  isNearGimmick(gimmick) {
    const left = gimmick.x * this.tileSize;
    const top = gimmick.y * this.tileSize;
    const right = left + gimmick.width * this.tileSize;
    const bottom = top + gimmick.height * this.tileSize;
    const nearestX = Math.max(left, Math.min(this.player.x, right));
    const nearestY = Math.max(top, Math.min(this.player.y, bottom));
    return Math.hypot(this.player.x - nearestX, this.player.y - nearestY) < 82;
  }

  update(deltaTime) {
    if (this.bossQuiz.active) return;
    this.collectNearbyItems();
    let horizontal = 0;
    let vertical = 0;
    if (this.movement.has('left')) horizontal -= 1;
    if (this.movement.has('right')) horizontal += 1;
    if (this.movement.has('up')) vertical -= 1;
    if (this.movement.has('down')) vertical += 1;

    if (horizontal === 0 && vertical === 0) return;

    const magnitude = Math.hypot(horizontal, vertical);
    const distance = this.player.speed * deltaTime / magnitude;
    this.moveAxis(horizontal * distance, 0);
    if (this.bossQuiz.active) return;
    this.moveAxis(0, vertical * distance);
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

  moveAxis(deltaX, deltaY) {
    const nextX = this.player.x + deltaX;
    const nextY = this.player.y + deltaY;
    if (this.canOccupy(nextX, nextY)) {
      this.player.x = nextX;
      this.player.y = nextY;
      this.checkGoal();
    }
  }

  checkGoal() {
    const goalX = (this.goal.x + 0.5) * this.tileSize;
    const goalY = (this.goal.y + 0.5) * this.tileSize;
    if (Math.hypot(this.player.x - goalX, this.player.y - goalY) > this.player.radius + this.goal.radius) return;

    if (!this.gimmicks.every((gimmick) => gimmick.solved)) {
      this.lastShortcutMessage = 'ゴールは封印中です。コピー扉と橋のギミックを解除しよう';
      return;
    }

    this.movement.clear();
    this.input.setEnabled(false);
    this.bossQuiz.start();
  }

  resetRun() {
    this.bossQuiz.stop();
    this.player.x = this.width / 2;
    this.player.y = this.height / 2;
    this.player.hp = this.player.maxHp;
    this.player.skillEnergy = 1;
    this.inventory.skillPotion = 0;
    this.inventory.lifePotion = 0;
    this.items.forEach((item) => { item.collected = false; });
    this.gimmicks.forEach((gimmick) => { gimmick.solved = false; });
    this.movement.clear();
    this.lastShortcutMessage = 'ダンジョンに再挑戦！青いポーションを回収しよう';
    this.input.setEnabled(true);
    this.canvas.focus({ preventScroll: true });
  }

  canOccupy(x, y) {
    const { radius } = this.player;
    if (x - radius < this.tileSize || y - radius < this.tileSize
      || x + radius > this.width - this.tileSize
      || y + radius > this.height - this.tileSize) {
      return false;
    }

    const blockingObjects = [
      ...this.obstacles,
      ...this.gimmicks.filter((gimmick) => !gimmick.solved),
    ];
    return !blockingObjects.some((obstacle) => {
      const left = obstacle.x * this.tileSize;
      const top = obstacle.y * this.tileSize;
      const right = left + obstacle.width * this.tileSize;
      const bottom = top + obstacle.height * this.tileSize;
      const nearestX = Math.max(left, Math.min(x, right));
      const nearestY = Math.max(top, Math.min(y, bottom));
      const distanceX = x - nearestX;
      const distanceY = y - nearestY;
      return distanceX * distanceX + distanceY * distanceY < radius * radius;
    });
  }

  render() {
    const { context: ctx, width, height, tileSize } = this;
    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = COLORS.background;
    ctx.fillRect(0, 0, width, height);

    this.drawFloor(ctx);
    this.drawGoal(ctx);
    this.drawObstacles(ctx);
    this.drawGimmicks(ctx);
    this.drawItems(ctx);
    this.drawHud(ctx);
    this.drawPlayer(ctx);
    this.bossQuiz.render(ctx, width, height);
  }

  drawGoal(ctx) {
    const x = (this.goal.x + 0.5) * this.tileSize;
    const y = (this.goal.y + 0.5) * this.tileSize;
    const unlocked = this.gimmicks.every((gimmick) => gimmick.solved);
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, this.goal.radius, 0, Math.PI * 2);
    ctx.fillStyle = unlocked ? 'rgba(112, 225, 193, 0.22)' : 'rgba(243, 201, 105, 0.14)';
    ctx.fill();
    ctx.strokeStyle = unlocked ? '#70e1c1' : '#f3c969';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = unlocked ? '#70e1c1' : '#f3c969';
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(unlocked ? 'GOAL' : 'LOCK', x, y + 4);
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

  drawGimmicks(ctx) {
    for (const gimmick of this.gimmicks) {
      const x = gimmick.x * this.tileSize;
      const y = gimmick.y * this.tileSize;
      const width = gimmick.width * this.tileSize;
      const height = gimmick.height * this.tileSize;
      const color = gimmick.solved ? COLORS.unlocked : COLORS.locked;

      if (gimmick.solved) {
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = COLORS.unlocked;
        ctx.fillRect(x, y, width, height);
        ctx.restore();
        continue;
      }

      ctx.fillStyle = gimmick.type === 'copyDoor' ? '#613f3b' : '#17212b';
      ctx.fillRect(x + 2, y + 2, width - 4, height - 4);
      ctx.strokeStyle = color;
      ctx.lineWidth = 3;
      ctx.setLineDash(gimmick.type === 'pasteBridge' ? [7, 5] : []);
      ctx.strokeRect(x + 4, y + 4, width - 8, height - 8);
      ctx.setLineDash([]);

      ctx.fillStyle = color;
      ctx.font = '700 12px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(gimmick.label, x + width / 2, y + height / 2 + 4);
      ctx.textAlign = 'left';
    }
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
    ctx.fillText('STAGE 1', this.width - 58, 30);
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
    ctx.fillStyle = COLORS.muted;
    ctx.font = '12px system-ui, sans-serif';
    ctx.fillText('青: エナジー+2   赤: HP+1   扉の近くで Ctrl+C / 橋の近くで Ctrl+V', 62, 81);

    ctx.fillStyle = 'rgba(8, 16, 22, 0.88)';
    ctx.fillRect(48, this.height - 34, this.width - 96, 22);
    ctx.fillStyle = COLORS.muted;
    ctx.font = '13px system-ui, sans-serif';
    ctx.fillText(this.lastShortcutMessage, 58, this.height - 19);
    ctx.textAlign = 'right';
    ctx.fillText('矢印キー / WASD で移動', this.width - 58, this.height - 19);
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
    this.movement.clear();
  }
}
