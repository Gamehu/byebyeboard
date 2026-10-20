/**
 * 键盘优先的白板页面（/board）。
 * 定位是讲课 / 讨论时用的黑板：打开就能写，Enter / Tab 像写大纲一样连续书写，思路不被鼠标打断。
 *
 * 交互核心：页面里始终只有一个获得焦点的 textarea（"笔"），它跟随当前焦点（便签或自由光标）。
 * 普通态下它透明、内容是选中便签的文字；用户一打字（含输入法组字、粘贴）就原地变成可见的编辑器。
 * 这样输入法从第一个键起就落在正确的元素里，不需要先"进入编辑模式"，也不会丢字。
 * 鼠标只是可选项：点选、双击新建 / 编辑、拖动便签、拖动或滚轮平移、Ctrl+滚轮缩放。
 */
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useI18n } from '../lib/i18n';
import { shouldIgnoreBoardKey } from '../lib/keyboard';
import {
  BIG_STEP_FACTOR,
  CURSOR_SIZE,
  DEFAULT_SIZE_LEVEL,
  EMPTY_BOARD,
  FONT_SIZES,
  GRID,
  NOTE_FRAMES,
  NOTE_SIZE_LEVELS,
  addNote,
  boundsOf,
  createNote,
  cursorRect,
  edgePath,
  navigate,
  noteRect,
  parentOf,
  placeInDirection,
  placeSibling,
  removeNote,
  snap,
  toggleEdge,
  updateNote,
  type BoardNote,
  type BoardSelection,
  type BoardState,
  type Direction,
  type Rect,
  type SizeMap,
} from '../lib/whiteboard/model';
import { loadBoard, loadBoardTheme, saveBoard, saveBoardTheme, type BoardTheme } from '../lib/whiteboard/boardStorage';
import { downloadBoardJson, downloadBoardPng } from '../lib/whiteboard/export';
import { MOD_KEY, WhiteboardHelp, WhiteboardHints, type HintMode } from '../components/whiteboard/WhiteboardHelp';
import './whiteboard.css';

/** 视口相机：世界坐标 (wx, wy) 显示在屏幕 (wx * zoom + x, wy * zoom + y) */
interface Camera {
  x: number;
  y: number;
  zoom: number;
}

/** 一次编辑会话；结束时据此决定是否记入撤销历史，或整体回滚一条什么都没写的新便签 */
interface EditSession {
  id: string;
  isNew: boolean;
  /** 从哪条便签派生出来的（Enter / Tab / Alt+方向），空行缩进时要用到 */
  originId: string | null;
  /** 会话开始前的白板：有改动时记入撤销历史，空白新便签直接回滚到它 */
  before: BoardState;
  originalText: string;
}

interface ViewportSize {
  w: number;
  h: number;
}

const MIN_ZOOM = 0.3;
const MAX_ZOOM = 3;
const ZOOM_STEP = 1.2;
/** 相机跟随时焦点距视口边缘的最小距离；底部额外让出提示条 */
const FOLLOW_MARGIN = 80;
const HINT_BAR_SPACE = 48;
const HISTORY_LIMIT = 200;
const SAVE_DELAY = 300;
const NOTICE_DURATION = 2400;
/** 鼠标按下后移动超过这个距离才算拖动，否则视为点击 */
const DRAG_THRESHOLD = 4;

const ARROW_DIRECTIONS: Record<string, Direction> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
};

/**
 * 字母键匹配：macOS 上 ⌥+字母的 e.key 会变成特殊字符（⌥+C → ç），
 * 所以优先看物理键位 e.code，拿不到时再退回 e.key。
 */
function matchesLetter(e: React.KeyboardEvent, letter: string): boolean {
  const upper = letter.toUpperCase();
  // keyCode 是最后的兜底：个别输入法 / 浏览器在组字时只给物理键码，code 和 key 都不可靠
  return e.code === `Key${upper}` || e.key.toLowerCase() === letter || e.keyCode === upper.charCodeAt(0);
}

/** 数字键匹配：⌥+1 在 macOS 上是 ¡，同样不能只看 e.key */
function matchesDigit(e: React.KeyboardEvent, digit: number): boolean {
  return e.code === `Digit${digit}` || e.key === String(digit) || e.keyCode === 48 + digit;
}

function clampZoom(zoom: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

/**
 * 以屏幕点 (sx, sy) 为中心缩放，保证该点下的内容不动。
 */
function zoomCamera(camera: Camera, factor: number, sx: number, sy: number): Camera {
  const zoom = clampZoom(camera.zoom * factor);
  const ratio = zoom / camera.zoom;
  return { zoom, x: sx - (sx - camera.x) * ratio, y: sy - (sy - camera.y) * ratio };
}

/**
 * 让焦点矩形保持在视口内：只做最小平移，焦点本来就可见时不动，避免画面来回晃。
 * @return 新相机；无需移动时返回 null
 */
function followCamera(camera: Camera, rect: Rect, viewport: ViewportSize): Camera | null {
  const left = rect.x * camera.zoom + camera.x;
  const right = (rect.x + rect.w) * camera.zoom + camera.x;
  const top = rect.y * camera.zoom + camera.y;
  const bottom = (rect.y + rect.h) * camera.zoom + camera.y;
  const maxRight = viewport.w - FOLLOW_MARGIN;
  const maxBottom = viewport.h - FOLLOW_MARGIN - HINT_BAR_SPACE;
  let dx = 0;
  let dy = 0;
  // 焦点比可视区还大时优先保证左上角可见（长文本从开头读起）
  if (left < FOLLOW_MARGIN || right - left > maxRight - FOLLOW_MARGIN) dx = FOLLOW_MARGIN - left;
  else if (right > maxRight) dx = maxRight - right;
  if (top < FOLLOW_MARGIN || bottom - top > maxBottom - FOLLOW_MARGIN) dy = FOLLOW_MARGIN - top;
  else if (bottom > maxBottom) dy = maxBottom - bottom;
  return dx || dy ? { ...camera, x: camera.x + dx, y: camera.y + dy } : null;
}

function findNote(state: BoardState, id: string): BoardNote | undefined {
  return state.notes.find((note) => note.id === id);
}

/** 打开页面时：有内容就选中最后写的那条，接着写；空白板则光标放在原点 */
function initialSelection(state: BoardState): BoardSelection {
  const last = state.notes[state.notes.length - 1];
  return last ? { kind: 'note', id: last.id } : { kind: 'cursor', x: 0, y: 0 };
}

/** 子级 / 延伸出的便签沿用颜色和外框，但字号不超过正文，避免标题下面全是标题 */
function childStyleSource(parent: BoardNote): BoardNote {
  return { ...parent, size: Math.min(parent.size, DEFAULT_SIZE_LEVEL) };
}

/** 便签里的文字后补一个零宽空格：让末尾换行也占一行，展示层与编辑器的尺寸完全一致 */
function displayText(text: string): string {
  return `${text}​`;
}

export function WhiteboardPage() {
  const { t, language, setLanguage } = useI18n();
  const [initial] = useState(() => {
    const state = loadBoard();
    return { board: state, selection: initialSelection(state) };
  });
  const [board, setBoard] = useState<BoardState>(initial.board);
  const [selection, setSelection] = useState<BoardSelection>(initial.selection);
  const [editing, setEditing] = useState<EditSession | null>(null);
  /** 连线模式的起点；非 null 时方向键在便签间挑选目标 */
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [viewport, setViewport] = useState<ViewportSize>(() => ({ w: window.innerWidth, h: window.innerHeight }));
  const [camera, setCamera] = useState<Camera>(() => ({ x: window.innerWidth / 2, y: window.innerHeight / 3, zoom: 1 }));
  /** 键盘操作时相机平滑过渡；鼠标拖动、滚轮时关闭过渡以免跟手延迟 */
  const [smoothCamera, setSmoothCamera] = useState(true);
  const [sizes, setSizes] = useState<SizeMap>({});
  const [theme, setTheme] = useState<BoardTheme>(loadBoardTheme);
  const [showHelp, setShowHelp] = useState(false);
  const [showHints, setShowHints] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const compositionActiveRef = useRef(false);
  const [debugKey, setDebugKey] = useState('waiting');
  useEffect(() => {
    const report = (e: KeyboardEvent) => setDebugKey(JSON.stringify({ type: e.type, key: e.key, code: e.code, keyCode: e.keyCode, composing: e.isComposing, active: compositionActiveRef.current, target: (e.target as HTMLElement)?.tagName }));
    window.addEventListener('keydown', report, true);
    window.addEventListener('keyup', report, true);
    return () => { window.removeEventListener('keydown', report, true); window.removeEventListener('keyup', report, true); };
  }, []);
  const viewportRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef(camera);
  cameraRef.current = camera;
  const boardRef = useRef(board);
  boardRef.current = board;
  /** 快照式撤销栈；lastKey 用来合并连续的同类操作（如连续 Shift+方向键挪动同一便签） */
  const historyRef = useRef<{ past: BoardState[]; future: BoardState[]; lastKey: string | null }>({ past: [], future: [], lastKey: null });
  const noticeTimerRef = useRef<number | undefined>(undefined);

  // ResizeObserver 在渲染期惰性创建：首次挂载时便签的 ref 回调早于 effect 执行，必须提前就绪
  const observerRef = useRef<ResizeObserver | null>(null);
  if (!observerRef.current && typeof ResizeObserver !== 'undefined') {
    observerRef.current = new ResizeObserver((entries) => {
      setSizes((previous) => {
        let next = previous;
        for (const entry of entries) {
          const element = entry.target as HTMLElement;
          const id = element.dataset.id;
          if (!id) continue;
          // offsetWidth 不受父级 transform 缩放影响，正好是世界坐标尺寸
          const size = { w: element.offsetWidth, h: element.offsetHeight };
          const old = previous[id];
          if (old && old.w === size.w && old.h === size.h) continue;
          if (next === previous) next = { ...previous };
          next[id] = size;
        }
        return next;
      });
    });
  }

  /** 便签 DOM 的 ref：挂载时开始测量尺寸，卸载时停止（React 19 的 ref 清理函数） */
  const observeNote = useCallback((element: HTMLDivElement | null) => {
    const observer = observerRef.current;
    if (!element || !observer) return;
    observer.observe(element);
    return () => observer.unobserve(element);
  }, []);

  useEffect(() => () => observerRef.current?.disconnect(), []);

  // 防抖保存；关闭 / 切走页面时立即落盘，避免最后几个字丢失
  useEffect(() => {
    const timer = window.setTimeout(() => saveBoard(board), SAVE_DELAY);
    return () => window.clearTimeout(timer);
  }, [board]);
  useEffect(() => {
    const flush = () => saveBoard(boardRef.current);
    window.addEventListener('pagehide', flush);
    return () => window.removeEventListener('pagehide', flush);
  }, []);

  useEffect(() => saveBoardTheme(theme), [theme]);

  useEffect(() => {
    const onResize = () => setViewport({ w: window.innerWidth, h: window.innerHeight });
    // 切回标签页时把焦点还给"笔"，回来就能直接打字
    const onFocus = () => textareaRef.current?.focus({ preventScroll: true });
    window.addEventListener('resize', onResize);
    window.addEventListener('focus', onFocus);
    textareaRef.current?.focus({ preventScroll: true });
    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  // 滚轮需要非 passive 监听才能阻止页面默认缩放 / 回弹；触控板捏合会带 ctrlKey
  useEffect(() => {
    const element = viewportRef.current;
    if (!element) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setSmoothCamera(false);
      if (e.ctrlKey || e.metaKey) setCamera((current) => zoomCamera(current, Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY));
      else setCamera((current) => ({ ...current, x: current.x - e.deltaX, y: current.y - e.deltaY }));
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

  const selectedNote = selection.kind === 'note' ? findNote(board, selection.id) : undefined;

  const focusRect = useMemo<Rect | null>(() => {
    if (selection.kind === 'cursor') return cursorRect(selection.x, selection.y);
    const note = findNote(board, selection.id);
    return note ? noteRect(note, sizes) : null;
  }, [selection, board, sizes]);
  const focusKey = focusRect ? `${focusRect.x},${focusRect.y},${focusRect.w},${focusRect.h}` : '';

  // 焦点移动或便签随输入变大时，相机跟上；只依赖焦点本身，用户手动平移后不会被拽回
  useLayoutEffect(() => {
    if (!focusRect) return;
    const next = followCamera(cameraRef.current, focusRect, viewport);
    if (next) setCamera(next);
  }, [focusKey, viewport]);

  // 普通态下"笔"的光标始终停在末尾：一打字就是在选中便签后面续写
  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea || editing) return;
    const end = textarea.value.length;
    textarea.setSelectionRange(end, end);
  }, [selection, editing, board]);

  /** 底部短暂提示，用于撤销、连线等没有明显视觉变化的操作 */
  function flash(message: string) {
    setNotice(message);
    window.clearTimeout(noticeTimerRef.current);
    noticeTimerRef.current = window.setTimeout(() => setNotice(null), NOTICE_DURATION);
  }

  /**
   * 记一笔撤销历史。
   * @param snapshot 操作前的白板
   * @param coalesceKey 与上一笔相同时不再记录，把连续操作合并成一次撤销
   */
  function recordHistory(snapshot: BoardState, coalesceKey: string | null = null) {
    const history = historyRef.current;
    if (coalesceKey && coalesceKey === history.lastKey) return;
    history.past.push(snapshot);
    if (history.past.length > HISTORY_LIMIT) history.past.shift();
    history.future = [];
    history.lastKey = coalesceKey;
  }

  /** 普通态的一次修改：记历史并应用 */
  function commit(next: BoardState, coalesceKey: string | null = null) {
    recordHistory(board, coalesceKey);
    setBoard(next);
  }

  /** 切换焦点；同时打断操作合并，换个对象再挪动就是新的一次撤销 */
  function select(next: BoardSelection) {
    historyRef.current.lastKey = null;
    setSmoothCamera(true);
    setSelection(next);
  }

  /**
   * 撤销 / 重做后，若选中的便签已不存在，就把自由光标留在它原来的位置。
   */
  function reconcileSelection(next: BoardState) {
    if (selection.kind !== 'note' || findNote(next, selection.id)) return;
    const gone = findNote(board, selection.id);
    setSelection({ kind: 'cursor', x: gone?.x ?? 0, y: gone?.y ?? 0 });
  }

  function undo() {
    const history = historyRef.current;
    const previous = history.past.pop();
    if (!previous) {
      flash(t('board.notice.nothingToUndo'));
      return;
    }
    history.future.push(board);
    history.lastKey = null;
    setBoard(previous);
    reconcileSelection(previous);
    flash(t('board.notice.undo'));
  }

  function redo() {
    const history = historyRef.current;
    const next = history.future.pop();
    if (!next) {
      flash(t('board.notice.nothingToRedo'));
      return;
    }
    history.past.push(board);
    history.lastKey = null;
    setBoard(next);
    reconcileSelection(next);
    flash(t('board.notice.redo'));
  }

  /**
   * 开始编辑：选中便签时续写它，自由光标时在光标处新建一条。
   * @param text 触发编辑时"笔"里的内容（打字 / 输入法 / 粘贴进来的文字已包含在内）
   */
  function beginEditing(text?: string) {
    setSmoothCamera(true);
    if (selection.kind === 'note') {
      const note = findNote(board, selection.id);
      if (!note) return;
      setEditing({ id: note.id, isNew: false, originId: null, before: board, originalText: note.text });
      if (text !== undefined && text !== note.text) setBoard(updateNote(board, note.id, { text }));
      return;
    }
    const note = createNote(snap(selection.x), snap(selection.y), text ?? '');
    setBoard(addNote(board, note));
    setSelection({ kind: 'note', id: note.id });
    setEditing({ id: note.id, isNew: true, originId: null, before: board, originalText: '' });
  }

  /**
   * 结算当前编辑会话（不直接 setState，返回结果供调用方继续链式创建下一条）。
   * 空白的新便签整体回滚且不留历史；清空了文字的旧便签视为删除。
   * @return 结算后的白板与应落到的焦点
   */
  function settleEdit(): { next: BoardState; selection: BoardSelection } {
    const note = editing ? findNote(board, editing.id) : undefined;
    if (!editing || !note) return { next: board, selection };
    if (!note.text.trim()) {
      if (editing.isNew) {
        const origin = editing.originId && findNote(editing.before, editing.originId);
        return {
          next: editing.before,
          selection: origin ? { kind: 'note', id: origin.id } : { kind: 'cursor', x: note.x, y: note.y },
        };
      }
      recordHistory(editing.before);
      return { next: removeNote(board, note.id), selection: { kind: 'cursor', x: note.x, y: note.y } };
    }
    if (editing.isNew || note.text !== editing.originalText) recordHistory(editing.before);
    return { next: board, selection: { kind: 'note', id: note.id } };
  }

  function finishEditing() {
    const result = settleEdit();
    setBoard(result.next);
    setEditing(null);
    select(result.selection);
    flash(t('board.notice.editFinished'));
  }

  /**
   * 在 base 上新建一条空便签并立即进入编辑。
   * @param base 基准白板（通常是刚结算完的上一条）
   * @param position 落点
   * @param linkFrom 从哪条便签连线过来
   * @param styleSource 继承样式的来源
   * @param originId 派生来源，供空行缩进判断
   */
  function startNote(
    base: BoardState,
    position: { x: number; y: number },
    linkFrom: string | null,
    styleSource: BoardNote | undefined,
    originId: string,
  ) {
    const note = createNote(position.x, position.y, '', styleSource);
    historyRef.current.lastKey = null;
    setSmoothCamera(true);
    setBoard(addNote(base, note, linkFrom));
    setSelection({ kind: 'note', id: note.id });
    setEditing({ id: note.id, isNew: true, originId, before: base, originalText: '' });
  }

  /** 新同级：放在该便签子树下方，与它挂在同一个父级下 */
  function createSibling(base: BoardState, id: string) {
    const position = placeSibling(base, sizes, id);
    if (position) startNote(base, position, parentOf(base, id), findNote(base, id), id);
  }

  /** 朝某方向延伸一条连线便签；向右即"新子级" */
  function growNote(base: BoardState, id: string, direction: Direction) {
    const source = findNote(base, id);
    const position = placeInDirection(base, sizes, id, direction);
    if (source && position) startNote(base, position, id, childStyleSource(source), id);
  }

  /** 编辑态按键：Enter / Tab / Shift+Tab 写完当前条并接着写下一条，形成不间断的书写流 */
  function handleEditKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!editing) return;
    const note = findNote(board, editing.id);
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey;
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEditing();
      return;
    }
    if (!note) return;
    if (e.key === 'Enter' && plain && !e.shiftKey) {
      e.preventDefault();
      // 空行上回车：结束这一串书写（和大纲工具一致）
      if (!note.text.trim()) {
        finishEditing();
        return;
      }
      createSibling(settleEdit().next, note.id);
      return;
    }
    if (e.key === 'Tab' && plain) {
      e.preventDefault();
      if (!note.text.trim()) {
        // 空行上 Tab / Shift+Tab 是调整层级：丢弃这条空行，在新层级重新开一条
        if (!editing.isNew) return;
        const base = editing.before;
        const parent = parentOf(board, note.id);
        if (e.shiftKey) {
          if (parent) createSibling(base, parent);
        } else if (editing.originId && parentOf(base, editing.originId) === parent) {
          // 只有作为"同级"新建的空行才能缩进到上一条下面
          growNote(base, editing.originId, 'right');
        }
        return;
      }
      const base = settleEdit().next;
      if (e.shiftKey) createSibling(base, parentOf(base, note.id) ?? note.id);
      else growNote(base, note.id, 'right');
    }
  }

  /** 连线模式按键：方向键挑目标，Enter 连上 / 断开，Esc 退回起点 */
  function handleConnectKey(e: React.KeyboardEvent<HTMLTextAreaElement>, from: string) {
    const direction = ARROW_DIRECTIONS[e.key];
    if (direction) {
      e.preventDefault();
      if (selection.kind !== 'note') return;
      // 连线目标只能是便签：该方向没有便签时原地不动，不落到空白处
      const next = navigate(board, sizes, selection, direction);
      if (next.kind === 'note') select(next);
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      connectTo(from, selection.kind === 'note' ? selection.id : null);
      return;
    }
    if (e.key === 'Escape' || (e.altKey && e.code === 'KeyC')) {
      e.preventDefault();
      setConnectFrom(null);
      select({ kind: 'note', id: from });
      return;
    }
    // 连线模式下不接受输入，避免误把字打进便签
    if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') e.preventDefault();
  }

  /** 在 from 与 to 之间切换连线并退出连线模式 */
  function connectTo(from: string, to: string | null) {
    setConnectFrom(null);
    if (!to || to === from) {
      select({ kind: 'note', id: from });
      return;
    }
    const result = toggleEdge(board, from, to);
    commit(result.state);
    flash(t(result.linked ? 'board.notice.linked' : 'board.notice.unlinked'));
  }

  /** 修改选中便签的样式；没选中便签时提示一下 */
  function styleSelected(patch: (note: BoardNote) => Partial<BoardNote>) {
    if (!selectedNote) {
      flash(t('board.notice.needNote'));
      return;
    }
    commit(updateNote(board, selectedNote.id, patch(selectedNote)));
  }

  /** ⌘B / Ctrl+B：整条便签加粗；普通态与编辑态都能用 */
  function toggleBold() {
    styleSelected((note) => ({ bold: !note.bold }));
  }

  /** 以选中便签为起点进入连线模式；⌥+C、⌘+Enter 和顶栏按钮共用 */
  function beginConnect() {
    if (!selectedNote) {
      flash(t('board.notice.needNote'));
      return;
    }
    // 输入中直接进入连线模式会留下一个还开着的编辑器：先把当前这条写完
    if (editing) {
      finishEditing();
      // 空白便签会在结算时被删掉，没有可连线的对象
      if (!selectedNote.text.trim()) return;
    }
    setConnectFrom(selectedNote.id);
  }

  /**
   * ⌥ 组合键：颜色 / 外框 / 字号 / 连线 / 主题 / 提示条。
   * 编辑态也会调用，所以 ⌥+方向 不能放进来（那里是输入法的按词移动光标）。
   * @return 是否消费了这次按键
   */
  function handleAltShortcut(e: React.KeyboardEvent): boolean {
    for (let digit = 1; digit <= 6; digit += 1) {
      if (matchesDigit(e, digit)) {
        e.preventDefault();
        styleSelected(() => ({ color: digit - 1 }));
        return true;
      }
    }
    if (matchesLetter(e, 'b')) {
      e.preventDefault();
      styleSelected((note) => ({ frame: NOTE_FRAMES[(NOTE_FRAMES.indexOf(note.frame) + 1) % NOTE_FRAMES.length] }));
      return true;
    }
    if (e.code === 'Equal' || e.key === '=' || e.key === '+') {
      e.preventDefault();
      styleSelected((note) => ({ size: Math.min(NOTE_SIZE_LEVELS - 1, note.size + 1) }));
      return true;
    }
    if (e.code === 'Minus' || e.key === '-' || e.key === '_' || e.key === '−') {
      e.preventDefault();
      styleSelected((note) => ({ size: Math.max(0, note.size - 1) }));
      return true;
    }
    if (matchesLetter(e, 'c')) {
      e.preventDefault();
      beginConnect();
      return true;
    }
    if (matchesLetter(e, 't')) {
      e.preventDefault();
      const next = theme === 'chalk' ? 'white' : 'chalk';
      setTheme(next);
      flash(t(`board.notice.theme.${next}`));
      return true;
    }
    if (matchesLetter(e, 'h')) {
      e.preventDefault();
      setShowHints((visible) => !visible);
      return true;
    }
    return false;
  }

  async function handleDownloadPng() {
    if (board.notes.length === 0) {
      flash(t('board.notice.nothingToExport'));
      return;
    }
    try {
      const ok = await downloadBoardPng(board, sizes, theme);
      flash(ok ? t('board.notice.downloaded') : t('board.notice.nothingToExport'));
    } catch {
      flash(t('board.notice.downloadFailed'));
    }
  }

  function handleDownloadJson() {
    if (board.notes.length === 0) {
      flash(t('board.notice.nothingToExport'));
      return;
    }
    try {
      downloadBoardJson(board, theme);
      flash(t('board.notice.downloaded'));
    } catch {
      flash(t('board.notice.downloadFailed'));
    }
  }

  function setZoom(factor: number | 'fit') {
    setSmoothCamera(true);
    if (factor !== 'fit') {
      const next = zoomCamera(camera, factor, viewport.w / 2, viewport.h / 2);
      setCamera(next);
      flash(`${Math.round(next.zoom * 100)}%`);
      return;
    }
    const bounds = boundsOf(board.notes.map((note) => noteRect(note, sizes)));
    if (!bounds) {
      setCamera({ x: viewport.w / 2, y: viewport.h / 3, zoom: 1 });
      return;
    }
    const padding = FOLLOW_MARGIN * 1.5;
    const zoom = clampZoom(Math.min((viewport.w - padding * 2) / bounds.w, (viewport.h - padding * 2) / bounds.h, 1.5));
    setCamera({
      zoom,
      x: viewport.w / 2 - (bounds.x + bounds.w / 2) * zoom,
      y: (viewport.h - HINT_BAR_SPACE) / 2 - (bounds.y + bounds.h / 2) * zoom,
    });
  }

  /** 普通态按键：导航、结构、样式、视图；普通字符不拦截，交给 onChange 自动进入编辑 */
  function handleNormalKey(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    const mod = e.metaKey || e.ctrlKey;
    const key = e.key;
    const direction = ARROW_DIRECTIONS[key];

    if (key === 'Escape') {
      e.preventDefault();
      if (showHelp) setShowHelp(false);
      else if (selectedNote) select({ kind: 'cursor', x: selectedNote.x, y: selectedNote.y });
      return;
    }

    if (mod && !e.altKey) {
      const lower = key.toLowerCase();
      if (lower === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (lower === 'y') {
        e.preventDefault();
        redo();
      } else if (key === '=' || key === '+') {
        e.preventDefault();
        setZoom(ZOOM_STEP);
      } else if (key === '-') {
        e.preventDefault();
        setZoom(1 / ZOOM_STEP);
      } else if (key === '0') {
        e.preventDefault();
        setZoom('fit');
      } else if (e.shiftKey && (key === 'Backspace' || key === 'Delete')) {
        e.preventDefault();
        if (board.notes.length > 0) {
          commit(EMPTY_BOARD);
          select({ kind: 'cursor', x: 0, y: 0 });
          flash(t('board.notice.cleared', { mod: MOD_KEY }));
        }
      } else if (lower === 'a' || lower === 'x') {
        // 普通态下"笔"不可见，全选 / 剪切会悄悄改动便签文字，直接屏蔽
        e.preventDefault();
      }
      return;
    }

    if (direction) {
      e.preventDefault();
      if (e.altKey && selectedNote) {
        growNote(board, selectedNote.id, direction);
      } else if (e.shiftKey && selectedNote) {
        const dx = direction === 'right' ? GRID : direction === 'left' ? -GRID : 0;
        const dy = direction === 'down' ? GRID : direction === 'up' ? -GRID : 0;
        setSmoothCamera(true);
        commit(updateNote(board, selectedNote.id, { x: selectedNote.x + dx, y: selectedNote.y + dy }), `move:${selectedNote.id}`);
      } else if (!e.altKey) {
        select(navigate(board, sizes, selection, direction, e.shiftKey));
      }
      return;
    }

    if (e.altKey) {
      handleAltShortcut(e);
      return;
    }

    if (key === 'Enter' || key === 'F2' || key === ' ') {
      e.preventDefault();
      if (key === 'Enter' && selectedNote) createSibling(board, selectedNote.id);
      else beginEditing();
      return;
    }
    if (key === 'Tab') {
      e.preventDefault();
      if (!selectedNote) return;
      if (e.shiftKey) createSibling(board, parentOf(board, selectedNote.id) ?? selectedNote.id);
      else growNote(board, selectedNote.id, 'right');
      return;
    }
    if (key === 'Backspace' || key === 'Delete') {
      e.preventDefault();
      if (!selectedNote) return;
      const parent = parentOf(board, selectedNote.id);
      commit(removeNote(board, selectedNote.id));
      select(parent ? { kind: 'note', id: parent } : { kind: 'cursor', x: selectedNote.x, y: selectedNote.y });
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (showHelp && e.key === 'Escape') {
      e.preventDefault();
      setShowHelp(false);
      return;
    }
    // 输入法组字期间的 Enter / Esc 属于输入法；带修饰键的组合键是快捷键，不能被 229 吞掉
    const hasModifier = e.metaKey || e.ctrlKey || e.altKey;
    if (!hasModifier && shouldIgnoreBoardKey(e.nativeEvent, compositionActiveRef.current)) return;
    if (((e.metaKey || e.ctrlKey) && e.key === '/') || e.key === 'F1') {
      e.preventDefault();
      setShowHelp((visible) => !visible);
      return;
    }
    // ⌘B / Ctrl+B：整条便签加粗（输入中也算），放在模式分发之前
    if ((e.metaKey || e.ctrlKey) && !e.altKey && matchesLetter(e, 'b')) {
      e.preventDefault();
      toggleBold();
      return;
    }
    // ⌘Enter / Ctrl+Enter：连线的备用入口，部分输入法会吞掉 ⌥ 组合键
    if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key === 'Enter') {
      e.preventDefault();
      beginConnect();
      return;
    }
    if (editing) {
      // 编辑中也允许缩放视图，撤销则交给 textarea 自带的文字撤销
      if ((e.metaKey || e.ctrlKey) && (e.key === '=' || e.key === '+' || e.key === '-' || e.key === '0')) {
        e.preventDefault();
        setZoom(e.key === '0' ? 'fit' : e.key === '-' ? 1 / ZOOM_STEP : ZOOM_STEP);
        return;
      }
      // ⌥ 样式快捷键在输入时同样生效，不用先按 Esc 退出编辑
      if (e.altKey && !e.metaKey && !e.ctrlKey && handleAltShortcut(e)) return;
      handleEditKey(e);
      return;
    }
    if (connectFrom) {
      handleConnectKey(e, connectFrom);
      return;
    }
    handleNormalKey(e);
  }

  /** "笔"里的内容变化：编辑中同步到便签；普通态下出现输入说明用户开始写了，直接进入编辑 */
  function handleChange(e: React.ChangeEvent<HTMLTextAreaElement>) {
    const value = e.target.value;
    if (editing) {
      setBoard((current) => updateNote(current, editing.id, { text: value }));
      return;
    }
    if (connectFrom) setConnectFrom(null);
    beginEditing(value);
  }

  /** 输入法开始组字：立即让编辑器可见，组字过程就显示在便签原位 */
  function handleCompositionStart(e: React.CompositionEvent<HTMLTextAreaElement>) {
    compositionActiveRef.current = true;
    if (editing) return;
    if (connectFrom) setConnectFrom(null);
    beginEditing(e.currentTarget.value);
  }

  function screenToWorld(clientX: number, clientY: number): { x: number; y: number } {
    return { x: (clientX - camera.x) / camera.zoom, y: (clientY - camera.y) / camera.zoom };
  }

  /**
   * 跟踪一次鼠标拖动：超过阈值才回调 onDrag，松开时若没拖动则回调 onClick。
   */
  function trackPointer(
    e: React.PointerEvent,
    onDrag: (dx: number, dy: number, first: boolean) => void,
    onClick: (clientX: number, clientY: number) => void,
  ) {
    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;
    const onMove = (event: PointerEvent) => {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (!dragging && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      const first = !dragging;
      dragging = true;
      onDrag(dx, dy, first);
    };
    const onUp = (event: PointerEvent) => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      if (!dragging) onClick(event.clientX, event.clientY);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /** 点空白处：拖动平移画布；单击把自由光标放到点击位置 */
  function handleViewportPointerDown(e: React.PointerEvent) {
    if (e.button !== 0) return;
    e.preventDefault();
    const start = cameraRef.current;
    trackPointer(
      e,
      (dx, dy) => {
        setSmoothCamera(false);
        setCamera({ ...start, x: start.x + dx, y: start.y + dy });
      },
      (clientX, clientY) => {
        const point = screenToWorld(clientX, clientY);
        if (editing) {
          const result = settleEdit();
          setBoard(result.next);
          setEditing(null);
        }
        setConnectFrom(null);
        select({ kind: 'cursor', x: snap(point.x - GRID / 2), y: snap(point.y - CURSOR_SIZE.h / 2) });
      },
    );
  }

  /** 点便签：选中（连线模式下则连向它）；拖动则移动便签，整段拖动只记一次撤销 */
  function handleNotePointerDown(e: React.PointerEvent, note: BoardNote) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    if (connectFrom) {
      connectTo(connectFrom, note.id);
      return;
    }
    let base = board;
    if (editing) {
      const result = settleEdit();
      base = result.next;
      setBoard(base);
      setEditing(null);
    }
    if (!findNote(base, note.id)) return;
    select({ kind: 'note', id: note.id });
    const zoom = cameraRef.current.zoom;
    trackPointer(
      e,
      (dx, dy, first) => {
        if (first) recordHistory(base);
        setBoard((current) => updateNote(current, note.id, { x: snap(note.x + dx / zoom), y: snap(note.y + dy / zoom) }));
      },
      () => {},
    );
  }

  /** 双击：空白处新建，便签上编辑（前一次单击已经把焦点放好了） */
  function handleDoubleClick() {
    if (!editing && !connectFrom) beginEditing();
  }

  const hintMode: HintMode = editing ? 'edit' : connectFrom ? 'connect' : selectedNote ? 'note' : 'cursor';
  const editorNote = selectedNote;
  const editorValue = editorNote?.text ?? '';
  const connectSource = connectFrom ? findNote(board, connectFrom) : undefined;
  const gridSize = GRID * 2 * camera.zoom;

  /** 便签与编辑器共用的外观 class / 样式，保证编辑器能严丝合缝地盖在便签上 */
  const noteAppearance = (note: BoardNote | undefined) => ({
    className: `wb-note frame-${note?.frame ?? 'none'}${note?.bold ? ' is-bold' : ''}`,
    style: {
      left: note?.x ?? (selection.kind === 'cursor' ? selection.x : 0),
      top: note?.y ?? (selection.kind === 'cursor' ? selection.y : 0),
      fontSize: FONT_SIZES[note?.size ?? DEFAULT_SIZE_LEVEL],
      color: `var(--wb-c${note?.color ?? 0})`,
    } as React.CSSProperties,
  });

  const connectPreview = connectSource && selectedNote && selectedNote.id !== connectSource.id
    ? edgePath(noteRect(connectSource, sizes), noteRect(selectedNote, sizes))
    : null;
  const editorAppearance = noteAppearance(editorNote);

  return (
    <div className={`wb-root wb-theme-${theme}`}>
      <output style={{ position: 'absolute', top: 110, left: 20, zIndex: 30 }}>{debugKey}</output>
      <div
        ref={viewportRef}
        className="wb-viewport"
        style={{
          backgroundSize: `${gridSize}px ${gridSize}px`,
          backgroundPosition: `${camera.x}px ${camera.y}px`,
        }}
        onPointerDown={handleViewportPointerDown}
        onMouseDown={(e) => e.preventDefault()}
        onDoubleClick={handleDoubleClick}
        onScroll={(e) => {
          // 浏览器会为可见光标自动滚动 overflow:hidden 容器，这里强制归零，位移只由相机控制
          e.currentTarget.scrollTop = 0;
          e.currentTarget.scrollLeft = 0;
        }}
      >
        <div
          className={`wb-world${smoothCamera ? ' is-smooth' : ''}`}
          style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.zoom})` }}
        >
          <svg className="wb-edges" aria-hidden="true">
            <defs>
              <marker id="wb-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
                <path d="M 0 1 L 9 5 L 0 9" fill="none" stroke="var(--wb-edge)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
              </marker>
            </defs>
            {board.edges.map((edge) => {
              const from = findNote(board, edge.from);
              const to = findNote(board, edge.to);
              const path = from && to ? edgePath(noteRect(from, sizes), noteRect(to, sizes)) : null;
              return path ? <path key={edge.id} d={path} markerEnd="url(#wb-arrow)" /> : null;
            })}
            {connectPreview && <path className="is-preview" d={connectPreview} />}
          </svg>

          {board.notes.map((note) => {
            const appearance = noteAppearance(note);
            const isSelected = selection.kind === 'note' && selection.id === note.id;
            const isEditing = editing?.id === note.id;
            return (
              <div
                key={note.id}
                ref={observeNote}
                data-id={note.id}
                className={[
                  appearance.className,
                  isSelected && !isEditing ? 'is-selected' : '',
                  isEditing ? 'is-hidden' : '',
                  connectFrom === note.id ? 'is-connect-source' : '',
                ].filter(Boolean).join(' ')}
                style={appearance.style}
                onPointerDown={(e) => handleNotePointerDown(e, note)}
              >
                {displayText(note.text)}
              </div>
            );
          })}

          {selection.kind === 'cursor' && (
            <div className="wb-cursor" style={{ left: selection.x, top: selection.y, width: CURSOR_SIZE.w, height: CURSOR_SIZE.h }} />
          )}

          <div
            className={`${editorAppearance.className} wb-editor${editing ? ' is-active' : ''}`}
            style={editorAppearance.style}
            onPointerDown={(e) => {
              // 编辑中点击编辑器内部只移动文字光标，不触发画布的取消选中
              if (editing) e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <span aria-hidden="true">{displayText(editorValue)}</span>
            <textarea
              ref={textareaRef}
              value={editorValue}
              rows={1}
              cols={1}
              spellCheck={false}
              autoComplete="off"
              aria-label={t('board.editorLabel')}
              onChange={handleChange}
              onKeyDown={handleKeyDown}
              onCompositionStart={handleCompositionStart}
              onCompositionEnd={() => { compositionActiveRef.current = false; }}
              onBlur={() => requestAnimationFrame(() => textareaRef.current?.focus({ preventScroll: true }))}
            />
          </div>
        </div>
      </div>

      {board.notes.length === 0 && !editing && <div className="wb-empty">{t('board.empty')}</div>}

      <header className="wb-topbar" onMouseDown={(e) => e.preventDefault()}>
        <span className="wb-topbar-title">{t('app.title')}</span>
        <button type="button" aria-label={language === 'en' ? '切换到中文' : 'Switch to English'} onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}>{language === 'en' ? '中文' : 'EN'}</button>
        <span className="wb-topbar-spacer" />
        <button type="button" onClick={() => setTheme(theme === 'chalk' ? 'white' : 'chalk')}>
          {t(theme === 'chalk' ? 'board.notice.theme.white' : 'board.notice.theme.chalk')}
        </button>
        <button type="button" onClick={beginConnect} disabled={!selectedNote} aria-pressed={Boolean(connectFrom)}>
          {t('board.connect')}
        </button>
        <button type="button" onClick={handleDownloadPng}>{t('board.downloadPng')}</button>
        <button type="button" onClick={handleDownloadJson}>{t('board.downloadJson')}</button>
        <a className="wb-topbar-link" href={language === 'zh' ? '/zh/guide.html' : '/guide.html'}>{t('board.guide')}</a>
        <button type="button" onClick={() => setShowHelp(true)}>{t('board.help')}</button>
      </header>

      {(connectFrom || editing || notice) && (
        <div className="wb-status" role="status">
          {connectFrom ? t('board.connectMode') : editing ? t('board.editMode') : notice}
        </div>
      )}
      {(showHints || connectFrom) && <WhiteboardHints mode={hintMode} notice={null} />}
      {showHelp && <WhiteboardHelp onClose={() => setShowHelp(false)} />}
    </div>
  );
}

export default WhiteboardPage;
