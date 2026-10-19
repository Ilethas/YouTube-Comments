import { defineConfig } from 'vite';
import { noticeBundle } from './scripts/notice-bundle';

// https://vitejs.dev/config
export default defineConfig({ plugins: [noticeBundle('preload')] });
