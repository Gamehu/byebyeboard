/**
 * 白板顶栏：左侧品牌，右侧一条悬浮的图标工具条。
 * 所有按钮在 mousedown 时阻止默认行为，键盘焦点始终留在白板的"笔"上。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../lib/i18n';

interface WhiteboardTopbarProps {
  theme: 'chalk' | 'white';
  connecting: boolean;
  canConnect: boolean;
  onToggleTheme: () => void;
  onConnect: () => void;
  onDownloadPng: () => void;
  onDownloadJson: () => void;
  onShowHelp: () => void;
}

/** 16px 线性图标，统一描边风格 */
function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

const SunIcon = () => <Icon><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></Icon>;
const MoonIcon = () => <Icon><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></Icon>;
const LinkIcon = () => <Icon><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7" /></Icon>;
const DownloadIcon = () => <Icon><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></Icon>;
const BookIcon = () => <Icon><path d="M2.5 4.5h6a3.5 3.5 0 0 1 3.5 3.5v12a2.5 2.5 0 0 0-2.5-2.5h-7z" /><path d="M21.5 4.5h-6A3.5 3.5 0 0 0 12 8v12a2.5 2.5 0 0 1 2.5-2.5h7z" /></Icon>;
const KeyboardIcon = () => <Icon><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6.5 10h.01M10 10h.01M14 10h.01M17.5 10h.01M7.5 14h9" /></Icon>;

function BrandMark() {
  return (
    <svg viewBox="0 0 64 64" width="22" height="22" aria-hidden="true">
      <rect width="64" height="64" rx="14" fill="#244b34" />
      <path d="M17 15h17c9 0 14 5 14 12 0 5-3 8-7 10 6 2 9 6 9 11 0 8-6 13-16 13H17V15zm10 10v8h7c3 0 5-2 5-4s-2-4-5-4h-7zm0 17v9h8c4 0 6-2 6-5s-2-4-6-4h-8z" fill="#f4efd6" transform="translate(0 -5)" />
      <path d="M43 10h11v11M54 10 41 23" fill="none" stroke="#c7dba8" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
    </svg>
  );
}

export function WhiteboardTopbar({
  theme, connecting, canConnect, onToggleTheme, onConnect, onDownloadPng, onDownloadJson, onShowHelp,
}: WhiteboardTopbarProps) {
  const { t, language, setLanguage } = useI18n();
  const [exportOpen, setExportOpen] = useState(false);
  const exportRef = useRef<HTMLDivElement>(null);

  // 点到导出菜单以外的任何地方都收起
  useEffect(() => {
    if (!exportOpen) return undefined;
    const close = (e: PointerEvent) => {
      if (!exportRef.current?.contains(e.target as Node)) setExportOpen(false);
    };
    window.addEventListener('pointerdown', close, true);
    return () => window.removeEventListener('pointerdown', close, true);
  }, [exportOpen]);

  const themeLabel = t(theme === 'chalk' ? 'board.notice.theme.white' : 'board.notice.theme.chalk');

  return (
    <header className="wb-topbar" onMouseDown={(e) => e.preventDefault()}>
      <a className="wb-brand" href={language === 'zh' ? '/zh/' : '/'} aria-label={t('app.title')}>
        <BrandMark />
        <span className="wb-brand-name">{t('app.title')}</span>
      </a>
      <span className="wb-topbar-spacer" />
      <nav className="wb-toolbar" aria-label={t('app.title')}>
        <button type="button" className="wb-tool" data-tip={themeLabel} aria-label={themeLabel} onClick={onToggleTheme}>
          {theme === 'chalk' ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className="wb-tool"
          data-tip={t('board.connect')}
          aria-label={t('board.connect')}
          aria-pressed={connecting}
          disabled={!canConnect}
          onClick={onConnect}
        >
          <LinkIcon />
        </button>
        <div className="wb-menu" ref={exportRef}>
          <button
            type="button"
            className="wb-tool"
            data-tip={exportOpen ? undefined : t('board.export')}
            aria-label={t('board.export')}
            aria-haspopup="menu"
            aria-expanded={exportOpen}
            onClick={() => setExportOpen((open) => !open)}
          >
            <DownloadIcon />
          </button>
          {exportOpen && (
            <div className="wb-menu-list" role="menu">
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); onDownloadPng(); }}>
                {t('board.downloadPng')}<span>.png</span>
              </button>
              <button type="button" role="menuitem" onClick={() => { setExportOpen(false); onDownloadJson(); }}>
                {t('board.downloadJson')}<span>.json</span>
              </button>
            </div>
          )}
        </div>
        <span className="wb-toolbar-divider" aria-hidden="true" />
        <a
          className="wb-tool"
          data-tip={t('board.guide')}
          aria-label={t('board.guide')}
          href={language === 'zh' ? '/zh/guide.html' : '/guide.html'}
        >
          <BookIcon />
        </a>
        <button type="button" className="wb-tool" data-tip={t('board.help')} aria-label={t('board.help')} onClick={onShowHelp}>
          <KeyboardIcon />
        </button>
        <button
          type="button"
          className="wb-tool wb-tool-text"
          data-tip={language === 'en' ? '切换到中文' : 'Switch to English'}
          aria-label={language === 'en' ? '切换到中文' : 'Switch to English'}
          onClick={() => setLanguage(language === 'en' ? 'zh' : 'en')}
        >
          {language === 'en' ? '中' : 'EN'}
        </button>
      </nav>
    </header>
  );
}
