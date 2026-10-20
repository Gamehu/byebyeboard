/**
 * 白板导出：JSON 备份与 PNG 图片。
 * PNG 不截图 DOM，而是按模型直接画到 Canvas 上：结果与视口缩放无关，
 * 也不会把选中虚线、编辑光标之类的临时状态带进图片。
 */
import {
  FONT_SIZES,
  GRID,
  boundsOf,
  edgePath,
  noteRect,
  type BoardNote,
  type BoardState,
  type SizeMap,
} from './model';
import type { BoardTheme } from './boardStorage';

export const EXPORT_PADDING = 48;
/** Canvas 单边上限；超出时按比例缩小，避免生成一张浏览器画不出来的图 */
const MAX_SIDE = 8192;
/** 提示条在页面里用的网格间距（GRID * 2） */
const GRID_SPACING = GRID * 2;

export interface BoardFileV1 {
  version: 1;
  theme: BoardTheme;
  notes: BoardState['notes'];
  edges: BoardState['edges'];
}

interface ThemeColors {
  bg: string;
  grid: string;
  edge: string;
  colors: string[];
  textShadow: string;
  font: string;
}

const FALLBACK: Record<BoardTheme, ThemeColors> = {
  chalk: {
    bg: '#24332a',
    grid: 'rgba(241, 239, 230, 0.06)',
    edge: 'rgba(241, 239, 230, 0.7)',
    colors: ['#f1efe6', '#f6e27f', '#f5a7b8', '#94cdf3', '#a9e3a4', '#f7b46e'],
    textShadow: '1px',
    font: '"Patrick Hand", "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  white: {
    bg: '#fbfbf8',
    grid: 'rgba(24, 24, 27, 0.08)',
    edge: 'rgba(31, 35, 40, 0.6)',
    colors: ['#1f2328', '#b7791f', '#c2255c', '#1c6fd1', '#2b8a3e', '#d9480f'],
    textShadow: 'none',
    font: '"Patrick Hand", "Kaiti SC", "STKaiti", "KaiTi", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
};

/** 从页面读取主题色；读不到（例如在测试里）就用内置的同款配色 */
function readThemeColors(root: HTMLElement | null, theme: BoardTheme): ThemeColors {
  const fallback = FALLBACK[theme];
  if (!root) return fallback;
  const style = window.getComputedStyle(root);
  const read = (name: string, value: string) => style.getPropertyValue(name).trim() || value;
  return {
    bg: read('--wb-bg', fallback.bg),
    grid: read('--wb-grid', fallback.grid),
    edge: read('--wb-edge', fallback.edge),
    colors: fallback.colors.map((color, index) => read(`--wb-c${index}`, color)),
    textShadow: read('--wb-text-shadow', fallback.textShadow),
    font: read('--wb-font', fallback.font),
  };
}

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 导出文件名里的日期：whiteboard-2026-10-20 */
export function exportStamp(date = new Date()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/** JSON 备份内容；字段与 localStorage 里的白板结构一致，以后可以直接读回来 */
export function serializeBoard(board: BoardState, theme: BoardTheme): string {
  const file: BoardFileV1 = {
    version: 1,
    theme,
    notes: board.notes,
    edges: board.edges,
  };
  return JSON.stringify(file, null, 2);
}

/**
 * 按宽度把文字折成多行。
 * 白板允许在任意字符处断行（CSS overflow-wrap: anywhere），所以这里也逐字符测量，
 * 中英文混排的结果与页面上基本一致。
 * @param text 段落文字（可含 \n）
 * @param maxWidth 一行允许的最大宽度（世界坐标 px）
 * @param measure 测量一段文字宽度的函数
 * @return 每一行的文字；空段落保留为空行
 */
export function wrapTextLines(text: string, maxWidth: number, measure: (line: string) => number): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split('\n')) {
    if (!paragraph) {
      lines.push('');
      continue;
    }
    let line = '';
    for (const char of paragraph) {
      const candidate = line + char;
      if (line && measure(candidate) > maxWidth) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  return lines;
}

/** 把路径末端的切线角度取出来，用于画箭头 */
function pathEndAngle(d: string): { x: number; y: number; angle: number } | null {
  const numbers = d.match(/-?\d+(?:\.\d+)?/g)?.map(Number);
  if (!numbers || numbers.length < 8) return null;
  const c2x = numbers[4];
  const c2y = numbers[5];
  const x2 = numbers[6];
  const y2 = numbers[7];
  return { x: x2, y: y2, angle: Math.atan2(y2 - c2y, x2 - c2x) };
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number): void {
  if (typeof ctx.roundRect === 'function') {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, radius);
    return;
  }
  ctx.beginPath();
  ctx.rect(x, y, w, h);
}

function drawArrowHead(ctx: CanvasRenderingContext2D, d: string, color: string): void {
  const end = pathEndAngle(d);
  if (!end) return;
  const length = 9;
  const spread = Math.PI / 7;
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.6;
  for (const direction of [1, -1]) {
    const angle = end.angle + direction * spread;
    ctx.beginPath();
    ctx.moveTo(end.x, end.y);
    ctx.lineTo(end.x - Math.cos(angle) * length, end.y - Math.sin(angle) * length);
    ctx.stroke();
  }
}

function drawNote(ctx: CanvasRenderingContext2D, note: BoardNote, rect: { x: number; y: number; w: number; h: number }, colors: ThemeColors): void {
  const fontSize = FONT_SIZES[note.size] ?? FONT_SIZES[1];
  const color = colors.colors[note.color] ?? colors.colors[0];
  const radius = fontSize * 0.4;
  const padX = fontSize * 0.45;
  const padY = fontSize * 0.18;

  ctx.save();
  if (note.frame === 'fill') {
    ctx.globalAlpha = 0.16;
    ctx.fillStyle = color;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.fill();
    ctx.globalAlpha = 1;
  }
  if (note.frame === 'box') {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, radius);
    ctx.stroke();
  }

  ctx.fillStyle = color;
  ctx.font = `${note.bold ? '700 ' : ''}${fontSize}px ${colors.font}`;
  ctx.textBaseline = 'top';
  if (colors.textShadow !== 'none') {
    ctx.shadowColor = color;
    ctx.shadowBlur = 1;
  }
  const maxWidth = Math.max(rect.w - padX * 2 - 4, fontSize);
  const lines = wrapTextLines(note.text, maxWidth, (line) => ctx.measureText(line).width);
  const lineHeight = fontSize * 1.35;
  const top = rect.y + 2 + padY;
  lines.forEach((line, index) => {
    ctx.fillText(line, rect.x + 2 + padX, top + index * lineHeight);
  });
  ctx.restore();
}

/**
 * 把整块白板画成 PNG。
 * @return 图片 Blob；白板为空或浏览器不支持 Canvas 时返回 null
 */
export async function renderBoardPng(
  board: BoardState,
  sizes: SizeMap,
  theme: BoardTheme,
  root: HTMLElement | null = document.querySelector<HTMLElement>('.wb-root'),
): Promise<Blob | null> {
  const bounds = boundsOf(board.notes.map((note) => noteRect(note, sizes)));
  if (!bounds) return null;

  const width = bounds.w + EXPORT_PADDING * 2;
  const height = bounds.h + EXPORT_PADDING * 2;
  // 大板子自动降低倍率，保证长边不超过 Canvas 上限
  const scale = Math.min(2, MAX_SIDE / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 字体没加载完就画会用回退字体，行宽和页面上对不上
  await document.fonts?.ready;
  const colors = readThemeColors(root, theme);

  ctx.scale(scale, scale);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, width, height);

  ctx.save();
  ctx.translate(EXPORT_PADDING - bounds.x, EXPORT_PADDING - bounds.y);

  ctx.fillStyle = colors.grid;
  const startX = Math.floor(bounds.x / GRID_SPACING) * GRID_SPACING;
  const startY = Math.floor(bounds.y / GRID_SPACING) * GRID_SPACING;
  for (let x = startX; x <= bounds.x + bounds.w; x += GRID_SPACING) {
    for (let y = startY; y <= bounds.y + bounds.h; y += GRID_SPACING) {
      ctx.beginPath();
      ctx.arc(x, y, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  ctx.strokeStyle = colors.edge;
  ctx.lineWidth = 2;
  ctx.lineCap = 'round';
  const byId = new Map(board.notes.map((note) => [note.id, note]));
  for (const edge of board.edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    const d = from && to ? edgePath(noteRect(from, sizes), noteRect(to, sizes)) : null;
    if (!d) continue;
    ctx.stroke(new Path2D(d));
    drawArrowHead(ctx, d, colors.edge);
  }

  for (const note of board.notes) drawNote(ctx, note, noteRect(note, sizes), colors);
  ctx.restore();

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));
}

function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/** 下载 JSON 备份 */
export function downloadBoardJson(board: BoardState, theme: BoardTheme, date = new Date()): void {
  const blob = new Blob([serializeBoard(board, theme)], { type: 'application/json;charset=utf-8' });
  saveBlob(blob, `whiteboard-${exportStamp(date)}.json`);
}

/**
 * 下载整块白板的 PNG。
 * @return 是否成功；白板为空时返回 false，由调用方提示
 */
export async function downloadBoardPng(
  board: BoardState,
  sizes: SizeMap,
  theme: BoardTheme,
  date = new Date(),
): Promise<boolean> {
  const blob = await renderBoardPng(board, sizes, theme);
  if (!blob) return false;
  saveBlob(blob, `whiteboard-${exportStamp(date)}.png`);
  return true;
}
