import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'; // Import i18n config
import App from './App.tsx'

import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';
import { SplashScreen } from '@capacitor/splash-screen';

// Initialize Native Features
const initNativeBridge = async () => {
  if (Capacitor.isNativePlatform()) {
    try {
      // 1. Status Bar
      await StatusBar.setOverlaysWebView({ overlay: true });
      await StatusBar.setStyle({ style: Style.Dark });

      // 2. Hide Splash Screen (Wait a bit or hide immediately)
      await SplashScreen.hide();
      console.log('Splash screen hidden');
    } catch (e) {
      console.warn('Native bridge init failed', e);
    }
  }
};

initNativeBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
