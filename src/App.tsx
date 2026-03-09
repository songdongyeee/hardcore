import { useState, useEffect, useRef } from 'react';
import { cn } from "@/lib/utils";
import { useAudio } from "@/hooks/useAudio";
import { transcript as defaultTranscript } from "@/data/transcript";
import type { TranscriptSegment } from "@/data/transcript";
import { Header } from "@/components/Header";
import { HomeView } from "@/components/views/HomeView";
import { ListeningView } from "@/components/views/ListeningView";
import { AnalysisView } from "@/components/views/AnalysisView";
import { ShadowingView } from "@/components/views/ShadowingView";
import { ProfileView } from "@/components/views/ProfileView";

import { pb, getLatestTranscript, getCachedTranscript, saveTranscriptToCache, silentLogin, updateUserProgress, getTranscriptById } from "@/lib/api";
import { useRevenueCat } from "@/hooks/useRevenueCat";
import { analytics } from "@/lib/analytics";

import { App as CapacitorApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { PushNotifications } from '@capacitor/push-notifications';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { RELEASE_NOTES } from '@/data/releaseNotes';
import { WhatsNewModal } from '@/components/ui/WhatsNewModal';


type ViewState = 'home' | 'listening' | 'analysis' | 'shadowing' | 'profile';

// 🔖 被标记生词的数据结构
export interface MarkedWord {
  /** 全局唯一 ID：段落索引_单词索引 */
  id: string;
  /** 单词原文 */
  text: string;
  /** 段落索引 */
  segmentIndex: number;
  /** 单词在段落中的索引 */
  wordIndex: number;
  /** 只增不减的展示序号（从 1 开始） */
  order: number;
}

function App() {
  const [activeView, setActiveView] = useState<ViewState>('home');
  console.log(`📡 [App Render] Current View: ${activeView}`);
  const [currentSrc, setCurrentSrc] = useState<string>('');
  const [currentCoverUrl, setCurrentCoverUrl] = useState<string | undefined>(undefined);
  const [currentTranscript, setCurrentTranscript] = useState<TranscriptSegment[]>(defaultTranscript);
  const [currentMaterialId, setCurrentMaterialId] = useState<string>(''); // NEW STATE
  const [currentMaterialTitle, setCurrentMaterialTitle] = useState<string>(''); // NEW STATE for Analytics
  const [currentWaveformData, setCurrentWaveformData] = useState<number[][] | undefined>(undefined);

  // 🔖 全局生词标记状态（序号只增不减发号器）
  const [markedWords, setMarkedWords] = useState<MarkedWord[]>([]);
  const currentMaxOrderRef = useRef<number>(0);

  // 🚀 获取到的推送令牌
  const [fcmToken, setFcmToken] = useState<string>('');
  const [apnsToken, setApnsToken] = useState<string>('');

  // 🆙 版本更新弹窗状态
  const [showUpdateModal, setShowUpdateModal] = useState(false);

  const handleMarkWord = (word: { id: string; text: string; segmentIndex: number; wordIndex: number }) => {
    // 已经存在则不重复标记
    setMarkedWords(prev => {
      if (prev.some(w => w.id === word.id)) return prev;
      currentMaxOrderRef.current += 1;
      return [...prev, { ...word, order: currentMaxOrderRef.current }];
    });
  };

  const handleUnmarkWord = (wordId: string) => {
    // 取消标记：序号不重排，只从列表中移除
    setMarkedWords(prev => prev.filter(w => w.id !== wordId));
  };

  // Ref to prevent double-click/event bubbling
  const lastPlayTime = useRef<number>(0);
  // Ref to prevent async init from overwriting user actions (CRITICAL FIX)
  const isUserActiveRef = useRef(false);

  // 🔖 标记持久化：防抖控制 (Debounce)
  const isInitialMarkLoadRef = useRef(true); // 避免刚加载时就触发保存
  useEffect(() => {
    // 首次加载/恢复数据时不触发保存
    if (isInitialMarkLoadRef.current) {
      isInitialMarkLoadRef.current = false;
      return;
    }

    if (!currentMaterialId || !pb.authStore.isValid) return;

    const timer = setTimeout(() => {
      console.log('💾 [Debounce Save] Saving marked words to PocketBase...', markedWords.length);
      updateUserProgress(currentMaterialId, { marked_words: markedWords });
    }, 1000); // 1秒防抖

    return () => clearTimeout(timer);
  }, [markedWords, currentMaterialId]);

  // 🛡️ Strict Auth Gate: Block HomeView execution until auth check is done (success or fail)
  const [isAuthCheckComplete, setIsAuthCheckComplete] = useState(false);
  const [authReadyVersion, setAuthReadyVersion] = useState(0);
  const hasLoggedRef = useRef(false); // 🔥 Prevent double login

  // 📊 Learning Progress Time Tracking
  const sessionStartTimeRef = useRef<number>(0);  // Material session start time
  const phaseStartTimeRef = useRef<number>(0);    // Current phase start time
  const currentPhaseRef = useRef<string>('');      // Current phase name
  const visitedPhasesRef = useRef<Set<string>>(new Set());  // Visited phases
  const furthestPhaseRef = useRef<string>('');     // Furthest phase reached

  const { isPlaying, currentTime, togglePlay, seek, audioRef, pause, play } = useAudio(currentSrc, activeView === 'listening');
  const { appUserID } = useRevenueCat();

  // 📊 Helper: Calculate duration in seconds
  const calculateDuration = (startTime: number): number => {
    if (startTime === 0) return 0;
    return Math.floor((Date.now() - startTime) / 1000);
  };

  // 📊 Helper: End current phase
  const endCurrentPhase = (completed: boolean = false) => {
    if (phaseStartTimeRef.current > 0 && currentPhaseRef.current && currentMaterialId) {
      const duration = calculateDuration(phaseStartTimeRef.current);

      analytics.track('phase_completed', {
        material_id: currentMaterialId,
        material_title: currentMaterialTitle,
        phase: currentPhaseRef.current,
        duration_seconds: duration,
        completed: completed,
        timestamp: new Date().toISOString()
      });

      phaseStartTimeRef.current = 0;
    }
  };

  // 📊 Helper: End material session
  const endMaterialSession = (completedShadowing: boolean = false) => {
    if (sessionStartTimeRef.current > 0 && currentMaterialId) {
      endCurrentPhase(false); // First end current phase

      const totalDuration = calculateDuration(sessionStartTimeRef.current);

      analytics.track('material_session_end', {
        material_id: currentMaterialId,
        material_title: currentMaterialTitle,
        total_duration_seconds: totalDuration,
        phases_visited: Array.from(visitedPhasesRef.current),
        furthest_phase: furthestPhaseRef.current,
        completed_shadowing: completedShadowing,
        timestamp: new Date().toISOString()
      });

      // Reset
      sessionStartTimeRef.current = 0;
      visitedPhasesRef.current.clear();
      furthestPhaseRef.current = '';
    }
  };

  // 🚀 Push Notifications & Version Check Logic
  useEffect(() => {
    const initNotificationsAndUpdates = async () => {
      // 1. 版本检测：检查是否需要弹出“新功能介绍” 
      // 这里的逻辑只跟 RELEASE_NOTES.version 挂钩，用于控制 UI
      const { value: lastSeenVersion } = await Preferences.get({ key: 'last_seen_release_version' });
      if (lastSeenVersion !== RELEASE_NOTES.version) {
        setShowUpdateModal(true);
      }

      // 2. 推送注册：申请权限并注册设备 (接入 Firebase Cloud Messaging)
      try {
        let permStatus = await FirebaseMessaging.checkPermissions();
        if (permStatus.receive === 'prompt') {
          permStatus = await FirebaseMessaging.requestPermissions();
        }

        if (permStatus.receive === 'granted') {
          await PushNotifications.register();

          console.log('⏳ Requesting FCM Token from Google with 5s timeout...');
          // ⚠️ FCM_TIMEOUT_FIX: 在未翻墙的网络下，getToken() 会阻塞极长的时间甚至不返回，导致 App 的 Token 同步状态永远落后。
          // 强制加入 5 秒超时竞速机制。
          const tokenPromise = FirebaseMessaging.getToken();
          // 🔥 进一步优化：即使 race 失败了（超时了），如果之后 getToken 成功了（比如用户开了 VPN），
          // 我们依然捕获它并触发同步。
          tokenPromise.then(({ token }) => {
            console.log('🔥 FCM Token actually arrived (possibly late):', token);
            setFcmToken(token);
          }).catch(() => { });

          const timeoutPromise = new Promise<{ token: string }>((_, reject) =>
            setTimeout(() => reject(new Error('FCM getToken timeout (5s) - likely no VPN')), 5000)
          );

          const { token } = await Promise.race([tokenPromise, timeoutPromise]);
          console.log('🔥 FCM Push Token (Succeeded within 5s):', token);
          setFcmToken(token);
        }
      } catch (err: any) {
        if (err.message?.includes('timeout') || err.errorMessage?.includes('超时') || (err.code && err.code === -1001)) {
          console.warn('⚠️ FCM Timeout Blocked. Resorting to APNs (if iOS) or empty token. Please use VPN for FCM in China.');
        } else {
          console.error('❌ FCM Init Error:', err);
        }
      }
    };

    initNotificationsAndUpdates();

    // 监听原生推送注册 (APNs Token - 国内网络秒拿)
    const unsubReg = PushNotifications.addListener('registration', (token) => {
      console.log('🍎 Native APNs Token (Value):', token.value);
      setApnsToken(token.value);
      // 🔥 关键修复：拿到 Token 后立即增加版本号，触发下面的 syncProfile useEffect 同步到后端
      setAuthReadyVersion(v => v + 1);
    });

    // 监听注册失败
    const unsubRegErr = PushNotifications.addListener('registrationError', (error) => {
      console.error('❌ Push registration error:', error);
    });

    // 监听来自 Firebase 的通知消息
    const unsubRec = FirebaseMessaging.addListener('notificationReceived', (event) => {
      console.log('🔔 Firebase Notification received: ', event);
    });

    // 监听通知点击
    const unsubAct = FirebaseMessaging.addListener('notificationActionPerformed', (event) => {
      console.log('👉 Firebase Notification action performed: ', event);
    });

    return () => {
      unsubReg.then(h => h.remove());
      unsubRegErr.then(h => h.remove());
      unsubRec.then(h => h.remove());
      unsubAct.then(h => h.remove());
    };
  }, []);

  // 🆙 Sync User Profile for Push Targeting
  useEffect(() => {
    // 🔍 核心修复：即使 isAuthCheckComplete 为 false (比如RC报错了)，只要模型里有 ID 就尝试同步
    const canSync = (isAuthCheckComplete || pb.authStore.isValid) && pb.authStore.model;

    if (canSync) {
      console.log('🔄 [Profile Sync Triggered]', {
        fcmToken: !!fcmToken,
        userId: pb.authStore.model?.id,
        authValid: pb.authStore.isValid
      });

      const syncProfile = async () => {
        try {
          const userId = pb.authStore.model!.id;
          const currentModel = pb.authStore.model;
          const updateData: any = {};

          // 📡 获取真实版本 (由 Info.plist / build.gradle 决定)
          let realVersion = "0.0.0";
          try {
            const info = await CapacitorApp.getInfo();
            realVersion = info.version;
          } catch (e) {
            console.error('❌ [Profile Sync] Failed to get native app version:', e);
          }

          // 仅在拿到有效的真实版本号时才更新，避免 N/A 或 0.0.0 覆盖
          if (realVersion !== "0.0.0" && currentModel?.last_active_version !== realVersion) {
            updateData.last_active_version = realVersion;
          }

          // 2. 核心修复：检查 Token 是否真正需要写入
          // 优先使用 FCM，如果国内网络超时，则退而求其次使用 APNs 原生令牌入库
          const bestToken = fcmToken || apnsToken;

          if (bestToken && currentModel?.fcm_token !== bestToken) {
            console.log('📡 [Profile Sync] New Token detected:', bestToken);
            updateData.fcm_token = bestToken;
          }

          if (Object.keys(updateData).length > 0) {
            console.log('📡 [Profile Sync] Payload to PB:', updateData);
            try {
              const updatedRec = await pb.collection('users').update(userId, updateData);
              console.log('✅ [Profile Sync] Successfully wrote to PocketBase');
              pb.authStore.save(pb.authStore.token, updatedRec);
            } catch (syncErr: any) {
              console.error('❌ [Profile Sync] Original DB Update Error:', syncErr.message, syncErr.data);
              // 🛡️ 容错处理：如果 PocketBase 的 fcm_token 字段是普通文本，默认最大长度是 255
              // 而 Android/FCM 的 token 往往会超过 200+ 甚至跑到 255+ 字符，导致整个 update 请求被 400 拒绝
              // 从而连带导致 last_active_version 也存入失败！
              if (updateData.fcm_token && syncErr.status === 400) {
                console.warn('⚠️ [Profile Sync] Token validation failed (likely exceeded DB max length). Retrying without token...');
                delete updateData.fcm_token;
                if (Object.keys(updateData).length > 0) {
                  const rescueRec = await pb.collection('users').update(userId, updateData);
                  pb.authStore.save(pb.authStore.token, rescueRec);
                  console.log('✅ [Profile Sync] Rescue save successful (without token).');
                }
              }
            }
          } else {
            console.log('⏭️ [Profile Sync] No changes needed.', {
              localVersion: realVersion,
              dbVersion: currentModel?.last_active_version,
              localToken: bestToken?.slice(0, 10) + '...',
              dbToken: currentModel?.fcm_token?.slice(0, 10) + '...'
            });
          }

          // Topics
          try {
            const safeVersionStr = realVersion.replace(/\./g, '_');
            await FirebaseMessaging.subscribeToTopic({ topic: `version_${safeVersionStr}` });
            const tier = currentModel?.subscription_tier || 'free';
            await FirebaseMessaging.subscribeToTopic({ topic: `tier_${tier}` });
          } catch (tErr) { }
        } catch (e) {
          console.error('❌ [Profile Sync] Error:', e);
        }
      };

      syncProfile();
    }
  }, [authReadyVersion, fcmToken, apnsToken, isAuthCheckComplete]);

  const handleUpdateModalClose = async () => {
    setShowUpdateModal(false);
    // 标记该“功能公告版本”已读，与 App 真实版本解耦
    await Preferences.set({
      key: 'last_seen_release_version',
      value: RELEASE_NOTES.version
    });
  };

  // 📊 Helper: End current phase

  // 1. 🔥 PARALLEL DATA LOADING (Independent of Auth)
  useEffect(() => {
    async function loadData() {
      if (isUserActiveRef.current) return;
      try {
        console.log('🚀 Parallel Load: Starting Data Fetch...');

        // Load Cache Immediately for Speed
        const cached = await getCachedTranscript();
        if (cached && !isUserActiveRef.current) {
          console.log('⚡ Cache Hit: Loaded transcript');
          setCurrentSrc(cached.url);
          setCurrentTranscript(cached.segments);
        }

        // Fetch Server Data in Background
        const data = await getLatestTranscript();
        if (data && data.segments.length > 0 && !isUserActiveRef.current) {
          console.log('🌐 Server Data Arrived');
          setCurrentSrc(prev => (prev ? prev : data.url));
          setCurrentTranscript(data.segments);
          saveTranscriptToCache(data);
        }
      } catch (err) {
        console.warn('Data load warning:', err);
      }
    }
    loadData();
  }, []);

  // 2. 🔐 SMART AUTH STRATEGY (Cache RC ID -> wait for live RC ID)
  useEffect(() => {
    let timeoutId: number | null = null;

    const markLoginSuccess = () => {
      hasLoggedRef.current = true;
      setIsAuthCheckComplete(true);
      setAuthReadyVersion(v => v + 1);
    };

    async function initAuth() {
      if (hasLoggedRef.current) return;

      try {
        // A. ⚡ Try Cache First (0ms latency for existing users)
        const { value: cachedId } = await Preferences.get({ key: 'last_rc_id' });
        if (cachedId) {
          console.log('💾 Auth Cache Hit:', cachedId);

          analytics.init();
          analytics.identify(cachedId);
          analytics.track('app_opened', { platform: 'capacitor', method: 'cache' });

          const ok = await silentLogin(cachedId);
          if (ok) {
            markLoginSuccess();
            return;
          }

          console.warn('⚠️ Cached RC login failed. Waiting for RevenueCat live ID...');
        }

        // B. ⏳ If no cached login, wait for live RC ID.
        console.log('⏳ No auth cache. Waiting for RevenueCat...');

        // After timeout, release UI gate (keep bundled/cache visible), but do not switch account source.
        timeoutId = window.setTimeout(() => {
          if (!hasLoggedRef.current && !pb.authStore.isValid) {
            console.warn('⏰ RC login not ready after 2.5s. Running in degraded mode until RC ID arrives.');
            setIsAuthCheckComplete(true);
          }
        }, 2500);

      } catch (e) {
        console.error('Auth Init Error', e);
        setIsAuthCheckComplete(true);
      }
    }

    initAuth();

    return () => {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    };
  }, []); // Run once on mount

  // 3. 📡 REVENUECAT LISTENER (The "Winner" of the race)
  useEffect(() => {
    if (!appUserID || hasLoggedRef.current) return;

    console.log('💎 RevenueCat ID Ready:', appUserID);

    analytics.init();
    analytics.identify(appUserID);
    analytics.track('app_opened', { platform: 'capacitor', method: 'revenuecat' });

    silentLogin(appUserID).then((ok) => {
      if (ok) {
        hasLoggedRef.current = true;
        setIsAuthCheckComplete(true);
        setAuthReadyVersion(v => v + 1);
      } else {
        console.warn('⚠️ RC login failed. Keeping degraded mode and waiting for retry triggers.');
        setIsAuthCheckComplete(true);
      }
    }).catch((e) => {
      console.warn('⚠️ RC login error:', e);
      setIsAuthCheckComplete(true);
    });
  }, [appUserID]); // Trigger when RC provides ID

  // 4. 🔄 SAFETY RE-FETCH (Ensure Content Loads)
  // If parallel fetch failed (e.g. fresh install + protected DB), retry after auth.
  useEffect(() => {
    if (isAuthCheckComplete && currentTranscript.length <= 1) {
      console.log('🔄 Auth Complete & No Data: Retrying fetch...');
      getLatestTranscript().then(data => {
        if (data && data.segments.length > 0) {
          console.log('✅ Safety Fetch Success');
          setCurrentSrc(prev => (prev ? prev : data.url));
          setCurrentTranscript(data.segments);
          saveTranscriptToCache(data);
        }
      });
    }
  }, [isAuthCheckComplete]);

  // Debug: Track transcript changes
  useEffect(() => {
    console.log('📝 currentTranscript changed:', currentTranscript.length, 'segments');
  }, [currentTranscript]);

  // Deep Link Listener (Custom Scheme + Universal Links)
  useEffect(() => {
    const listener = CapacitorApp.addListener('appUrlOpen', async (data) => {
      console.log('🔗 Deep link received:', data.url);

      const url = new URL(data.url);

      // Handle /listening with ID
      if (url.pathname.includes('/listening')) {
        const materialId = url.searchParams.get('id');
        if (materialId) {
          const transcript = await getTranscriptById(materialId);
          if (transcript) {
            handlePlay(transcript.url, 'listening', transcript.segments, transcript.id);
          }
        }
      }
      // Handle /profile
      else if (url.pathname.includes('/profile')) {
        setActiveView('profile');
      }
      // Handle /home
      else if (url.pathname.includes('/home')) {
        console.log('🔗 [DeepLink] Navigating to home');
        setActiveView('home');
      }
    });

    return () => {
      listener.then(l => l.remove());
    };
  }, []); // Empty deps - listener uses latest handlePlay via closure


  const handlePlay = async (
    audioUrl: string,
    targetView?: ViewState,
    newTranscript?: TranscriptSegment[],
    materialId?: string,
    waveformData?: number[][],
    title?: string,
    coverUrl?: string, // 🔥 新增：封面URL
    dataPromise?: Promise<any>  // 🔥 新增：预加载的Promise
  ) => {
    const now = Date.now();
    // Debounce: Ignore if called within 500ms (prevent double clicks causing audio restart)
    if (now - lastPlayTime.current < 500 && audioUrl === currentSrc) {
      console.log('🚫 [handlePlay] Debounced call');
      // Still ensure view is correct just in case
      if (targetView && activeView !== targetView) {
        console.log(`🔄 [handlePlay] Fixing view to: ${targetView}`);
        setActiveView(targetView);
      }
      return;
    }
    lastPlayTime.current = now;
    isUserActiveRef.current = true; // Mark user as active, stopping any pending init overwrites

    console.log('🎬 handlePlay called:', { audioUrl, targetView, transcriptItems: newTranscript?.length || 0, currentTranscriptItems: currentTranscript.length, materialId });

    // Set Material ID and Trigger Progress
    if (materialId) {
      setCurrentMaterialId(materialId);
      setCurrentMaterialTitle(title || 'Unknown');
      setCurrentWaveformData(waveformData);
      if (coverUrl) setCurrentCoverUrl(coverUrl);

      // 🔖 切换材料时重置标记词
      setMarkedWords([]);
      currentMaxOrderRef.current = 0;

      // 📊 Start new learning session
      sessionStartTimeRef.current = Date.now();
      phaseStartTimeRef.current = Date.now();
      currentPhaseRef.current = 'listening';
      visitedPhasesRef.current.clear();
      visitedPhasesRef.current.add('listening');
      furthestPhaseRef.current = 'listening';

      // 📊 Track phase started
      analytics.track('phase_started', {
        material_id: materialId,
        material_title: title || 'Unknown',
        phase: 'listening',
        timestamp: new Date().toISOString()
      });

      // Analytics: View Material
      analytics.track('view_material', {
        material_id: materialId,
        material_title: title || 'Unknown',
        category: 'core_library'
      });

      // 🔥 Trigger Phase 1 Progress & Restore Marked Words
      isInitialMarkLoadRef.current = true; // 告知 Effect 这是初始化，别急着保存
      setMarkedWords([]);
      currentMaxOrderRef.current = 0;

      if (pb.authStore.isValid) {
        const userId = pb.authStore.model?.id;
        const rawId = materialId.startsWith('user-') ? materialId.replace('user-', '') : materialId;

        // 悄悄拉取进度恢复 marked_words
        // updateUserProgress 本身并不返回内容，所以我们需要自己拉一下
        pb.collection('user_progress').getFirstListItem(`user="${userId}" && material_id="${rawId}"`)
          .then(progress => {
            if (progress.marked_words && Array.isArray(progress.marked_words)) {
              const restoredWords = progress.marked_words as MarkedWord[];
              setMarkedWords(restoredWords);

              // 恢复最大计数器
              let maxOrder = 0;
              restoredWords.forEach(w => {
                if (w.order > maxOrder) maxOrder = w.order;
              });
              currentMaxOrderRef.current = maxOrder;
              console.log(`✅ [App] Restored ${restoredWords.length} marked words from DB.`);
            }
          })
          .catch(() => { /* NotFound, normally ignored */ })
          .finally(() => {
            // 不管有没有找到，都在后台顺手 update current_step (兼顾初次创建逻辑)
            if (!targetView || targetView === 'listening') {
              updateUserProgress(materialId, { current_step: 1 });
            }
          });
      } else {
        // 未登录：只改当前步数（里面会跳过）
        if (!targetView || targetView === 'listening') {
          updateUserProgress(materialId, { current_step: 1 });
        }
      }
    }

    // Only update src if it's actually different (prevent audio reload)
    if (audioUrl !== currentSrc) {
      setCurrentSrc(audioUrl);
    }

    // 🚀 NEW: 预加载模式 - 立即切换页面并播放，后台异步加载数据
    if (dataPromise) {
      console.log('🎬 [handlePlay] Preload mode: switching view immediately');

      // 1. 立即切换页面
      setActiveView(targetView || 'listening');

      // 2. 立即开始播放 (不再等待数据)
      if (!targetView || targetView === 'listening') {
        console.log('🎬 [handlePlay] Preload: Calling play() immediately');
        play();
      }

      // 3. 后台静默等待数据更新
      (async () => {
        try {
          const data = await dataPromise;
          if (data && data.segments && data.segments.length > 0) {
            console.log('✅ [handlePlay] Preloaded data arrived:', data.segments.length, 'segments');
            setCurrentTranscript(data.segments);
            if (data.waveform_data) {
              setCurrentWaveformData(data.waveform_data);
            }
          }
        } catch (error) {
          console.error('❌ [handlePlay] Preload data failed:', error);
        }
      })();

      return;
    }

    // 🔥 FIX: 如果 transcript 为空但有 materialId，主动加载
    if ((!newTranscript || newTranscript.length === 0) && materialId) {
      console.warn('⚠️ Transcript missing or empty for material:', materialId, '- fetching from server...');
      try {
        const fullData = await getTranscriptById(materialId);
        if (fullData && fullData.segments && fullData.segments.length > 0) {
          console.log('✅ Loaded transcript from server:', fullData.segments.length, 'segments');
          setCurrentTranscript(fullData.segments);
          setTimeout(() => setActiveView(targetView || 'listening'), 0);

          // Auto-play if listening view
          if (!targetView || targetView === 'listening') {
            play();
          }
          return;
        } else {
          console.warn('⚠️ Server returned empty transcript for material:', materialId);
        }
      } catch (error: any) {
        console.error('❌ Failed to load transcript:', error);

        // 🔥 FIX: 如果是404错误，说明材料不存在，阻止播放
        if (error.status === 404) {
          console.error('❌ Material not found on server:', materialId);
          // 恢复到之前的状态
          setCurrentSrc(currentSrc); // 保持原有音频
          // 提示用户并返回Home
          alert('该材料不存在或已被删除');
          setActiveView('home');
          return;
        }
        // 其他错误(网络异常等)继续执行原有逻辑，不阻塞播放
      }
    }

    if (newTranscript && newTranscript.length > 0) {
      console.log('✅ [handlePlay] Setting new transcript:', newTranscript.length, 'segments');
      setCurrentTranscript(newTranscript);
      // Delay view change to ensure transcript updates first
      setTimeout(() => {
        console.log(`🎬 [handlePlay] Navigating to: ${targetView || 'listening'}`);
        setActiveView(targetView || 'listening');
      }, 0);
    } else if (audioUrl !== currentSrc && audioUrl === '/演讲音频.m4a') {
      // Only reset to default if switching to bundled material AND source actually changed
      console.log('🔄 [handlePlay] Resetting to default transcript');
      setCurrentTranscript(defaultTranscript);
      setTimeout(() => setActiveView(targetView || 'listening'), 0);
    } else {
      // Defensive: If source is same, NEVER reset transcript to empty/default
      console.log(`⚠️ [handlePlay] Keeping current transcript, Navigating to: ${targetView || 'listening'}`);
      setActiveView(targetView || 'listening');
    }

    // Auto-play if same source and listening view
    if (audioUrl === currentSrc && (!targetView || targetView === 'listening')) {
      play();
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-zinc-950 font-sans text-zinc-200 p-0 md:p-6 lg:p-12 overflow-hidden selection:bg-indigo-500/30 selection:text-indigo-200">

      {/* App Container */}
      <div
        id="app-container"
        className={cn(
          "w-full max-w-md md:max-w-2xl lg:max-w-3xl bg-black md:bg-zinc-900/50 md:backdrop-blur-xl md:border md:border-zinc-800 md:rounded-3xl h-[100dvh] overflow-hidden relative shadow-2xl flex flex-col transition-all duration-500",
          activeView !== 'home' && "md:bg-black"
        )}
      >


        <Header
          onNavigateHome={() => {
            pause();
            setActiveView('home');
          }}
          className={activeView === 'home' ? "" : "hidden"}
        />

        {/* View Manager */}
        <div className="relative w-full h-full flex-1 flex flex-col">
          <HomeView
            onPlay={handlePlay}
            onProfile={() => setActiveView('profile')}
            isActive={activeView === 'home'}
            isAuthCheckComplete={isAuthCheckComplete}
            authReadyVersion={authReadyVersion}
          />

          {activeView === 'listening' && (
            <ListeningView
              onBack={() => {
                pause();
                // 📊 End phase and session
                endCurrentPhase(false);
                endMaterialSession(false);
                setActiveView('home');
              }}
              onNextPhase={() => {
                pause();
                // 📊 End Listening phase (completed)
                endCurrentPhase(true);

                // 📊 Start Analysis phase
                phaseStartTimeRef.current = Date.now();
                currentPhaseRef.current = 'analysis';
                visitedPhasesRef.current.add('analysis');
                furthestPhaseRef.current = 'analysis';

                analytics.track('phase_started', {
                  material_id: currentMaterialId,
                  material_title: currentMaterialTitle,
                  phase: 'analysis',
                  timestamp: new Date().toISOString()
                });

                // 🔥 Trigger Phase 2 Progress (Entered Analysis)
                if (currentMaterialId) {
                  updateUserProgress(currentMaterialId, { current_step: 2 });
                }
                setActiveView('analysis');
              }}
              audioRef={audioRef}
              currentTime={currentTime}
              isPlaying={isPlaying}
              togglePlay={togglePlay}
              seek={seek}
              transcript={currentTranscript}
              waveformData={currentWaveformData}
              coverUrl={currentCoverUrl}
              markedWords={markedWords}
              onMarkWord={handleMarkWord}
              onUnmarkWord={handleUnmarkWord}
            />
          )}

          {activeView === 'analysis' && (
            <AnalysisView
              onBack={() => {
                // 📊 End Analysis phase (not completed)
                endCurrentPhase(false);

                // 📊 Restart Listening phase
                phaseStartTimeRef.current = Date.now();
                currentPhaseRef.current = 'listening';

                analytics.track('phase_started', {
                  material_id: currentMaterialId,
                  material_title: currentMaterialTitle,
                  phase: 'listening',
                  timestamp: new Date().toISOString()
                });

                setActiveView('listening');
              }}
              onNextPhase={() => {
                pause();
                // 📊 End Analysis phase (completed)
                endCurrentPhase(true);

                // 📊 Start Shadowing phase
                phaseStartTimeRef.current = Date.now();
                currentPhaseRef.current = 'shadowing';
                visitedPhasesRef.current.add('shadowing');
                furthestPhaseRef.current = 'shadowing';

                analytics.track('phase_started', {
                  material_id: currentMaterialId,
                  material_title: currentMaterialTitle,
                  phase: 'shadowing',
                  timestamp: new Date().toISOString()
                });

                // 🔥 Trigger Phase 3 Progress (Entered Shadowing)
                if (currentMaterialId) {
                  updateUserProgress(currentMaterialId, { current_step: 3 });
                }
                setActiveView('shadowing');
              }}
              audioRef={audioRef}
              currentTime={currentTime}
              isPlaying={isPlaying}
              seek={seek}
              transcript={currentTranscript}
              markedWords={markedWords}
            />
          )}

          {activeView === 'shadowing' && (
            <ShadowingView
              onBack={() => {
                // 📊 End Shadowing phase and session (not completed)
                endCurrentPhase(false);
                endMaterialSession(false);
                setActiveView('analysis');
              }} // Back to Analysis (Top Left)
              audioSrc={currentSrc}
              transcript={currentTranscript}
              materialId={currentMaterialId} // NEW: Pass Material ID for Phase 3 Tracking
              waveformData={currentWaveformData}
              onRecordingComplete={() => {
                // 📊 End Shadowing phase and session (completed)
                endCurrentPhase(true);
                endMaterialSession(true);
              }}
            />
          )}

          {activeView === 'profile' && (
            <ProfileView
              onBack={() => setActiveView('home')}
            />
          )}

          {/* 🆙 新功能介绍弹窗 */}
          <WhatsNewModal
            isOpen={showUpdateModal}
            onClose={handleUpdateModalClose}
          />
        </div>


      </div>
    </div>
  );
}

export default App;
