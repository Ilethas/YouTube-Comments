import { defineConfig } from 'vite';
import { noticeBundle } from './scripts/notice-bundle';

// https://vitejs.dev/config
export default defineConfig({ base: './', plugins: [noticeBundle('renderer')], worker: { plugins: () => [noticeBundle('worker')] } });
