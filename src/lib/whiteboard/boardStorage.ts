/**
 * 白板的本地持久化：内容与主题都存在 localStorage，刷新或误关页面后能原样恢复。
 * 读出时逐字段校验，脏数据（手改、旧版本）只丢弃坏掉的部分，不让整块白板打不开。
 */
import { EMPTY_BOARD, NOTE_COLOR_COUNT, NOTE_FRAMES, NOTE_SIZE_LEVELS, DEFAULT_SIZE_LEVEL, type BoardEdge, type BoardNote, type BoardState } from './model';

const BOARD_KEY = 'byebyeboard.board';
const THEME_KEY = 'byebyeboard.theme';

export type BoardTheme = 'chalk' | 'white';

function clampInt(value: unknown, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < max ? value : fallback;
}

/**
 * 把任意 JSON 值收敛为合法的白板状态。
 * @param raw 解析后的 JSON
 * @return 合法状态；连线只保留两端便签都存在的
 */
export function sanitizeBoard(raw: unknown): BoardState {
  if (!raw || typeof raw !== 'object') return EMPTY_BOARD;
  const { notes: rawNotes, edges: rawEdges } = raw as { notes?: unknown; edges?: unknown };
  const notes: BoardNote[] = [];
  for (const item of Array.isArray(rawNotes) ? rawNotes : []) {
    const note = item as Partial<BoardNote>;
    if (typeof note.id !== 'string' || typeof note.text !== 'string') continue;
    if (!Number.isFinite(note.x) || !Number.isFinite(note.y)) continue;
    notes.push({
      id: note.id,
      x: note.x as number,
      y: note.y as number,
      text: note.text,
      color: clampInt(note.color, NOTE_COLOR_COUNT, 0),
      frame: NOTE_FRAMES.includes(note.frame as BoardNote['frame']) ? (note.frame as BoardNote['frame']) : 'none',
      size: clampInt(note.size, NOTE_SIZE_LEVELS, DEFAULT_SIZE_LEVEL),
      bold: note.bold === true,
    });
  }
  const ids = new Set(notes.map((note) => note.id));
  const edges: BoardEdge[] = [];
  for (const item of Array.isArray(rawEdges) ? rawEdges : []) {
    const edge = item as Partial<BoardEdge>;
    if (typeof edge.id !== 'string' || typeof edge.from !== 'string' || typeof edge.to !== 'string') continue;
    if (!ids.has(edge.from) || !ids.has(edge.to) || edge.from === edge.to) continue;
    edges.push({ id: edge.id, from: edge.from, to: edge.to });
  }
  return { notes, edges };
}

export function loadBoard(): BoardState {
  try {
    const raw = localStorage.getItem(BOARD_KEY);
    return raw ? sanitizeBoard(JSON.parse(raw)) : EMPTY_BOARD;
  } catch {
    return EMPTY_BOARD;
  }
}

export function saveBoard(state: BoardState): void {
  try {
    localStorage.setItem(BOARD_KEY, JSON.stringify(state));
  } catch {
    // 配额不足或隐私模式：白板仍可用，只是不持久化
  }
}

/** 默认黑板：这个页面的定位就是「讲课用的黑板」 */
export function loadBoardTheme(): BoardTheme {
  try {
    return localStorage.getItem(THEME_KEY) === 'white' ? 'white' : 'chalk';
  } catch {
    return 'chalk';
  }
}

export function saveBoardTheme(theme: BoardTheme): void {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 忽略
  }
}
