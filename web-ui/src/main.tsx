import { createRoot } from 'react-dom/client';
import { QueryClientProvider } from '@tanstack/react-query';
import { I18nextProvider } from 'react-i18next';
import { App } from './App';
import { queryClient } from './lib/queryClient';
import i18n from './lib/i18n';
import { initTheme } from './lib/theme';

initTheme();

const root = document.getElementById('root')!;
createRoot(root).render(
  <I18nextProvider i18n={i18n}>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </I18nextProvider>,
);
