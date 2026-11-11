import './vertex-ai-proxy-interceptor.js';
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error("Could not find root element to mount to");
}

try {
  const root = ReactDOM.createRoot(rootElement);
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
} catch (err: any) {
  console.error("Critical mounting error:", err);
  rootElement.innerHTML = `
    <div style="padding: 2rem; color: #f87171; font-family: sans-serif; text-align: center;">
      <h2>Anwendungsstart fehlgeschlagen</h2>
      <p style="color: #cbd5e1; font-size: 0.9rem;">${err?.message || 'Unbekannter Fehler'}</p>
    </div>
  `;
}
