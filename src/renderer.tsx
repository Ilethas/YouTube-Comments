import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './renderer/App';
import './index.css';
import { applyAppearance } from './renderer/appearance';

applyAppearance({ appearance: 'system' }, window.matchMedia('(prefers-color-scheme: dark)').matches);

const root = document.getElementById('root');
if (!root) throw new Error('Missing renderer root');
createRoot(root).render(<StrictMode><App /></StrictMode>);
