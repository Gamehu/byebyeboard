/**
 * Small keyboard-related utilities.
 */

/** The keyboard event fields needed to detect IME composition */
export interface CompositionKey {
  isComposing?: boolean;
  keyCode?: number;
}

/**
 * Whether a keypress belongs to IME composition (e.g. Enter while picking a pinyin
 * candidate, or Esc while canceling one).
 * Safari already reports isComposing as false on the keydown that confirms a candidate, so
 * that case can only be detected by keyCode 229.
 * @param e the native keyboard event (for a React event, pass e.nativeEvent)
 * @returns true while composing, in which case Enter / Esc should be left to the IME
 */
export function isImeComposing(e: CompositionKey): boolean {
  return Boolean(e.isComposing) || e.keyCode === 229;
}

export function shouldIgnoreBoardKey(e: CompositionKey & { key: string }, compositionActive: boolean): boolean {
  // Esc 在组字已结束后必须能退出编辑，不能仅凭遗留的 229 一直吞掉它。
  // 其他按键继续保留 229 兜底，尤其是 Safari 的组字确认 Enter。
  return compositionActive || Boolean(e.isComposing) || (e.keyCode === 229 && e.key !== 'Escape');
}
