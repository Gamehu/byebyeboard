import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';

export type Language = 'en' | 'zh';

const LANGUAGE_STORAGE_KEY = 'byebyeboard.language';

const translations: Record<Language, Record<string, string>> = {
  en: {
    'app.title': 'ByeByeBoard',
    'common.close': 'Close',
    'board.help': 'Shortcuts',
    'board.guide': 'Guide',
    'board.empty': 'Start typing to create a note. Select a note before connecting or styling it.',
    'board.editorLabel': 'Whiteboard input',
    'board.notice.undo': 'Undone',
    'board.notice.redo': 'Redone',
    'board.notice.nothingToUndo': 'Nothing to undo',
    'board.notice.nothingToRedo': 'Nothing to redo',
    'board.notice.cleared': 'Board cleared · {mod}+Z to undo',
    'board.notice.linked': 'Connected',
    'board.notice.unlinked': 'Connection removed',
    'board.notice.needNote': 'Type to create a note, or click an existing note to select it first.',
    'board.connectMode': 'Connect mode: click another note, or use arrows then Enter. Esc cancels.',
    'board.editMode': 'Editing — press Esc to finish, or Enter for the next note.',
    'board.notice.editFinished': 'Editing finished. Typing will start editing again.',
    'board.notice.theme.chalk': 'Dark',
    'board.notice.theme.white': 'Light',
    'board.notice.nothingToExport': 'Write something first',
    'board.notice.downloaded': 'Downloaded',
    'board.notice.downloadFailed': "Couldn't export the board",
    'board.downloadPng': 'Download PNG',
    'board.downloadJson': 'Download JSON',
    'board.connect': 'Connect',
    'board.hint.type': 'type to write',
    'board.hint.move': 'move',
    'board.hint.allKeys': 'all shortcuts',
    'board.hint.edit': 'type to edit',
    'board.hint.sibling': 'next item',
    'board.hint.child': 'child',
    'board.hint.grow': 'grow',
    'board.hint.nudge': 'nudge',
    'board.hint.bold': 'bold',
    'board.hint.connect': 'connect',
    'board.hint.delete': 'delete',
    'board.hint.next': 'next line',
    'board.hint.outdent': 'up a level',
    'board.hint.newline': 'new line',
    'board.hint.done': 'done',
    'board.hint.pickTarget': 'pick target',
    'board.hint.toggleLink': 'connect / disconnect',
    'board.hint.cancel': 'cancel',
    'board.help.title': 'Keyboard shortcuts',
    'board.help.subtitle': 'Everything works from the keyboard. The mouse is optional.',
    'board.help.group.write': 'Write',
    'board.help.group.navigate': 'Move around',
    'board.help.group.structure': 'Structure',
    'board.help.group.style': 'Style',
    'board.help.group.view': 'View & board',
    'board.help.typeAnywhere': 'Start typing: create a note at the cursor, or append to the selected note',
    'board.help.editNote': 'Edit the selected note (or create one at the cursor)',
    'board.help.nextItem': 'Finish and write the next item at the same level',
    'board.help.childItem': 'Finish and branch out a child to the right (connected)',
    'board.help.outdent': 'Finish and continue one level up; on an empty line, Tab / Shift+Tab indent / outdent it',
    'board.help.newline': 'New line inside a note',
    'board.help.finish': 'Finish editing (an empty new note is discarded)',
    'board.help.arrows': 'Jump to the nearest note in that direction, or into the empty space beyond',
    'board.help.bigStep': 'Free cursor: move in big steps',
    'board.help.deselect': 'Deselect and go back to the free cursor',
    'board.help.grow': 'Grow a connected note in that direction',
    'board.help.nudge': 'Move the selected note',
    'board.help.connect': 'Select a note, then pick a target with arrows; Enter connects or disconnects',
    'board.help.delete': 'Delete the selected note',
    'board.help.bold': 'Bold / normal text',
    'board.help.color': 'Color',
    'board.help.frame': 'Cycle frame: none / box / filled',
    'board.help.size': 'Text size',
    'board.help.zoom': 'Zoom in / out',
    'board.help.fit': 'Fit everything in view',
    'board.help.theme': 'Dark chalkboard / light background',
    'board.help.hints': 'Show / hide the hint bar',
    'board.help.undo': 'Undo / redo',
    'board.help.clear': 'Clear the board (undoable)',
    'board.help.help': 'Open / close this panel',
  },
  zh: {
    'app.title': 'ByeByeBoard',
    'common.close': '关闭',
    'board.help': '快捷键',
    'board.guide': '使用指南',
    'board.empty': '直接打字创建便签；先选中便签，再使用连线或样式快捷键',
    'board.editorLabel': '白板输入',
    'board.notice.undo': '已撤销',
    'board.notice.redo': '已重做',
    'board.notice.nothingToUndo': '没有可撤销的操作',
    'board.notice.nothingToRedo': '没有可重做的操作',
    'board.notice.cleared': '已清空白板 · {mod}+Z 撤销',
    'board.notice.linked': '已连线',
    'board.notice.unlinked': '已断开连线',
    'board.notice.needNote': '请先输入文字创建便签，或点击已有便签选中它，再使用这个快捷键。',
    'board.connectMode': '已进入连线模式：点击另一条便签，或用方向键选择后按 Enter。Esc 取消。',
    'board.editMode': '正在编辑：按 Esc 完成，按 Enter 写下一条。',
    'board.notice.editFinished': '已结束编辑。再次打字会重新进入编辑。',
    'board.notice.theme.chalk': '深色',
    'board.notice.theme.white': '浅色',
    'board.notice.nothingToExport': '白板还是空的，先写点内容',
    'board.notice.downloaded': '已下载',
    'board.notice.downloadFailed': '导出失败，请重试',
    'board.downloadPng': '下载 PNG',
    'board.downloadJson': '下载 JSON',
    'board.connect': '连线',
    'board.hint.type': '打字书写',
    'board.hint.move': '移动',
    'board.hint.allKeys': '全部快捷键',
    'board.hint.edit': '打字续写',
    'board.hint.sibling': '同级',
    'board.hint.child': '子级',
    'board.hint.grow': '延伸',
    'board.hint.nudge': '挪动',
    'board.hint.bold': '加粗',
    'board.hint.connect': '连线',
    'board.hint.delete': '删除',
    'board.hint.next': '下一条',
    'board.hint.outdent': '上一级',
    'board.hint.newline': '换行',
    'board.hint.done': '完成',
    'board.hint.pickTarget': '选目标',
    'board.hint.toggleLink': '连线 / 断开',
    'board.hint.cancel': '取消',
    'board.help.title': '键盘快捷键',
    'board.help.subtitle': '所有操作都能用键盘完成，鼠标只是可选项。',
    'board.help.group.write': '书写',
    'board.help.group.navigate': '移动',
    'board.help.group.structure': '结构',
    'board.help.group.style': '样式',
    'board.help.group.view': '视图与白板',
    'board.help.typeAnywhere': '直接打字：在光标处新建，或续写选中的便签',
    'board.help.editNote': '编辑选中的便签（光标处则新建）',
    'board.help.nextItem': '写完，接着写同级下一条',
    'board.help.childItem': '写完，向右展开子级（自动连线）',
    'board.help.outdent': '写完，回到上一级继续写；空行上 Tab / Shift+Tab 为缩进 / 反缩进',
    'board.help.newline': '便签内换行',
    'board.help.finish': '结束编辑（空白的新便签会被丢弃）',
    'board.help.arrows': '跳到该方向最近的便签，没有就进入空白处',
    'board.help.bigStep': '自由光标：大步移动',
    'board.help.deselect': '取消选中，回到自由光标',
    'board.help.grow': '朝该方向延伸一条连线便签',
    'board.help.nudge': '挪动选中的便签',
    'board.help.connect': '先选中便签，再用方向键选目标；Enter 连线或断开',
    'board.help.delete': '删除选中的便签',
    'board.help.bold': '加粗 / 取消加粗',
    'board.help.color': '颜色',
    'board.help.frame': '切换外框：无 / 方框 / 底色',
    'board.help.size': '字号',
    'board.help.zoom': '放大 / 缩小',
    'board.help.fit': '全部收入视野',
    'board.help.theme': '深色黑板 / 浅色背景',
    'board.help.hints': '显示 / 隐藏底部提示',
    'board.help.undo': '撤销 / 重做',
    'board.help.clear': '清空白板（可撤销）',
    'board.help.help': '打开 / 关闭本面板',
  },
};

function interpolate(template: string, variables?: Record<string, string | number>): string {
  if (!variables) return template;
  return Object.entries(variables).reduce((acc, [key, value]) => {
    return acc.replaceAll(`{${key}}`, String(value));
  }, template);
}

export function getStoredLanguage(): Language {
  try {
    const saved = window.localStorage.getItem(LANGUAGE_STORAGE_KEY);
    return saved === 'zh' ? 'zh' : 'en';
  } catch {
    return 'en';
  }
}

const I18nContext = createContext<{
  language: Language;
  setLanguage: (lang: Language) => void;
  t: (key: string, variables?: Record<string, string | number>) => string;
} | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguage] = useState<Language>(() => getStoredLanguage());

  useEffect(() => {
    try {
      window.localStorage.setItem(LANGUAGE_STORAGE_KEY, language);
    } catch {
      // Ignore localStorage failures.
    }
  }, [language]);

  const value = useMemo(() => {
    return {
      language,
      setLanguage,
      t: (key: string, variables?: Record<string, string | number>) => {
        const message = translations[language][key] ?? translations.en[key] ?? key;
        return interpolate(message, variables);
      },
    };
  }, [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return context;
}
