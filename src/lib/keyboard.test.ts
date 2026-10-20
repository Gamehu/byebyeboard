/**
 * keyboard tests: Enter / Esc during IME composition belong to the IME and must not be
 * treated as "confirm rename / cancel rename".
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isImeComposing, shouldIgnoreBoardKey } from './keyboard';

test('组字已经结束时，带 229 的 Esc 仍然退出白板编辑', () => {
  assert.equal(shouldIgnoreBoardKey({ key: 'Escape', keyCode: 229, isComposing: false }, false), false);
});

test('正在组字时 Esc 交给输入法，Safari 的组字确认 Enter 仍被保护', () => {
  assert.equal(shouldIgnoreBoardKey({ key: 'Escape', keyCode: 229 }, true), true);
  assert.equal(shouldIgnoreBoardKey({ key: 'Escape', isComposing: true }, false), true);
  assert.equal(shouldIgnoreBoardKey({ key: 'Enter', keyCode: 229 }, false), true);
});

test('isComposing 为 true 时视为输入法组字中', () => {
  assert.equal(isImeComposing({ isComposing: true, keyCode: 13 }), true);
});

test('部分浏览器（Safari）在组字确认时 isComposing 已为 false，但 keyCode 为 229', () => {
  assert.equal(isImeComposing({ isComposing: false, keyCode: 229 }), true);
});

test('普通回车与 Esc 不是组字', () => {
  assert.equal(isImeComposing({ isComposing: false, keyCode: 13 }), false);
  assert.equal(isImeComposing({ isComposing: false, keyCode: 27 }), false);
});
