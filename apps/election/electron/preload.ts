import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('lecpunchDesktop', {
  platform: process.platform,
  isDesktop: true
});
