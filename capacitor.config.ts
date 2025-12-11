import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.hardcore.english',
  appName: 'Hardcore English',
  webDir: 'dist',
  server: {
    // Local Dev Server (Live Reload)
    url: 'http://192.168.105.61:5173',
    cleartext: true
  }
};

export default config;
