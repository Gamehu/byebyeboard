/**
 * 白板的快捷键说明：底部随当前状态变化的提示条，以及 Ctrl/⌘+/ 打开的完整快捷键面板。
 * 提示条只列当下最可能用到的几个键，让新用户边写边学，熟练后可用 Alt+H 隐藏。
 */
import React from 'react';
import { useI18n } from '../../lib/i18n';

/** 提示条对应的交互状态 */
export type HintMode = 'cursor' | 'note' | 'edit' | 'connect';

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
export const MOD_KEY = IS_MAC ? '⌘' : 'Ctrl';
export const ALT_KEY = IS_MAC ? '⌥' : 'Alt';

/** 一行说明：combos 是可互换的组合键（用 / 分隔显示），每个组合内的键用 + 连接 */
interface KeyRow {
  combos: string[][];
  label: string;
}

const ARROWS = '↑↓←→';

const HINTS: Record<HintMode, KeyRow[]> = {
  cursor: [
    { combos: [['Aa']], label: 'board.hint.type' },
    { combos: [[ARROWS]], label: 'board.hint.move' },
    { combos: [[MOD_KEY, '/']], label: 'board.hint.allKeys' },
  ],
  note: [
    { combos: [['Aa']], label: 'board.hint.edit' },
    { combos: [['Enter']], label: 'board.hint.sibling' },
    { combos: [['Tab']], label: 'board.hint.child' },
    { combos: [[ALT_KEY, ARROWS]], label: 'board.hint.grow' },
    { combos: [['Shift', ARROWS]], label: 'board.hint.nudge' },
    { combos: [[MOD_KEY, 'B']], label: 'board.hint.bold' },
    { combos: [[ALT_KEY, 'C'], [MOD_KEY, 'Enter']], label: 'board.hint.connect' },
    { combos: [['Del']], label: 'board.hint.delete' },
    { combos: [[MOD_KEY, '/']], label: 'board.hint.allKeys' },
  ],
  edit: [
    { combos: [['Enter']], label: 'board.hint.next' },
    { combos: [['Tab']], label: 'board.hint.child' },
    { combos: [['Shift', 'Tab']], label: 'board.hint.outdent' },
    { combos: [['Shift', 'Enter']], label: 'board.hint.newline' },
    { combos: [['Esc']], label: 'board.hint.done' },
  ],
  connect: [
    { combos: [[ARROWS]], label: 'board.hint.pickTarget' },
    { combos: [['Enter']], label: 'board.hint.toggleLink' },
    { combos: [['Esc']], label: 'board.hint.cancel' },
  ],
};

const HELP_GROUPS: Array<{ title: string; rows: KeyRow[] }> = [
  {
    title: 'board.help.group.write',
    rows: [
      { combos: [['Aa']], label: 'board.help.typeAnywhere' },
      { combos: [['F2'], ['Space']], label: 'board.help.editNote' },
      { combos: [['Enter']], label: 'board.help.nextItem' },
      { combos: [['Tab']], label: 'board.help.childItem' },
      { combos: [['Shift', 'Tab']], label: 'board.help.outdent' },
      { combos: [['Shift', 'Enter']], label: 'board.help.newline' },
      { combos: [['Esc']], label: 'board.help.finish' },
    ],
  },
  {
    title: 'board.help.group.navigate',
    rows: [
      { combos: [[ARROWS]], label: 'board.help.arrows' },
      { combos: [['Shift', ARROWS]], label: 'board.help.bigStep' },
      { combos: [['Esc']], label: 'board.help.deselect' },
    ],
  },
  {
    title: 'board.help.group.structure',
    rows: [
      { combos: [[ALT_KEY, ARROWS]], label: 'board.help.grow' },
      { combos: [['Shift', ARROWS]], label: 'board.help.nudge' },
      { combos: [[ALT_KEY, 'C'], [MOD_KEY, 'Enter']], label: 'board.help.connect' },
      { combos: [['Del'], ['⌫']], label: 'board.help.delete' },
    ],
  },
  {
    title: 'board.help.group.style',
    rows: [
      { combos: [[MOD_KEY, 'B']], label: 'board.help.bold' },
      { combos: [[ALT_KEY, '1–6']], label: 'board.help.color' },
      { combos: [[ALT_KEY, 'B']], label: 'board.help.frame' },
      { combos: [[ALT_KEY, '+'], [ALT_KEY, '−']], label: 'board.help.size' },
    ],
  },
  {
    title: 'board.help.group.view',
    rows: [
      { combos: [[MOD_KEY, '+'], [MOD_KEY, '−']], label: 'board.help.zoom' },
      { combos: [[MOD_KEY, '0']], label: 'board.help.fit' },
      { combos: [[ALT_KEY, 'T']], label: 'board.help.theme' },
      { combos: [[ALT_KEY, 'H']], label: 'board.help.hints' },
      { combos: [[MOD_KEY, 'Z'], [MOD_KEY, 'Shift', 'Z']], label: 'board.help.undo' },
      { combos: [[MOD_KEY, 'Shift', '⌫']], label: 'board.help.clear' },
      { combos: [[MOD_KEY, '/'], ['F1']], label: 'board.help.help' },
    ],
  },
];

/** 渲染一组可互换的组合键，如「Ctrl + / ／ F1」 */
function KeyCombos({ combos }: { combos: string[][] }) {
  return (
    <span className="wb-keys">
      {combos.map((combo, comboIndex) => (
        <React.Fragment key={comboIndex}>
          {comboIndex > 0 && <span className="wb-keys-or">/</span>}
          {combo.map((key) => <kbd key={key}>{key}</kbd>)}
        </React.Fragment>
      ))}
    </span>
  );
}

/**
 * 底部提示条；有临时通知（撤销、连线结果等）时优先显示通知。
 * @param mode 当前交互状态
 * @param notice 临时通知文本
 */
export function WhiteboardHints({ mode, notice }: { mode: HintMode; notice: string | null }) {
  const { t } = useI18n();
  return (
    <footer className="wb-hints" aria-live="polite">
      {notice ? (
        <span className="wb-hint-notice">{notice}</span>
      ) : (
        HINTS[mode].map((row) => (
          <span key={row.label} className="wb-hint">
            <KeyCombos combos={row.combos} />
            <span>{t(row.label)}</span>
          </span>
        ))
      )}
    </footer>
  );
}

/**
 * 完整快捷键面板。焦点始终留在白板的输入框上，所以 Esc / Ctrl+/ 由页面统一处理关闭。
 * @param onClose 点击遮罩关闭
 */
export function WhiteboardHelp({ onClose }: { onClose: () => void }) {
  const { t } = useI18n();
  return (
    <div className="wb-help-backdrop" onMouseDown={(e) => { e.preventDefault(); onClose(); }}>
      <section className="wb-help" role="dialog" aria-modal="true" aria-label={t('board.help.title')} onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); }} onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          e.stopPropagation();
          onClose();
        }
      }}>
        <header>
          <button className="wb-help-close" type="button" aria-label={t('common.close')} onMouseDown={(e) => e.preventDefault()} onClick={onClose}>×</button>
          <h2>{t('board.help.title')}</h2>
          <p>{t('board.help.subtitle')}</p>
        </header>
        <div className="wb-help-groups">
          {HELP_GROUPS.map((group) => (
            <div key={group.title} className="wb-help-group">
              <h3>{t(group.title)}</h3>
              {group.rows.map((row) => (
                <div key={row.label} className="wb-help-row">
                  <KeyCombos combos={row.combos} />
                  <span>{t(row.label)}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
