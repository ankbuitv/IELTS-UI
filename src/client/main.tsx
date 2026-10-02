import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './context/AuthContext';
import { ToastProvider } from './components/ui';
// Typography is the system Arial/Helvetica stack, so no font files are shipped.
import './styles/globals.css';
import './styles/refresh.css';
import './styles/shell.css';
import './styles/public.css';
import './styles/pages.css';
import './styles/learn.css';
import './styles/exam.css';
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
