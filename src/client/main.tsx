import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui';
// Be Vietnam Pro (display + body) is bundled (fonts.css, imported by globals.css) so Vietnamese diacritics render the same everywhere.
import './styles/globals.css';
import './styles/refresh.css';
import './styles/shell.css';
import './styles/public.css';
import './styles/pages.css';
import './styles/learn.css';
import './styles/exam.css';
import './styles/exam-tools.css';
import './styles/mentor.css';
import './styles/earnings.css';
import './styles/callroom.css';
import './styles/notifications.css';
import './styles/action-plan.css';
import './styles/tutor.css';
import './styles/speaking-partner.css';
import './styles/certificate.css';
import { applyPrefs, loadPrefs } from './lib/display';

// Apply the reader's display preferences before the first paint, so the page
// never flashes at the wrong text size or in the wrong theme.
applyPrefs(loadPrefs());

const container = document.getElementById('root');
if (!container) throw new Error('Root element is missing from index.html');

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <App />
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  </StrictMode>,
);
