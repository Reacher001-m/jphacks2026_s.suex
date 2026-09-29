const QUIZZES = [
  { key: 'z', question: '操作をひとつ前の状態に戻すには？', answer: 'Ctrl+Z' },
  { key: 'c', question: '選択した内容をコピーするには？', answer: 'Ctrl+C' },
  { key: 'v', question: 'コピーした内容を貼り付けるには？', answer: 'Ctrl+V' },
];

/** 実際のショートカット入力で回答するボス戦モーダルです。 */
export default class BossQuizScene {
  constructor({ canvas, player, onRetry }) {
    this.canvas = canvas;
    this.player = player;
    this.onRetry = onRetry;
    this.platform = /Mac|iPhone|iPad|iPod/i.test(globalThis.navigator?.platform ?? '')
      ? 'mac'
      : 'windows';
    this.active = false;
    this.state = 'inactive';
    this.questionIndex = 0;
    this.correctCount = 0;
    this.feedback = '';
    this.modifierName = this.platform === 'mac' ? 'Command' : 'Control';
    this.modifierLabel = this.platform === 'mac' ? 'Cmd' : 'Ctrl';
    this.handleKeyDown = this.handleKeyDown.bind(this);
  }

  start() {
    if (this.active) return;
    this.active = true;
    this.state = 'quiz';
    this.questionIndex = 0;
    this.correctCount = 0;
    this.feedback = '正解のショートカットを実際に入力してください';
    this.canvas.addEventListener('keydown', this.handleKeyDown, true);
    this.canvas.focus({ preventScroll: true });
  }

  handleKeyDown(event) {
    if (!this.active || event.key === 'Control' || event.key === 'Meta' || event.key === 'Shift' || event.key === 'Alt') {
      return;
    }

    event.preventDefault();
    event.stopImmediatePropagation();

    if (this.state === 'clear' || this.state === 'gameover') {
      if (event.key === 'Enter' || event.key.toLowerCase() === 'r') this.onRetry();
      return;
    }

    if (event.repeat) return;

    const quiz = QUIZZES[this.questionIndex];
    const modifierPressed = this.platform === 'mac' ? event.metaKey : event.ctrlKey;
    const isCorrect = event.key.toLowerCase() === quiz.key
      && modifierPressed
      && !event.altKey
      && !event.shiftKey;

    if (!isCorrect) {
      this.player.hp = Math.max(0, this.player.hp - 1);
      if (this.player.hp === 0) {
        this.state = 'gameover';
        this.feedback = 'HPがなくなった...もう一度挑戦しよう';
      } else {
        this.feedback = `不正解！HP -1  残り ${this.player.hp}`;
      }
      return;
    }

    this.correctCount += 1;
    this.questionIndex += 1;
    if (this.correctCount === QUIZZES.length) {
      this.state = 'clear';
      this.feedback = '3問正解！ボスを撃破した！';
    } else {
      this.feedback = '正解！次の問題へ';
    }
  }

  render(ctx, width, height) {
    if (!this.active) return;

    ctx.save();
    ctx.fillStyle = 'rgba(4, 9, 14, 0.82)';
    ctx.fillRect(0, 0, width, height);

    const panelWidth = Math.min(720, width - 48);
    const panelHeight = 390;
    const panelX = (width - panelWidth) / 2;
    const panelY = (height - panelHeight) / 2;
    ctx.fillStyle = '#172631';
    ctx.fillRect(panelX, panelY, panelWidth, panelHeight);
    ctx.strokeStyle = this.state === 'clear' ? '#70e1c1' : this.state === 'gameover' ? '#ff5e68' : '#f3c969';
    ctx.lineWidth = 2;
    ctx.strokeRect(panelX, panelY, panelWidth, panelHeight);

    ctx.textAlign = 'center';
    ctx.fillStyle = '#f3c969';
    ctx.font = '700 13px system-ui, sans-serif';
    ctx.fillText('BOSS BATTLE', width / 2, panelY + 34);

    if (this.state === 'clear' || this.state === 'gameover') {
      const cleared = this.state === 'clear';
      ctx.fillStyle = cleared ? '#70e1c1' : '#ff7a80';
      ctx.font = '700 34px system-ui, sans-serif';
      ctx.fillText(cleared ? 'GAME CLEAR' : 'GAME OVER', width / 2, panelY + 130);
      ctx.fillStyle = '#eff7f5';
      ctx.font = '600 20px system-ui, sans-serif';
      ctx.fillText(this.feedback, width / 2, panelY + 184);
      ctx.fillStyle = '#a7b9b8';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText('Enter または R キーでリトライ', width / 2, panelY + 255);
      ctx.fillText(`正解数 ${this.correctCount} / ${QUIZZES.length}　 HP ${this.player.hp} / ${this.player.maxHp}`, width / 2, panelY + 300);
    } else {
      const quiz = QUIZZES[this.questionIndex];
      ctx.fillStyle = '#eff7f5';
      ctx.font = '600 22px system-ui, sans-serif';
      ctx.fillText(`問題 ${this.questionIndex + 1} / ${QUIZZES.length}`, width / 2, panelY + 88);
      ctx.font = '600 21px system-ui, sans-serif';
      ctx.fillText(quiz.question, width / 2, panelY + 145);
      ctx.fillStyle = '#70e1c1';
      ctx.font = '700 26px system-ui, sans-serif';
      ctx.fillText(`${this.modifierLabel} + ?`, width / 2, panelY + 205);
      ctx.fillStyle = '#a7b9b8';
      ctx.font = '15px system-ui, sans-serif';
      ctx.fillText(`正解数 ${this.correctCount} / ${QUIZZES.length}　 HP ${'♥'.repeat(this.player.hp)}${'♡'.repeat(this.player.maxHp - this.player.hp)}`, width / 2, panelY + 250);
      ctx.fillStyle = '#f3c969';
      ctx.font = '14px system-ui, sans-serif';
      ctx.fillText(this.feedback, width / 2, panelY + 298);
      ctx.fillStyle = '#a7b9b8';
      ctx.font = '13px system-ui, sans-serif';
      ctx.fillText(`${this.modifierName} キーを押しながら答えのキーを入力`, width / 2, panelY + 344);
    }

    ctx.restore();
  }

  stop() {
    if (!this.active) return;
    this.canvas.removeEventListener('keydown', this.handleKeyDown, true);
    this.active = false;
    this.state = 'inactive';
  }

  dispose() {
    this.stop();
  }
}
