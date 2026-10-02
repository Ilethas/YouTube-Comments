import type { ReaderApi } from './reader-api';
declare global { interface Window { reader: ReaderApi } }
