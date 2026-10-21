import { MAX_STAGE_FILE_BYTES } from '@shortcut-dungeon/stage-schema';

export const DRAFT_KEY = 'shortcut-dungeon:editor:draft';

export function serializeStage(stage) {
  return `${JSON.stringify(stage, null, 2)}\n`;
}

export function parseStageJson(source) {
  const normalized = source.replace(/^\uFEFF/, '');
  return JSON.parse(normalized);
}

export async function readStageFile(file) {
  if (file.size > MAX_STAGE_FILE_BYTES) {
    throw new Error(`ファイルサイズが上限（${MAX_STAGE_FILE_BYTES} bytes）を超えています`);
  }
  const source = await file.text();
  return parseStageJson(source);
}

function downloadText(fileName, text) {
  const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

export async function saveStageFile(stage) {
  const text = serializeStage(stage);
  const fileName = `${stage.id}.json`;

  if (typeof globalThis.showSaveFilePicker === 'function') {
    try {
      const handle = await globalThis.showSaveFilePicker({
        suggestedName: fileName,
        types: [{ description: 'ステージJSON', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(text);
      await writable.close();
      return { method: 'file-system', fileName };
    } catch (error) {
      if (error?.name === 'AbortError') return { method: 'cancelled', fileName };
    }
  }

  downloadText(fileName, text);
  return { method: 'download', fileName };
}

export async function copyStageToClipboard(stage) {
  const text = serializeStage(stage);
  if (globalThis.navigator?.clipboard?.writeText) {
    await globalThis.navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.append(textarea);
  textarea.select();
  document.execCommand('copy');
  textarea.remove();
}

export function saveDraft(stage) {
  try {
    globalThis.localStorage.setItem(DRAFT_KEY, JSON.stringify({
      updatedAt: Date.now(),
      stage,
    }));
    return true;
  } catch {
    return false;
  }
}

export function loadDraft() {
  try {
    const source = globalThis.localStorage.getItem(DRAFT_KEY);
    if (!source) return null;
    const draft = JSON.parse(source);
    if (!draft?.stage) return null;
    return draft;
  } catch {
    return null;
  }
}

export function clearDraft() {
  try {
    globalThis.localStorage.removeItem(DRAFT_KEY);
  } catch {
    // localStorageが使えない環境では何もしません。
  }
}
