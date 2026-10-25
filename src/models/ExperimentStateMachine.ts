/**
 * ExperimentStateMachine.ts
 * Máy trạng thái quản lí thiết bị thí nghiệm Bài 11: Đo gia tốc rơi tự do
 * và Mô-đun Đồng hồ đo thời gian hiện số MC964 (đầy đủ 5 chế độ: A, B, A+B, A<->B, T)
 */

import {
  PhysicsConfig,
  DEFAULT_PHYSICS_CONFIG,
  computeIdealFallTime,
  computeMeasuredFallTime,
  computeKinematicsAtTime,
  isPhotogateBeamAligned,
  isCylinderBlockingBeam,
  quantizeTimerValue,
} from './PhysicsModel';

export type ExperimentPhase =
  | 'POWER_OFF'
  | 'SETUP'
  | 'BALL_HELD'
  | 'READY_TO_DROP'
  | 'FALLING_TIMER_RUNNING'
  | 'PHOTOGATE_TRIGGERED'
  | 'MEASUREMENT_COMPLETE'
  | 'ERROR';

export type ErrorCode =
  | 'NONE'
  | 'ERR_NO_POWER'
  | 'ERR_NOT_HELD'
  | 'ERR_NOT_RESET'
  | 'ERR_PHOTOGATE_UNPLUGGED'
  | 'ERR_PORT_A_UNPLUGGED'
  | 'ERR_PORT_B_UNPLUGGED'
  | 'ERR_PHOTOGATE_MISALIGNED'
  | 'ERR_INVALID_SIGNAL_ORDER'
  | 'ERR_INCOMPLETE_PERIOD_EVENTS'
  | 'ERR_ABORTED_BY_RESET';

/**
 * Hai cấu hình kết nối đồng hồ đo thời gian hiện số MC964:
 * - 'SGK_KNTT': Cấu hình thí nghiệm rơi tự do Bài 11 theo SGK Vật lí 10 – Kết nối tri thức
 *   (Kênh A: Tín hiệu thả vật từ công tắc nam châm điện; Kênh B: Cổng quang điện phía dưới)
 * - 'C3_MC964': Cấu hình hai cổng quang điện độc lập A và B trên giá đỡ
 *   (Kênh A: Cổng quang điện A ở trên; Kênh B: Cổng quang điện B ở dưới)
 */
export type WiringVariant = 'SGK_KNTT' | 'C3_MC964';

export type C3TimerMode = 'A' | 'B' | 'A+B' | 'A<->B' | 'T';

/**
 * 5 trạng thái chuẩn của từng cổng tín hiệu A và B trên đồng hồ MC964:
 * - DISCONNECTED: Chưa kết nối (rút dây)
 * - CONNECTED: Đã kết nối (sẵn sàng tham gia phép đo)
 * - STANDBY: Chờ tín hiệu (cổng không tham gia phép đo ở MODE hiện tại)
 * - ACTIVE: Đang kích hoạt (đang nhận xung / vật đang chắn tia / đang đếm)
 * - RECEIVED: Đã nhận tín hiệu (đã hoàn tất sự kiện tại cổng)
 */
export type PortSignalState =
  | 'DISCONNECTED'
  | 'CONNECTED'
  | 'STANDBY'
  | 'ACTIVE'
  | 'RECEIVED';

export const PORT_STATE_LABELS: Record<PortSignalState, string> = {
  DISCONNECTED: 'Chưa kết nối',
  CONNECTED: 'Đã kết nối',
  STANDBY: 'Chờ tín hiệu',
  ACTIVE: 'Đang kích hoạt',
  RECEIVED: 'Đã nhận tín hiệu',
};

export interface TimerModeGuideInfo {
  mode: C3TimerMode;
  shortTitle: string;
  activePortsText: string;
  startConditionText: string;
  stopConditionText: string;
  description: string;
}

export const TIMER_MODE_GUIDES: Record<C3TimerMode, TimerModeGuideInfo> = {
  'A<->B': {
    mode: 'A<->B',
    shortTitle: 'MODE A ↔ B: Đo thời gian chuyển động từ A đến B',
    activePortsText: 'Kênh A (Bắt đầu) & Kênh B (Kết thúc) cùng hoạt động',
    startConditionText:
      'Bắt đầu đếm khi nhận tín hiệu tại cổng A (công tắc nam châm nhả vật trong Bài 11 SGK, hoặc vật chắn tia cổng A)',
    stopConditionText: 'Dừng đếm ngay khi vật đi qua và chắn chùm tia tại cổng quang điện B',
    description:
      'Chế độ chuẩn cho Bài 11 (Đo gia tốc rơi tự do): đo khoảng thời gian t vật rơi từ vị trí thả A (v₀ = 0) đến cổng quang điện B ở quãng đường s.',
  },
  A: {
    mode: 'A',
    shortTitle: 'MODE A: Đo thời gian chắn tia tại cổng A',
    activePortsText: 'Chỉ kích hoạt Kênh A · Kênh B ở trạng thái chờ',
    startConditionText: 'Bắt đầu đếm khi mép dưới trụ thép bắt đầu chắn chùm tia cổng A',
    stopConditionText: 'Dừng đếm ngay khi mép trên trụ thép vừa thoát khỏi chùm tia cổng A',
    description:
      'Đo khoảng thời gian Δt_A mà thân trụ thép chắn chùm tia hồng ngoại tại cổng A (dùng tính vận tốc tức thời v_A = L / Δt_A).',
  },
  B: {
    mode: 'B',
    shortTitle: 'MODE B: Đo thời gian chắn tia tại cổng B',
    activePortsText: 'Chỉ kích hoạt Kênh B · Kênh A ở trạng thái chờ',
    startConditionText: 'Bắt đầu đếm khi mép dưới trụ thép bắt đầu chắn chùm tia cổng quang B',
    stopConditionText: 'Dừng đếm ngay khi mép trên trụ thép vừa thoát khỏi chùm tia cổng quang B',
    description:
      'Đo khoảng thời gian Δt_B mà thân trụ thép chắn chùm tia hồng ngoại tại cổng quang điện B (dùng tính vận tốc tức thời v_B = L / Δt_B).',
  },
  'A+B': {
    mode: 'A+B',
    shortTitle: 'MODE A + B: Tổng thời gian chắn tia tại A và B (t = tA + tB)',
    activePortsText: 'Kích hoạt cả Kênh A và Kênh B',
    startConditionText: 'Đo riêng thời gian vật chắn tia tại cổng A (tA) và tại cổng B (tB)',
    stopConditionText: 'Hoàn tất khi vật thoát khỏi tia cổng B; hiển thị tA, tB và tổng t = tA + tB',
    description:
      'Lưu ý quan trọng: Kết quả t = tA + tB là TỔNG hai khoảng thời gian vật chắn tia tại hai cổng A và B, KHÔNG phải thời gian vật rơi từ A đến B.',
  },
  T: {
    mode: 'T',
    shortTitle: 'MODE T: Đo chu kì T của chuyển động tuần hoàn',
    activePortsText: 'Kích hoạt Kênh A (đo chu kì) · Kênh B ở trạng thái chờ',
    startConditionText: 'Bắt đầu đếm tại sự kiện chắn tia đầu chu kì (Sự kiện 1/2)',
    stopConditionText:
      'Dừng đếm tại sự kiện tương ứng liên tiếp của chu kì tiếp theo (Sự kiện 2/2)',
    description:
      'Xác định thời gian T giữa hai sự kiện tương ứng liên tiếp của một dao động tuần hoàn. Không tự tạo kết quả nếu vật chỉ rơi qua 1 lần (chưa đủ 2 sự kiện).',
  },
};

export interface ExperimentSnapshot {
  phase: ExperimentPhase;
  errorCode: ErrorCode;
  errorMessage: string | null;
  statusMessage: string;

  // Trạng thái thiết bị vật lí
  powerOn: boolean;
  electromagnetEnergized: boolean;
  releaseSwitchClosed: boolean;
  cylinderAttachedToMagnet: boolean;
  photogateConnected: boolean; // Tương thích ngược với cổng B
  portAConnected: boolean;
  portBConnected: boolean;
  portAState: PortSignalState;
  portBState: PortSignalState;
  timerResetReady: boolean;

  // Cấu hình sơ đồ đồng hồ MC964
  wiringVariant: WiringVariant;
  c3Mode: C3TimerMode;

  // Vị trí và hình học (m & mm)
  /** Vị trí cổng A trên giá đỡ (m) khi đo chắn tia tại A (mặc định 0.150 m) */
  gateADistanceMeters: number;
  /** Quãng đường s từ mặt đáy trụ thép lúc giữ (y=0) đến tia cổng quang điện B (m) */
  photogateDistanceMeters: number;
  /** Độ lệch ngang của cổng quang điện B so với phương dây dọi (mm), 0 = thẳng hàng hoàn toàn */
  photogateLateralOffsetMm: number;
  /** Vị trí hiện tại của mặt đáy trụ thép tính từ mốc thả (m) */
  cylinderDropDistanceMeters: number;
  /** Vận tốc tức thời của trụ thép (m/s) */
  cylinderVelocityMetersPerSec: number;
  /** Tia cổng A đang bị chắn bởi thân trụ thép */
  isBeamABlockedNow: boolean;
  /** Tia cổng quang B đang bị chắn bởi thân trụ thép */
  isBeamBlockedNow: boolean;

  // Đồng hồ đo thời gian hiện số MC964
  timerDisplaySeconds: number;
  /** Thời gian chắn tia riêng tại cổng A (s) - dùng cho MODE A và MODE A+B */
  measuredTimeASeconds: number | null;
  /** Thời gian chắn tia riêng tại cổng B (s) - dùng cho MODE B và MODE A+B */
  measuredTimeBSeconds: number | null;
  /** Chu kì T đo được trong MODE T (s) */
  measuredPeriodTSeconds: number | null;
  /** Số sự kiện chu kì đã nhận trong MODE T (0, 1, 2) */
  periodEventCount: number;
  /** Đang phát tín hiệu dao động tuần hoàn để đo chu kì trong MODE T */
  isPeriodicSourceRunning: boolean;
  /** Chu kì chuẩn của nguồn tuần hoàn khi kiểm nghiệm MODE T (s) */
  periodicSourcePeriodSeconds: number;

  /** Tiến độ xung tín hiệu truyền trên dây A (0..1) */
  signalPulseAProgress: number;
  /** Tiến độ xung tín hiệu truyền trên dây B (0..1) */
  signalPulseBProgress: number;

  /** Thời gian đã trôi qua kể từ lúc nhả trụ thép hoặc bắt đầu chu kì (s) */
  elapsedFallSeconds: number;
  /** Thời gian đích khi trụ thép chạm cổng quang điện (s) */
  targetTriggerSeconds: number | null;
  /** Kết quả thời gian đo hợp lệ của lần đo vừa xong (s) */
  completedMeasurementSeconds: number | null;

  // Mảng các vị trí chụp hoạt nghiệm (stroboscopic positions)
  strobePositionsMeters: number[];
}

/**
 * Xác định trạng thái ban đầu của hai cổng A và B khi đang ở trạng thái chờ đo (trước khi thả)
 */
export function computeIdlePortStates(
  powerOn: boolean,
  mode: C3TimerMode,
  portAConnected: boolean,
  portBConnected: boolean
): { portAState: PortSignalState; portBState: PortSignalState } {
  if (!powerOn) {
    return {
      portAState: portAConnected ? 'STANDBY' : 'DISCONNECTED',
      portBState: portBConnected ? 'STANDBY' : 'DISCONNECTED',
    };
  }

  const aParticipates = mode === 'A' || mode === 'A+B' || mode === 'A<->B' || mode === 'T';
  const bParticipates = mode === 'B' || mode === 'A+B' || mode === 'A<->B';

  return {
    portAState: !portAConnected
      ? 'DISCONNECTED'
      : aParticipates
      ? 'CONNECTED'
      : 'STANDBY',
    portBState: !portBConnected
      ? 'DISCONNECTED'
      : bParticipates
      ? 'CONNECTED'
      : 'STANDBY',
  };
}

export const INITIAL_EXPERIMENT_SNAPSHOT: ExperimentSnapshot = {
  phase: 'READY_TO_DROP',
  errorCode: 'NONE',
  errorMessage: null,
  statusMessage:
    'Sẵn sàng! Đồng hồ MC964 đang ở MODE A ↔ B (A: Tín hiệu thả vật, B: Cổng quang điện). Nhấn "Nhả trụ thép" để đo.',

  powerOn: true,
  electromagnetEnergized: true,
  releaseSwitchClosed: true,
  cylinderAttachedToMagnet: true,
  photogateConnected: true,
  portAConnected: true,
  portBConnected: true,
  portAState: 'CONNECTED',
  portBState: 'CONNECTED',
  timerResetReady: true,

  wiringVariant: 'SGK_KNTT',
  c3Mode: 'A<->B',

  gateADistanceMeters: 0.15, // Cổng A ở 15.0 cm
  photogateDistanceMeters: 0.5, // Cổng B ở 50.0 cm
  photogateLateralOffsetMm: 0,
  cylinderDropDistanceMeters: 0,
  cylinderVelocityMetersPerSec: 0,
  isBeamABlockedNow: false,
  isBeamBlockedNow: false,

  timerDisplaySeconds: 0,
  measuredTimeASeconds: null,
  measuredTimeBSeconds: null,
  measuredPeriodTSeconds: null,
  periodEventCount: 0,
  isPeriodicSourceRunning: false,
  periodicSourcePeriodSeconds: 1.0,

  signalPulseAProgress: 0,
  signalPulseBProgress: 0,

  elapsedFallSeconds: 0,
  targetTriggerSeconds: null,
  completedMeasurementSeconds: null,

  strobePositionsMeters: [],
};

export class ExperimentController {
  private snapshot: ExperimentSnapshot;
  private config: PhysicsConfig;

  constructor(
    initialSnapshot: ExperimentSnapshot = INITIAL_EXPERIMENT_SNAPSHOT,
    initialConfig: PhysicsConfig = DEFAULT_PHYSICS_CONFIG
  ) {
    this.snapshot = { ...initialSnapshot };
    this.config = { ...initialConfig };
  }

  public getSnapshot(): ExperimentSnapshot {
    return this.snapshot;
  }

  public getConfig(): PhysicsConfig {
    return this.config;
  }

  public updateConfig(partial: Partial<PhysicsConfig>): ExperimentSnapshot {
    this.config = { ...this.config, ...partial };
    return this.snapshot;
  }

  private syncIdlePorts() {
    const idle = computeIdlePortStates(
      this.snapshot.powerOn,
      this.snapshot.c3Mode,
      this.snapshot.portAConnected,
      this.snapshot.portBConnected
    );
    this.snapshot.portAState = idle.portAState;
    this.snapshot.portBState = idle.portBState;
  }

  /**
   * Bật / Tắt nguồn đồng hồ đo thời gian hiện số MC964
   */
  public togglePower(forceState?: boolean): ExperimentSnapshot {
    const nextPower = forceState !== undefined ? forceState : !this.snapshot.powerOn;
    if (!nextPower) {
      const idle = computeIdlePortStates(
        false,
        this.snapshot.c3Mode,
        this.snapshot.portAConnected,
        this.snapshot.portBConnected
      );
      this.snapshot = {
        ...this.snapshot,
        powerOn: false,
        electromagnetEnergized: false,
        cylinderAttachedToMagnet: false,
        cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
        cylinderVelocityMetersPerSec: 0,
        timerResetReady: false,
        timerDisplaySeconds: 0,
        measuredTimeASeconds: null,
        measuredTimeBSeconds: null,
        measuredPeriodTSeconds: null,
        periodEventCount: 0,
        isPeriodicSourceRunning: false,
        signalPulseAProgress: 0,
        signalPulseBProgress: 0,
        elapsedFallSeconds: 0,
        targetTriggerSeconds: null,
        completedMeasurementSeconds: null,
        isBeamABlockedNow: false,
        isBeamBlockedNow: false,
        portAState: idle.portAState,
        portBState: idle.portBState,
        phase: 'POWER_OFF',
        errorCode: 'NONE',
        errorMessage: null,
        statusMessage:
          'Đã tắt nguồn đồng hồ MC964. Nam châm điện ngắt điện, trụ thép nằm tại khay hứng.',
      };
      return this.snapshot;
    }

    const idle = computeIdlePortStates(
      true,
      this.snapshot.c3Mode,
      this.snapshot.portAConnected,
      this.snapshot.portBConnected
    );
    this.snapshot = {
      ...this.snapshot,
      powerOn: true,
      releaseSwitchClosed: true,
      electromagnetEnergized: true,
      cylinderAttachedToMagnet: true,
      cylinderDropDistanceMeters: 0,
      cylinderVelocityMetersPerSec: 0,
      timerResetReady: false,
      timerDisplaySeconds: 0,
      measuredTimeASeconds: null,
      measuredTimeBSeconds: null,
      measuredPeriodTSeconds: null,
      periodEventCount: 0,
      isPeriodicSourceRunning: false,
      signalPulseAProgress: 0,
      signalPulseBProgress: 0,
      elapsedFallSeconds: 0,
      targetTriggerSeconds: null,
      completedMeasurementSeconds: null,
      isBeamABlockedNow: false,
      isBeamBlockedNow: false,
      portAState: idle.portAState,
      portBState: idle.portBState,
      strobePositionsMeters: [],
      phase: 'BALL_HELD',
      errorCode: 'NONE',
      errorMessage: null,
      statusMessage:
        'Đã bật nguồn đồng hồ MC964. Trụ thép được giữ ở đầu nam châm điện. Nhấn RESET để chuẩn bị đo.',
    };
    return this.snapshot;
  }

  /**
   * Đặt lại trụ thép lên đầu nam châm điện (không xóa bảng số liệu)
   */
  public attachCylinderToMagnet(): ExperimentSnapshot {
    if (!this.snapshot.powerOn) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_NO_POWER',
        errorMessage:
          'Đồng hồ MC964 chưa bật nguồn. Hãy bật nút POWER trước khi gắn trụ thép vào nam châm điện.',
        statusMessage: 'Lỗi: Chưa bật nguồn điện cho đồng hồ và nam châm điện.',
      };
      return this.snapshot;
    }

    const nextPhase: ExperimentPhase = this.snapshot.timerResetReady
      ? 'READY_TO_DROP'
      : 'BALL_HELD';
    const idle = computeIdlePortStates(
      true,
      this.snapshot.c3Mode,
      this.snapshot.portAConnected,
      this.snapshot.portBConnected
    );

    this.snapshot = {
      ...this.snapshot,
      releaseSwitchClosed: true,
      electromagnetEnergized: true,
      cylinderAttachedToMagnet: true,
      cylinderDropDistanceMeters: 0,
      cylinderVelocityMetersPerSec: 0,
      elapsedFallSeconds: 0,
      targetTriggerSeconds: null,
      isBeamABlockedNow: false,
      isBeamBlockedNow: false,
      isPeriodicSourceRunning: false,
      signalPulseAProgress: 0,
      signalPulseBProgress: 0,
      portAState: idle.portAState,
      portBState: idle.portBState,
      strobePositionsMeters: [],
      phase: nextPhase,
      errorCode: 'NONE',
      errorMessage: null,
      statusMessage:
        nextPhase === 'READY_TO_DROP'
          ? 'Trụ thép đã gắn vào nam châm điện và đồng hồ đã RESET (0.000 s). Sẵn sàng thả.'
          : 'Đã đưa trụ thép lên đầu nam châm điện. Nhấn RESET đồng hồ về 0.000 s trước khi thả.',
    };
    return this.snapshot;
  }

  /**
   * Nhấn nút RESET trên đồng hồ đo thời gian hiện số MC964
   */
  public resetTimer(): ExperimentSnapshot {
    if (!this.snapshot.powerOn) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_NO_POWER',
        errorMessage: 'Không thể RESET khi đồng hồ đang tắt nguồn.',
        statusMessage: 'Lỗi: Đồng hồ chưa bật nguồn.',
      };
      return this.snapshot;
    }

    const idle = computeIdlePortStates(
      true,
      this.snapshot.c3Mode,
      this.snapshot.portAConnected,
      this.snapshot.portBConnected
    );

    // Nếu đang rơi mà bấm RESET -> Hủy lần đo hiện tại
    if (
      (this.snapshot.phase === 'FALLING_TIMER_RUNNING' ||
        this.snapshot.phase === 'PHOTOGATE_TRIGGERED') &&
      !this.snapshot.isPeriodicSourceRunning
    ) {
      this.snapshot = {
        ...this.snapshot,
        timerDisplaySeconds: 0,
        measuredTimeASeconds: null,
        measuredTimeBSeconds: null,
        measuredPeriodTSeconds: null,
        periodEventCount: 0,
        isPeriodicSourceRunning: false,
        signalPulseAProgress: 0,
        signalPulseBProgress: 0,
        portAState: idle.portAState,
        portBState: idle.portBState,
        timerResetReady: true,
        elapsedFallSeconds: 0,
        targetTriggerSeconds: null,
        completedMeasurementSeconds: null,
        cylinderVelocityMetersPerSec: 0,
        cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
        cylinderAttachedToMagnet: false,
        isBeamABlockedNow: false,
        isBeamBlockedNow: false,
        phase: 'ERROR',
        errorCode: 'ERR_ABORTED_BY_RESET',
        errorMessage:
          'Đã nhấn RESET khi trụ thép đang rơi — lần đo hiện tại bị hủy. Hãy nhấn "Đặt lại trụ thép" để đo lại.',
        statusMessage: 'Lần đo bị hủy do nhấn RESET giữa chừng.',
      };
      return this.snapshot;
    }

    const nextPhase: ExperimentPhase = this.snapshot.cylinderAttachedToMagnet
      ? 'READY_TO_DROP'
      : 'SETUP';

    this.snapshot = {
      ...this.snapshot,
      timerDisplaySeconds: 0,
      measuredTimeASeconds: null,
      measuredTimeBSeconds: null,
      measuredPeriodTSeconds: null,
      periodEventCount: 0,
      isPeriodicSourceRunning: false,
      signalPulseAProgress: 0,
      signalPulseBProgress: 0,
      portAState: idle.portAState,
      portBState: idle.portBState,
      timerResetReady: true,
      completedMeasurementSeconds: null,
      targetTriggerSeconds: null,
      phase: nextPhase,
      errorCode: 'NONE',
      errorMessage: null,
      statusMessage: this.snapshot.cylinderAttachedToMagnet
        ? `Đồng hồ MC964 đã RESET về 0.000 s (MODE ${this.snapshot.c3Mode}). Sẵn sàng thực hiện phép đo.`
        : 'Đồng hồ đã RESET về 0.000 s. Hãy nhấn "Đặt lại trụ thép" lên đầu nam châm điện để bắt đầu.',
    };
    return this.snapshot;
  }

  /**
   * Nút START/STOP trên đồng hồ MC964:
   * - Nếu đang ở MODE T và chưa rơi: kích hoạt đo chu kì tín hiệu tuần hoàn qua cổng A
   * - Nếu đang chạy: dừng/tạm dừng hoặc nếu đang sẵn sàng thì kích hoạt nhả vật đo
   */
  public triggerStartStopButton(): ExperimentSnapshot {
    if (!this.snapshot.powerOn) {
      return this.releaseCylinder();
    }
    if (this.snapshot.c3Mode === 'T') {
      if (this.snapshot.isPeriodicSourceRunning) {
        return this.resetTimer();
      }
      return this.startPeriodicCycleMeasurement(this.snapshot.periodicSourcePeriodSeconds);
    }
    if (
      this.snapshot.phase === 'FALLING_TIMER_RUNNING' ||
      this.snapshot.phase === 'PHOTOGATE_TRIGGERED'
    ) {
      return this.resetTimer();
    }
    if (!this.snapshot.cylinderAttachedToMagnet) {
      this.attachCylinderToMagnet();
    }
    if (!this.snapshot.timerResetReady) {
      this.resetTimer();
    }
    return this.releaseCylinder();
  }

  /**
   * Bắt đầu phép đo chu kì T của chuyển động tuần hoàn trong MODE T
   * (Xác định thời gian giữa 2 sự kiện tương ứng liên tiếp của cùng một chu kì)
   */
  public startPeriodicCycleMeasurement(periodSeconds: number = 1.0): ExperimentSnapshot {
    if (!this.snapshot.powerOn) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_NO_POWER',
        errorMessage: 'Chưa bật nguồn đồng hồ MC964. Hãy bật nút POWER trước.',
        statusMessage: 'Lỗi: Chưa bật nguồn đồng hồ.',
      };
      return this.snapshot;
    }

    if (!this.snapshot.portAConnected) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_PORT_A_UNPLUGGED',
        errorMessage:
          'Cổng A chưa kết nối dây tín hiệu! MODE T cần tín hiệu tuần hoàn đưa vào cổng A.',
        statusMessage: 'Lỗi: Chưa kết nối cổng A khi đo chu kì T.',
      };
      return this.snapshot;
    }

    const safePeriod = Math.max(0.2, Math.min(5.0, periodSeconds));
    this.snapshot = {
      ...this.snapshot,
      c3Mode: 'T',
      timerResetReady: false,
      elapsedFallSeconds: 0,
      timerDisplaySeconds: 0,
      measuredPeriodTSeconds: null,
      completedMeasurementSeconds: null,
      periodEventCount: 1, // Nhận sự kiện tương ứng lần 1 tại t = 0
      isPeriodicSourceRunning: true,
      periodicSourcePeriodSeconds: safePeriod,
      portAState: 'ACTIVE',
      portBState: this.snapshot.portBConnected ? 'STANDBY' : 'DISCONNECTED',
      signalPulseAProgress: 0.2,
      signalPulseBProgress: 0,
      phase: 'FALLING_TIMER_RUNNING',
      errorCode: 'NONE',
      errorMessage: null,
      statusMessage:
        'MODE T: Đã nhận sự kiện 1/2 đầu chu kì tại cổng A — đồng hồ đang đếm chờ sự kiện tương ứng liên tiếp lần 2...',
    };
    return this.snapshot;
  }

  /**
   * Thao tác công tắc kép để ngắt dòng điện nam châm, thả trụ thép và kích hoạt đồng hồ theo đúng thuật toán của MODE hiện tại
   */
  public releaseCylinder(seed?: number): ExperimentSnapshot {
    if (!this.snapshot.powerOn) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_NO_POWER',
        errorMessage: 'Chưa bật nguồn đồng hồ hiện số. Hãy bật nút POWER trước.',
        statusMessage: 'Lỗi: Chưa bật nguồn thiết bị.',
      };
      return this.snapshot;
    }

    if (!this.snapshot.cylinderAttachedToMagnet) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_NOT_HELD',
        errorMessage:
          'Trụ thép chưa được giữ ở nam châm điện. Hãy nhấn "Đặt lại trụ thép" trước khi thả.',
        statusMessage: 'Lỗi: Trụ thép chưa ở vị trí thả trên đầu nam châm điện.',
      };
      return this.snapshot;
    }

    if (!this.snapshot.timerResetReady) {
      this.snapshot = {
        ...this.snapshot,
        phase: 'ERROR',
        errorCode: 'ERR_NOT_RESET',
        errorMessage:
          'Đồng hồ chưa được RESET về 0. Hãy nhấn nút RESET trên đồng hồ trước khi thả trụ thép.',
        statusMessage: 'Chưa RESET đồng hồ! Nhấn RESET để đưa số chỉ về 0.000 s trước khi thả.',
      };
      return this.snapshot;
    }

    const aligned = isPhotogateBeamAligned(
      this.snapshot.photogateLateralOffsetMm,
      this.config.cylinderDiameterMeters
    );

    let targetTriggerSeconds: number | null = null;
    if (this.snapshot.portBConnected && this.snapshot.photogateConnected && aligned) {
      const sim = computeMeasuredFallTime(
        this.snapshot.photogateDistanceMeters,
        this.config,
        seed
      );
      targetTriggerSeconds = sim.rawSimulatedTime;
    }

    const mode = this.snapshot.c3Mode;
    const idle = computeIdlePortStates(
      true,
      mode,
      this.snapshot.portAConnected,
      this.snapshot.portBConnected
    );

    // Trong cấu hình SGK_KNTT với MODE A<->B, ngay khi ngắt công tắc nam châm tại t=0,
    // nếu cổng A được kết nối thì cổng A kích hoạt xung START ngay lập tức!
    const initPortAState: PortSignalState =
      mode === 'A<->B' &&
      this.snapshot.wiringVariant === 'SGK_KNTT' &&
      this.snapshot.portAConnected
        ? 'ACTIVE'
        : idle.portAState;

    this.snapshot = {
      ...this.snapshot,
      releaseSwitchClosed: false,
      electromagnetEnergized: false,
      cylinderAttachedToMagnet: false,
      timerResetReady: false,
      isPeriodicSourceRunning: false,
      elapsedFallSeconds: 0,
      timerDisplaySeconds: 0,
      measuredTimeASeconds: null,
      measuredTimeBSeconds: null,
      measuredPeriodTSeconds: null,
      periodEventCount: 0,
      signalPulseAProgress:
        initPortAState === 'ACTIVE' ? 0.15 : 0,
      signalPulseBProgress: 0,
      portAState: initPortAState,
      portBState: idle.portBState,
      targetTriggerSeconds,
      completedMeasurementSeconds: null,
      cylinderDropDistanceMeters: 0,
      cylinderVelocityMetersPerSec: 0,
      isBeamABlockedNow: false,
      isBeamBlockedNow: false,
      strobePositionsMeters: [0],
      phase: 'FALLING_TIMER_RUNNING',
      errorCode: 'NONE',
      errorMessage: null,
      statusMessage: `Đang thả rơi tự do (MODE ${mode})...`,
    };
    return this.snapshot;
  }

  /**
   * Tiến thời gian mô phỏng thêm deltaSeconds — thực thi thuật toán đo thời gian thực cho cả 5 chế độ:
   * MODE A, MODE B, MODE A+B, MODE A<->B, và MODE T.
   */
  public stepSimulation(deltaSeconds: number): ExperimentSnapshot {
    if (
      this.snapshot.phase !== 'FALLING_TIMER_RUNNING' &&
      this.snapshot.phase !== 'PHOTOGATE_TRIGGERED'
    ) {
      return this.snapshot;
    }

    const dt = Math.max(0, Math.min(deltaSeconds, 0.1));
    const nextElapsed = this.snapshot.elapsedFallSeconds + dt;
    const g = this.config.gravity;
    const cylL = this.config.cylinderHeightMeters;
    const scale = this.config.timerScale;
    const mode = this.snapshot.c3Mode;

    // =========================================================================
    // TRƯỜNG HỢP ĐẶC BIỆT: ĐANG ĐO CHU KÌ DAO ĐỘNG TUẦN HOÀN TRONG MODE T
    // =========================================================================
    if (mode === 'T' && this.snapshot.isPeriodicSourceRunning) {
      const targetT = this.snapshot.periodicSourcePeriodSeconds;
      const halfT = targetT * 0.5;
      const pulseA = ((nextElapsed * 2.2) % 1 + 1) % 1;

      if (nextElapsed >= targetT) {
        const finalT = quantizeTimerValue(targetT, scale);
        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: targetT,
          timerDisplaySeconds: finalT,
          measuredPeriodTSeconds: finalT,
          completedMeasurementSeconds: finalT,
          periodEventCount: 2,
          isPeriodicSourceRunning: false,
          portAState: 'RECEIVED',
          portBState: this.snapshot.portBConnected ? 'STANDBY' : 'DISCONNECTED',
          signalPulseAProgress: 1,
          phase: 'MEASUREMENT_COMPLETE',
          errorCode: 'NONE',
          errorMessage: null,
          statusMessage: `Hoàn tất đo chu kì MODE T! Đã nhận đủ 2 sự kiện tương ứng liên tiếp của chu kì: T = ${finalT.toFixed(
            scale === '9.999' ? 3 : 2
          )} s.`,
        };
        return this.snapshot;
      }

      const passedHalfCycle = nextElapsed >= halfT;
      this.snapshot = {
        ...this.snapshot,
        elapsedFallSeconds: nextElapsed,
        timerDisplaySeconds: quantizeTimerValue(nextElapsed, scale),
        periodEventCount: 1,
        portAState: 'ACTIVE',
        portBState: this.snapshot.portBConnected ? 'STANDBY' : 'DISCONNECTED',
        signalPulseAProgress: pulseA,
        statusMessage: passedHalfCycle
          ? 'MODE T: Đã qua nửa chu kì (bỏ qua sự kiện ngược pha), đang đợi sự kiện cùng pha lần 2 để chốt chu kì T...'
          : 'MODE T: Đã nhận sự kiện 1/2 tại cổng A, đang đếm thời gian chu kì T...',
      };
      return this.snapshot;
    }

    // =========================================================================
    // ĐỘNG HỌC RƠI TỰ DO CỦA TRỤ THÉP TRÊN GIÁ ĐỠ
    // =========================================================================
    const kinematics = computeKinematicsAtTime(
      nextElapsed,
      g,
      this.config.maxFallDistanceMeters
    );

    const sA = this.snapshot.gateADistanceMeters;
    const sB = this.snapshot.photogateDistanceMeters;
    const alignedB = isPhotogateBeamAligned(
      this.snapshot.photogateLateralOffsetMm,
      this.config.cylinderDiameterMeters
    );

    // Thời điểm mép dưới chạm tia (enter) và mép trên thoát khỏi tia (exit) tại cổng A và cổng B
    const tEnterA = computeIdealFallTime(sA, g);
    const tExitA = computeIdealFallTime(sA + cylL, g);
    const exactBlockDurationA = Math.max(0.001, tExitA - tEnterA);

    const tEnterB =
      this.snapshot.targetTriggerSeconds !== null
        ? this.snapshot.targetTriggerSeconds
        : computeIdealFallTime(sB, g);
    const exactBlockDurationB = Math.max(
      0.001,
      computeIdealFallTime(sB + cylL, g) - computeIdealFallTime(sB, g)
    );
    const tExitB = tEnterB + exactBlockDurationB;

    const beamABlocked =
      this.snapshot.portAConnected &&
      isCylinderBlockingBeam(
        kinematics.distanceMeters,
        sA,
        cylL,
        0,
        this.config.cylinderDiameterMeters
      );

    const beamBBlocked =
      this.snapshot.portBConnected &&
      this.snapshot.photogateConnected &&
      isCylinderBlockingBeam(
        kinematics.distanceMeters,
        sB,
        cylL,
        this.snapshot.photogateLateralOffsetMm,
        this.config.cylinderDiameterMeters
      );

    // Cập nhật điểm chụp hoạt nghiệm mỗi 0.05 s
    const strobeInterval = 0.05;
    const expectedStrobeCount = Math.floor(nextElapsed / strobeInterval) + 1;
    const nextStrobes = [...this.snapshot.strobePositionsMeters];
    while (nextStrobes.length < expectedStrobeCount && nextStrobes.length < 20) {
      const tStrobe = nextStrobes.length * strobeInterval;
      const dStrobe = Math.min(
        this.config.maxFallDistanceMeters,
        0.5 * g * tStrobe * tStrobe
      );
      nextStrobes.push(dStrobe);
    }

    // =========================================================================
    // 1. THUẬT TOÁN ĐO CHO CHẾ ĐỘ MODE A ↔ B (ĐO THỜI GIAN TỪ A ĐẾN B)
    // =========================================================================
    if (mode === 'A<->B') {
      const isTwoPhotogates = this.snapshot.wiringVariant === 'C3_MC964';
      const startTimeA = isTwoPhotogates ? tEnterA : 0;

      // Kiểm tra lỗi thứ tự tín hiệu khi ở cấu hình 2 cổng quang độc lập (sA >= sB -> B nhận trước A)
      if (
        isTwoPhotogates &&
        sA >= sB &&
        this.snapshot.portBConnected &&
        alignedB &&
        nextElapsed >= tEnterB
      ) {
        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: beamABlocked,
          isBeamBlockedNow: beamBBlocked,
          timerDisplaySeconds: 0,
          completedMeasurementSeconds: null,
          portAState: this.snapshot.portAConnected ? 'CONNECTED' : 'DISCONNECTED',
          portBState: 'ACTIVE',
          strobePositionsMeters: nextStrobes,
          phase: 'ERROR',
          errorCode: 'ERR_INVALID_SIGNAL_ORDER',
          errorMessage: `Thứ tự sự kiện không hợp lệ trong MODE A ↔ B: Cổng B (s_B = ${sB.toFixed(
            2
          )} m) nhận tín hiệu trước Cổng A (s_A = ${sA.toFixed(
            2
          )} m). Hãy đặt Cổng A ở phía trên Cổng B (s_A < s_B).`,
          statusMessage: 'Lỗi: Sai thứ tự tín hiệu (Cổng B nhận trước Cổng A).',
        };
        return this.snapshot;
      }

      // Kiểm tra nếu cổng A bị rút dây -> Đồng hồ không nhận được xung START từ A
      if (!this.snapshot.portAConnected) {
        if (kinematics.hasHitCatchTray) {
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            isBeamABlockedNow: false,
            isBeamBlockedNow: false,
            timerDisplaySeconds: 0,
            completedMeasurementSeconds: null,
            portAState: 'DISCONNECTED',
            portBState: this.snapshot.portBConnected ? 'RECEIVED' : 'DISCONNECTED',
            strobePositionsMeters: nextStrobes,
            phase: 'ERROR',
            errorCode: 'ERR_PORT_A_UNPLUGGED',
            errorMessage:
              'Thiếu tín hiệu bắt đầu tại Cổng A (Cổng A chưa kết nối dây)! Đồng hồ không thể bắt đầu đếm trong MODE A ↔ B.',
            statusMessage: 'Lỗi: Cổng A chưa kết nối dây tín hiệu.',
          };
          return this.snapshot;
        }

        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: false,
          isBeamBlockedNow: beamBBlocked,
          timerDisplaySeconds: 0,
          portAState: 'DISCONNECTED',
          portBState: beamBBlocked
            ? 'ACTIVE'
            : this.snapshot.portBConnected
            ? 'CONNECTED'
            : 'DISCONNECTED',
          strobePositionsMeters: nextStrobes,
        };
        return this.snapshot;
      }

      // Khi cổng A đã kết nối: kiểm tra thời점 nhận xung STOP tại cổng B
      const canTriggerB =
        this.snapshot.portBConnected &&
        this.snapshot.photogateConnected &&
        alignedB &&
        this.snapshot.targetTriggerSeconds !== null;

      if (canTriggerB && nextElapsed >= tEnterB) {
        const finalMeasured = quantizeTimerValue(Math.max(0, tEnterB - startTimeA), scale);

        if (kinematics.hasHitCatchTray) {
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            isBeamABlockedNow: false,
            isBeamBlockedNow: false,
            timerDisplaySeconds: finalMeasured,
            completedMeasurementSeconds: finalMeasured,
            portAState: 'RECEIVED',
            portBState: 'RECEIVED',
            signalPulseAProgress: 1,
            signalPulseBProgress: 1,
            strobePositionsMeters: nextStrobes,
            phase: 'MEASUREMENT_COMPLETE',
            errorCode: 'NONE',
            errorMessage: null,
            statusMessage: `Hoàn tất phép đo (MODE A ↔ B)! Tại s = ${sB.toFixed(
              3
            )} m, thời gian t = ${finalMeasured.toFixed(
              scale === '9.999' ? 3 : 2
            )} s. Nhấn "Ghi kết quả" để lưu vào bảng.`,
          };
          return this.snapshot;
        }

        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: beamABlocked,
          isBeamBlockedNow: beamBBlocked,
          timerDisplaySeconds: finalMeasured,
          completedMeasurementSeconds: finalMeasured,
          portAState: 'RECEIVED',
          portBState: beamBBlocked ? 'ACTIVE' : 'RECEIVED',
          signalPulseAProgress: 1,
          signalPulseBProgress: Math.min(1, (nextElapsed - tEnterB) * 12),
          strobePositionsMeters: nextStrobes,
          phase: 'PHOTOGATE_TRIGGERED',
          errorCode: 'NONE',
          errorMessage: null,
          statusMessage: `Trụ thép đã qua cổng quang B! Đồng hồ dừng tại t = ${finalMeasured.toFixed(
            scale === '9.999' ? 3 : 2
          )} s.`,
        };
        return this.snapshot;
      }

      // Nếu cổng B bị rút dây hoặc bị lệch ngang -> đồng hồ không nhận được tín hiệu dừng tại B
      if (!canTriggerB && kinematics.hasHitCatchTray) {
        const errCode: ErrorCode =
          !this.snapshot.portBConnected || !this.snapshot.photogateConnected
            ? 'ERR_PHOTOGATE_UNPLUGGED'
            : 'ERR_PHOTOGATE_MISALIGNED';

        const errMsg =
          errCode === 'ERR_PHOTOGATE_UNPLUGGED'
            ? 'Cổng quang điện B chưa được cắm dây vào đồng hồ! Trụ thép đã rơi xuống khay hứng nhưng đồng hồ không nhận được tín hiệu dừng tại cổng B.'
            : `Cổng quang điện B bị lệch ngang (${this.snapshot.photogateLateralOffsetMm.toFixed(
                1
              )} mm) khỏi phương dây dọi! Trụ thép rơi không chắn tia hồng ngoại nên đồng hồ không dừng.`;

        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
          cylinderVelocityMetersPerSec: 0,
          isBeamABlockedNow: false,
          isBeamBlockedNow: false,
          timerDisplaySeconds: quantizeTimerValue(
            Math.max(0, nextElapsed - startTimeA + 0.12),
            scale
          ),
          completedMeasurementSeconds: null,
          portAState: 'RECEIVED',
          portBState:
            errCode === 'ERR_PHOTOGATE_UNPLUGGED' ? 'DISCONNECTED' : 'CONNECTED',
          strobePositionsMeters: nextStrobes,
          phase: 'ERROR',
          errorCode: errCode,
          errorMessage: errMsg,
          statusMessage: errMsg,
        };
        return this.snapshot;
      }

      // Đang rơi trên đường từ A đến B
      const hasStartedA = nextElapsed >= startTimeA;
      const currentCount = hasStartedA ? Math.max(0, nextElapsed - startTimeA) : 0;
      const portAStateNow: PortSignalState = !hasStartedA
        ? 'CONNECTED'
        : nextElapsed - startTimeA < 0.08 || beamABlocked
        ? 'ACTIVE'
        : 'RECEIVED';

      this.snapshot = {
        ...this.snapshot,
        elapsedFallSeconds: nextElapsed,
        cylinderDropDistanceMeters: kinematics.distanceMeters,
        cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
        isBeamABlockedNow: beamABlocked,
        isBeamBlockedNow: beamBBlocked,
        timerDisplaySeconds: quantizeTimerValue(currentCount, scale),
        portAState: portAStateNow,
        portBState: this.snapshot.portBConnected ? 'CONNECTED' : 'DISCONNECTED',
        signalPulseAProgress: hasStartedA
          ? Math.min(1, (nextElapsed - startTimeA) * 6)
          : 0,
        signalPulseBProgress: 0,
        strobePositionsMeters: nextStrobes,
      };
      return this.snapshot;
    }

    // =========================================================================
    // 2. THUẬT TOÁN ĐO CHO CHẾ ĐỘ MODE A (CHỈ ĐO THỜI GIAN CHẮN TIA TẠI CỔNG A)
    // =========================================================================
    if (mode === 'A') {
      const bStandby: PortSignalState = this.snapshot.portBConnected
        ? 'STANDBY'
        : 'DISCONNECTED';

      if (!this.snapshot.portAConnected) {
        if (kinematics.hasHitCatchTray) {
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            timerDisplaySeconds: 0,
            completedMeasurementSeconds: null,
            portAState: 'DISCONNECTED',
            portBState: bStandby,
            strobePositionsMeters: nextStrobes,
            phase: 'ERROR',
            errorCode: 'ERR_PORT_A_UNPLUGGED',
            errorMessage:
              'Cổng A chưa kết nối dây tín hiệu! MODE A cần tín hiệu chắn tia từ cổng A.',
            statusMessage: 'Lỗi: Cổng A chưa kết nối.',
          };
          return this.snapshot;
        }
      } else {
        if (nextElapsed < tEnterA) {
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: nextElapsed,
            cylinderDropDistanceMeters: kinematics.distanceMeters,
            cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
            isBeamABlockedNow: false,
            isBeamBlockedNow: beamBBlocked,
            timerDisplaySeconds: 0,
            portAState: 'CONNECTED',
            portBState: bStandby,
            strobePositionsMeters: nextStrobes,
          };
          return this.snapshot;
        }

        if (nextElapsed >= tEnterA && nextElapsed < tExitA) {
          const currentBlockA = quantizeTimerValue(nextElapsed - tEnterA, scale);
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: nextElapsed,
            cylinderDropDistanceMeters: kinematics.distanceMeters,
            cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
            isBeamABlockedNow: true,
            isBeamBlockedNow: beamBBlocked,
            timerDisplaySeconds: currentBlockA,
            measuredTimeASeconds: currentBlockA,
            portAState: 'ACTIVE',
            portBState: bStandby,
            signalPulseAProgress: (nextElapsed - tEnterA) / exactBlockDurationA,
            strobePositionsMeters: nextStrobes,
            statusMessage: 'MODE A: Trụ thép đang chắn chùm tia cổng A — đồng hồ đang đếm tA...',
          };
          return this.snapshot;
        }

        // Đã giải phóng tia tại cổng A (nextElapsed >= tExitA)
        const finalTA = quantizeTimerValue(exactBlockDurationA, scale);
        if (kinematics.hasHitCatchTray) {
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            isBeamABlockedNow: false,
            isBeamBlockedNow: false,
            timerDisplaySeconds: finalTA,
            measuredTimeASeconds: finalTA,
            completedMeasurementSeconds: finalTA,
            portAState: 'RECEIVED',
            portBState: bStandby,
            signalPulseAProgress: 1,
            strobePositionsMeters: nextStrobes,
            phase: 'MEASUREMENT_COMPLETE',
            errorCode: 'NONE',
            errorMessage: null,
            statusMessage: `Hoàn tất MODE A! Thời gian trụ thép chắn chùm tia cổng A là tA = ${finalTA.toFixed(
              scale === '9.999' ? 3 : 2
            )} s.`,
          };
          return this.snapshot;
        }

        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: false,
          isBeamBlockedNow: beamBBlocked,
          timerDisplaySeconds: finalTA,
          measuredTimeASeconds: finalTA,
          completedMeasurementSeconds: finalTA,
          portAState: 'RECEIVED',
          portBState: bStandby,
          signalPulseAProgress: 1,
          strobePositionsMeters: nextStrobes,
          phase: 'PHOTOGATE_TRIGGERED',
          statusMessage: `MODE A: Đã giải phóng tia cổng A! Chốt thời gian chắn tia tA = ${finalTA.toFixed(
            scale === '9.999' ? 3 : 2
          )} s.`,
        };
        return this.snapshot;
      }
    }

    // =========================================================================
    // 3. THUẬT TOÁN ĐO CHO CHẾ ĐỘ MODE B (CHỈ ĐO THỜI GIAN CHẮN TIA TẠI CỔNG B)
    // =========================================================================
    if (mode === 'B') {
      const aStandby: PortSignalState = this.snapshot.portAConnected
        ? 'STANDBY'
        : 'DISCONNECTED';

      const canTriggerB =
        this.snapshot.portBConnected &&
        this.snapshot.photogateConnected &&
        alignedB &&
        this.snapshot.targetTriggerSeconds !== null;

      if (!canTriggerB) {
        if (kinematics.hasHitCatchTray) {
          const errCode: ErrorCode =
            !this.snapshot.portBConnected || !this.snapshot.photogateConnected
              ? 'ERR_PHOTOGATE_UNPLUGGED'
              : 'ERR_PHOTOGATE_MISALIGNED';
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            timerDisplaySeconds: 0,
            completedMeasurementSeconds: null,
            portAState: aStandby,
            portBState:
              errCode === 'ERR_PHOTOGATE_UNPLUGGED' ? 'DISCONNECTED' : 'CONNECTED',
            strobePositionsMeters: nextStrobes,
            phase: 'ERROR',
            errorCode: errCode,
            errorMessage:
              errCode === 'ERR_PHOTOGATE_UNPLUGGED'
                ? 'Cổng B chưa kết nối dây tín hiệu! MODE B cần tín hiệu chắn tia từ cổng quang điện B.'
                : 'Cổng quang điện B bị lệch khỏi phương dây dọi nên trụ thép không chắn tia B!',
            statusMessage: 'Lỗi: Không nhận được tín hiệu chắn tia tại cổng B.',
          };
          return this.snapshot;
        }

        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          timerDisplaySeconds: 0,
          portAState: aStandby,
          portBState: this.snapshot.portBConnected ? 'CONNECTED' : 'DISCONNECTED',
          strobePositionsMeters: nextStrobes,
        };
        return this.snapshot;
      }

      if (nextElapsed < tEnterB) {
        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: beamABlocked,
          isBeamBlockedNow: false,
          timerDisplaySeconds: 0,
          portAState: aStandby,
          portBState: 'CONNECTED',
          strobePositionsMeters: nextStrobes,
        };
        return this.snapshot;
      }

      if (nextElapsed >= tEnterB && nextElapsed < tExitB) {
        const currentBlockB = quantizeTimerValue(nextElapsed - tEnterB, scale);
        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: beamABlocked,
          isBeamBlockedNow: true,
          timerDisplaySeconds: currentBlockB,
          measuredTimeBSeconds: currentBlockB,
          portAState: aStandby,
          portBState: 'ACTIVE',
          signalPulseBProgress: (nextElapsed - tEnterB) / exactBlockDurationB,
          strobePositionsMeters: nextStrobes,
          statusMessage: 'MODE B: Trụ thép đang chắn chùm tia cổng B — đồng hồ đang đếm tB...',
        };
        return this.snapshot;
      }

      const finalTB = quantizeTimerValue(exactBlockDurationB, scale);
      if (kinematics.hasHitCatchTray) {
        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: kinematics.timeAtCatchTray,
          cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
          cylinderVelocityMetersPerSec: 0,
          isBeamABlockedNow: false,
          isBeamBlockedNow: false,
          timerDisplaySeconds: finalTB,
          measuredTimeBSeconds: finalTB,
          completedMeasurementSeconds: finalTB,
          portAState: aStandby,
          portBState: 'RECEIVED',
          signalPulseBProgress: 1,
          strobePositionsMeters: nextStrobes,
          phase: 'MEASUREMENT_COMPLETE',
          errorCode: 'NONE',
          errorMessage: null,
          statusMessage: `Hoàn tất MODE B! Thời gian trụ thép chắn chùm tia cổng quang B là tB = ${finalTB.toFixed(
            scale === '9.999' ? 3 : 2
          )} s.`,
        };
        return this.snapshot;
      }

      this.snapshot = {
        ...this.snapshot,
        elapsedFallSeconds: nextElapsed,
        cylinderDropDistanceMeters: kinematics.distanceMeters,
        cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
        isBeamABlockedNow: false,
        isBeamBlockedNow: false,
        timerDisplaySeconds: finalTB,
        measuredTimeBSeconds: finalTB,
        completedMeasurementSeconds: finalTB,
        portAState: aStandby,
        portBState: 'RECEIVED',
        signalPulseBProgress: 1,
        strobePositionsMeters: nextStrobes,
        phase: 'PHOTOGATE_TRIGGERED',
        statusMessage: `MODE B: Đã giải phóng tia cổng B! Chốt thời gian chắn tia tB = ${finalTB.toFixed(
          scale === '9.999' ? 3 : 2
        )} s.`,
      };
      return this.snapshot;
    }

    // =========================================================================
    // 4. THUẬT TOÁN ĐO CHO CHẾ ĐỘ MODE A + B (TỔNG THỜI GIAN CHẮN TIA t = tA + tB)
    // =========================================================================
    if (mode === 'A+B') {
      const canTriggerB =
        this.snapshot.portBConnected &&
        this.snapshot.photogateConnected &&
        alignedB &&
        this.snapshot.targetTriggerSeconds !== null;

      if (!this.snapshot.portAConnected || !canTriggerB) {
        if (kinematics.hasHitCatchTray) {
          const errCode: ErrorCode = !this.snapshot.portAConnected
            ? 'ERR_PORT_A_UNPLUGGED'
            : !this.snapshot.portBConnected || !this.snapshot.photogateConnected
            ? 'ERR_PHOTOGATE_UNPLUGGED'
            : 'ERR_PHOTOGATE_MISALIGNED';

          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            completedMeasurementSeconds: null,
            portAState: this.snapshot.portAConnected ? 'RECEIVED' : 'DISCONNECTED',
            portBState: this.snapshot.portBConnected ? 'CONNECTED' : 'DISCONNECTED',
            strobePositionsMeters: nextStrobes,
            phase: 'ERROR',
            errorCode: errCode,
            errorMessage:
              errCode === 'ERR_PORT_A_UNPLUGGED'
                ? 'Thiếu tín hiệu tại Cổng A! MODE A + B yêu cầu cả hai cổng A và B cùng kết nối để tính tổng t = tA + tB.'
                : 'Thiếu tín hiệu tại Cổng B! MODE A + B yêu cầu cả hai cổng A và B cùng nhận được tín hiệu chắn tia.',
            statusMessage: 'Lỗi: Chưa đủ tín hiệu từ cả hai cổng A và B.',
          };
          return this.snapshot;
        }
      }

      const finalTA = quantizeTimerValue(exactBlockDurationA, scale);
      const finalTB = quantizeTimerValue(exactBlockDurationB, scale);

      let curTA: number | null = null;
      let curTB: number | null = null;
      let pA: PortSignalState = this.snapshot.portAConnected ? 'CONNECTED' : 'DISCONNECTED';
      let pB: PortSignalState = this.snapshot.portBConnected ? 'CONNECTED' : 'DISCONNECTED';

      if (this.snapshot.portAConnected) {
        if (nextElapsed >= tEnterA && nextElapsed < tExitA) {
          curTA = quantizeTimerValue(nextElapsed - tEnterA, scale);
          pA = 'ACTIVE';
        } else if (nextElapsed >= tExitA) {
          curTA = finalTA;
          pA = 'RECEIVED';
        }
      }

      if (canTriggerB) {
        if (nextElapsed >= tEnterB && nextElapsed < tExitB) {
          curTB = quantizeTimerValue(nextElapsed - tEnterB, scale);
          pB = 'ACTIVE';
        } else if (nextElapsed >= tExitB) {
          curTB = finalTB;
          pB = 'RECEIVED';
        }
      }

      const sumAB = quantizeTimerValue((curTA ?? 0) + (curTB ?? 0), scale);

      if (canTriggerB && this.snapshot.portAConnected && nextElapsed >= tExitB) {
        const totalDone = quantizeTimerValue(finalTA + finalTB, scale);
        if (kinematics.hasHitCatchTray) {
          this.snapshot = {
            ...this.snapshot,
            elapsedFallSeconds: kinematics.timeAtCatchTray,
            cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
            cylinderVelocityMetersPerSec: 0,
            isBeamABlockedNow: false,
            isBeamBlockedNow: false,
            measuredTimeASeconds: finalTA,
            measuredTimeBSeconds: finalTB,
            timerDisplaySeconds: totalDone,
            completedMeasurementSeconds: totalDone,
            portAState: 'RECEIVED',
            portBState: 'RECEIVED',
            signalPulseAProgress: 1,
            signalPulseBProgress: 1,
            strobePositionsMeters: nextStrobes,
            phase: 'MEASUREMENT_COMPLETE',
            errorCode: 'NONE',
            errorMessage: null,
            statusMessage: `Hoàn tất MODE A + B! tA = ${finalTA.toFixed(
              3
            )} s, tB = ${finalTB.toFixed(3)} s ⇒ Tổng thời gian chắn tia t = tA + tB = ${totalDone.toFixed(
              3
            )} s.`,
          };
          return this.snapshot;
        }

        this.snapshot = {
          ...this.snapshot,
          elapsedFallSeconds: nextElapsed,
          cylinderDropDistanceMeters: kinematics.distanceMeters,
          cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
          isBeamABlockedNow: false,
          isBeamBlockedNow: false,
          measuredTimeASeconds: finalTA,
          measuredTimeBSeconds: finalTB,
          timerDisplaySeconds: totalDone,
          completedMeasurementSeconds: totalDone,
          portAState: 'RECEIVED',
          portBState: 'RECEIVED',
          signalPulseAProgress: 1,
          signalPulseBProgress: 1,
          strobePositionsMeters: nextStrobes,
          phase: 'PHOTOGATE_TRIGGERED',
          statusMessage: `MODE A + B: tA = ${finalTA.toFixed(3)} s, tB = ${finalTB.toFixed(
            3
          )} s ⇒ Tổng t = tA + tB = ${totalDone.toFixed(3)} s.`,
        };
        return this.snapshot;
      }

      this.snapshot = {
        ...this.snapshot,
        elapsedFallSeconds: nextElapsed,
        cylinderDropDistanceMeters: kinematics.distanceMeters,
        cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
        isBeamABlockedNow: beamABlocked,
        isBeamBlockedNow: beamBBlocked,
        measuredTimeASeconds: curTA,
        measuredTimeBSeconds: curTB,
        timerDisplaySeconds: sumAB,
        portAState: pA,
        portBState: pB,
        signalPulseAProgress: pA === 'ACTIVE' ? 0.5 : pA === 'RECEIVED' ? 1 : 0,
        signalPulseBProgress: pB === 'ACTIVE' ? 0.5 : pB === 'RECEIVED' ? 1 : 0,
        strobePositionsMeters: nextStrobes,
      };
      return this.snapshot;
    }

    // =========================================================================
    // 5. THUẬT TOÁN KHI THẢ RƠI TỰ DO 1 LẦN TRONG MODE T (KHÔNG ĐỦ 2 SỰ KIỆN CHU KÌ)
    // =========================================================================
    const bStandby: PortSignalState = this.snapshot.portBConnected
      ? 'STANDBY'
      : 'DISCONNECTED';

    if (kinematics.hasHitCatchTray) {
      this.snapshot = {
        ...this.snapshot,
        elapsedFallSeconds: kinematics.timeAtCatchTray,
        cylinderDropDistanceMeters: this.config.maxFallDistanceMeters,
        cylinderVelocityMetersPerSec: 0,
        isBeamABlockedNow: false,
        isBeamBlockedNow: false,
        timerDisplaySeconds: 0,
        measuredPeriodTSeconds: null,
        completedMeasurementSeconds: null,
        periodEventCount: this.snapshot.portAConnected ? 1 : 0,
        portAState: this.snapshot.portAConnected ? 'ACTIVE' : 'DISCONNECTED',
        portBState: bStandby,
        strobePositionsMeters: nextStrobes,
        phase: 'ERROR',
        errorCode: 'ERR_INCOMPLETE_PERIOD_EVENTS',
        errorMessage:
          'MODE T (Đo chu kì tuần hoàn): Trụ thép rơi tự do chỉ đi qua cổng 1 lần (mới có 1/2 sự kiện) nên chưa đủ 2 sự kiện tương ứng liên tiếp của một chu kì. Hãy nhấn nút "Đo chu kì tuần hoàn (MODE T)" hoặc chọn MODE A ↔ B để đo rơi tự do.',
        statusMessage: 'MODE T: Chưa đủ 2 sự kiện chu kì liên tiếp.',
      };
      return this.snapshot;
    }

    const passedA = nextElapsed >= tEnterA && this.snapshot.portAConnected;
    this.snapshot = {
      ...this.snapshot,
      elapsedFallSeconds: nextElapsed,
      cylinderDropDistanceMeters: kinematics.distanceMeters,
      cylinderVelocityMetersPerSec: kinematics.velocityMetersPerSec,
      isBeamABlockedNow: beamABlocked,
      isBeamBlockedNow: beamBBlocked,
      periodEventCount: passedA ? 1 : 0,
      timerDisplaySeconds: passedA ? quantizeTimerValue(nextElapsed - tEnterA, scale) : 0,
      portAState: !this.snapshot.portAConnected
        ? 'DISCONNECTED'
        : passedA
        ? 'ACTIVE'
        : 'CONNECTED',
      portBState: bStandby,
      strobePositionsMeters: nextStrobes,
    };
    return this.snapshot;
  }

  /**
   * Di chuyển vị trí cổng quang điện B để chọn quãng đường rơi s (m), hợp lệ từ 0.10 m đến 0.80 m
   */
  public setPhotogateDistance(distanceMeters: number): ExperimentSnapshot {
    if (
      this.snapshot.phase === 'FALLING_TIMER_RUNNING' ||
      this.snapshot.phase === 'PHOTOGATE_TRIGGERED'
    ) {
      return this.snapshot;
    }

    const clamped = Math.max(0.1, Math.min(0.8, Math.round(distanceMeters * 1000) / 1000));
    this.snapshot = {
      ...this.snapshot,
      photogateDistanceMeters: clamped,
      statusMessage: `Đã điều chỉnh vị trí cổng quang điện B: quãng đường s = ${clamped.toFixed(
        3
      )} m (${(clamped * 100).toFixed(1)} cm).`,
    };
    return this.snapshot;
  }

  /**
   * Điều chỉnh vị trí cổng A trên giá đỡ (m) khi kiểm nghiệm cấu hình 2 cổng quang hoặc MODE A / A+B
   */
  public setGateADistance(distanceMeters: number): ExperimentSnapshot {
    if (
      this.snapshot.phase === 'FALLING_TIMER_RUNNING' ||
      this.snapshot.phase === 'PHOTOGATE_TRIGGERED'
    ) {
      return this.snapshot;
    }
    const clamped = Math.max(0.05, Math.min(0.75, Math.round(distanceMeters * 1000) / 1000));
    this.snapshot = {
      ...this.snapshot,
      gateADistanceMeters: clamped,
      statusMessage: `Đã đặt vị trí cổng A tại s_A = ${clamped.toFixed(3)} m (${(
        clamped * 100
      ).toFixed(1)} cm).`,
    };
    return this.snapshot;
  }

  /**
   * Điều chỉnh độ lệch ngang của cổng quang điện B (mm)
   */
  public setPhotogateLateralOffset(offsetMm: number): ExperimentSnapshot {
    const clamped = Math.max(-18, Math.min(18, Math.round(offsetMm * 10) / 10));
    const aligned = isPhotogateBeamAligned(clamped, this.config.cylinderDiameterMeters);
    this.snapshot = {
      ...this.snapshot,
      photogateLateralOffsetMm: clamped,
      errorCode: aligned ? 'NONE' : this.snapshot.errorCode,
      errorMessage: aligned ? null : this.snapshot.errorMessage,
      statusMessage: aligned
        ? `Cổng quang điện B đang thẳng hàng với đường rơi (lệch ngang ${clamped.toFixed(1)} mm).`
        : `Cảnh báo: Cổng quang điện B đang lệch ngang ${clamped.toFixed(
            1
          )} mm khỏi phương dây dọi — trụ thép sẽ không chắn tia!`,
    };
    return this.snapshot;
  }

  /**
   * Cắm hoặc rút dây tín hiệu cổng A (phía trên trên đồng hồ MC964)
   */
  public setPortAConnected(connected: boolean): ExperimentSnapshot {
    this.snapshot.portAConnected = connected;
    this.syncIdlePorts();
    this.snapshot = {
      ...this.snapshot,
      errorCode: connected ? 'NONE' : this.snapshot.errorCode,
      errorMessage: connected ? null : this.snapshot.errorMessage,
      statusMessage: connected
        ? 'Đã kết nối dây tín hiệu vào Cổng A (phía trên) của đồng hồ MC964.'
        : 'Cảnh báo: Đã ngắt kết nối Cổng A trên đồng hồ MC964!',
    };
    return this.snapshot;
  }

  /**
   * Cắm hoặc rút dây tín hiệu cổng quang điện B (phía dưới trên đồng hồ MC964)
   */
  public setPhotogateConnected(connected: boolean): ExperimentSnapshot {
    this.snapshot.photogateConnected = connected;
    this.snapshot.portBConnected = connected;
    this.syncIdlePorts();
    this.snapshot = {
      ...this.snapshot,
      errorCode: connected ? 'NONE' : this.snapshot.errorCode,
      errorMessage: connected ? null : this.snapshot.errorMessage,
      statusMessage: connected
        ? 'Đã cắm dây kết nối cổng quang điện B vào Cổng B (phía dưới) của đồng hồ MC964.'
        : 'Cảnh báo: Đã rút dây Cổng B! Đồng hồ sẽ không nhận được tín hiệu từ cổng quang điện B.',
    };
    return this.snapshot;
  }

  /**
   * Đổi cấu hình sơ đồ chân cắm đồng hồ (Theo SGK Bài 11 hoặc Hai cổng quang độc lập)
   */
  public setWiringVariant(variant: WiringVariant): ExperimentSnapshot {
    this.snapshot = {
      ...this.snapshot,
      wiringVariant: variant,
      statusMessage:
        variant === 'SGK_KNTT'
          ? 'Cấu hình Bài 11 SGK: Cổng A nhận tín hiệu thả vật (công tắc nam châm điện), Cổng B nhận tín hiệu từ cổng quang điện.'
          : 'Cấu hình 2 cổng quang độc lập: Cổng A nối cổng quang A phía trên, Cổng B nối cổng quang B phía dưới.',
    };
    return this.snapshot;
  }

  /**
   * Chọn trực tiếp một chế độ MODE của đồng hồ MC964 ('A', 'B', 'A+B', 'A<->B', 'T')
   */
  public setTimerMode(mode: C3TimerMode): ExperimentSnapshot {
    this.snapshot.c3Mode = mode;
    this.snapshot.measuredTimeASeconds = null;
    this.snapshot.measuredTimeBSeconds = null;
    this.snapshot.measuredPeriodTSeconds = null;
    this.snapshot.periodEventCount = 0;
    this.snapshot.isPeriodicSourceRunning = false;
    this.snapshot.timerDisplaySeconds = 0;
    this.snapshot.completedMeasurementSeconds = null;
    this.snapshot.timerResetReady = this.snapshot.powerOn;
    this.snapshot.errorCode = 'NONE';
    this.snapshot.errorMessage = null;
    if (this.snapshot.powerOn && this.snapshot.cylinderAttachedToMagnet) {
      this.snapshot.phase = 'READY_TO_DROP';
    }
    this.syncIdlePorts();
    const guide = TIMER_MODE_GUIDES[mode];
    this.snapshot = {
      ...this.snapshot,
      statusMessage: `${guide.shortTitle} — ${guide.activePortsText}.`,
    };
    return this.snapshot;
  }

  /**
   * Đổi tuần hoàn chế độ MODE của đồng hồ hiện số MC964
   */
  public cycleTimerMode(): ExperimentSnapshot {
    const modes: C3TimerMode[] = ['A<->B', 'A', 'B', 'A+B', 'T'];
    const idx = modes.indexOf(this.snapshot.c3Mode);
    const nextMode = modes[(idx + 1) % modes.length];
    return this.setTimerMode(nextMode);
  }
}
