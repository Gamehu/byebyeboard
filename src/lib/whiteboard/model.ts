/**
 * 键盘白板的纯数据模型。
 * 白板由「便签」（一段可多行的文字）和「连线」组成，所有坐标都在世界坐标系里、按 GRID 对齐。
 * 这里只放与 DOM 无关的计算（空间导航、新便签落点、连线几何、增删改），方便单测；
 * 便签的真实宽高由页面测量后以 SizeMap 传入，没测到时用默认尺寸兜底。
 */

/** 网格步长：便签位置都对齐到它，挪动便签也按它步进 */
export const GRID = 20;
/** 横向（子级 / 左右延伸）新便签与锚点之间的间距 */
export const GAP_X = 60;
/** 纵向（同级 / 上下延伸）新便签与锚点之间的间距 */
export const GAP_Y = 20;
/** 尚未测量到尺寸的便签（例如刚创建）按这个大小参与布局 */
export const DEFAULT_NOTE_SIZE: Size = { w: 120, h: 40 };
/** 自由光标的占位大小，也是光标处新建便签的预期大小 */
export const CURSOR_SIZE: Size = { w: 120, h: 40 };
/** 自由光标每次按方向键移动的距离（Shift 时乘以 BIG_STEP_FACTOR） */
export const CURSOR_STEP = 40;
export const BIG_STEP_FACTOR = 5;

/** 颜色以下标存储，具体色值由主题的 CSS 变量决定，这样切换黑板/白板时颜色自动适配 */
export const NOTE_COLOR_COUNT = 6;
/** 字号档位数：0 小、1 正文（默认）、2 小标题、3 大标题 */
export const NOTE_SIZE_LEVELS = 4;
export const DEFAULT_SIZE_LEVEL = 1;
/** 四档字号（px），对应 BoardNote.size；导出图片时也用它绘制文字 */
export const FONT_SIZES = [16, 22, 32, 46];

export type NoteFrame = 'none' | 'box' | 'fill';
/** Alt+B 循环切换的外框顺序 */
export const NOTE_FRAMES: NoteFrame[] = ['none', 'box', 'fill'];

export type Direction = 'up' | 'down' | 'left' | 'right';

export interface Size {
  w: number;
  h: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardNote {
  id: string;
  x: number;
  y: number;
  text: string;
  color: number;
  frame: NoteFrame;
  size: number;
  /** 整条便签加粗（⌘B / Ctrl+B 切换） */
  bold: boolean;
}

/** 有向连线；同一对便签之间最多一条（无论方向） */
export interface BoardEdge {
  id: string;
  from: string;
  to: string;
}

export interface BoardState {
  notes: BoardNote[];
  edges: BoardEdge[];
}

/** 当前焦点：要么选中某条便签，要么是一个落在空白处的自由光标 */
export type BoardSelection = { kind: 'note'; id: string } | { kind: 'cursor'; x: number; y: number };

/** 便签 id → 实测尺寸（世界坐标，不受缩放影响） */
export type SizeMap = Record<string, Size>;

export const EMPTY_BOARD: BoardState = { notes: [], edges: [] };

let idSequence = 0;

/**
 * 生成本地唯一 id：时间戳 + 自增序号 + 随机后缀，避免同一毫秒内连续创建时撞号。
 * @param prefix 区分便签 / 连线的前缀
 * @return 新 id
 */
export function createId(prefix: string): string {
  idSequence += 1;
  return `${prefix}${Date.now().toString(36)}${idSequence.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 四舍五入到最近的网格点 */
export function snap(value: number): number {
  return Math.round(value / GRID) * GRID;
}

/**
 * 便签在世界坐标里的矩形。
 * @param note 便签
 * @param sizes 实测尺寸表
 * @return 矩形；未测量时按默认尺寸
 */
export function noteRect(note: BoardNote, sizes: SizeMap): Rect {
  const size = sizes[note.id] ?? DEFAULT_NOTE_SIZE;
  return { x: note.x, y: note.y, w: size.w, h: size.h };
}

export function cursorRect(x: number, y: number): Rect {
  return { x, y, w: CURSOR_SIZE.w, h: CURSOR_SIZE.h };
}

function centerOf(rect: Rect): { x: number; y: number } {
  return { x: rect.x + rect.w / 2, y: rect.y + rect.h / 2 };
}

/**
 * 两个矩形是否相交。
 * @param gap 额外留白：间距小于它也算相交，用来保证新便签之间留有呼吸空间
 */
export function rectsOverlap(a: Rect, b: Rect, gap = 0): boolean {
  return a.x < b.x + b.w + gap && b.x < a.x + a.w + gap && a.y < b.y + b.h + gap && b.y < a.y + a.h + gap;
}

export function containsPoint(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

/**
 * 一组矩形的外接矩形。
 * @return 外接矩形；没有矩形时返回 null
 */
export function boundsOf(rects: Rect[]): Rect | null {
  if (rects.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const rect of rects) {
    minX = Math.min(minX, rect.x);
    minY = Math.min(minY, rect.y);
    maxX = Math.max(maxX, rect.x + rect.w);
    maxY = Math.max(maxY, rect.y + rect.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * 空间导航：从 origin 出发，找该方向上「最顺手」的便签。
 * 评分 = 主轴距离 + 2 × 偏离距离，偏离过大（超出约 ±63° 的方向锥）的直接排除，
 * 避免按 → 却跳到几乎正下方的便签。
 * @param origin 出发矩形（选中便签或光标）
 * @param notes 候选便签
 * @param sizes 实测尺寸表
 * @param direction 方向
 * @param excludeId 排除的便签（通常是自己）
 * @return 目标便签；该方向没有时返回 null
 */
export function findNoteInDirection(
  origin: Rect,
  notes: BoardNote[],
  sizes: SizeMap,
  direction: Direction,
  excludeId?: string,
): BoardNote | null {
  const from = centerOf(origin);
  let best: BoardNote | null = null;
  let bestScore = Infinity;
  for (const note of notes) {
    if (note.id === excludeId) continue;
    const to = centerOf(noteRect(note, sizes));
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const horizontal = direction === 'left' || direction === 'right';
    const primary = direction === 'right' ? dx : direction === 'left' ? -dx : direction === 'down' ? dy : -dy;
    const secondary = horizontal ? Math.abs(dy) : Math.abs(dx);
    if (primary <= 1 || secondary > primary * 2) continue;
    const score = primary + secondary * 2;
    if (score < bestScore) {
      bestScore = score;
      best = note;
    }
  }
  return best;
}

/**
 * 紧贴 anchor 某一侧、留出标准间距的位置（左上角，已对齐网格）。
 * 向右 / 向下取上整、向左 / 向上取下整，保证对齐后间距不会被吃掉。
 * @param anchor 参照矩形
 * @param direction 放在哪一侧
 * @param size 要放置的东西的大小
 */
export function adjacentPosition(anchor: Rect, direction: Direction, size: Size): { x: number; y: number } {
  const ceil = (value: number) => Math.ceil(value / GRID) * GRID;
  const floor = (value: number) => Math.floor(value / GRID) * GRID;
  switch (direction) {
    case 'right':
      return { x: ceil(anchor.x + anchor.w + GAP_X), y: snap(anchor.y) };
    case 'left':
      return { x: floor(anchor.x - GAP_X - size.w), y: snap(anchor.y) };
    case 'down':
      return { x: snap(anchor.x), y: ceil(anchor.y + anchor.h + GAP_Y) };
    case 'up':
      return { x: snap(anchor.x), y: floor(anchor.y - GAP_Y - size.h) };
  }
}

/**
 * 从起点开始沿纵向避让，直到不和任何已有便签重叠。
 * 直接跳到挡路矩形的另一侧而不是逐格试探，便签再多也只需线性次数。
 * @param start 期望落点（新便签按默认尺寸）
 * @param occupied 已占用的矩形
 * @param towards 避让方向：向下（默认）或向上
 * @return 不重叠的位置（左上角）
 */
export function findFreePosition(start: Rect, occupied: Rect[], towards: 'down' | 'up' = 'down'): { x: number; y: number } {
  const rect = { ...start };
  // 每轮至少越过一个挡路矩形，因此最多 occupied.length + 1 轮
  for (let round = 0; round <= occupied.length; round += 1) {
    const blocker = occupied.find((other) => rectsOverlap(rect, other, GAP_Y / 2));
    if (!blocker) break;
    rect.y = towards === 'down'
      ? Math.ceil((blocker.y + blocker.h + GAP_Y) / GRID) * GRID
      : Math.floor((blocker.y - GAP_Y - rect.h) / GRID) * GRID;
  }
  return { x: rect.x, y: rect.y };
}

/**
 * 「父级」= 第一条指向它的连线的起点。
 * 白板本身是任意图，这里约定第一条入边是树边，用于 Enter / Tab 的大纲式书写。
 */
export function parentOf(state: BoardState, id: string): string | null {
  return state.edges.find((edge) => edge.to === id)?.from ?? null;
}

/** 某便签的直接子级（以树边为准，跳过后来手动连过来的交叉线） */
export function childrenOf(state: BoardState, id: string): string[] {
  return state.edges.filter((edge) => edge.from === id && parentOf(state, edge.to) === id).map((edge) => edge.to);
}

/**
 * 便签及其全部后代（沿树边）的外接矩形，用来把新的同级放到整棵子树下方。
 * 有环时靠 visited 截断。
 */
export function subtreeBounds(state: BoardState, sizes: SizeMap, id: string): Rect | null {
  const byId = new Map(state.notes.map((note) => [note.id, note]));
  const visited = new Set<string>();
  const queue = [id];
  const rects: Rect[] = [];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const note = byId.get(current);
    if (!note) continue;
    rects.push(noteRect(note, sizes));
    queue.push(...childrenOf(state, current));
  }
  return boundsOf(rects);
}

function occupiedRects(state: BoardState, sizes: SizeMap): Rect[] {
  return state.notes.map((note) => noteRect(note, sizes));
}

/**
 * 新同级的落点：与该便签左对齐，放在它整棵子树的下方。
 * @return 位置；便签不存在时返回 null
 */
export function placeSibling(state: BoardState, sizes: SizeMap, id: string): { x: number; y: number } | null {
  const note = state.notes.find((item) => item.id === id);
  const bounds = subtreeBounds(state, sizes, id);
  if (!note || !bounds) return null;
  const start = adjacentPosition({ ...bounds, x: note.x }, 'down', DEFAULT_NOTE_SIZE);
  return findFreePosition({ ...start, ...DEFAULT_NOTE_SIZE }, occupiedRects(state, sizes));
}

/**
 * 朝某个方向延伸的新便签落点。
 * 向右时视为「新子级」：已有子级则排到最后一个子级子树的下方，形成整齐的一列。
 * @return 位置；便签不存在时返回 null
 */
export function placeInDirection(
  state: BoardState,
  sizes: SizeMap,
  id: string,
  direction: Direction,
): { x: number; y: number } | null {
  const note = state.notes.find((item) => item.id === id);
  if (!note) return null;
  const rect = noteRect(note, sizes);
  let start = adjacentPosition(rect, direction, DEFAULT_NOTE_SIZE);
  if (direction === 'right') {
    const childBounds = childrenOf(state, id)
      .map((childId) => subtreeBounds(state, sizes, childId))
      .filter((bounds): bounds is Rect => bounds !== null);
    const lowest = boundsOf(childBounds);
    if (lowest) start = { x: start.x, y: Math.max(start.y, Math.ceil((lowest.y + lowest.h + GAP_Y) / GRID) * GRID) };
  }
  return findFreePosition({ ...start, ...DEFAULT_NOTE_SIZE }, occupiedRects(state, sizes), direction === 'up' ? 'up' : 'down');
}

/**
 * 方向键导航：选中便签时跳到该方向最近的便签，没有就落到紧邻的空白处（自由光标）；
 * 自由光标时按步长移动，移进某条便签就选中它。
 * @param big 自由光标是否大步移动（Shift）
 * @return 新的焦点
 */
export function navigate(
  state: BoardState,
  sizes: SizeMap,
  selection: BoardSelection,
  direction: Direction,
  big = false,
): BoardSelection {
  if (selection.kind === 'note') {
    const note = state.notes.find((item) => item.id === selection.id);
    if (!note) return { kind: 'cursor', x: 0, y: 0 };
    const rect = noteRect(note, sizes);
    const target = findNoteInDirection(rect, state.notes, sizes, direction, note.id);
    if (target) return { kind: 'note', id: target.id };
    return { kind: 'cursor', ...adjacentPosition(rect, direction, CURSOR_SIZE) };
  }
  const step = CURSOR_STEP * (big ? BIG_STEP_FACTOR : 1);
  const x = selection.x + (direction === 'right' ? step : direction === 'left' ? -step : 0);
  const y = selection.y + (direction === 'down' ? step : direction === 'up' ? -step : 0);
  // 以光标左侧中点作为「笔尖」，它落进哪条便签就选中哪条
  const hit = state.notes.find((note) => containsPoint(noteRect(note, sizes), x + GRID / 2, y + CURSOR_SIZE.h / 2));
  return hit ? { kind: 'note', id: hit.id } : { kind: 'cursor', x, y };
}

/**
 * 创建一条默认样式的便签。
 * @param inherit 从哪条便签继承颜色 / 外框 / 字号（同级和子级保持一致的视觉层次）
 */
export function createNote(x: number, y: number, text = '', inherit?: BoardNote): BoardNote {
  return {
    id: createId('n'),
    x,
    y,
    text,
    color: inherit?.color ?? 0,
    frame: inherit?.frame ?? 'none',
    size: inherit?.size ?? DEFAULT_SIZE_LEVEL,
    bold: inherit?.bold ?? false,
  };
}

/**
 * 添加便签，可选地同时从 linkFrom 连一条线过来。
 */
export function addNote(state: BoardState, note: BoardNote, linkFrom?: string | null): BoardState {
  const edges = linkFrom ? [...state.edges, { id: createId('e'), from: linkFrom, to: note.id }] : state.edges;
  return { notes: [...state.notes, note], edges };
}

export function updateNote(state: BoardState, id: string, patch: Partial<Omit<BoardNote, 'id'>>): BoardState {
  return { ...state, notes: state.notes.map((note) => (note.id === id ? { ...note, ...patch } : note)) };
}

/** 删除便签及与它相连的所有连线 */
export function removeNote(state: BoardState, id: string): BoardState {
  return {
    notes: state.notes.filter((note) => note.id !== id),
    edges: state.edges.filter((edge) => edge.from !== id && edge.to !== id),
  };
}

/**
 * 切换两条便签之间的连线：已有（任一方向）则删除，否则新增 from → to。
 * @return 新状态与本次是连上还是断开
 */
export function toggleEdge(state: BoardState, from: string, to: string): { state: BoardState; linked: boolean } {
  if (from === to) return { state, linked: false };
  const existing = state.edges.find((edge) => (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from));
  if (existing) return { state: { ...state, edges: state.edges.filter((edge) => edge !== existing) }, linked: false };
  return { state: { ...state, edges: [...state.edges, { id: createId('e'), from, to }] }, linked: true };
}

/**
 * 连线路径（SVG path 的 d）：思维导图式的平滑曲线。
 * 只要横向有空隙就走横向（白板以向右展开为主），从右边中点连到左边中点（或反之）；
 * 横向重叠（如 Alt+↓ 延伸出的上下排列）才走纵向，从下边中点连到上边中点（或反之）。两端切线沿轴向。
 * 相比中心直连，兄弟节点多时线不会从旁边便签的文字上穿过。
 * @param from 起点便签矩形
 * @param to 终点便签矩形
 * @param pad 两端与便签边框之间的空隙
 * @return path 的 d；两条便签重叠时返回 null
 */
export function edgePath(from: Rect, to: Rect, pad = 6): string | null {
  const gapX = Math.max(to.x - (from.x + from.w), from.x - (to.x + to.w));
  const gapY = Math.max(to.y - (from.y + from.h), from.y - (to.y + to.h));
  if (gapX <= pad * 2 && gapY <= pad * 2) return null;
  const fromCenter = centerOf(from);
  const toCenter = centerOf(to);
  let x1: number;
  let y1: number;
  let x2: number;
  let y2: number;
  let horizontal: boolean;
  if (gapX > pad * 2) {
    horizontal = true;
    const rightward = toCenter.x > fromCenter.x;
    x1 = rightward ? from.x + from.w + pad : from.x - pad;
    x2 = rightward ? to.x - pad : to.x + to.w + pad;
    y1 = fromCenter.y;
    y2 = toCenter.y;
  } else {
    horizontal = false;
    const downward = toCenter.y > fromCenter.y;
    y1 = downward ? from.y + from.h + pad : from.y - pad;
    y2 = downward ? to.y - pad : to.y + to.h + pad;
    x1 = fromCenter.x;
    x2 = toCenter.x;
  }
  // 控制点沿轴向伸出一半距离，曲线两端都与轴平行
  const bend = Math.max(Math.abs(horizontal ? x2 - x1 : y2 - y1) / 2, GRID);
  const round = (value: number) => Math.round(value * 10) / 10;
  const c1 = horizontal ? [x1 + Math.sign(x2 - x1) * bend, y1] : [x1, y1 + Math.sign(y2 - y1) * bend];
  const c2 = horizontal ? [x2 - Math.sign(x2 - x1) * bend, y2] : [x2, y2 - Math.sign(y2 - y1) * bend];
  return `M ${round(x1)} ${round(y1)} C ${round(c1[0])} ${round(c1[1])} ${round(c2[0])} ${round(c2[1])} ${round(x2)} ${round(y2)}`;
}
