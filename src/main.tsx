import React from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './lib/i18n';
import { WhiteboardPage } from './pages/WhiteboardPage';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode><I18nProvider><WhiteboardPage /></I18nProvider></React.StrictMode>,
);
