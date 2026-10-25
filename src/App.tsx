/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Play,
  RotateCcw,
  Power,
  BookmarkPlus,
  Magnet,
  EyeOff,
  Eye,
  Maximize2,
  Minimize2,
  Sliders,
  Table2,
  LineChart,
  BookOpen,
  Camera,
  Settings,
  CheckCircle2,
  AlertTriangle,
  Download,
  Trash2,
  Volume2,
  VolumeX,
  HelpCircle,
  ChevronDown,
  ChevronUp,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  Gauge,
  Video,
  ArrowRight,
  Activity,
  PlugZap,
  Wind,
} from 'lucide-react';
import {
  DEFAULT_PHYSICS_CONFIG,
  PhysicsConfig,
  computeGravityFromMeasurement,
  formatTimerDisplay,
  isPhotogateBeamAligned,
} from './models/PhysicsModel';
import {
  C3TimerMode,
  ExperimentController,
  ExperimentSnapshot,
  INITIAL_EXPERIMENT_SNAPSHOT,
  PORT_STATE_LABELS,
  PortSignalState,
  TIMER_MODE_GUIDES,
  WiringVariant,
} from './models/ExperimentStateMachine';
import {
  DistanceRowData,
  INITIAL_DISTANCE_ROWS,
  computeTableSummary,
  deleteSingleTrial,
  exportTableToCSV,
  recordMeasurementToRows,
} from './models/MeasurementStore';
import {
  CameraPresetId,
  EQUIPMENT_CATALOG,
  EquipmentId,
  POST_LAB_QUESTIONS,
} from './models/EquipmentInfo';
import {
  Apparatus3D,
  GraphicsQualityPreset,
  RuntimeRenderMetrics,
  TouchInteractionMode,
} from './components/Apparatus3D';
import { RegressionGraphSvsT2 } from './components/RegressionGraphSvsT2';
import { AcceptanceTestResult, runAllAcceptanceTests } from './tests/acceptanceTests';
import { labSound } from './utils/soundEffects';

type ActiveDrawerTab =
  | 'NONE'
  | 'CONTROLS'
  | 'TABLE'
  | 'GRAPH'
  | 'THEORY'
  | 'SETTINGS_TESTS';

export interface TimerHistoryEntry {
  id: number;
  mode: C3TimerMode;
  sMeters: number;
  mainValueSeconds: number;
  tASeconds: number | null;
  tBSeconds: number | null;
  timestamp: string;
}

function getPortBadgeClasses(state: PortSignalState): string {
  switch (state) {
    case 'ACTIVE':
      return 'bg-amber-500 text-slate-950 border-amber-300 font-bold animate-pulse';
    case 'RECEIVED':
      return 'bg-emerald-600 text-white border-emerald-400 font-bold';
    case 'CONNECTED':
      return 'bg-sky-600/30 text-sky-200 border-sky-500/60 font-semibold';
    case 'STANDBY':
      return 'bg-slate-800/80 text-slate-400 border-slate-700';
    case 'DISCONNECTED':
    default:
      return 'bg-red-950/80 text-red-300 border-red-600/60';
  }
}

export default function App() {
  // Kiểm tra màn hình điện thoại / màn hình nhỏ để tự động ẩn các menu
  const checkIsMobileViewport = () =>
    typeof window !== 'undefined' ? window.innerWidth < 900 : false;

  // Bộ điều khiển trạng thái vật lí & đồng hồ MC964
  const controllerRef = useRef<ExperimentController>(
    new ExperimentController(INITIAL_EXPERIMENT_SNAPSHOT, DEFAULT_PHYSICS_CONFIG)
  );
  const [snapshot, setSnapshot] = useState<ExperimentSnapshot>(INITIAL_EXPERIMENT_SNAPSHOT);
  const [physicsConfig, setPhysicsConfig] = useState<PhysicsConfig>(DEFAULT_PHYSICS_CONFIG);

  // Tốc độ hiển thị chuyển động rơi: Mặc định 0.25x (Quay chậm 4 lần)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(0.25);
  // Camera tự động bám theo vật rơi (đặt trong menu trái theo yêu cầu)
  const [autoTrackFall, setAutoTrackFall] = useState<boolean>(true);
  // Tự động đưa trụ lên nam châm & reset đồng hồ khi bấm "Nhả trụ thép"
  const [autoPrepareOnDrop, setAutoPrepareOnDrop] = useState<boolean>(true);

  // Bảng số liệu 5 mức × 5 lần đo
  const [rows, setRows] = useState<DistanceRowData[]>(INITIAL_DISTANCE_ROWS);
  const [lastRecordedMessage, setLastRecordedMessage] = useState<string | null>(null);
  const [confirmClearTable, setConfirmClearTable] = useState(false);

  // Lịch sử đo trực tiếp của đồng hồ MC964 (hỗ trợ xóa từng phép đo)
  const [timerHistory, setTimerHistory] = useState<TimerHistoryEntry[]>([]);
  const historyCounterRef = useRef(1);

  // Đồ thị s theo t²
  const [showTrendline, setShowTrendline] = useState(true);
  const [forceOriginRegression, setForceOriginRegression] = useState(false);

  // Tùy chọn giao diện: Trên điện thoại tự động ẩn menu mặc định; các chú thích thêm đều tự ẩn, khi nào cần mới gọi ra!
  const [activeDrawer, setActiveDrawer] = useState<ActiveDrawerTab>('NONE');
  const [isLeftPanelOpen, setIsLeftPanelOpen] = useState<boolean>(() => !checkIsMobileViewport());
  const [isRightPanelOpen, setIsRightPanelOpen] = useState<boolean>(() => !checkIsMobileViewport());
  const [isUiHiddenZen, setIsUiHiddenZen] = useState(false);
  const [isExpandedViewport, setIsExpandedViewport] = useState(false);

  // Mặc định TỰ ẨN toàn bộ chữ chú thích trên màn hình 3D (chỉ hiện chữ A và B trên giá; bấm nút tròn Con Mắt góc trên phải để bật/tắt)
  const [showEquipmentLabels, setShowEquipmentLabels] = useState(false);
  // Giải thích chi tiết chế độ MODE, chi tiết dây cắm cổng A/B và lịch sử đo đều tự ẩn mặc định, khi cần mới gọi ra
  const [showModeGuide, setShowModeGuide] = useState(false);
  const [showPortConfigDetails, setShowPortConfigDetails] = useState(false);
  const [showHistoryList, setShowHistoryList] = useState(false);

  // Tự động ẩn menu khi xoay hoặc thu nhỏ màn hình sang kích thước điện thoại
  useEffect(() => {
    let wasMobile = checkIsMobileViewport();
    const handleResize = () => {
      const nowMobile = checkIsMobileViewport();
      if (nowMobile && !wasMobile) {
        setIsLeftPanelOpen(false);
        setIsRightPanelOpen(false);
      }
      wasMobile = nowMobile;
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('OVERVIEW');
  const [touchMode] = useState<TouchInteractionMode>('ORBIT_CAMERA');
  const [qualityPreset, setQualityPreset] = useState<GraphicsQualityPreset>('AUTO');
  const [showScientificVisuals, setShowScientificVisuals] = useState(true);
  const [selectedEquipment, setSelectedEquipment] = useState<EquipmentId | null>(null);
  const [soundEnabled, setSoundEnabled] = useState(true);
  // Âm thanh nền phòng thí nghiệm (tiếng quạt thông gió nhẹ + nhiễu biến áp/nam châm điện 50Hz-100Hz), bật/tắt độc lập với âm hiệu ứng
  const [ambienceEnabled, setAmbienceEnabled] = useState(false);
  const [ambienceVolume, setAmbienceVolume] = useState(0.5);
  const [openQuestionId, setOpenQuestionId] = useState<number | null>(null);

  const [distanceInputStr, setDistanceInputStr] = useState('0.500');

  const [renderMetrics, setRenderMetrics] = useState<RuntimeRenderMetrics>({
    fps: 60,
    canvasWidthCss: 1024,
    canvasHeightCss: 640,
    rendererPixelRatio: 1.5,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1,
    isSoftwareGl: false,
    activeQualityLabel: 'AUTO',
  });
  const [testResults, setTestResults] = useState<AcceptanceTestResult[] | null>(null);
  const [isCatchTrayImpactActive, setIsCatchTrayImpactActive] = useState(false);

  // Kích hoạt phản hồi xúc giác (Haptic Feedback) trên thiết bị hỗ trợ Web Vibration API
  const triggerHapticFeedback = useCallback((pattern: number | number[]) => {
    try {
      if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
        navigator.vibrate(pattern);
      }
    } catch {
      // Bỏ qua nếu trình duyệt chặn hoặc không hỗ trợ Vibration API
    }
  }, []);

  // Phát hiện thời điểm trụ thép va chạm với khay nhận (đệm cao su đáy giá đỡ) để tạo hiệu ứng rung nhẹ chân thực
  const prevHitCatchTrayRef = useRef(false);
  useEffect(() => {
    const hasHitCatchTrayNow =
      !snapshot.cylinderAttachedToMagnet &&
      !snapshot.isPeriodicSourceRunning &&
      snapshot.cylinderDropDistanceMeters >= physicsConfig.maxFallDistanceMeters - 1e-4;

    if (hasHitCatchTrayNow && !prevHitCatchTrayRef.current) {
      // Rung xúc giác 2 nhịp mô phỏng tiếng "cộp" của trụ thép chạm đệm khay nhận
      triggerHapticFeedback([18, 25, 42]);
      setIsCatchTrayImpactActive(true);
      const timer = window.setTimeout(() => {
        setIsCatchTrayImpactActive(false);
      }, 190);
      prevHitCatchTrayRef.current = true;
      return () => window.clearTimeout(timer);
    }

    if (!hasHitCatchTrayNow) {
      prevHitCatchTrayRef.current = false;
    }
  }, [
    snapshot.cylinderAttachedToMagnet,
    snapshot.isPeriodicSourceRunning,
    snapshot.cylinderDropDistanceMeters,
    physicsConfig.maxFallDistanceMeters,
    triggerHapticFeedback,
  ]);

  // Phát âm thanh và tự động lưu vào lịch sử đồng hồ MC964 khi hoàn tất phép đo
  const prevPhaseRef = useRef(snapshot.phase);
  useEffect(() => {
    if (prevPhaseRef.current !== snapshot.phase) {
      if (snapshot.phase === 'PHOTOGATE_TRIGGERED') {
        labSound.playTimerBeep(2500, 0.07);
        triggerHapticFeedback(10);
      } else if (snapshot.phase === 'MEASUREMENT_COMPLETE') {
        if (prevPhaseRef.current === 'FALLING_TIMER_RUNNING') {
          labSound.playTimerBeep(2500, 0.07);
        }
        labSound.playCatchTrayThud();

        if (snapshot.completedMeasurementSeconds !== null) {
          const entry: TimerHistoryEntry = {
            id: historyCounterRef.current++,
            mode: snapshot.c3Mode,
            sMeters: snapshot.photogateDistanceMeters,
            mainValueSeconds: snapshot.completedMeasurementSeconds,
            tASeconds: snapshot.measuredTimeASeconds,
            tBSeconds: snapshot.measuredTimeBSeconds,
            timestamp: new Date().toLocaleTimeString('vi-VN', {
              hour: '2-digit',
              minute: '2-digit',
              second: '2-digit',
            }),
          };
          setTimerHistory((prev) => [entry, ...prev.slice(0, 19)]);
        }
      } else if (snapshot.phase === 'ERROR') {
        labSound.playErrorTone();
      }
      prevPhaseRef.current = snapshot.phase;
    }
  }, [snapshot, triggerHapticFeedback]);

  useEffect(() => {
    setDistanceInputStr(snapshot.photogateDistanceMeters.toFixed(3));
  }, [snapshot.photogateDistanceMeters]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (e.key === 'h' || e.key === 'H') {
        setIsUiHiddenZen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const updatePhysicsConfig = useCallback((partial: Partial<PhysicsConfig>) => {
    const nextCfg = { ...controllerRef.current.getConfig(), ...partial };
    controllerRef.current.updateConfig(partial);
    setPhysicsConfig(nextCfg);
  }, []);

  const handleTogglePower = useCallback(() => {
    labSound.playSwitchClick(620);
    const next = controllerRef.current.togglePower();
    setSnapshot({ ...next });
  }, []);

  const handleResetTimer = useCallback(() => {
    labSound.playTimerBeep(1950, 0.05);
    const next = controllerRef.current.resetTimer();
    setSnapshot({ ...next });
  }, []);

  const handleReleaseCylinder = useCallback(() => {
    labSound.playSwitchClick(1100);
    const cur = controllerRef.current.getSnapshot();
    if (autoPrepareOnDrop && cur.powerOn) {
      if (!cur.cylinderAttachedToMagnet) {
        controllerRef.current.attachCylinderToMagnet();
      }
      if (!controllerRef.current.getSnapshot().timerResetReady) {
        controllerRef.current.resetTimer();
      }
    }
    const next = controllerRef.current.releaseCylinder();
    setSnapshot({ ...next });
    // Trên điện thoại: khi bấm Nhả trụ thép từ trong menu, tự động thu gọn menu để quan sát trọn vẹn cảnh 3D vật rơi
    if (checkIsMobileViewport() && next.phase === 'FALLING_TIMER_RUNNING') {
      setIsLeftPanelOpen(false);
      setIsRightPanelOpen(false);
    }
  }, [autoPrepareOnDrop]);

  const handleStartStopTimer = useCallback(() => {
    labSound.playSwitchClick(1040);
    const next = controllerRef.current.triggerStartStopButton();
    setSnapshot({ ...next });
  }, []);

  const handleStartPeriodicModeT = useCallback(() => {
    labSound.playTimerBeep(2200, 0.06);
    const next = controllerRef.current.startPeriodicCycleMeasurement(1.0);
    setSnapshot({ ...next });
  }, []);

  const handleAttachCylinder = useCallback(() => {
    labSound.playSwitchClick(780);
    controllerRef.current.attachCylinderToMagnet();
    if (autoPrepareOnDrop && controllerRef.current.getSnapshot().powerOn) {
      controllerRef.current.resetTimer();
    }
    setSnapshot({ ...controllerRef.current.getSnapshot() });
  }, [autoPrepareOnDrop]);

  const handleChangePhotogateDistance = useCallback((newDist: number) => {
    const next = controllerRef.current.setPhotogateDistance(newDist);
    setSnapshot({ ...next });
  }, []);

  const handleChangeGateADistance = useCallback((newDist: number) => {
    const next = controllerRef.current.setGateADistance(newDist);
    setSnapshot({ ...next });
  }, []);

  const handleChangeLateralOffset = useCallback((offsetMm: number) => {
    const next = controllerRef.current.setPhotogateLateralOffset(offsetMm);
    setSnapshot({ ...next });
  }, []);

  const handleTogglePortAConnected = useCallback(() => {
    labSound.playSwitchClick(700);
    const current = controllerRef.current.getSnapshot().portAConnected;
    const next = controllerRef.current.setPortAConnected(!current);
    setSnapshot({ ...next });
  }, []);

  const handleTogglePhotogateConnected = useCallback(() => {
    labSound.playSwitchClick(700);
    const current = controllerRef.current.getSnapshot().photogateConnected;
    const next = controllerRef.current.setPhotogateConnected(!current);
    setSnapshot({ ...next });
  }, []);

  const handleChangeWiringVariant = useCallback((variant: WiringVariant) => {
    labSound.playSwitchClick(840);
    const next = controllerRef.current.setWiringVariant(variant);
    setSnapshot({ ...next });
  }, []);

  const handleSelectTimerMode = useCallback((mode: C3TimerMode) => {
    labSound.playSwitchClick(960);
    const next = controllerRef.current.setTimerMode(mode);
    setSnapshot({ ...next });
  }, []);

  const handleCycleTimerMode = useCallback(() => {
    labSound.playSwitchClick(980);
    const next = controllerRef.current.cycleTimerMode();
    setSnapshot({ ...next });
  }, []);

  const handleSimulationTick = useCallback((dt: number) => {
    const next = controllerRef.current.stepSimulation(dt);
    setSnapshot({ ...next });
  }, []);

  const handleRecordResult = useCallback(() => {
    const snap = controllerRef.current.getSnapshot();
    if (snap.completedMeasurementSeconds === null || snap.completedMeasurementSeconds <= 0) {
      return;
    }
    labSound.playTimerBeep(2800, 0.06);
    const res = recordMeasurementToRows(
      rows,
      snap.photogateDistanceMeters,
      snap.completedMeasurementSeconds
    );
    setRows(res.updatedRows);
    setLastRecordedMessage(res.message);
  }, [rows]);

  const handleToggleFullscreenOrExpand = useCallback(async () => {
    const docEl = document.documentElement;
    if (document.fullscreenElement) {
      try {
        await document.exitFullscreen();
      } catch {
        // Ignore
      }
      setIsExpandedViewport(false);
      return;
    }

    if (docEl.requestFullscreen) {
      try {
        await docEl.requestFullscreen();
        setIsExpandedViewport(true);
        return;
      } catch {
        // Fallback cho iPhone Safari
      }
    }
    setIsExpandedViewport((prev) => !prev);
  }, []);

  const tableComputed = useMemo(() => {
    return computeTableSummary(
      rows,
      physicsConfig.gCalculationMethod,
      physicsConfig.uncertaintyMethod,
      forceOriginRegression
    );
  }, [rows, physicsConfig.gCalculationMethod, physicsConfig.uncertaintyMethod, forceOriginRegression]);

  const currentTSquared = useMemo(() => {
    const t = snapshot.timerDisplaySeconds;
    return t > 0 ? t * t : 0;
  }, [snapshot.timerDisplaySeconds]);

  const currentInstantG = useMemo(() => {
    if (
      snapshot.c3Mode === 'A<->B' &&
      snapshot.wiringVariant === 'SGK_KNTT' &&
      snapshot.completedMeasurementSeconds &&
      snapshot.completedMeasurementSeconds > 0
    ) {
      return computeGravityFromMeasurement(
        snapshot.photogateDistanceMeters,
        snapshot.completedMeasurementSeconds
      );
    }
    return null;
  }, [snapshot.c3Mode, snapshot.wiringVariant, snapshot.completedMeasurementSeconds, snapshot.photogateDistanceMeters]);

  const currentModeGuide = TIMER_MODE_GUIDES[snapshot.c3Mode];

  const handleRunAcceptanceTests = useCallback(() => {
    const hasHorizontalOverflow =
      typeof document !== 'undefined'
        ? document.documentElement.scrollWidth > document.documentElement.clientWidth
        : false;
    const res = runAllAcceptanceTests({
      canvasWidthCss: renderMetrics.canvasWidthCss,
      canvasHeightCss: renderMetrics.canvasHeightCss,
      rendererPixelRatio: renderMetrics.rendererPixelRatio,
      devicePixelRatio: renderMetrics.devicePixelRatio,
      hasHorizontalOverflow,
    });
    setTestResults(res);
  }, [renderMetrics]);

  const handleExportCsv = useCallback(() => {
    const csvContent = exportTableToCSV(
      rows,
      physicsConfig.gCalculationMethod,
      physicsConfig.uncertaintyMethod,
      forceOriginRegression
    );
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `bai_11_do_gia_toc_roi_tu_do_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [rows, physicsConfig.gCalculationMethod, physicsConfig.uncertaintyMethod, forceOriginRegression]);

  const toggleSound = () => {
    const next = !soundEnabled;
    setSoundEnabled(next);
    labSound.setEnabled(next);
  };

  // Bộ tổng hợp âm thanh nền phòng thí nghiệm (Web Audio API):
  // 1) Tiếng quạt thông gió dịu nhẹ (Filtered Brownian Noise @ 210 Hz)
  // 2) Tiếng nhiễu điện từ biến áp MC964 & cuộn dây nam châm điện (50 Hz + họa âm 100 Hz cực nhỏ)
  const ambienceAudioRef = useRef<{
    ctx: AudioContext;
    masterGain: GainNode;
    fanGain: GainNode;
    humGain: GainNode;
    noiseSource: AudioBufferSourceNode;
    hum50Osc: OscillatorNode;
    hum100Osc: OscillatorNode;
  } | null>(null);

  const ensureAmbienceGraph = useCallback(() => {
    if (typeof window === 'undefined') return null;
    if (ambienceAudioRef.current) return ambienceAudioRef.current;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.0001, ctx.currentTime);
    masterGain.connect(ctx.destination);

    // 1. Tạo buffer nhiễu nâu (Brownian noise) 3 giây lặp vòng cho tiếng quạt thông gió êm dịu
    const sampleRate = ctx.sampleRate;
    const bufferLength = sampleRate * 3;
    const noiseBuffer = ctx.createBuffer(1, bufferLength, sampleRate);
    const channelData = noiseBuffer.getChannelData(0);
    let lastOut = 0.0;
    for (let i = 0; i < bufferLength; i++) {
      const white = Math.random() * 2 - 1;
      lastOut = (lastOut + 0.025 * white) / 1.025;
      channelData[i] = lastOut * 2.2;
    }

    const noiseSource = ctx.createBufferSource();
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;

    const fanLowpass = ctx.createBiquadFilter();
    fanLowpass.type = 'lowpass';
    fanLowpass.frequency.setValueAtTime(215, ctx.currentTime);
    fanLowpass.Q.setValueAtTime(0.7, ctx.currentTime);

    const fanGain = ctx.createGain();
    // Âm lượng quạt rất nhẹ, không gây ồn
    fanGain.gain.setValueAtTime(0.015, ctx.currentTime);

    noiseSource.connect(fanLowpass);
    fanLowpass.connect(fanGain);
    fanGain.connect(masterGain);

    // 2. Tạo tiếng nhiễu điện xoay chiều 50 Hz + họa âm 100 Hz của biến áp nguồn & nam châm điện
    const hum50Osc = ctx.createOscillator();
    hum50Osc.type = 'sine';
    hum50Osc.frequency.setValueAtTime(50, ctx.currentTime);

    const hum100Osc = ctx.createOscillator();
    hum100Osc.type = 'triangle';
    hum100Osc.frequency.setValueAtTime(100, ctx.currentTime);

    const hum100SubGain = ctx.createGain();
    hum100SubGain.gain.setValueAtTime(0.28, ctx.currentTime);

    const humFilter = ctx.createBiquadFilter();
    humFilter.type = 'lowpass';
    humFilter.frequency.setValueAtTime(190, ctx.currentTime);

    const humGain = ctx.createGain();
    humGain.gain.setValueAtTime(0.006, ctx.currentTime);

    hum50Osc.connect(humFilter);
    hum100Osc.connect(hum100SubGain);
    hum100SubGain.connect(humFilter);
    humFilter.connect(humGain);
    humGain.connect(masterGain);

    noiseSource.start();
    hum50Osc.start();
    hum100Osc.start();

    ambienceAudioRef.current = {
      ctx,
      masterGain,
      fanGain,
      humGain,
      noiseSource,
      hum50Osc,
      hum100Osc,
    };
    return ambienceAudioRef.current;
  }, []);

  const toggleAmbience = useCallback(() => {
    setAmbienceEnabled((prev) => {
      const next = !prev;
      if (next) {
        const nodes = ensureAmbienceGraph();
        if (nodes && nodes.ctx.state === 'suspended') {
          nodes.ctx.resume().catch(() => {});
        }
      }
      return next;
    });
  }, [ensureAmbienceGraph]);

  // Đồng bộ trạng thái âm thanh nền theo nút bật/tắt độc lập, mức âm lượng và trạng thái nguồn/nam châm điện
  useEffect(() => {
    if (!ambienceEnabled && !ambienceAudioRef.current) return;
    const nodes = ensureAmbienceGraph();
    if (!nodes) return;

    const { ctx, masterGain, fanGain, humGain } = nodes;
    if (ambienceEnabled && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    const now = ctx.currentTime;
    const targetMaster = ambienceEnabled ? Math.max(0.05, Math.min(1, ambienceVolume)) : 0.0001;
    // Khi nguồn MC964 và nam châm điện đang bật giữ trụ thép, tiếng nhiễu điện từ rõ hơn một chút
    const targetHum = !snapshot.powerOn
      ? 0.002
      : snapshot.electromagnetEnergized
      ? 0.009
      : 0.0055;
    const targetFan = snapshot.powerOn ? 0.016 : 0.011;

    masterGain.gain.cancelScheduledValues(now);
    masterGain.gain.setTargetAtTime(targetMaster, now, 0.12);

    humGain.gain.cancelScheduledValues(now);
    humGain.gain.setTargetAtTime(targetHum, now, 0.15);

    fanGain.gain.cancelScheduledValues(now);
    fanGain.gain.setTargetAtTime(targetFan, now, 0.2);
  }, [
    ambienceEnabled,
    ambienceVolume,
    snapshot.powerOn,
    snapshot.electromagnetEnergized,
    ensureAmbienceGraph,
  ]);

  useEffect(() => {
    return () => {
      if (ambienceAudioRef.current) {
        try {
          ambienceAudioRef.current.noiseSource.stop();
          ambienceAudioRef.current.hum50Osc.stop();
          ambienceAudioRef.current.hum100Osc.stop();
          ambienceAudioRef.current.ctx.close().catch(() => {});
        } catch {
          // Ignore cleanup errors
        }
        ambienceAudioRef.current = null;
      }
    };
  }, []);

  // =========================================================================
  // HỆ THỐNG TOOLTIP SƯ PHẠM NỔI (HỖ TRỢ HỌC SINH HIỂU RÕ CHỨC NĂNG TỪNG NÚT)
  // =========================================================================
  const [hoveredTooltip, setHoveredTooltip] = useState<{
    title: string;
    desc: string;
    tip?: string;
    top: number;
    left?: number;
    right?: number;
  } | null>(null);

  const bindTooltip = useCallback(
    (
      title: string,
      desc: string,
      tip?: string,
      side: 'right' | 'left' = 'right'
    ) => {
      const fullNativeTitle = tip ? `${title} — ${desc} (${tip})` : `${title} — ${desc}`;
      const show = (el: HTMLElement | null) => {
        if (!el || checkIsMobileViewport()) return;
        const rect = el.getBoundingClientRect();
        const clampedTop = Math.max(12, Math.min(window.innerHeight - 135, rect.top - 4));
        if (side === 'right') {
          setHoveredTooltip({
            title,
            desc,
            tip,
            top: clampedTop,
            left: Math.min(window.innerWidth - 290, rect.right + 10),
          });
        } else {
          setHoveredTooltip({
            title,
            desc,
            tip,
            top: clampedTop,
            right: Math.max(12, window.innerWidth - rect.left + 10),
          });
        }
      };
      return {
        title: fullNativeTitle,
        onMouseEnter: (e: React.MouseEvent<HTMLElement>) => show(e.currentTarget),
        onMouseLeave: () => setHoveredTooltip(null),
        onFocus: (e: React.FocusEvent<HTMLElement>) => show(e.currentTarget),
        onBlur: () => setHoveredTooltip(null),
        onClickCapture: () => setHoveredTooltip(null),
      };
    },
    [checkIsMobileViewport]
  );

  const MODE_TOOLTIP_INFO: Record<
    C3TimerMode,
    { title: string; desc: string; tip: string }
  > = {
    A: {
      title: 'MODE A — Đo thời gian chắn tia tại Cổng A',
      desc: 'Chỉ kích hoạt Cổng quang điện A. Đồng hồ bắt đầu đếm khi mép dưới trụ thép chắn tia hồng ngoại A và dừng khi trụ thép thoát khỏi tia A.',
      tip: 'Ứng dụng: Tính vận tốc tức thời tại vị trí A theo vA ≈ d / tA',
    },
    B: {
      title: 'MODE B — Đo thời gian chắn tia tại Cổng B',
      desc: 'Chỉ kích hoạt Cổng quang điện B. Đo khoảng thời gian ΔtB mà trụ thép đi qua và chắn chùm tia hồng ngoại tại cổng B.',
      tip: 'Ứng dụng: Tính vận tốc tức thời tại vị trí B theo vB ≈ d / tB',
    },
    'A+B': {
      title: 'MODE A + B — Tổng thời gian chắn tia tại A và B',
      desc: 'Kích hoạt cả 2 cổng A và B để đo riêng thời gian chắn tia tA và tB, sau đó hiển thị tổng t = tA + tB.',
      tip: 'Lưu ý: Đây là tổng 2 khoảng thời gian chắn tia, KHÔNG phải thời gian rơi từ A đến B',
    },
    'A<->B': {
      title: 'MODE A ↔ B — Đo thời gian rơi từ A đến B (Bài 11)',
      desc: 'Bắt đầu đếm (START) khi nhận tín hiệu tại kênh A và dừng đếm (STOP) khi trụ thép đi qua Cổng quang điện B.',
      tip: 'Công thức xác định gia tốc rơi tự do: g = 2s / t²',
    },
    T: {
      title: 'MODE T — Đo chu kì chuyển động tuần hoàn (T)',
      desc: 'Đo khoảng thời gian giữa 2 sự kiện tương ứng liên tiếp tại Cổng A của một dao động hoặc chuyển động tuần hoàn.',
      tip: 'Đồng hồ cần nhận đủ 2 sự kiện liên tiếp để hiển thị chu kì T',
    },
  };

  return (
    <div className="relative flex flex-row w-full h-full bg-slate-950 text-slate-100 overflow-hidden select-none">
      {/* Thẻ Tooltip Sư Phạm Nổi (Không bao giờ bị che cắt bởi thanh cuộn sidebar) */}
      {hoveredTooltip && !isUiHiddenZen && (
        <div
          role="tooltip"
          style={{
            top: hoveredTooltip.top,
            left: hoveredTooltip.left,
            right: hoveredTooltip.right,
          }}
          className="hidden md:flex fixed z-50 pointer-events-none w-72 p-3 rounded-xl bg-slate-950/98 border border-sky-400/80 shadow-2xl flex-col gap-1.5 text-xs"
        >
          <div className="font-display font-bold text-sky-300 leading-snug flex items-center gap-1.5">
            <HelpCircle className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span>{hoveredTooltip.title}</span>
          </div>
          <p className="text-slate-200 text-[11px] leading-relaxed">
            {hoveredTooltip.desc}
          </p>
          {hoveredTooltip.tip && (
            <div className="pt-1 border-t border-slate-800 text-[10px] font-mono-tabular text-amber-300 leading-snug">
              {hoveredTooltip.tip}
            </div>
          )}
        </div>
      )}
      {/* =====================================================================
          1. CỘT DỌC BÊN TRÁI: ĐỒNG HỒ HIỆN SỐ MC964 (CỔNG A TRÊN / B DƯỚI,
             5 CHẾ ĐỘ MODE A, B, A+B, A↔B, T) + NÚT THAO TÁC & CAM BÁM RƠI
             (Trên điện thoại tự động ẩn mặc định, bấm nút cạnh trái mới mở ra)
      ===================================================================== */}
      {!isUiHiddenZen && isLeftPanelOpen && (
        <aside
          aria-label="Mô-đun đồng hồ MC964 và điều khiển bên trái"
          className="fixed md:static inset-y-0 left-0 z-40 shrink-0 h-full w-64 sm:w-72 bg-slate-900/98 md:bg-slate-900/95 border-r border-slate-800 safe-top safe-bottom safe-left p-2.5 flex flex-col justify-between gap-2 overflow-y-auto lab-scroll shadow-2xl"
        >
          <div className="flex flex-col gap-2">
            {/* Đầu cột trái: Tiêu đề + Nút thu gọn */}
            <div className="flex items-center justify-between gap-1.5 pb-1.5 border-b border-slate-800">
              <div className="min-w-0">
                <h1 className="font-display text-xs sm:text-sm font-bold text-slate-100 truncate">
                  Đồng Hồ Hiện Số MC964
                </h1>
                <p className="text-[10px] text-sky-400 truncate">
                  {snapshot.wiringVariant === 'SGK_KNTT'
                    ? 'Bài 11 SGK: A (Thả vật) → B (Cổng quang)'
                    : '2 cổng quang độc lập: Cổng A & Cổng B'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsLeftPanelOpen(false)}
                title="Ẩn bảng đồng hồ bên trái"
                className="w-7 h-7 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center shrink-0"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
            </div>

            {/* MÀN HÌNH LED SỐ LỚN CỦA ĐỒNG HỒ MC964 (ĐỘ CHÍNH XÁC 0,001 s) */}
            <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-2 font-mono-tabular shadow-inner">
              <div className="flex items-center justify-between text-[10px] text-slate-400 border-b border-slate-800/80 pb-1">
                <span className="font-bold text-sky-400">MODE: {snapshot.c3Mode}</span>
                <div className="flex items-center gap-1.5">
                  <span
                    className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                      snapshot.timerResetReady
                        ? 'bg-emerald-950 text-emerald-400 border border-emerald-700/60'
                        : snapshot.phase === 'FALLING_TIMER_RUNNING'
                        ? 'bg-sky-950 text-sky-300 border border-sky-700/60'
                        : 'bg-slate-900 text-slate-500'
                    }`}
                  >
                    {snapshot.timerResetReady
                      ? 'READY'
                      : snapshot.phase === 'FALLING_TIMER_RUNNING'
                      ? 'RUN'
                      : 'HOLD'}
                  </span>
                  <button
                    type="button"
                    onClick={() => setShowModeGuide((v) => !v)}
                    {...bindTooltip(
                      'Giải thích chế độ MODE (?)',
                      'Mở hoặc đóng hộp hướng dẫn tóm tắt nguyên lí hoạt động, cổng tham gia và điều kiện Bắt đầu / Kết thúc của chế độ MODE đang chọn.',
                      `Chế độ hiện tại: MODE ${snapshot.c3Mode === 'A<->B' ? 'A↔B' : snapshot.c3Mode}`
                    )}
                    className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] font-bold border ${
                      showModeGuide
                        ? 'bg-sky-600 text-white border-sky-300'
                        : 'bg-slate-800 text-slate-300 border-slate-700'
                    }`}
                  >
                    ?
                  </button>
                </div>
              </div>

              {/* Số hiển thị chính 0.001 s */}
              <div className="flex items-baseline justify-between bg-[#050811] px-3 py-2 rounded-lg border border-slate-800/90">
                <span className="text-[11px] text-slate-400 font-sans">
                  {snapshot.c3Mode === 'A'
                    ? 't_A (Chắn A):'
                    : snapshot.c3Mode === 'B'
                    ? 't_B (Chắn B):'
                    : snapshot.c3Mode === 'A+B'
                    ? 'Tổng tA+tB:'
                    : snapshot.c3Mode === 'T'
                    ? 'Chu kì T:'
                    : 'Thời gian t:'}
                </span>
                <span
                  className={`text-2xl sm:text-3xl font-extrabold tracking-tight ${
                    !snapshot.powerOn
                      ? 'text-slate-700'
                      : snapshot.phase === 'ERROR'
                      ? 'text-orange-400'
                      : 'text-red-500'
                  }`}
                >
                  {!snapshot.powerOn
                    ? 'OFF'
                    : snapshot.phase === 'ERROR'
                    ? 'Err'
                    : `${formatTimerDisplay(
                        snapshot.timerDisplaySeconds,
                        physicsConfig.timerScale
                      )} s`}
                </span>
              </div>

              {/* Hiển thị chuyên biệt cho MODE A + B (tA, tB và tổng t = tA + tB) */}
              {snapshot.c3Mode === 'A+B' && (
                <div className="p-2 rounded-lg bg-amber-950/30 border border-amber-600/40 flex flex-col gap-1 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Chắn cổng A (tA):</span>
                    <strong className="text-amber-300">
                      {snapshot.measuredTimeASeconds !== null
                        ? `${snapshot.measuredTimeASeconds.toFixed(3)} s`
                        : '0.000 s'}
                    </strong>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-slate-300">Chắn cổng B (tB):</span>
                    <strong className="text-sky-300">
                      {snapshot.measuredTimeBSeconds !== null
                        ? `${snapshot.measuredTimeBSeconds.toFixed(3)} s`
                        : '0.000 s'}
                    </strong>
                  </div>
                  <div className="text-[10px] text-amber-200/90 font-sans pt-0.5 border-t border-amber-700/30 leading-tight">
                    Lưu ý: t = tA + tB là tổng 2 khoảng thời gian chắn tia, KHÔNG phải thời gian đi từ A đến B.
                  </div>
                </div>
              )}

              {/* Minh họa mũi tên chuyển động A -> B khi ở MODE A <-> B */}
              {snapshot.c3Mode === 'A<->B' && (
                <div className="px-2.5 py-1.5 rounded-lg bg-slate-900/90 border border-slate-800 flex items-center justify-between text-[11px]">
                  <span
                    className={`px-1.5 py-0.5 rounded font-bold ${
                      snapshot.portAState === 'ACTIVE' || snapshot.portAState === 'RECEIVED'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    A (Bắt đầu)
                  </span>
                  <div className="flex-1 flex items-center justify-center px-2 text-sky-400">
                    <div className="h-0.5 flex-1 bg-gradient-to-r from-red-500 via-amber-400 to-sky-400" />
                    <ArrowRight className="w-3.5 h-3.5 -ml-1 shrink-0" />
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded font-bold ${
                      snapshot.portBState === 'ACTIVE' || snapshot.portBState === 'RECEIVED'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-slate-800 text-slate-300'
                    }`}
                  >
                    B (Kết thúc)
                  </span>
                </div>
              )}

              {/* Minh họa đếm sự kiện chu kì tuần hoàn khi ở MODE T */}
              {snapshot.c3Mode === 'T' && (
                <div className="p-2 rounded-lg bg-purple-950/30 border border-purple-500/40 flex flex-col gap-1.5 text-[11px]">
                  <div className="flex items-center justify-between">
                    <span className="text-purple-200 font-sans">Sự kiện chu kì tại A:</span>
                    <span className="font-bold text-purple-300">
                      {snapshot.periodEventCount} / 2 sự kiện
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={handleStartPeriodicModeT}
                    disabled={!snapshot.powerOn}
                    className="w-full py-1.5 px-2 rounded bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white font-sans font-semibold text-[11px] flex items-center justify-center gap-1.5 shadow"
                  >
                    <Activity className="w-3.5 h-3.5 shrink-0" />
                    <span>Phát tín hiệu tuần hoàn (Đo chu kì T)</span>
                  </button>
                </div>
              )}

              {/* Thông số s, t², g = 2s/t² */}
              <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-800/80 text-[11px]">
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-sans">Quãng đường s</span>
                  <span className="font-bold text-amber-300">
                    {snapshot.photogateDistanceMeters.toFixed(3)} m
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-sans">Bình phương t²</span>
                  <span className="font-semibold text-sky-300">
                    {currentTSquared > 0 ? `${currentTSquared.toFixed(3)} s²` : '0.000 s²'}
                  </span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[10px] text-slate-400 font-sans">g = 2s/t²</span>
                  <span className="font-bold text-emerald-400">
                    {currentInstantG !== null
                      ? `${currentInstantG.toFixed(2)}`
                      : tableComputed.summary.meanG !== null
                      ? `${tableComputed.summary.meanG.toFixed(2)}`
                      : '—'}{' '}
                    m/s²
                  </span>
                </div>
              </div>
            </div>

            {/* HƯỚNG DẪN NGẮN GIẢI THÍCH CHẾ ĐỘ MODE ĐANG CHỌN (TỰ ẨN, BẤM "?" MỚI HIỆN) */}
            {showModeGuide && (
              <div className="p-2.5 rounded-xl bg-sky-950/50 border border-sky-500/50 text-[11px] flex flex-col gap-1 leading-snug">
                <div className="flex items-center justify-between font-bold text-sky-300">
                  <span>{currentModeGuide.shortTitle}</span>
                  <button
                    type="button"
                    onClick={() => setShowModeGuide(false)}
                    className="text-slate-400 hover:text-white px-1"
                  >
                    ×
                  </button>
                </div>
                <p className="text-slate-200">
                  <strong>Cổng hoạt động:</strong> {currentModeGuide.activePortsText}
                </p>
                <p className="text-emerald-300">
                  <strong>Bắt đầu:</strong> {currentModeGuide.startConditionText}
                </p>
                <p className="text-amber-300">
                  <strong>Kết thúc:</strong> {currentModeGuide.stopConditionText}
                </p>
              </div>
            )}

            {/* CHỌN 5 CHẾ ĐỘ MODE CỦA ĐỒNG HỒ MC964: A, B, A+B, A↔B, T */}
            <div className="p-2 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-300">Chọn chế độ MODE:</span>
                <button
                  type="button"
                  onClick={handleCycleTimerMode}
                  {...bindTooltip(
                    'Nút chuyển vòng MODE ↻',
                    'Chuyển đổi tuần tự qua 5 chế độ đo thời gian của đồng hồ hiện số MC964: A → B → A+B → A↔B → T.',
                    'Tương đương nút MODE vật lí trên mặt đồng hồ 3D'
                  )}
                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[10px] font-mono-tabular border border-slate-700"
                >
                  Nút MODE ↻
                </button>
              </div>
              <div className="grid grid-cols-5 gap-1 font-mono-tabular">
                {(['A', 'B', 'A+B', 'A<->B', 'T'] as C3TimerMode[]).map((m) => {
                  const isSel = snapshot.c3Mode === m;
                  const info = MODE_TOOLTIP_INFO[m];
                  return (
                    <button
                      key={m}
                      type="button"
                      onClick={() => handleSelectTimerMode(m)}
                      {...bindTooltip(info.title, info.desc, info.tip)}
                      className={`min-h-[32px] py-1 rounded-lg text-xs font-bold border transition-all ${
                        isSel
                          ? 'bg-sky-600 text-white border-sky-300 shadow-md scale-[1.02]'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {m === 'A<->B' ? 'A↔B' : m}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* MẶT KẾT NỐI 2 CỔNG TÍN HIỆU MC964: CỔNG A Ở PHÍA TRÊN, CỔNG B Ở PHÍA DƯỚI
                (Các chú thích chi tiết dây nối tự ẩn, bấm "Chi tiết" mới hiện ra) */}
            <div className="p-2 rounded-xl bg-slate-950 border border-slate-800 flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-[11px]">
                <span className="font-semibold text-slate-200 flex items-center gap-1">
                  <PlugZap className="w-3.5 h-3.5 text-amber-400" />
                  <span>Cổng tín hiệu (A trên / B dưới)</span>
                </span>
                <button
                  type="button"
                  onClick={() => setShowPortConfigDetails((v) => !v)}
                  {...bindTooltip(
                    'Chi tiết dây & Cắm/rút cổng tín hiệu',
                    'Mở rộng để kiểm tra vị trí cổng quang sA, sB, thực hành cắm/rút giắc tín hiệu 3D hoặc chuyển đổi sơ đồ đấu nối.',
                    'Hỗ trợ kiểm nghiệm lỗi khi quên cắm dây cổng A hoặc B'
                  )}
                  className="text-[10px] text-sky-400 hover:underline font-medium flex items-center gap-0.5"
                >
                  <span>{showPortConfigDetails ? 'Ẩn chi tiết' : 'Chi tiết dây'}</span>
                  {showPortConfigDetails ? (
                    <ChevronUp className="w-3 h-3" />
                  ) : (
                    <ChevronDown className="w-3 h-3" />
                  )}
                </button>
              </div>

              {/* ĐẦU NỐI A Ở PHÍA TRÊN (Bấm vào để chọn Cổng quang A) */}
              <div
                onClick={() => handleSelectTimerMode(snapshot.c3Mode === 'A' ? 'A<->B' : 'A')}
                {...bindTooltip(
                  'CỔNG QUANG A (Đầu nối kênh A phía trên)',
                  'Nhận tín hiệu bắt đầu (START) hoặc đo thời gian chắn tia tA tại Cổng quang điện A. Bấm vào thẻ này để chọn nhanh Cổng A (hiện Cổng A và ký hiệu A trên giá đỡ).',
                  `Trạng thái hiện tại: ${PORT_STATE_LABELS[snapshot.portAState]}`
                )}
                className={`p-1.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition-colors ${
                  snapshot.c3Mode === 'A' || snapshot.c3Mode === 'A+B' || snapshot.c3Mode === 'A<->B' || snapshot.c3Mode === 'T'
                    ? 'bg-red-950/35 border-red-500/60 hover:bg-red-950/50'
                    : 'bg-slate-900/90 border-slate-800 hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-red-600 text-white font-mono-tabular text-xs font-extrabold flex items-center justify-center shrink-0">
                      A
                    </span>
                    <span className="text-[11px] font-bold text-slate-100 truncate">
                      CỔNG QUANG A (Trên)
                    </span>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular border shrink-0 ${getPortBadgeClasses(
                      snapshot.portAState
                    )}`}
                  >
                    {PORT_STATE_LABELS[snapshot.portAState]}
                  </span>
                </div>

                {/* Đường truyền tín hiệu A */}
                <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-150 ${
                      snapshot.portAState === 'ACTIVE'
                        ? 'w-full bg-amber-400'
                        : snapshot.portAState === 'RECEIVED'
                        ? 'w-full bg-emerald-500'
                        : snapshot.portAState === 'CONNECTED'
                        ? 'w-1/3 bg-red-500/60'
                        : 'w-0'
                    }`}
                  />
                </div>

                {showPortConfigDetails && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="pt-1 border-t border-slate-800/80 flex items-center justify-between gap-1 text-[10px] text-slate-400"
                  >
                    <span className="truncate">
                      Cổng quang A (sA = {(snapshot.gateADistanceMeters * 100).toFixed(1)} cm)
                    </span>
                    <button
                      type="button"
                      onClick={handleTogglePortAConnected}
                      {...bindTooltip(
                        snapshot.portAConnected ? 'Rút dây Cổng A' : 'Cắm dây Cổng A',
                        'Mô phỏng thao tác cắm hoặc rút phích cắm 3D màu đỏ tại ổ IN A trên mặt đồng hồ MC964.',
                        'Nếu rút dây khi cần đo kênh A, đồng hồ sẽ báo lỗi thiếu tín hiệu'
                      )}
                      className={`px-1.5 py-0.5 rounded font-medium border shrink-0 ${
                        snapshot.portAConnected
                          ? 'bg-slate-800 text-emerald-300 border-emerald-700/60'
                          : 'bg-red-950 text-red-200 border-red-600'
                      }`}
                    >
                      {snapshot.portAConnected ? 'Đang cắm' : 'Đã rút'}
                    </button>
                  </div>
                )}
              </div>

              {/* ĐẦU NỐI B Ở PHÍA DƯỚI (Bấm vào để chọn Cổng quang B) */}
              <div
                onClick={() => handleSelectTimerMode(snapshot.c3Mode === 'B' ? 'A<->B' : 'B')}
                {...bindTooltip(
                  'CỔNG QUANG B (Đầu nối kênh B phía dưới)',
                  'Nhận tín hiệu kết thúc (STOP) trong chế độ A↔B hoặc đo thời gian chắn tia tB tại Cổng quang điện B. Bấm vào thẻ này để chọn nhanh Cổng B.',
                  `Trạng thái hiện tại: ${PORT_STATE_LABELS[snapshot.portBState]}`
                )}
                className={`p-1.5 rounded-lg border flex flex-col gap-1 cursor-pointer transition-colors ${
                  snapshot.c3Mode === 'B' || snapshot.c3Mode === 'A+B' || snapshot.c3Mode === 'A<->B'
                    ? 'bg-sky-950/35 border-sky-500/60 hover:bg-sky-950/50'
                    : 'bg-slate-900/90 border-slate-800 hover:bg-slate-800/80'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="w-5 h-5 rounded-full bg-sky-600 text-white font-mono-tabular text-xs font-extrabold flex items-center justify-center shrink-0">
                      B
                    </span>
                    <span className="text-[11px] font-bold text-slate-100 truncate">
                      CỔNG QUANG B (Dưới)
                    </span>
                  </div>
                  <span
                    className={`px-1.5 py-0.5 rounded text-[10px] font-mono-tabular border shrink-0 ${getPortBadgeClasses(
                      snapshot.portBState
                    )}`}
                  >
                    {PORT_STATE_LABELS[snapshot.portBState]}
                  </span>
                </div>

                {/* Đường truyền tín hiệu B */}
                <div className="w-full h-1.5 rounded-full bg-slate-950 overflow-hidden border border-slate-800">
                  <div
                    className={`h-full transition-all duration-150 ${
                      snapshot.portBState === 'ACTIVE'
                        ? 'w-full bg-amber-400'
                        : snapshot.portBState === 'RECEIVED'
                        ? 'w-full bg-emerald-500'
                        : snapshot.portBState === 'CONNECTED'
                        ? 'w-1/3 bg-sky-500/60'
                        : 'w-0'
                    }`}
                  />
                </div>

                {showPortConfigDetails && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="pt-1 border-t border-slate-800/80 flex items-center justify-between gap-1 text-[10px] text-slate-400"
                  >
                    <span className="truncate">
                      Cổng quang B (s = {(snapshot.photogateDistanceMeters * 100).toFixed(1)} cm)
                    </span>
                    <button
                      type="button"
                      onClick={handleTogglePhotogateConnected}
                      {...bindTooltip(
                        snapshot.portBConnected ? 'Rút dây Cổng B' : 'Cắm dây Cổng B',
                        'Mô phỏng thao tác cắm hoặc rút phích cắm 3D màu xanh dương tại ổ IN B trên mặt đồng hồ MC964.',
                        'Nếu rút dây Cổng B trong chế độ A↔B, đồng hồ sẽ không dừng tự động khi vật đi qua'
                      )}
                      className={`px-1.5 py-0.5 rounded font-medium border shrink-0 ${
                        snapshot.portBConnected
                          ? 'bg-slate-800 text-emerald-300 border-emerald-700/60'
                          : 'bg-red-950 text-red-200 border-red-600'
                      }`}
                    >
                      {snapshot.portBConnected ? 'Đang cắm' : 'Đã rút'}
                    </button>
                  </div>
                )}
              </div>

              {showPortConfigDetails && (
                <div className="flex items-center justify-between pt-0.5 text-[10px]">
                  <span className="text-slate-400">Sơ đồ đấu nối:</span>
                  <button
                    type="button"
                    onClick={() =>
                      handleChangeWiringVariant(
                        snapshot.wiringVariant === 'SGK_KNTT' ? 'C3_MC964' : 'SGK_KNTT'
                      )
                    }
                    {...bindTooltip(
                      'Chuyển đổi sơ đồ đấu nối thí nghiệm',
                      'Đổi giữa cấu hình Bài 11 SGK (Kênh A nhận xung từ công tắc thả vật t=0, Kênh B nhận xung từ cổng quang) và cấu hình 2 cổng quang điện độc lập A – B.',
                      'Giúp học sinh hiểu rõ vai trò của từng kênh trong các biến thể thí nghiệm'
                    )}
                    className="px-2 py-0.5 rounded bg-slate-900 border border-slate-700 text-sky-300 font-semibold"
                  >
                    {snapshot.wiringVariant === 'SGK_KNTT'
                      ? 'Hệ Bài 11 SGK (Đổi sang 2 cổng)'
                      : 'Hệ 2 Cổng quang (Đổi về SGK)'}
                  </button>
                </div>
              )}
            </div>

            {/* NÚT THAO TÁC ĐỒNG HỒ & THÍ NGHIỆM (NHẢ TRỤ, START/STOP, RESET, GHI KẾT QUẢ) */}
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={handleReleaseCylinder}
                disabled={
                  !snapshot.powerOn ||
                  snapshot.phase === 'FALLING_TIMER_RUNNING' ||
                  snapshot.phase === 'PHOTOGATE_TRIGGERED'
                }
                {...bindTooltip(
                  snapshot.cylinderAttachedToMagnet
                    ? 'Nhả trụ thép (Bắt đầu thả rơi)'
                    : 'Thực hiện lại phép đo (Thả lại)',
                  'Tác động vào công tắc kép để ngắt dòng điện qua nam châm điện, thả trụ thép rơi tự do không vận tốc đầu (v0 = 0) dọc theo dây dọi.',
                  'Tự động đặt lại trụ thép và RESET đồng hồ nếu đang ở trạng thái hoàn tất'
                )}
                className="w-full min-h-[42px] px-3 py-2 rounded-lg font-bold text-xs sm:text-sm flex items-center justify-center gap-2 border transition-colors whitespace-nowrap disabled:opacity-40 bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-300 shadow-lg"
              >
                <Play className="w-4 h-4 shrink-0 fill-current" />
                <span>
                  {snapshot.cylinderAttachedToMagnet
                    ? 'Nhả trụ thép (Thả rơi)'
                    : 'Thực hiện lại (Thả lại)'}
                </span>
              </button>

              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  onClick={handleStartStopTimer}
                  disabled={!snapshot.powerOn}
                  {...bindTooltip(
                    'Nút START / STOP (Đếm / Dừng thủ công)',
                    'Bắt đầu hoặc dừng bộ đếm thời gian của đồng hồ hiện số MC964 bằng tay để kiểm tra độ ổn định xung nhịp 1000 Hz (0,001 s).',
                    'Trong khi thả rơi tự động, đồng hồ sẽ tự START/STOP theo tín hiệu cổng A và B'
                  )}
                  className="min-h-[36px] px-2 py-1 rounded-lg bg-sky-700 hover:bg-sky-600 disabled:opacity-40 text-white border border-sky-400 font-bold text-[11px] flex items-center justify-center"
                >
                  START/STOP
                </button>

                <button
                  type="button"
                  onClick={handleResetTimer}
                  disabled={!snapshot.powerOn}
                  {...bindTooltip(
                    'Nút RESET (Đưa đồng hồ về 0,000 s)',
                    'Xóa số đo hiện tại trên màn hình LED về 0.000 s và đặt lại trạng thái chờ tín hiệu READY cho các cổng.',
                    'Không làm mất các lần đo đã lưu trong Bảng số liệu'
                  )}
                  className="min-h-[36px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 font-semibold text-[11px] flex items-center justify-center gap-1"
                >
                  <RotateCcw className="w-3.5 h-3.5 shrink-0 text-sky-300" />
                  <span>RESET</span>
                </button>

                <button
                  type="button"
                  onClick={handleAttachCylinder}
                  disabled={!snapshot.powerOn || snapshot.cylinderAttachedToMagnet}
                  {...bindTooltip(
                    'Đặt trụ thép lên nam châm điện',
                    'Đưa trụ thép từ khay hứng phía dưới lên gắn vào lõi nam châm điện tại mốc xuất phát s = 0,0 cm.',
                    'Học sinh cũng có thể dùng chuột/ngón tay kéo trực tiếp trụ thép 3D lên nam châm'
                  )}
                  className="min-h-[36px] px-2 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 font-semibold text-[11px] flex items-center justify-center gap-1"
                >
                  <Magnet className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                  <span>Đặt trụ</span>
                </button>
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={handleRecordResult}
                  disabled={snapshot.completedMeasurementSeconds === null}
                  {...bindTooltip(
                    'Ghi kết quả vào Bảng số liệu',
                    'Ghi nhận giá trị thời gian rơi t vừa đo được ứng với quãng đường s hiện tại vào Bảng 11.1 để tự động tính t̄, t̄² và gia tốc g.',
                    'Chỉ sáng lên sau khi hoàn tất một lượt đo hợp lệ'
                  )}
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-lg font-bold text-xs flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap disabled:opacity-40 ${
                    snapshot.completedMeasurementSeconds !== null
                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white border-emerald-400 shadow-md'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <BookmarkPlus className="w-3.5 h-3.5 shrink-0" />
                  <span>Ghi vào bảng</span>
                </button>

                <button
                  type="button"
                  onClick={handleTogglePower}
                  {...bindTooltip(
                    'Công tắc nguồn chính (POWER)',
                    'Bật hoặc tắt nguồn điện 220V AC / 12V DC cấp cho đồng hồ đo thời gian hiện số MC964, đèn hồng ngoại cổng quang và nam châm điện.',
                    snapshot.powerOn
                      ? 'Đang BẬT: Nếu tắt nguồn, nam châm sẽ mất từ tính và nhả trụ thép'
                      : 'Đang TẮT: Hãy bật nguồn trước khi gắn trụ thép và đo'
                  )}
                  className={`min-h-[36px] px-2.5 py-1.5 rounded-lg font-semibold text-xs flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap ${
                    snapshot.powerOn
                      ? 'bg-slate-800 hover:bg-slate-700 text-emerald-300 border-emerald-600/60'
                      : 'bg-red-950 hover:bg-red-900 text-red-200 border-red-600'
                  }`}
                >
                  <Power className="w-3.5 h-3.5 shrink-0" />
                  <span>{snapshot.powerOn ? 'Nguồn: BẬT' : 'Nguồn: TẮT'}</span>
                </button>
              </div>
            </div>

            {/* THÔNG BÁO LỖI KHI CHƯA KẾT NỐI CỔNG, SAI THỨ TỰ TÍN HIỆU HOẶC CHƯA ĐỦ SỰ KIỆN */}
            {snapshot.phase === 'ERROR' && snapshot.errorMessage && (
              <div className="p-2.5 rounded-xl bg-red-950/95 border border-red-500/80 text-red-100 text-xs flex flex-col gap-1.5">
                <div className="flex items-start gap-1.5">
                  <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                  <span className="leading-snug">{snapshot.errorMessage}</span>
                </div>
                <button
                  type="button"
                  onClick={handleAttachCylinder}
                  className="w-full py-1 rounded bg-red-700 hover:bg-red-600 text-white text-xs font-semibold"
                >
                  Đặt lại trụ & RESET
                </button>
              </div>
            )}

            {/* TỐC ĐỘ RƠI (QUAY CHẬM) & NÚT CAM BÁM RƠI ĐẶT BÊN MENU TRÁI */}
            <div className="p-2 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-1.5">
              <div className="flex items-center justify-between gap-1">
                <span className="text-[11px] font-semibold text-slate-300 flex items-center gap-1">
                  <Gauge className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                  <span>Tốc độ rơi:</span>
                </span>
                <button
                  type="button"
                  onClick={() => setAutoTrackFall((v) => !v)}
                  {...bindTooltip(
                    'Camera tự động bám theo vật rơi',
                    'Khi BẬT, camera 3D tự động căn chỉnh khoảng cách tối ưu và lia theo trụ thép trong suốt quá trình rơi từ nam châm xuống khay hứng.',
                    'Tắt nếu bạn muốn giữ cố định một góc nhìn cận cảnh'
                  )}
                  className={`px-2 py-0.5 rounded text-[10px] font-semibold flex items-center gap-1 border transition-colors ${
                    autoTrackFall
                      ? 'bg-emerald-600/90 text-white border-emerald-400'
                      : 'bg-slate-800 text-slate-400 border-slate-700'
                  }`}
                >
                  <Video className="w-3 h-3 shrink-0" />
                  <span>{autoTrackFall ? 'Cam bám rơi: BẬT' : 'Cam bám rơi: TẮT'}</span>
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1">
                {[
                  {
                    speed: 1,
                    label: '1x Thực',
                    title: 'Tốc độ 1x (Thời gian thực)',
                    desc: 'Mô phỏng quá trình rơi tự do đúng theo tốc độ thực tế ngoài đời.',
                  },
                  {
                    speed: 0.25,
                    label: '0.25x Chậm',
                    title: 'Quay chậm 0.25x (Chậm 4 lần)',
                    desc: 'Làm chậm chuyển động rơi 4 lần để học sinh quan sát rõ lúc trụ thép đi qua tia hồng ngoại của cổng quang.',
                  },
                  {
                    speed: 0.1,
                    label: '0.1x Siêu',
                    title: 'Quay siêu chậm 0.1x (Chậm 10 lần)',
                    desc: 'Làm chậm chuyển động 10 lần để phân tích chi tiết thời điểm bắt đầu chắn tia và thoát khỏi tia quang điện.',
                  },
                ].map((item) => (
                  <button
                    key={item.speed}
                    type="button"
                    onClick={() => setPlaybackSpeed(item.speed)}
                    {...bindTooltip(
                      item.title,
                      item.desc,
                      'Kết quả thời gian đo trên đồng hồ vẫn giữ nguyên độ chính xác vật lí'
                    )}
                    className={`min-h-[28px] px-1.5 py-1 rounded text-[11px] font-medium transition-colors whitespace-nowrap ${
                      playbackSpeed === item.speed
                        ? 'bg-amber-500 text-slate-950 font-bold shadow'
                        : 'bg-slate-900 text-slate-300 hover:bg-slate-800 border border-slate-800'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>

            {/* LỊCH SỬ CÁC PHÉP ĐO ĐỒNG HỒ MC964 (TỰ ẨN, BẤM MỚI MỞ) */}
            <div className="rounded-xl bg-slate-950/90 border border-slate-800 overflow-hidden">
              <button
                type="button"
                onClick={() => setShowHistoryList((v) => !v)}
                className="w-full px-2.5 py-1.5 text-[11px] font-semibold text-slate-300 hover:text-white flex items-center justify-between"
              >
                <span>Lịch sử đo đồng hồ ({timerHistory.length})</span>
                {showHistoryList ? (
                  <ChevronUp className="w-3.5 h-3.5 text-sky-400" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5 text-slate-500" />
                )}
              </button>
              {showHistoryList && (
                <div className="px-2 pb-2 pt-1 border-t border-slate-800 flex flex-col gap-1 max-h-32 overflow-y-auto lab-scroll">
                  {timerHistory.length === 0 ? (
                    <span className="text-[10px] text-slate-500 text-center py-1">
                      Chưa có phép đo nào.
                    </span>
                  ) : (
                    timerHistory.map((item) => (
                      <div
                        key={item.id}
                        className="px-2 py-1 rounded bg-slate-900 border border-slate-800 flex items-center justify-between gap-1 text-[10px] font-mono-tabular"
                      >
                        <div className="truncate">
                          <span className="text-sky-400 font-bold mr-1">[{item.mode}]</span>
                          <span className="text-slate-300">
                            s={item.sMeters.toFixed(2)}m →{' '}
                          </span>
                          <strong className="text-emerald-400">
                            {item.mainValueSeconds.toFixed(3)}s
                          </strong>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            setTimerHistory((prev) => prev.filter((x) => x.id !== item.id))
                          }
                          title="Xóa phép đo này"
                          className="text-slate-500 hover:text-red-400 px-1 font-bold"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Chân cột trái: Âm hiệu ứng, Âm nền phòng thí nghiệm (độc lập), Toàn màn hình, Ẩn UI */}
          <div className="pt-1.5 border-t border-slate-800 grid grid-cols-4 gap-1">
            <button
              type="button"
              onClick={toggleSound}
              aria-label="Bật tắt âm hiệu ứng"
              {...bindTooltip(
                'Âm thanh hiệu ứng thiết bị',
                'Bật hoặc tắt tiếng tách cơ khí khi đóng/ngắt công tắc, tiếng bíp đồng hồ MC964 và tiếng trụ thép chạm khay hứng.',
                soundEnabled ? 'Trạng thái: Đang BẬT' : 'Trạng thái: Đang TẮT'
              )}
              className="min-h-[30px] px-1.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1 text-[10px]"
            >
              {soundEnabled ? (
                <Volume2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              ) : (
                <VolumeX className="w-3.5 h-3.5 text-slate-500 shrink-0" />
              )}
              <span>Âm</span>
            </button>

            <button
              type="button"
              onClick={toggleAmbience}
              aria-label="Bật tắt âm thanh nền phòng thí nghiệm"
              {...bindTooltip(
                'Âm thanh nền phòng thí nghiệm (Độc lập)',
                'Mô phỏng tiếng quạt thông gió nhẹ và tiếng rung điện từ 50Hz rất nhỏ của nguồn biến áp / nam châm điện để tăng cảm giác chân thực.',
                'Có thể bật/tắt hoàn toàn độc lập với âm hiệu ứng'
              )}
              className={`min-h-[30px] px-1.5 py-1 rounded-lg border flex items-center justify-center gap-1 text-[10px] transition-colors ${
                ambienceEnabled
                  ? 'bg-emerald-950/90 hover:bg-emerald-900 text-emerald-300 border-emerald-500/60 font-semibold'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-400 border-slate-700'
              }`}
            >
              <Wind
                className={`w-3.5 h-3.5 shrink-0 ${
                  ambienceEnabled ? 'text-emerald-400 animate-pulse' : 'text-slate-500'
                }`}
              />
              <span>Nền</span>
            </button>

            <button
              type="button"
              onClick={handleToggleFullscreenOrExpand}
              aria-label="Toàn màn hình"
              {...bindTooltip(
                'Chế độ Toàn màn hình (Fullscreen)',
                'Mở rộng không gian phòng thí nghiệm 3D ra toàn bộ màn hình thiết bị để quan sát rõ hơn.',
                'Nhấn lại hoặc phím ESC để thu nhỏ'
              )}
              className="min-h-[30px] px-1.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 flex items-center justify-center gap-1 text-[10px]"
            >
              {isExpandedViewport ? (
                <Minimize2 className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              ) : (
                <Maximize2 className="w-3.5 h-3.5 text-slate-300 shrink-0" />
              )}
              <span>Full</span>
            </button>

            <button
              type="button"
              onClick={() => setIsUiHiddenZen(true)}
              {...bindTooltip(
                'Ẩn toàn bộ bảng điều khiển (Zen Mode)',
                'Tạm ẩn cả 2 cột menu trái và phải để dành 100% màn hình cho bộ thí nghiệm 3D.',
                'Phím tắt: Nhấn phím H để ẩn/hiện nhanh'
              )}
              className="min-h-[30px] px-1.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[10px] font-medium flex items-center justify-center gap-1"
            >
              <EyeOff className="w-3.5 h-3.5 text-sky-400 shrink-0" />
              <span>Ẩn</span>
            </button>
          </div>
        </aside>
      )}

      {/* =====================================================================
          2. VÙNG MÔ PHỎNG 3D TRUNG TÂM (CAO 100% TỪ ĐỈNH ĐẾN ĐÁY MÀN HÌNH,
             CÓ NÚT TRÒN CON MẮT GÓC TRÊN PHẢI ĐỂ ẨN/HIỆN CHÚ THÍCH KHI CẦN)
      ===================================================================== */}
      <main
        className={`relative flex-1 h-full min-w-0 min-h-0 overflow-hidden ${
          isCatchTrayImpactActive ? 'animate-catch-tray-impact' : ''
        }`}
      >
        <Apparatus3D
          snapshot={snapshot}
          physicsConfig={physicsConfig}
          playbackSpeed={playbackSpeed}
          autoTrackFall={autoTrackFall}
          cameraPreset={cameraPreset}
          touchMode={touchMode}
          qualityPreset={qualityPreset}
          showEquipmentLabels={showEquipmentLabels && !isUiHiddenZen}
          onToggleLabels={() => setShowEquipmentLabels((v) => !v)}
          showScientificVisuals={showScientificVisuals}
          selectedEquipment={selectedEquipment}
          onSelectEquipment={(id) => setSelectedEquipment(id)}
          onChangeGateADistance={handleChangeGateADistance}
          onChangePhotogateDistance={handleChangePhotogateDistance}
          onTogglePower={handleTogglePower}
          onResetTimer={handleResetTimer}
          onReleaseCylinder={handleReleaseCylinder}
          onAttachCylinder={handleAttachCylinder}
          onCycleTimerMode={handleCycleTimerMode}
          onSimulationTick={handleSimulationTick}
          onUpdateRenderMetrics={setRenderMetrics}
        />

        {/* Lớp phủ tự động đóng menu khi chạm ra ngoài vùng 3D trên điện thoại */}
        {!isUiHiddenZen && (isLeftPanelOpen || isRightPanelOpen) && (
          <div
            aria-hidden="true"
            onClick={() => {
              setIsLeftPanelOpen(false);
              setIsRightPanelOpen(false);
            }}
            className="md:hidden pointer-events-auto absolute inset-0 z-30 bg-black/25"
          />
        )}

        {/* Nút gọi Menu Trái (Đồng hồ MC964 & Thả rơi) khi đang ẩn */}
        {!isUiHiddenZen && !isLeftPanelOpen && (
          <button
            type="button"
            onClick={() => {
              setIsLeftPanelOpen(true);
              if (checkIsMobileViewport()) setIsRightPanelOpen(false);
            }}
            title="Mở bảng Đồng hồ MC964 & Điều khiển bên trái"
            className="pointer-events-auto absolute left-0 top-1/2 -translate-y-1/2 z-30 py-3 px-1.5 rounded-r-xl bg-slate-900/95 hover:bg-slate-800 text-sky-300 border border-l-0 border-slate-700 shadow-xl flex flex-col items-center gap-1 text-[11px] font-semibold"
          >
            <ChevronRight className="w-4 h-4" />
            <span style={{ writingMode: 'vertical-rl' }} className="tracking-wider">
              Đồng hồ MC964
            </span>
          </button>
        )}

        {/* Nút gọi Menu Phải (Chỉnh s & Bảng số liệu) khi đang ẩn */}
        {!isUiHiddenZen && !isRightPanelOpen && (
          <button
            type="button"
            onClick={() => {
              setIsRightPanelOpen(true);
              if (checkIsMobileViewport()) setIsLeftPanelOpen(false);
            }}
            title="Mở bảng chỉnh cổng quang s & Menu bên phải"
            className="pointer-events-auto absolute right-0 top-1/2 -translate-y-1/2 z-30 py-3 px-1.5 rounded-l-xl bg-slate-900/95 hover:bg-slate-800 text-amber-300 border border-r-0 border-slate-700 shadow-xl flex flex-col items-center gap-1 text-[11px] font-semibold"
          >
            <ChevronLeft className="w-4 h-4" />
            <span style={{ writingMode: 'vertical-rl' }} className="tracking-wider">
              Chỉnh s & Menu
            </span>
          </button>
        )}

        {/* Khi cả 2 menu đang tự ẩn trên điện thoại: Hiển thị thông số đồng hồ & nút Thả rơi siêu gọn ở góc trái trên để thao tác ngay trên cảnh 3D */}
        {!isUiHiddenZen && !isLeftPanelOpen && (
          <div className="pointer-events-auto absolute top-3 left-3 z-20 flex items-center gap-1.5 bg-slate-900/90 border border-slate-700 rounded-full pl-3 pr-1.5 py-1 shadow-xl">
            <span className="font-mono-tabular text-xs font-bold text-red-400">
              {!snapshot.powerOn
                ? 'OFF'
                : snapshot.phase === 'ERROR'
                ? 'Err'
                : `${formatTimerDisplay(
                    snapshot.timerDisplaySeconds,
                    physicsConfig.timerScale
                  )} s`}
            </span>
            <button
              type="button"
              onClick={handleReleaseCylinder}
              disabled={
                !snapshot.powerOn ||
                snapshot.phase === 'FALLING_TIMER_RUNNING' ||
                snapshot.phase === 'PHOTOGATE_TRIGGERED'
              }
              className="px-2.5 py-1 rounded-full bg-amber-500 hover:bg-amber-400 disabled:opacity-40 text-slate-950 font-bold text-xs flex items-center gap-1"
            >
              <Play className="w-3 h-3 fill-current" />
              <span>Thả rơi</span>
            </button>
          </div>
        )}

        {/* Nút Hiện lại giao diện khi đang ở chế độ Ẩn hết UI (Zen) */}
        {isUiHiddenZen && (
          <div className="pointer-events-none absolute top-16 right-3 z-40">
            <button
              type="button"
              onClick={() => setIsUiHiddenZen(false)}
              className="pointer-events-auto min-h-[38px] px-3 py-1.5 rounded-full bg-slate-900/95 hover:bg-slate-800 text-sky-300 border border-sky-500/60 shadow-xl flex items-center gap-1.5 text-xs font-semibold whitespace-nowrap"
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>Hiện menu</span>
            </button>
          </div>
        )}

        {/* PANEL CHI TIẾT (BẢNG SỐ LIỆU / ĐỒ THỊ / LÍ THUYẾT / CÀI ĐẶT) KHI NGƯỜI DÙNG GỌI RA */}
        {!isUiHiddenZen && activeDrawer !== 'NONE' && (
          <div className="pointer-events-auto absolute inset-y-3 left-3 right-3 z-50 max-w-4xl mx-auto rounded-xl bg-slate-900/98 border border-slate-700 shadow-2xl overflow-hidden flex flex-col">
            <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2 shrink-0">
              <div className="flex items-center gap-2 text-xs sm:text-sm font-display font-semibold text-slate-100">
                {activeDrawer === 'CONTROLS' && (
                  <>
                    <Sliders className="w-4 h-4 text-sky-400" />
                    <span>Điều khiển Thiết bị, Vị trí Cổng A / Cổng B & Góc nhìn</span>
                  </>
                )}
                {activeDrawer === 'TABLE' && (
                  <>
                    <Table2 className="w-4 h-4 text-emerald-400" />
                    <span>Bảng số liệu thực hành Bài 11 (g = 2s/t²)</span>
                  </>
                )}
                {activeDrawer === 'GRAPH' && (
                  <>
                    <LineChart className="w-4 h-4 text-sky-400" />
                    <span>Đồ thị sự phụ thuộc của quãng đường rơi s vào t²</span>
                  </>
                )}
                {activeDrawer === 'THEORY' && (
                  <>
                    <BookOpen className="w-4 h-4 text-amber-400" />
                    <span>Giải thích nguyên lí khoa học & Câu hỏi nhận xét kết quả</span>
                  </>
                )}
                {activeDrawer === 'SETTINGS_TESTS' && (
                  <>
                    <Settings className="w-4 h-4 text-purple-400" />
                    <span>Cài đặt Mô hình & Kiểm thử nghiệm thu MC964 (TEST A–Q)</span>
                  </>
                )}
              </div>

              <button
                type="button"
                onClick={() => setActiveDrawer('NONE')}
                className="min-h-[32px] px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-medium whitespace-nowrap"
              >
                Đóng bảng ×
              </button>
            </div>

            <div className="p-3 sm:p-4 overflow-y-auto lab-scroll flex-1 text-xs sm:text-sm">
              {/* TAB 1: ĐIỀU KHIỂN CHI TIẾT */}
              {activeDrawer === 'CONTROLS' && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        1. Vị trí Cổng quang điện B (Quãng đường s)
                      </span>
                      <span className="font-mono-tabular text-sm font-bold text-amber-400">
                        s = {snapshot.photogateDistanceMeters.toFixed(3)} m (
                        {(snapshot.photogateDistanceMeters * 100).toFixed(1)} cm)
                      </span>
                    </div>

                    <input
                      type="range"
                      min={0.1}
                      max={0.8}
                      step={0.005}
                      value={snapshot.photogateDistanceMeters}
                      onChange={(e) => handleChangePhotogateDistance(parseFloat(e.target.value))}
                      className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                    />

                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-xs text-slate-400 mr-1">Mức chuẩn:</span>
                      {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((presetS) => (
                        <button
                          key={presetS}
                          type="button"
                          onClick={() => handleChangePhotogateDistance(presetS)}
                          className={`min-h-[32px] px-2.5 py-1 rounded font-mono-tabular text-xs font-medium border ${
                            Math.abs(snapshot.photogateDistanceMeters - presetS) < 0.002
                              ? 'bg-sky-600 text-white border-sky-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700 hover:bg-slate-800'
                          }`}
                        >
                          {presetS.toFixed(2)} m
                        </button>
                      ))}
                    </div>

                    {/* Vị trí Cổng A khi thử nghiệm cấu hình 2 cổng quang hoặc MODE A / A+B */}
                    <div className="pt-2 border-t border-slate-800 flex flex-col gap-1.5">
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-slate-300">
                          Vị trí cảm biến Cổng A (khi đo chắn tia A / 2 cổng quang):
                        </span>
                        <span className="font-mono-tabular text-xs font-bold text-red-400">
                          s_A = {snapshot.gateADistanceMeters.toFixed(3)} m
                        </span>
                      </div>
                      <input
                        type="range"
                        min={0.05}
                        max={0.75}
                        step={0.01}
                        value={snapshot.gateADistanceMeters}
                        onChange={(e) => handleChangeGateADistance(parseFloat(e.target.value))}
                        className="w-full accent-red-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                      />
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-slate-200">
                        2. Căn chỉnh phương dây dọi & Kết nối Cổng A / B
                      </span>
                      <span
                        className={`font-mono-tabular text-xs font-semibold ${
                          isPhotogateBeamAligned(snapshot.photogateLateralOffsetMm)
                            ? 'text-emerald-400'
                            : 'text-red-400'
                        }`}
                      >
                        Lệch ngang: {snapshot.photogateLateralOffsetMm.toFixed(1)} mm
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={-15}
                        max={15}
                        step={0.5}
                        value={snapshot.photogateLateralOffsetMm}
                        onChange={(e) => handleChangeLateralOffset(parseFloat(e.target.value))}
                        className="flex-1 accent-emerald-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                      />
                      <button
                        type="button"
                        onClick={() => handleChangeLateralOffset(0)}
                        className="min-h-[32px] px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-xs text-emerald-300 border border-slate-700 whitespace-nowrap"
                      >
                        Căn thẳng (0 mm)
                      </button>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        onClick={handleTogglePortAConnected}
                        className={`min-h-[32px] px-2.5 py-1 rounded text-xs font-medium border ${
                          snapshot.portAConnected
                            ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60'
                            : 'bg-red-950/80 text-red-300 border-red-600/60'
                        }`}
                      >
                        {snapshot.portAConnected
                          ? 'Cổng A (Trên): Đang cắm'
                          : 'Cổng A (Trên): Đã rút'}
                      </button>

                      <button
                        type="button"
                        onClick={handleTogglePhotogateConnected}
                        className={`min-h-[32px] px-2.5 py-1 rounded text-xs font-medium border ${
                          snapshot.portBConnected
                            ? 'bg-emerald-950/80 text-emerald-300 border-emerald-600/60'
                            : 'bg-red-950/80 text-red-300 border-red-600/60'
                        }`}
                      >
                        {snapshot.portBConnected
                          ? 'Cổng B (Dưới): Đang cắm'
                          : 'Cổng B (Dưới): Đã rút'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: BẢNG SỐ LIỆU */}
              {activeDrawer === 'TABLE' && (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-3 text-xs font-mono-tabular">
                      <span className="text-slate-300">
                        Công thức:{' '}
                        <strong className="text-sky-300">
                          {physicsConfig.gCalculationMethod === 'FROM_MEAN_T'
                            ? 'g = 2s / t_tb²'
                            : 'g_tb = (1/n)·∑(2s / t_i²)'}
                        </strong>
                      </span>
                      <span aria-hidden="true" className="text-slate-600">·</span>
                      <span className="text-slate-200">
                        Gia tốc trung bình:{' '}
                        {tableComputed.summary.meanG !== null ? (
                          <strong className="text-emerald-400 text-sm">
                            g = {tableComputed.summary.meanG.toFixed(3)} ±{' '}
                            {(tableComputed.summary.deltaG ?? 0).toFixed(3)} m/s²
                          </strong>
                        ) : (
                          <span className="text-amber-300">Chưa có số liệu ghi nhận</span>
                        )}
                      </span>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleExportCsv}
                        disabled={tableComputed.summary.totalTrialsCount === 0}
                        className="min-h-[34px] px-3 py-1 rounded-md bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-100 border border-slate-700 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                      >
                        <Download className="w-3.5 h-3.5 text-sky-400" />
                        <span>Xuất CSV</span>
                      </button>

                      {!confirmClearTable ? (
                        <button
                          type="button"
                          onClick={() => setConfirmClearTable(true)}
                          disabled={tableComputed.summary.totalTrialsCount === 0}
                          className="min-h-[34px] px-3 py-1 rounded-md bg-red-950/70 hover:bg-red-900/80 disabled:opacity-40 text-red-200 border border-red-700/60 text-xs font-medium flex items-center gap-1.5 whitespace-nowrap"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa bảng</span>
                        </button>
                      ) : (
                        <div className="flex items-center gap-1.5 bg-red-950 px-2.5 py-1 rounded-md border border-red-500">
                          <span className="text-xs text-red-200">Xóa hết?</span>
                          <button
                            type="button"
                            onClick={() => {
                              setRows(INITIAL_DISTANCE_ROWS);
                              setConfirmClearTable(false);
                              setLastRecordedMessage('Đã xóa toàn bộ bảng số liệu.');
                            }}
                            className="px-2 py-0.5 rounded bg-red-600 text-white text-xs font-semibold"
                          >
                            Đồng ý
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmClearTable(false)}
                            className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-xs"
                          >
                            Hủy
                          </button>
                        </div>
                      )}
                    </div>
                  </div>

                  {lastRecordedMessage && (
                    <div className="px-3 py-1.5 rounded bg-emerald-950/60 border border-emerald-600/50 text-emerald-200 text-xs">
                      {lastRecordedMessage}
                    </div>
                  )}

                  <div className="w-full overflow-x-auto lab-scroll rounded-lg border border-slate-800">
                    <table className="w-full text-left border-collapse font-mono-tabular text-xs">
                      <thead>
                        <tr className="bg-slate-950 text-slate-300 border-b border-slate-800">
                          <th className="py-2 px-3 font-semibold whitespace-nowrap">Mức</th>
                          <th className="py-2 px-3 font-semibold whitespace-nowrap">s (m)</th>
                          <th className="py-2 px-2.5 font-semibold whitespace-nowrap">Lần 1 (s)</th>
                          <th className="py-2 px-2.5 font-semibold whitespace-nowrap">Lần 2 (s)</th>
                          <th className="py-2 px-2.5 font-semibold whitespace-nowrap">Lần 3 (s)</th>
                          <th className="py-2 px-2.5 font-semibold whitespace-nowrap">Lần 4 (s)</th>
                          <th className="py-2 px-2.5 font-semibold whitespace-nowrap">Lần 5 (s)</th>
                          <th className="py-2 px-3 font-semibold text-sky-300 whitespace-nowrap">
                            t_tb (s)
                          </th>
                          <th className="py-2 px-3 font-semibold text-amber-300 whitespace-nowrap">
                            t_tb² (s²)
                          </th>
                          <th className="py-2 px-3 font-semibold text-emerald-400 whitespace-nowrap">
                            g = 2s/t² (m/s²)
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 bg-slate-900/50">
                        {rows.map((r, rIdx) => {
                          const st = tableComputed.rowStats[rIdx];
                          const isCurrentS =
                            Math.abs(r.distanceMeters - snapshot.photogateDistanceMeters) < 0.0015;
                          return (
                            <tr
                              key={r.id}
                              className={isCurrentS ? 'bg-sky-950/35' : 'hover:bg-slate-800/40'}
                            >
                              <td className="py-2 px-3 font-bold text-slate-200 whitespace-nowrap">
                                <button
                                  type="button"
                                  onClick={() => handleChangePhotogateDistance(r.distanceMeters)}
                                  className="px-2 py-0.5 rounded bg-slate-800 hover:bg-sky-700 text-sky-300 hover:text-white transition-colors"
                                >
                                  {r.label}
                                </button>
                              </td>
                              <td className="py-2 px-3 font-semibold text-slate-100 whitespace-nowrap">
                                {r.distanceMeters.toFixed(3)}
                              </td>
                              {r.trials.map((tVal, tIdx) => (
                                <td
                                  key={tIdx}
                                  className="py-2 px-2.5 text-slate-200 whitespace-nowrap"
                                >
                                  {tVal !== null ? (
                                    <div className="inline-flex items-center gap-1 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800">
                                      <span>{tVal.toFixed(3)}</span>
                                      <button
                                        type="button"
                                        onClick={() =>
                                          setRows((prev) => deleteSingleTrial(prev, rIdx, tIdx))
                                        }
                                        className="text-slate-500 hover:text-red-400 ml-1"
                                      >
                                        ×
                                      </button>
                                    </div>
                                  ) : (
                                    <span className="text-slate-600">—</span>
                                  )}
                                </td>
                              ))}
                              <td className="py-2 px-3 font-semibold text-sky-300 whitespace-nowrap">
                                {st ? st.meanTime.toFixed(4) : '—'}
                              </td>
                              <td className="py-2 px-3 font-semibold text-amber-300 whitespace-nowrap">
                                {st ? st.meanTimeSquared.toFixed(5) : '—'}
                              </td>
                              <td className="py-2 px-3 font-bold text-emerald-400 whitespace-nowrap">
                                {st ? `${st.selectedG.toFixed(3)} ± ${st.deltaG.toFixed(3)}` : '—'}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: ĐỒ THỊ */}
              {activeDrawer === 'GRAPH' && (
                <RegressionGraphSvsT2
                  points={tableComputed.graphPoints}
                  regression={tableComputed.summary.regression}
                  showTrendline={showTrendline}
                  onToggleTrendline={() => setShowTrendline((v) => !v)}
                  forceOrigin={forceOriginRegression}
                  onToggleForceOrigin={() => setForceOriginRegression((v) => !v)}
                  trueGravity={physicsConfig.gravity}
                />
              )}

              {/* TAB 4: LÍ THUYẾT & CÂU HỎI */}
              {activeDrawer === 'THEORY' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col gap-2.5">
                    <h3 className="font-display font-semibold text-slate-100 text-sm">
                      Nguyên lí đo thời gian bằng đồng hồ MC964 (SGK Vật lí 10)
                    </h3>
                    <p className="text-xs text-slate-300 leading-relaxed">
                      Trong cấu hình thí nghiệm rơi tự do Bài 11: <strong>Kênh A</strong> nhận tín hiệu từ công tắc điều khiển nam châm điện (xác định thời điểm thả vật <span className="font-mono-tabular">t = 0</span>), <strong>Kênh B</strong> nhận tín hiệu từ cổng quang điện phía dưới (xác định thời điểm vật đi qua cổng). Khi chọn <strong>MODE A ↔ B</strong>, đồng hồ đo chính xác thời gian rơi <span className="font-mono-tabular text-emerald-300">t</span> trên quãng đường <span className="font-mono-tabular text-amber-300">s</span>:
                    </p>
                    <div className="p-2 rounded bg-slate-900 border border-slate-800 font-mono-tabular text-center text-sm text-sky-300">
                      s = ½ · g · t²   ⇒   g = 2s / t²
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col gap-2">
                    <h3 className="font-display font-semibold text-slate-100 text-sm">
                      Câu hỏi nhận xét kết quả sau thực hành (6 câu)
                    </h3>
                    <div className="flex flex-col gap-1.5">
                      {POST_LAB_QUESTIONS.map((q) => {
                        const isOpen = openQuestionId === q.id;
                        return (
                          <div
                            key={q.id}
                            className="rounded-md bg-slate-900/90 border border-slate-800 overflow-hidden"
                          >
                            <button
                              type="button"
                              onClick={() => setOpenQuestionId(isOpen ? null : q.id)}
                              className="w-full px-3 py-1.5 text-left text-xs font-semibold text-slate-200 hover:text-sky-300 flex items-center justify-between gap-2"
                            >
                              <span>{q.question}</span>
                              {isOpen ? (
                                <ChevronUp className="w-4 h-4 shrink-0 text-sky-400" />
                              ) : (
                                <ChevronDown className="w-4 h-4 shrink-0 text-slate-500" />
                              )}
                            </button>
                            {isOpen && (
                              <div className="px-3 pb-2 pt-1 border-t border-slate-800/80 text-xs flex flex-col gap-1">
                                <p className="text-amber-300/90">Gợi ý: {q.hint}</p>
                                <p className="text-slate-300 leading-relaxed">
                                  <strong className="text-emerald-400">Giải thích: </strong>
                                  {q.standardAnswer}
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 5: CÀI ĐẶT & KIỂM THỬ A–Q */}
              {activeDrawer === 'SETTINGS_TESTS' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col gap-2.5">
                    <h3 className="font-display font-semibold text-slate-100 text-sm">
                      Cấu hình Mô hình Vật lí, Đồng hồ MC964 & Hỗ trợ Thao tác
                    </h3>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-slate-300">Chế độ mô phỏng:</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => updatePhysicsConfig({ mode: 'IDEAL' })}
                          className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium border ${
                            physicsConfig.mode === 'IDEAL'
                              ? 'bg-sky-600 text-white border-sky-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700'
                          }`}
                        >
                          Lí tưởng (Không nhiễu)
                        </button>
                        <button
                          type="button"
                          onClick={() => updatePhysicsConfig({ mode: 'EXPERIMENTAL' })}
                          className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium border ${
                            physicsConfig.mode === 'EXPERIMENTAL'
                              ? 'bg-amber-600 text-white border-amber-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700'
                          }`}
                        >
                          Thực nghiệm có sai số
                        </button>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-slate-300">Thao tác nút "Nhả trụ thép":</span>
                      <button
                        type="button"
                        onClick={() => setAutoPrepareOnDrop((v) => !v)}
                        className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium border ${
                          autoPrepareOnDrop
                            ? 'bg-emerald-600 text-white border-emerald-400'
                            : 'bg-slate-900 text-slate-300 border-slate-700'
                        }`}
                      >
                        {autoPrepareOnDrop
                          ? 'Thông minh: Tự đặt lại trụ & Reset khi nhấn Nhả'
                          : 'Nghiêm ngặt: Bắt buộc bấm Đặt lại & Reset thủ công'}
                      </button>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <span className="text-xs text-slate-300">Gia tốc môi trường g:</span>
                      <div className="flex items-center gap-2 font-mono-tabular">
                        <input
                          type="range"
                          min={9.75}
                          max={9.85}
                          step={0.01}
                          value={physicsConfig.gravity}
                          onChange={(e) =>
                            updatePhysicsConfig({ gravity: parseFloat(e.target.value) })
                          }
                          className="w-24 accent-sky-500"
                        />
                        <span className="text-xs font-bold text-sky-300">
                          {physicsConfig.gravity.toFixed(2)} m/s²
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-xs text-slate-300">Cấu hình kênh A & B:</span>
                      <div className="flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={() => handleChangeWiringVariant('SGK_KNTT')}
                          className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium border ${
                            snapshot.wiringVariant === 'SGK_KNTT'
                              ? 'bg-sky-600 text-white border-sky-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700'
                          }`}
                        >
                          Bài 11 SGK (A: Thả vật, B: Cổng quang)
                        </button>
                        <button
                          type="button"
                          onClick={() => handleChangeWiringVariant('C3_MC964')}
                          className={`min-h-[34px] px-2.5 py-1 rounded text-xs font-medium border ${
                            snapshot.wiringVariant === 'C3_MC964'
                              ? 'bg-sky-600 text-white border-sky-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700'
                          }`}
                        >
                          2 Cổng quang độc lập (A & B)
                        </button>
                      </div>
                    </div>

                    {/* Điều khiển độc lập Âm thanh nền phòng thí nghiệm (Ambience) */}
                    <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-xs text-slate-300 flex items-center gap-1.5">
                          <Wind className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Âm thanh nền phòng thí nghiệm (Quạt nhẹ & Nhiễu điện 50Hz):</span>
                        </span>
                        <button
                          type="button"
                          onClick={toggleAmbience}
                          className={`min-h-[32px] px-3 py-1 rounded text-xs font-semibold border ${
                            ambienceEnabled
                              ? 'bg-emerald-600 text-white border-emerald-400'
                              : 'bg-slate-900 text-slate-300 border-slate-700'
                          }`}
                        >
                          {ambienceEnabled ? 'Đang BẬT' : 'Đang TẮT'}
                        </button>
                      </div>

                      <div className="flex items-center justify-between gap-3">
                        <span className="text-[11px] text-slate-400">
                          Mức âm lượng nền (êm dịu, độc lập với tiếng bíp):
                        </span>
                        <div className="flex items-center gap-2 font-mono-tabular">
                          <input
                            type="range"
                            min={0.1}
                            max={1.0}
                            step={0.05}
                            value={ambienceVolume}
                            onChange={(e) => setAmbienceVolume(parseFloat(e.target.value))}
                            className="w-24 accent-emerald-500"
                          />
                          <span className="text-xs font-bold text-emerald-300 w-10 text-right">
                            {Math.round(ambienceVolume * 100)}%
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-3 rounded-lg bg-slate-950/90 border border-slate-800 flex flex-col gap-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <h3 className="font-display font-semibold text-slate-100 text-sm">
                          Kiểm Thử Nghiệm Thu Tự Động (TEST A → TEST Q)
                        </h3>
                        <p className="text-[11px] text-slate-400">
                          Kiểm chứng 5 chế độ đồng hồ MC964 (A, B, A+B, A↔B, T) & vật lí
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRunAcceptanceTests}
                        className="min-h-[36px] px-3 py-1 rounded-md bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap shadow"
                      >
                        <FlaskConical className="w-3.5 h-3.5" />
                        <span>Chạy 17 Test (A–Q)</span>
                      </button>
                    </div>

                    {testResults ? (
                      <div className="flex flex-col gap-1.5 max-h-[210px] overflow-y-auto lab-scroll pr-1">
                        {testResults.map((tr) => (
                          <div
                            key={tr.id}
                            className="p-2 rounded bg-slate-900/90 border border-slate-800 flex items-start gap-2 text-xs"
                          >
                            <CheckCircle2
                              className={`w-4 h-4 shrink-0 mt-0.5 ${
                                tr.passed ? 'text-emerald-400' : 'text-red-400'
                              }`}
                            />
                            <div className="flex-1 min-w-0">
                              <div className="font-semibold text-slate-100">
                                {tr.id}: {tr.title}
                              </div>
                              <div className="text-slate-400 font-mono-tabular text-[11px] break-words">
                                {tr.details}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="p-4 rounded bg-slate-900/60 border border-slate-800/80 text-center text-xs text-slate-400">
                        Nhấn <strong className="text-emerald-400">Chạy 17 Test (A–Q)</strong> để kiểm chứng đầy đủ 5 chế độ đồng hồ MC964 và mô hình rơi tự do.
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* =====================================================================
          3. CỘT DỌC BÊN PHẢI: CHỈNH NHANH CỔNG QUANG B (s), GÓC NHÌN & CÁC BẢNG MENU
             (Trên điện thoại tự động ẩn mặc định, bấm nút cạnh phải mới mở ra)
      ===================================================================== */}
      {!isUiHiddenZen && isRightPanelOpen && (
        <aside
          aria-label="Bảng chỉnh cổng quang và menu bên phải"
          className="fixed md:static inset-y-0 right-0 z-40 shrink-0 h-full w-48 sm:w-52 bg-slate-900/98 md:bg-slate-900/95 border-l border-slate-800 safe-top safe-bottom safe-right p-2.5 flex flex-col justify-between gap-2.5 overflow-y-auto lab-scroll shadow-2xl"
        >
          <div className="flex flex-col gap-2.5">
            {/* Đầu cột phải: Tiêu đề + Nút thu gọn */}
            <div className="flex items-center justify-between gap-1 pb-2 border-b border-slate-800">
              <button
                type="button"
                onClick={() => setIsRightPanelOpen(false)}
                title="Ẩn cột công cụ bên phải"
                className="w-7 h-7 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 flex items-center justify-center shrink-0"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
              <span className="font-display text-xs font-bold text-amber-300 truncate">
                Cổng quang A/B & Menu
              </span>
            </div>

            {/* KHỐI 1A: CHỈNH NHANH VỊ TRÍ CỔNG QUANG ĐIỆN A (sA) KHI CHỌN MODE A, A+B, A↔B, T */}
            {(snapshot.c3Mode === 'A' ||
              snapshot.c3Mode === 'A+B' ||
              snapshot.c3Mode === 'A<->B' ||
              snapshot.c3Mode === 'T') && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-red-900/60 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-red-300 flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-red-600 text-white font-mono-tabular text-[10px] font-bold flex items-center justify-center">
                      A
                    </span>
                    <span>Cổng A (sA):</span>
                  </span>
                  <span className="font-mono-tabular text-xs font-bold text-red-400">
                    {(snapshot.gateADistanceMeters * 100).toFixed(1)} cm
                  </span>
                </div>

                <input
                  type="range"
                  min={0.05}
                  max={0.5}
                  step={0.005}
                  value={snapshot.gateADistanceMeters}
                  onChange={(e) => handleChangeGateADistance(parseFloat(e.target.value))}
                  aria-label="Kéo chỉnh vị trí cổng quang điện A"
                  {...bindTooltip(
                    'Thanh trượt vị trí Cổng quang điện A (sA)',
                    'Dịch chuyển Cổng quang điện A dọc theo thước thẳng từ 5 cm đến 50 cm tính từ đáy nam châm điện.',
                    'Bạn cũng có thể nắm kéo trực tiếp Cổng A màu đỏ trên mô hình 3D',
                    'left'
                  )}
                  className="w-full accent-red-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />

                <div className="grid grid-cols-3 gap-1">
                  {[0.05, 0.1, 0.15, 0.2, 0.25, 0.3].map((presetSA) => (
                    <button
                      key={presetSA}
                      type="button"
                      onClick={() => handleChangeGateADistance(presetSA)}
                      {...bindTooltip(
                        `Đặt Cổng quang A tại sA = ${(presetSA * 100).toFixed(0)} cm`,
                        `Di chuyển nhanh Cổng quang điện A tới vạch ${(presetSA * 100).toFixed(0)} cm (${presetSA.toFixed(2)} m) trên thước đo.`,
                        undefined,
                        'left'
                      )}
                      className={`min-h-[24px] py-0.5 rounded font-mono-tabular text-[10px] font-medium border ${
                        Math.abs(snapshot.gateADistanceMeters - presetSA) < 0.002
                          ? 'bg-red-600 text-white border-red-300 font-bold'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {(presetSA * 100).toFixed(0)}cm
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* KHỐI 1B: CHỈNH NHANH VỊ TRÍ CỔNG QUANG ĐIỆN B (sB) KHI CHỌN MODE B, A+B, A↔B */}
            {(snapshot.c3Mode === 'B' ||
              snapshot.c3Mode === 'A+B' ||
              snapshot.c3Mode === 'A<->B') && (
              <div className="p-2.5 rounded-xl bg-slate-950 border border-sky-900/60 flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-semibold text-sky-300 flex items-center gap-1">
                    <span className="w-4 h-4 rounded-full bg-sky-600 text-white font-mono-tabular text-[10px] font-bold flex items-center justify-center">
                      B
                    </span>
                    <span>Cổng B (s):</span>
                  </span>
                  <span className="font-mono-tabular text-xs font-bold text-amber-400">
                    {(snapshot.photogateDistanceMeters * 100).toFixed(1)} cm
                  </span>
                </div>

                <input
                  type="range"
                  min={0.1}
                  max={0.8}
                  step={0.005}
                  value={snapshot.photogateDistanceMeters}
                  onChange={(e) => handleChangePhotogateDistance(parseFloat(e.target.value))}
                  aria-label="Kéo chỉnh quãng đường rơi s tại cổng B"
                  {...bindTooltip(
                    'Thanh trượt quãng đường rơi s (Cổng quang B)',
                    'Thay đổi vị trí Cổng quang điện B từ 10 cm đến 80 cm để khảo sát sự phụ thuộc của thời gian rơi t vào quãng đường s.',
                    'Mẹo: Đo ở nhiều mốc s (20, 30, 40, 50, 60 cm) để vẽ đồ thị s – t²',
                    'left'
                  )}
                  className="w-full accent-amber-500 h-2 bg-slate-800 rounded-lg cursor-pointer"
                />

                <div className="grid grid-cols-3 gap-1">
                  {[0.2, 0.3, 0.4, 0.5, 0.6, 0.7].map((presetS) => (
                    <button
                      key={presetS}
                      type="button"
                      onClick={() => handleChangePhotogateDistance(presetS)}
                      {...bindTooltip(
                        `Chọn nhanh quãng đường s = ${(presetS * 100).toFixed(0)} cm`,
                        `Đặt Cổng quang điện B chính xác tại mốc s = ${presetS.toFixed(2)} m (${(presetS * 100).toFixed(0)} cm) theo quy trình SGK Vật lí 10.`,
                        `Thời gian rơi lí thuyết: t ≈ ${Math.sqrt((2 * presetS) / physicsConfig.trueGravity).toFixed(3)} s`,
                        'left'
                      )}
                      className={`min-h-[26px] py-0.5 rounded font-mono-tabular text-[11px] font-medium border ${
                        Math.abs(snapshot.photogateDistanceMeters - presetS) < 0.002
                          ? 'bg-amber-500 text-slate-950 border-amber-300 font-bold'
                          : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                      }`}
                    >
                      {(presetS * 100).toFixed(0)}cm
                    </button>
                  ))}
                </div>

                <div className="grid grid-cols-4 gap-1 pt-1 border-t border-slate-800/80">
                  <button
                    type="button"
                    onClick={() =>
                      handleChangePhotogateDistance(snapshot.photogateDistanceMeters - 0.01)
                    }
                    {...bindTooltip(
                      'Dịch Cổng B lên 1 cm (-1 cm)',
                      'Giảm quãng đường rơi s đi 10 mm (0,010 m).',
                      undefined,
                      'left'
                    )}
                    className="py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono-tabular text-[10px] border border-slate-800"
                  >
                    -1cm
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleChangePhotogateDistance(snapshot.photogateDistanceMeters - 0.001)
                    }
                    {...bindTooltip(
                      'Vi chỉnh Cổng B lên 1 mm (-1 mm)',
                      'Tinh chỉnh vị trí Cổng quang B từng milimet (0,001 m) đúng độ chia nhỏ nhất của thước.',
                      undefined,
                      'left'
                    )}
                    className="py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono-tabular text-[10px] border border-slate-800"
                  >
                    -1mm
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleChangePhotogateDistance(snapshot.photogateDistanceMeters + 0.001)
                    }
                    {...bindTooltip(
                      'Vi chỉnh Cổng B xuống 1 mm (+1 mm)',
                      'Tinh chỉnh tăng quãng đường rơi s thêm 1 milimet (0,001 m).',
                      undefined,
                      'left'
                    )}
                    className="py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono-tabular text-[10px] border border-slate-800"
                  >
                    +1mm
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      handleChangePhotogateDistance(snapshot.photogateDistanceMeters + 0.01)
                    }
                    {...bindTooltip(
                      'Dịch Cổng B xuống 1 cm (+1 cm)',
                      'Tăng quãng đường rơi s thêm 10 mm (0,010 m).',
                      undefined,
                      'left'
                    )}
                    className="py-1 rounded bg-slate-900 hover:bg-slate-800 text-slate-300 font-mono-tabular text-[10px] border border-slate-800"
                  >
                    +1cm
                  </button>
                </div>
              </div>
            )}

            {/* KHỐI 2: MENU CÁC BẢNG DỮ LIỆU & ĐỒ THỊ (XẾP DỌC) */}
            <div className="flex flex-col gap-1.5">
              <span className="text-[11px] font-semibold text-slate-400 px-0.5">
                Bảng dữ liệu & Công cụ:
              </span>
              {(
                [
                  {
                    id: 'TABLE',
                    label: `Bảng số liệu (${tableComputed.summary.totalTrialsCount})`,
                    icon: Table2,
                    tipTitle: 'Bảng số liệu thực nghiệm (Bảng 11.1 SGK)',
                    tipDesc:
                      'Xem bảng tổng hợp các lần đo t1, t2, t3..., giá trị trung bình t̄, bình phương t̄², gia tốc g = 2s/t̄² và sai số tuyệt đối Δg.',
                  },
                  {
                    id: 'GRAPH',
                    label: 'Đồ thị s – t²',
                    icon: LineChart,
                    tipTitle: 'Đồ thị phụ thuộc s theo t² & Hồi quy tuyến tính',
                    tipDesc:
                      'Biểu diễn các điểm thực nghiệm trên hệ trục (t², s). Hệ số góc của đường thẳng nối gốc tọa độ cho biết g ≈ 2·k.',
                  },
                  {
                    id: 'CONTROLS',
                    label: 'Chỉnh cổng A / B',
                    icon: Sliders,
                    tipTitle: 'Bảng điều khiển chi tiết Cổng quang A, B & Độ lệch ngang',
                    tipDesc:
                      'Tinh chỉnh chính xác tọa độ sA, sB và kiểm nghiệm hiện tượng trụ thép rơi lệch tâm chùm tia hồng ngoại.',
                  },
                  {
                    id: 'THEORY',
                    label: 'Lí thuyết & Câu hỏi',
                    icon: HelpCircle,
                    tipTitle: 'Cơ sở lí thuyết, Quy trình thí nghiệm & Câu hỏi báo cáo',
                    tipDesc:
                      'Ôn tập công thức s = ½gt², quy trình 5 bước chuẩn SGK Vật lí 10 và trả lời các câu hỏi thảo luận.',
                  },
                  {
                    id: 'SETTINGS_TESTS',
                    label: 'Cài đặt & Test A–Q',
                    icon: Settings,
                    tipTitle: 'Cài đặt mô hình vật lí & Chạy 17 bài kiểm thử (Test A–Q)',
                    tipDesc:
                      'Tùy chỉnh gia tốc g chuẩn theo vĩ độ, lực cản không khí, nhiễu cảm biến và chạy bộ kiểm thử tự động 5 chế độ đồng hồ MC964.',
                  },
                ] as {
                  id: ActiveDrawerTab;
                  label: string;
                  icon: React.ComponentType<{ className?: string }>;
                  tipTitle: string;
                  tipDesc: string;
                }[]
              ).map((tab) => {
                const IconComp = tab.icon;
                const isActive = activeDrawer === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      setActiveDrawer(isActive ? 'NONE' : tab.id);
                      if (checkIsMobileViewport()) setIsRightPanelOpen(false);
                    }}
                    {...bindTooltip(tab.tipTitle, tab.tipDesc, undefined, 'left')}
                    className={`w-full min-h-[36px] px-2.5 py-1.5 rounded-lg text-xs font-medium flex items-center gap-2 border transition-colors ${
                      isActive
                        ? 'bg-sky-600 text-white border-sky-400 shadow'
                        : 'bg-slate-950/90 hover:bg-slate-800 text-slate-200 border-slate-800'
                    }`}
                  >
                    <IconComp className="w-3.5 h-3.5 shrink-0 text-sky-400" />
                    <span className="truncate">{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {/* KHỐI 3: CHỌN NHANH GÓC NHÌN CAMERA (XẾP DỌC) */}
            <div className="p-2 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col gap-1.5">
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-300">
                <Camera className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span>Góc nhìn 3D:</span>
              </div>
              <div className="grid grid-cols-2 gap-1">
                {(
                  [
                    {
                      id: 'OVERVIEW',
                      label: 'Trọn bộ',
                      tipTitle: 'Góc nhìn Trọn bộ thí nghiệm',
                      tipDesc:
                        'Quan sát toàn cảnh giá đỡ, nam châm điện, cổng quang A/B, công tắc kép và đồng hồ hiện số MC964.',
                    },
                    {
                      id: 'MEASUREMENT_ANGLE',
                      label: 'Đọc thước',
                      tipTitle: 'Góc nhìn trực diện Đọc thước (Chống sai số thị sai)',
                      tipDesc:
                        'Đặt mắt vuông góc với mặt phẳng thước chia milimet để đọc chính xác vị trí cổng quang điện.',
                    },
                    {
                      id: 'CLOSEUP_PHOTOGATE',
                      label: 'Cổng B',
                      tipTitle: 'Góc nhìn cận cảnh Cổng quang điện B',
                      tipDesc:
                        'Quan sát sát chùm tia hồng ngoại và kim chỉ vạch thước của Cổng quang điện B phía dưới.',
                    },
                    {
                      id: 'CLOSEUP_MAGNET',
                      label: 'Cổng A',
                      tipTitle: 'Góc nhìn cận cảnh Nam châm điện & Cổng A',
                      tipDesc:
                        'Quan sát chi tiết trụ thép gắn tại nam châm điện (mốc 0) và Cổng quang điện A phía trên.',
                    },
                    {
                      id: 'CLOSEUP_TIMER',
                      label: 'Đồng hồ',
                      tipTitle: 'Góc nhìn cận cảnh Đồng hồ hiện số MC964',
                      tipDesc:
                        'Quan sát rõ màn hình LED 7 đoạn, các nút POWER / RESET / MODE và cụm phích cắm dây dẫn Cổng A, B.',
                    },
                    {
                      id: 'CLOSEUP_SWITCH',
                      label: 'Công tắc',
                      tipTitle: 'Góc nhìn cận cảnh Công tắc kép',
                      tipDesc:
                        'Quan sát cơ cấu cần gạt công tắc kép điều khiển ngắt điện nam châm và phát xung kích hoạt t = 0.',
                    },
                  ] as {
                    id: CameraPresetId;
                    label: string;
                    tipTitle: string;
                    tipDesc: string;
                  }[]
                ).map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    onClick={() => {
                      setCameraPreset(preset.id);
                      if (checkIsMobileViewport()) setIsRightPanelOpen(false);
                    }}
                    {...bindTooltip(preset.tipTitle, preset.tipDesc, undefined, 'left')}
                    className={`min-h-[28px] px-1.5 py-1 rounded text-[11px] font-medium border truncate ${
                      cameraPreset === preset.id
                        ? 'bg-sky-600 text-white border-sky-400 font-semibold'
                        : 'bg-slate-900 text-slate-300 border-slate-800 hover:bg-slate-800'
                    }`}
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chân cột phải: Bật/tắt Vệt hoạt nghiệm */}
          <div className="pt-2 border-t border-slate-800">
            <button
              type="button"
              onClick={() => setShowScientificVisuals((v) => !v)}
              {...bindTooltip(
                'Hiệu ứng Vệt hoạt nghiệm (Stroboscopic) & Véc-tơ vận tốc',
                'Hiển thị các bóng mờ vị trí trụ thép sau những khoảng thời gian bằng nhau (Δt = 0,025 s) và mũi tên véc-tơ vận tốc v tăng dần đều khi rơi.',
                'Giúp trực quan hóa tính chất nhanh dần đều của chuyển động rơi tự do',
                'left'
              )}
              className={`w-full min-h-[32px] px-2 py-1 rounded-lg text-[11px] font-medium border flex items-center justify-center ${
                showScientificVisuals
                  ? 'bg-amber-600/20 text-amber-300 border-amber-500/50'
                  : 'bg-slate-950 text-slate-400 border-slate-800'
              }`}
            >
              {showScientificVisuals ? 'Vệt rơi & Tia quang: BẬT' : 'Vệt rơi & Tia quang: TẮT'}
            </button>
          </div>
        </aside>
      )}
    </div>
  );
}
