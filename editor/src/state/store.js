import { validateStage, isPlayableTile } from '@shortcut-dungeon/stage-schema';
import {
  BLOCK_COLORS,
  ITEM_LABELS,
  createBlankStage,
  entityAt,
  findBlock,
  findItemIndex,
  makeBlockId,
  modelToStage,
  occupancyLabel,
  occupiedByOther,
  restoreSnapshot,
  selectionTile,
  snapshotModel,
  stageToModel,
} from './model.js';

const HISTORY_LIMIT = 100;

function selectionKey(selection) {
  if (!selection) return '';
  if (selection.kind === 'block') return `block:${selection.id}`;
  if (selection.kind === 'item') return `item:${selection.type}:${selection.x}:${selection.y}`;
  if (selection.kind === 'wall') return `wall:${selection.x}:${selection.y}`;
  return selection.kind;
}

export default class EditorStore {
  constructor(model = createBlankStage()) {
    this.model = model;
    this.tool = 'select';
    this.selection = null;
    this.preview = false;
    this.message = 'ツールを選び、キャンバスをクリックして配置します';
    this.history = [];
    this.future = [];
    this.listeners = new Set();
    this.drag = null;
    this.validation = this.runValidation();
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit() {
    this.validation = this.runValidation();
    for (const listener of this.listeners) listener(this);
  }

  runValidation() {
    const { errors, warnings } = validateStage(modelToStage(this.model));
    return { errors, warnings };
  }

  getStage() {
    return modelToStage(this.model);
  }

  getSelectedTile() {
    return selectionTile(this.model, this.selection);
  }

  pushHistory() {
    this.history.push(snapshotModel(this.model));
    if (this.history.length > HISTORY_LIMIT) this.history.shift();
    this.future.length = 0;
  }

  setMessage(message) {
    this.message = message;
    this.emit();
  }

  setTool(tool) {
    this.tool = tool;
    this.preview = false;
    this.message = tool === 'select'
      ? '要素を選択・ドラッグして移動できます'
      : 'クリックまたはドラッグで配置します。右クリックで削除';
    this.emit();
  }

  setPreview(preview) {
    this.preview = Boolean(preview);
    this.message = this.preview ? 'プレビュー表示中（編集はできません）' : '編集モードに戻りました';
    this.emit();
  }

  setSelection(selection) {
    if (selectionKey(this.selection) === selectionKey(selection)) return;
    this.selection = selection;
    this.emit();
  }

  selectAt(x, y) {
    const found = isPlayableTile(x, y) ? entityAt(this.model, x, y) : null;
    this.selection = found;
    this.message = found
      ? `${occupancyLabel(found)}を選択しました`
      : 'なにもないマスです';
    this.emit();
  }

  applyTool(tool, x, y) {
    if (!isPlayableTile(x, y)) {
      this.message = '外周の壁は編集できません';
      this.emit();
      return;
    }
    if (tool === 'select') {
      this.selectAt(x, y);
      return;
    }
    if (tool === 'erase') {
      this.eraseAt(x, y);
      return;
    }

    if (tool === 'wall') {
      if (this.model.walls.has(`${x},${y}`)) return;
      const other = occupiedByOther(this.model, x, y, { kind: 'wall', x, y });
      if (other) {
        this.message = `${other}があるため壁を置けません`;
        this.emit();
        return;
      }
      this.pushHistory();
      this.model.walls.add(`${x},${y}`);
      this.selection = { kind: 'wall', x, y };
      this.message = '固定壁を配置しました';
      this.emit();
      return;
    }

    if (tool === 'start' || tool === 'goal') {
      const current = this.model[tool];
      if (current.x === x && current.y === y) {
        this.selection = { kind: tool };
        this.message = tool === 'start' ? '開始位置はここです' : 'ゴールはここです';
        this.emit();
        return;
      }
      const other = occupiedByOther(this.model, x, y, { kind: tool });
      if (other) {
        this.message = `${other}があるため配置できません`;
        this.emit();
        return;
      }
      this.pushHistory();
      if (tool === 'start') this.model.start = { ...this.model.start, x, y };
      else this.model.goal = { x, y };
      this.selection = { kind: tool };
      this.message = tool === 'start' ? '開始位置を移動しました' : 'ゴールを移動しました';
      this.emit();
      return;
    }

    if (tool === 'goalBlock' || tool === 'gate') {
      const key = tool === 'gate' ? 'shortcutGate' : 'goalBlock';
      const current = this.model[key];
      if (current?.x === x && current?.y === y) {
        this.pushHistory();
        this.model[key] = null;
        this.selection = null;
        this.message = tool === 'gate' ? 'ショートカットゲートを解除しました' : 'goalBlockを解除しました';
        this.emit();
        return;
      }
      const other = occupiedByOther(this.model, x, y, { kind: tool });
      if (other) {
        this.message = `${other}があるため配置できません`;
        this.emit();
        return;
      }
      this.pushHistory();
      this.model[key] = { x, y };
      this.selection = { kind: tool };
      this.message = tool === 'gate' ? 'ショートカットゲートを配置しました' : 'goalBlockを配置しました';
      this.emit();
      return;
    }

    if (tool === 'block') {
      const other = occupiedByOther(this.model, x, y, { kind: 'block' });
      if (other) {
        this.message = `${other}があるため木箱を置けません`;
        this.emit();
        return;
      }
      this.pushHistory();
      const id = makeBlockId(this.model);
      const block = {
        id,
        name: '木箱',
        x,
        y,
        color: BLOCK_COLORS[this.model.blocks.length % BLOCK_COLORS.length],
      };
      this.model.blocks.push(block);
      this.selection = { kind: 'block', id };
      this.message = '木箱を配置しました';
      this.emit();
      return;
    }

    if (tool === 'skillPotion' || tool === 'lifePotion') {
      const other = occupiedByOther(this.model, x, y, { kind: 'item', type: tool });
      if (other) {
        this.message = `${other}があるためアイテムを置けません`;
        this.emit();
        return;
      }
      this.pushHistory();
      this.model.items.push({ type: tool, x, y });
      this.selection = { kind: 'item', type: tool, x, y };
      this.message = `${ITEM_LABELS[tool]}を配置しました`;
      this.emit();
      return;
    }
  }

  eraseAt(x, y) {
    if (!isPlayableTile(x, y)) {
      this.message = '外周の壁は編集できません';
      this.emit();
      return;
    }
    if ((this.model.start.x === x && this.model.start.y === y)
      || (this.model.goal.x === x && this.model.goal.y === y)) {
      this.message = '開始位置とゴールは削除できません。別の場所へ移動してください';
      this.emit();
      return;
    }

    const wallKey = `${x},${y}`;
    const blockIndex = this.model.blocks.findIndex((block) => block.x === x && block.y === y);
    const itemIndex = this.model.items.findIndex((item) => item.x === x && item.y === y);
    const hasWall = this.model.walls.has(wallKey);
    const hasGoalBlock = this.model.goalBlock?.x === x && this.model.goalBlock?.y === y;
    const hasGate = this.model.shortcutGate?.x === x && this.model.shortcutGate?.y === y;

    if (!hasWall && blockIndex === -1 && itemIndex === -1 && !hasGoalBlock && !hasGate) {
      this.message = '削除する要素がありません';
      this.emit();
      return;
    }

    this.pushHistory();
    if (hasWall) this.model.walls.delete(wallKey);
    if (blockIndex !== -1) this.model.blocks.splice(blockIndex, 1);
    if (itemIndex !== -1) this.model.items.splice(itemIndex, 1);
    if (hasGoalBlock) this.model.goalBlock = null;
    if (hasGate) this.model.shortcutGate = null;

    this.selection = null;
    this.message = '要素を削除しました';
    this.emit();
  }

  setMeta(patch) {
    const next = { ...this.model };
    let changed = false;

    if (patch.id !== undefined) {
      const id = String(patch.id)
        .toLowerCase()
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-+/, '');
      if (id !== next.id) {
        next.id = id;
        changed = true;
      }
    }
    if (patch.number !== undefined) {
      const number = Number(patch.number);
      const normalized = Number.isFinite(number) ? Math.trunc(number) : 0;
      if (normalized !== next.number) {
        next.number = normalized;
        changed = true;
      }
    }
    if (patch.name !== undefined && patch.name !== next.name) {
      next.name = String(patch.name);
      changed = true;
    }
    if (patch.hint !== undefined && patch.hint !== next.hint) {
      next.hint = String(patch.hint);
      changed = true;
    }

    if (!changed) return;
    this.pushHistory();
    this.model = next;
    this.emit();
  }

  setBlockProps(patch) {
    if (this.selection?.kind !== 'block') return;
    const block = findBlock(this.model, this.selection.id);
    if (!block) return;

    const name = patch.name !== undefined ? String(patch.name) : block.name;
    const color = patch.color !== undefined ? String(patch.color) : block.color;
    if (name === block.name && color === block.color) return;

    this.pushHistory();
    block.name = name;
    block.color = color;
    this.emit();
  }

  setFacing(facing) {
    if (this.model.start.facing === facing) return;
    this.pushHistory();
    this.model.start.facing = facing;
    this.message = `開始位置の向きを ${facing} にしました`;
    this.emit();
  }

  beginDrag() {
    this.drag = { moved: false };
  }

  endDrag() {
    this.drag = null;
  }

  moveSelectionTo(x, y, { recordHistory = true } = {}) {
    const selection = this.selection;
    const tile = this.getSelectedTile();
    if (!selection || !tile) return;
    if (tile.x === x && tile.y === y) return;
    if (!isPlayableTile(x, y)) {
      this.message = '配置可能範囲の外には移動できません';
      this.emit();
      return;
    }

    const other = occupiedByOther(this.model, x, y, selection);
    if (other) {
      this.message = `${other}があるため移動できません`;
      this.emit();
      return;
    }

    if (recordHistory || !this.drag?.moved) this.pushHistory();

    switch (selection.kind) {
      case 'start':
        this.model.start = { ...this.model.start, x, y };
        break;
      case 'goal':
        this.model.goal = { x, y };
        break;
      case 'goalBlock':
        this.model.goalBlock = { x, y };
        break;
      case 'gate':
        this.model.shortcutGate = { x, y };
        break;
      case 'block': {
        const block = findBlock(this.model, selection.id);
        if (block) {
          block.x = x;
          block.y = y;
        }
        break;
      }
      case 'item': {
        const index = findItemIndex(this.model, selection.type, selection.x, selection.y);
        if (index !== -1) {
          this.model.items[index].x = x;
          this.model.items[index].y = y;
          this.selection = { ...selection, x, y };
        }
        break;
      }
      case 'wall':
        this.model.walls.delete(`${selection.x},${selection.y}`);
        this.model.walls.add(`${x},${y}`);
        this.selection = { ...selection, x, y };
        break;
      default:
        break;
    }

    if (this.drag) this.drag.moved = true;
    this.message = '選択中の要素を移動しました';
    this.emit();
  }

  moveSelectionBy(dx, dy) {
    const tile = this.getSelectedTile();
    if (!tile) return;
    this.moveSelectionTo(tile.x + dx, tile.y + dy, { recordHistory: true });
  }

  deleteSelection() {
    if (!this.selection) return;
    if (this.selection.kind === 'start' || this.selection.kind === 'goal') {
      this.message = '開始位置とゴールは削除できません';
      this.emit();
      return;
    }

    this.pushHistory();
    if (this.selection.kind === 'block') {
      this.model.blocks = this.model.blocks.filter((block) => block.id !== this.selection.id);
    } else if (this.selection.kind === 'item') {
      const index = findItemIndex(
        this.model,
        this.selection.type,
        this.selection.x,
        this.selection.y,
      );
      if (index !== -1) this.model.items.splice(index, 1);
    } else if (this.selection.kind === 'wall') {
      this.model.walls.delete(`${this.selection.x},${this.selection.y}`);
    } else if (this.selection.kind === 'goalBlock') {
      this.model.goalBlock = null;
    } else if (this.selection.kind === 'gate') {
      this.model.shortcutGate = null;
    }
    this.selection = null;
    this.message = '選択中の要素を削除しました';
    this.emit();
  }

  undo() {
    if (this.history.length === 0) {
      this.message = '取り消せる操作がありません';
      this.emit();
      return;
    }
    this.future.push(snapshotModel(this.model));
    this.model = restoreSnapshot(this.history.pop());
    this.selection = null;
    this.message = '操作を取り消しました';
    this.emit();
  }

  redo() {
    if (this.future.length === 0) {
      this.message = 'やり直せる操作がありません';
      this.emit();
      return;
    }
    this.history.push(snapshotModel(this.model));
    this.model = restoreSnapshot(this.future.pop());
    this.selection = null;
    this.message = '操作をやり直しました';
    this.emit();
  }

  importStage(stage) {
    this.model = stageToModel(stage);
    this.history.length = 0;
    this.future.length = 0;
    this.selection = null;
    this.tool = 'select';
    this.preview = false;
    this.message = 'ステージJSONを読み込みました';
    this.emit();
  }

  newStage() {
    this.model = createBlankStage();
    this.history.length = 0;
    this.future.length = 0;
    this.selection = null;
    this.tool = 'select';
    this.preview = false;
    this.message = '新しいステージを作成しました';
    this.emit();
  }
}
