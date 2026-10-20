/**
 * 白板模型测试：空间导航、新便签落点（同级 / 子级不重叠）、连线切换与几何、持久化数据清洗。
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GAP_X,
  GRID,
  addNote,
  createNote,
  edgePath,
  findFreePosition,
  navigate,
  noteRect,
  parentOf,
  placeInDirection,
  placeSibling,
  rectsOverlap,
  removeNote,
  toggleEdge,
  type BoardState,
  type SizeMap,
} from './model';
import { sanitizeBoard } from './boardStorage';

/** 构造一块固定 id 的白板，便于断言 */
function boardWith(...specs: Array<[id: string, x: number, y: number]>): BoardState {
  return {
    notes: specs.map(([id, x, y]) => ({ ...createNote(x, y, id), id })),
    edges: [],
  };
}

const sizes: SizeMap = {};

test('方向键跳到该方向最近的便签，偏离过大的不算', () => {
  const board = boardWith(['a', 0, 0], ['right', 300, 0], ['far', 600, 0], ['below', 0, 120]);
  assert.deepEqual(navigate(board, sizes, { kind: 'note', id: 'a' }, 'right'), { kind: 'note', id: 'right' });
  assert.deepEqual(navigate(board, sizes, { kind: 'note', id: 'a' }, 'down'), { kind: 'note', id: 'below' });
  // "below" 在 right 的左下方很远，按 ↓ 不应该跳过去
  assert.equal(navigate(board, sizes, { kind: 'note', id: 'right' }, 'down').kind, 'cursor');
});

test('该方向没有便签时，光标落到紧邻的空白处', () => {
  const board = boardWith(['a', 0, 0]);
  const next = navigate(board, { a: { w: 100, h: 40 } }, { kind: 'note', id: 'a' }, 'right');
  assert.equal(next.kind, 'cursor');
  assert.ok(next.kind === 'cursor' && next.x >= 100 + GAP_X && next.y === 0);
});

test('自由光标移进便签时选中它', () => {
  const board = boardWith(['a', 40, 0]);
  assert.deepEqual(navigate(board, sizes, { kind: 'cursor', x: 0, y: 0 }, 'right'), { kind: 'note', id: 'a' });
  assert.deepEqual(navigate(board, sizes, { kind: 'cursor', x: 0, y: 200 }, 'up', true), { kind: 'cursor', x: 0, y: 0 });
});

test('同级放在整棵子树下方且挂在同一父级', () => {
  let board = boardWith(['root', 0, 0], ['a', 200, 0], ['a1', 400, 0], ['a2', 400, 60]);
  board = { ...board, edges: [{ id: 'e1', from: 'root', to: 'a' }, { id: 'e2', from: 'a', to: 'a1' }, { id: 'e3', from: 'a', to: 'a2' }] };
  const position = placeSibling(board, sizes, 'a');
  assert.ok(position);
  assert.equal(position.x, 200);
  // a 的子树最低到 a2 底部（60 + 40），新同级必须在它下面
  assert.ok(position.y >= 100);
  assert.equal(position.y % GRID, 0);
  assert.equal(parentOf(board, 'a'), 'root');
});

test('连续新建子级会排成一列，互不重叠', () => {
  let board = boardWith(['p', 0, 0]);
  for (let index = 0; index < 4; index += 1) {
    const position = placeInDirection(board, sizes, 'p', 'right');
    assert.ok(position);
    board = addNote(board, { ...createNote(position.x, position.y), id: `c${index}` }, 'p');
  }
  const children = board.notes.filter((note) => note.id.startsWith('c'));
  assert.ok(children.every((note) => note.x === children[0].x));
  for (let i = 0; i < children.length; i += 1) {
    for (let j = i + 1; j < children.length; j += 1) {
      assert.equal(rectsOverlap(noteRect(children[i], sizes), noteRect(children[j], sizes)), false);
    }
  }
});

test('避让时越过挡路的便签，向上延伸时往上避让', () => {
  const occupied = [{ x: 0, y: 0, w: 100, h: 40 }];
  assert.deepEqual(findFreePosition({ x: 0, y: 0, w: 100, h: 40 }, occupied), { x: 0, y: 60 });
  assert.deepEqual(findFreePosition({ x: 0, y: 0, w: 100, h: 40 }, occupied, 'up'), { x: 0, y: -60 });
});

test('连线切换：任一方向已存在则断开，否则新增', () => {
  const board = boardWith(['a', 0, 0], ['b', 300, 0]);
  const linked = toggleEdge(board, 'a', 'b');
  assert.equal(linked.linked, true);
  assert.equal(linked.state.edges.length, 1);
  const unlinked = toggleEdge(linked.state, 'b', 'a');
  assert.equal(unlinked.linked, false);
  assert.equal(unlinked.state.edges.length, 0);
  assert.equal(toggleEdge(board, 'a', 'a').state, board);
});

test('删除便签时一并删除相连的线', () => {
  const board = toggleEdge(boardWith(['a', 0, 0], ['b', 300, 0]), 'a', 'b').state;
  assert.deepEqual(removeNote(board, 'b').edges, []);
});

test('连线有横向空隙就横连，横向重叠才纵连，彼此重叠时不画', () => {
  // 横向：右边中点 → 左边中点
  assert.equal(edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 300, y: 0, w: 100, h: 40 }, 6), 'M 106 20 C 200 20 200 20 294 20');
  // 纵向：下边中点 → 上边中点
  assert.equal(edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 0, y: 200, w: 100, h: 40 }, 6), 'M 50 46 C 50 120 50 120 50 194');
  assert.equal(edgePath({ x: 0, y: 0, w: 100, h: 40 }, { x: 50, y: 10, w: 100, h: 40 }), null);
});

test('持久化数据清洗：丢弃坏便签和悬空连线，修正越界样式', () => {
  const state = sanitizeBoard({
    notes: [
      { id: 'a', x: 0, y: 0, text: 'ok', color: 99, frame: 'weird', size: -1 },
      { id: 'b', x: 'nope', y: 0, text: 'bad' },
    ],
    edges: [{ id: 'e', from: 'a', to: 'b' }, { id: 'self', from: 'a', to: 'a' }],
  });
  assert.equal(state.notes.length, 1);
  assert.deepEqual({ color: state.notes[0].color, frame: state.notes[0].frame, size: state.notes[0].size }, { color: 0, frame: 'none', size: 1 });
  assert.deepEqual(state.edges, []);
  assert.deepEqual(sanitizeBoard('garbage'), { notes: [], edges: [] });
});
