import test from 'node:test';
import assert from 'node:assert/strict';
import { exportStamp, serializeBoard, wrapTextLines } from './export';
import { sanitizeBoard } from './boardStorage';
import type { BoardState } from './model';

test('JSON 备份带上主题与加粗，能被持久化清洗逻辑原样读回', () => {
  const board: BoardState = {
    notes: [{ id: 'n1', x: 40, y: 20, text: '标题', color: 2, frame: 'box', size: 2, bold: true }],
    edges: [],
  };
  const parsed = JSON.parse(serializeBoard(board, 'chalk')) as { version: number; theme: string };
  assert.equal(parsed.version, 1);
  assert.equal(parsed.theme, 'chalk');

  const restored = sanitizeBoard(parsed);
  assert.deepEqual(restored, board);
});

test('换行按宽度逐字符折行，并保留空行', () => {
  const measure = (line: string) => line.length;
  assert.deepEqual(wrapTextLines('abcd', 2, measure), ['ab', 'cd']);
  assert.deepEqual(wrapTextLines('a\n\nb', 10, measure), ['a', '', 'b']);
  assert.deepEqual(wrapTextLines('', 10, measure), ['']);
});

test('导出文件名日期补零', () => {
  assert.equal(exportStamp(new Date(2026, 0, 5)), '2026-01-05');
});
