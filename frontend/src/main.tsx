import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router';
import App from './App';
import { FatalErrorBoundaryRoot } from './components/FatalErrorBoundary';
import './i18n';
import './index.css';

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <HashRouter>
      <FatalErrorBoundaryRoot>
        <App />
      </FatalErrorBoundaryRoot>
    </HashRouter>
  </React.StrictMode>,
);
