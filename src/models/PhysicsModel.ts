/**
 * PhysicsModel.ts
 * Mô hình vật lí rơi tự do cho Bài 11: Thực hành đo gia tốc rơi tự do
 *
 * Phương trình cơ bản:
 *   s(t) = 0.5 * g * t^2
 *   v(t) = g * t
 *   t_ideal = sqrt(2 * s / g)
 *   g = 2 * s / t^2
 *
 * Mốc đo chuẩn:
 *   Từ mặt đáy thấp nhất của trụ thép tại vị trí thả (y = 0 theo hệ trục đường rơi hướng xuống)
 *   đến mặt phẳng tia hồng ngoại của cổng quang điện (y = s).
 */

export type SimulationMode = 'IDEAL' | 'EXPERIMENTAL';

export type GCalculationMethod = 'FROM_MEAN_T' | 'MEAN_OF_G_TRIALS';

export type UncertaintyMethod = 'MEAN_ABSOLUTE_DEV' | 'SAMPLE_STD_DEV' | 'PROPAGATION';

export type TimerScale = '9.999' | '99.99';

export interface PhysicsConfig {
  /** Gia tốc rơi tự do thực của môi trường mô phỏng (m/s²), mặc định 9.81 */
  gravity: number;
  /** Chế độ mô phỏng: LÍ TƯỞNG (không nhiễu) hoặc THỰC NGHIỆM (có sai số ngẫu nhiên nhỏ & trễ nhả từ) */
  mode: SimulationMode;
  /** Độ lệch chuẩn sai số ngẫu nhiên thời gian (s) khi ở chế độ EXPERIMENTAL, mặc định 0.0012 s */
  noiseSigmaSeconds: number;
  /** Độ trễ nhả từ dư trung bình của nam châm điện (s) khi ở chế độ EXPERIMENTAL, mặc định 0.0008 s */
  magneticReleaseDelaySeconds: number;
  /** Thang đo hiển thị đồng hồ: '9.999' (độ chia 0.001 s) hoặc '99.99' (độ chia 0.01 s) */
  timerScale: TimerScale;
  /** Phương pháp tính g trung bình tại mỗi quãng đường */
  gCalculationMethod: GCalculationMethod;
  /** Phương pháp tính sai số Δg */
  uncertaintyMethod: UncertaintyMethod;
  /** Chiều cao trụ thép (m) - dùng để kiểm tra quá trình chắn tia quang điện */
  cylinderHeightMeters: number;
  /** Đường kính trụ thép (m) */
  cylinderDiameterMeters: number;
  /** Tổng hành trình rơi tối đa từ đáy trụ thép lúc giữ đến khay hứng (m) */
  maxFallDistanceMeters: number;
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  gravity: 9.81,
  mode: 'IDEAL',
  noiseSigmaSeconds: 0.0012,
  magneticReleaseDelaySeconds: 0.0006,
  timerScale: '9.999',
  gCalculationMethod: 'FROM_MEAN_T',
  uncertaintyMethod: 'MEAN_ABSOLUTE_DEV',
  cylinderHeightMeters: 0.028, // 28 mm
  cylinderDiameterMeters: 0.016, // 16 mm
  maxFallDistanceMeters: 0.85, // 85 cm
};

/**
 * Bộ tạo số giả ngẫu nhiên có seed (Mulberry32) để sai số thực nghiệm có thể tái lập khi kiểm thử
 */
export function createSeededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Biến đổi Box-Muller tạo phân phối chuẩn chuẩn tắc N(0, 1)
 */
export function sampleStandardNormal(rng: () => number = Math.random): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2.0 * Math.log(u1)) * Math.cos(2.0 * Math.PI * u2);
}

/**
 * Tính thời gian rơi lí tưởng chính xác (s) cho quãng đường s (m) và gia tốc g (m/s²)
 */
export function computeIdealFallTime(distanceMeters: number, gravity: number): number {
  if (distanceMeters <= 0 || gravity <= 0 || !Number.isFinite(distanceMeters) || !Number.isFinite(gravity)) {
    return 0;
  }
  return Math.sqrt((2 * distanceMeters) / gravity);
}

/**
 * Làm tròn thời gian theo độ phân giải của thang đo đồng hồ hiện số
 */
export function quantizeTimerValue(timeSeconds: number, scale: TimerScale): number {
  if (!Number.isFinite(timeSeconds) || timeSeconds < 0) return 0;
  const step = scale === '9.999' ? 0.001 : 0.01;
  const maxVal = scale === '9.999' ? 9.999 : 99.99;
  const clamped = Math.min(timeSeconds, maxVal);
  return Math.round(clamped / step) * step;
}

/**
 * Định dạng số hiển thị trên màn hình LED đồng hồ
 */
export function formatTimerDisplay(timeSeconds: number, scale: TimerScale): string {
  const q = quantizeTimerValue(timeSeconds, scale);
  return scale === '9.999' ? q.toFixed(3) : q.toFixed(2);
}

/**
 * Tính thời gian đo được tại cổng quang điện (s), hỗ trợ cả chế độ Lí tưởng và Thực nghiệm có sai số
 */
export function computeMeasuredFallTime(
  distanceMeters: number,
  config: PhysicsConfig,
  seed?: number
): {
  exactIdealTime: number;
  rawSimulatedTime: number;
  quantizedTime: number;
} {
  const exactIdealTime = computeIdealFallTime(distanceMeters, config.gravity);
  if (exactIdealTime <= 0) {
    return { exactIdealTime: 0, rawSimulatedTime: 0, quantizedTime: 0 };
  }

  let rawSimulatedTime = exactIdealTime;
  if (config.mode === 'EXPERIMENTAL') {
    const rng = seed !== undefined ? createSeededRandom(seed) : Math.random;
    const jitter = sampleStandardNormal(rng) * config.noiseSigmaSeconds;
    const releaseDelay = Math.max(0, config.magneticReleaseDelaySeconds * (0.7 + 0.6 * rng()));
    rawSimulatedTime = Math.max(0.001, exactIdealTime + releaseDelay + jitter);
  }

  const quantizedTime = quantizeTimerValue(rawSimulatedTime, config.timerScale);
  return {
    exactIdealTime,
    rawSimulatedTime,
    quantizedTime,
  };
}

/**
 * Tính vị trí mặt đáy trụ thép s(t) (m) và vận tốc tức thời v(t) (m/s) tại thời điểm t (s) kể từ lúc nhả
 */
export function computeKinematicsAtTime(
  elapsedSeconds: number,
  gravity: number,
  maxFallDistanceMeters: number
): {
  distanceMeters: number;
  velocityMetersPerSec: number;
  hasHitCatchTray: boolean;
  timeAtCatchTray: number;
} {
  const safeT = Math.max(0, elapsedSeconds);
  const safeG = Math.max(0.1, gravity);
  const timeAtCatchTray = computeIdealFallTime(maxFallDistanceMeters, safeG);

  if (safeT >= timeAtCatchTray) {
    return {
      distanceMeters: maxFallDistanceMeters,
      velocityMetersPerSec: 0,
      hasHitCatchTray: true,
      timeAtCatchTray,
    };
  }

  const distanceMeters = 0.5 * safeG * safeT * safeT;
  const velocityMetersPerSec = safeG * safeT;

  return {
    distanceMeters,
    velocityMetersPerSec,
    hasHitCatchTray: false,
    timeAtCatchTray,
  };
}

/**
 * Kiểm tra cổng quang điện có phát hiện được trụ thép hay không.
 * Cổng quang điện phát hiện trụ thép khi trụ thép chắn tia hồng ngoại đi qua tâm khe cổng.
 * Nếu độ lệch ngang |lateralOffsetMm| vượt quá bán kính hiệu dụng của trụ thép chắn tia (~7.5 mm),
 * trụ thép đi lệch khỏi tia hồng ngoại và đồng hồ KHÔNG dừng!
 */
export function isPhotogateBeamAligned(
  lateralOffsetMm: number,
  cylinderDiameterMeters: number = 0.016
): boolean {
  const effectiveRadiusMm = (cylinderDiameterMeters * 1000) * 0.46; // ~7.36 mm cho trụ 16 mm
  return Math.abs(lateralOffsetMm) <= effectiveRadiusMm;
}

/**
 * Kiểm tra tại vị trí rơi hiện tại `currentBottomDistanceMeters`, thân trụ thép có đang chắn tia quang điện tại `photogateDistanceMeters` không
 */
export function isCylinderBlockingBeam(
  currentBottomDistanceMeters: number,
  photogateDistanceMeters: number,
  cylinderHeightMeters: number,
  lateralOffsetMm: number,
  cylinderDiameterMeters: number = 0.016
): boolean {
  if (!isPhotogateBeamAligned(lateralOffsetMm, cylinderDiameterMeters)) {
    return false;
  }
  const topDistanceMeters = currentBottomDistanceMeters - cylinderHeightMeters;
  return (
    currentBottomDistanceMeters >= photogateDistanceMeters &&
    topDistanceMeters <= photogateDistanceMeters
  );
}

/**
 * Tính g = 2s / t^2 từ một cặp (s, t)
 */
export function computeGravityFromMeasurement(distanceMeters: number, timeSeconds: number): number {
  if (distanceMeters <= 0 || timeSeconds <= 0 || !Number.isFinite(distanceMeters) || !Number.isFinite(timeSeconds)) {
    return 0;
  }
  return (2 * distanceMeters) / (timeSeconds * timeSeconds);
}

export interface RowStatistics {
  count: number;
  meanTime: number;
  meanTimeSquared: number;
  trialGravities: number[];
  gFromMeanTime: number;
  meanOfTrialGravities: number;
  selectedG: number;
  deltaG: number;
}

/**
 * Tính thống kê cho một mức quãng đường s với mảng các lần đo thời gian t_1...t_n
 */
export function computeRowStatistics(
  distanceMeters: number,
  times: (number | null)[],
  gMethod: GCalculationMethod = 'FROM_MEAN_T',
  uncertaintyMethod: UncertaintyMethod = 'MEAN_ABSOLUTE_DEV'
): RowStatistics | null {
  const validTimes = times.filter((t): t is number => t !== null && Number.isFinite(t) && t > 0);
  const n = validTimes.length;
  if (n === 0 || distanceMeters <= 0) {
    return null;
  }

  const sumT = validTimes.reduce((acc, t) => acc + t, 0);
  const meanTime = sumT / n;
  const meanTimeSquared = meanTime * meanTime;
  const gFromMeanTime = computeGravityFromMeasurement(distanceMeters, meanTime);

  const trialGravities = validTimes.map((t) => computeGravityFromMeasurement(distanceMeters, t));
  const meanOfTrialGravities = trialGravities.reduce((acc, g) => acc + g, 0) / n;

  const selectedG = gMethod === 'FROM_MEAN_T' ? gFromMeanTime : meanOfTrialGravities;

  let deltaG = 0;
  if (uncertaintyMethod === 'MEAN_ABSOLUTE_DEV') {
    deltaG = trialGravities.reduce((acc, g) => acc + Math.abs(g - selectedG), 0) / n;
  } else if (uncertaintyMethod === 'SAMPLE_STD_DEV') {
    if (n > 1) {
      const variance = trialGravities.reduce((acc, g) => acc + (g - selectedG) ** 2, 0) / (n - 1);
      deltaG = Math.sqrt(variance);
    } else {
      deltaG = 0;
    }
  } else if (uncertaintyMethod === 'PROPAGATION') {
    // Δg / g = Δs / s + 2 * Δt / t_tb (với Δs ≈ 0.001 m = 1 mm)
    const deltaS = 0.001;
    const deltaT =
      n > 1
        ? validTimes.reduce((acc, t) => acc + Math.abs(t - meanTime), 0) / n
        : 0.001;
    deltaG = selectedG * (deltaS / distanceMeters + (2 * deltaT) / meanTime);
  }

  return {
    count: n,
    meanTime,
    meanTimeSquared,
    trialGravities,
    gFromMeanTime,
    meanOfTrialGravities,
    selectedG,
    deltaG,
  };
}

export interface LinearRegressionResult {
  slopeK: number;
  interceptB: number;
  estimatedG: number;
  rSquared: number;
  pointCount: number;
  forcedThroughOrigin: boolean;
}

/**
 * Hồi quy tuyến tính đồ thị s theo t^2:
 *   Trục hoành x = t^2 (s^2)
 *   Trục tung y = s (m)
 *   Hệ số góc k = g / 2 => g = 2 * k
 */
export function computeLinearRegressionSvsT2(
  points: { tSquared: number; sMeters: number }[],
  forceOrigin: boolean = false
): LinearRegressionResult | null {
  const valid = points.filter(
    (p) => Number.isFinite(p.tSquared) && Number.isFinite(p.sMeters) && p.tSquared > 0 && p.sMeters > 0
  );
  const n = valid.length;
  if (n < 2 && !(forceOrigin && n === 1)) {
    return null;
  }

  if (forceOrigin) {
    // s = k * t^2 => k = sum(x_i * y_i) / sum(x_i^2)
    let sumXY = 0;
    let sumXX = 0;
    let sumY = 0;
    for (const p of valid) {
      sumXY += p.tSquared * p.sMeters;
      sumXX += p.tSquared * p.tSquared;
      sumY += p.sMeters;
    }
    if (sumXX === 0) return null;
    const slopeK = sumXY / sumXX;
    const meanY = sumY / n;
    let ssRes = 0;
    let ssTot = 0;
    for (const p of valid) {
      const yPred = slopeK * p.tSquared;
      ssRes += (p.sMeters - yPred) ** 2;
      ssTot += (p.sMeters - meanY) ** 2;
    }
    const rSquared = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1;
    return {
      slopeK,
      interceptB: 0,
      estimatedG: 2 * slopeK,
      rSquared,
      pointCount: n,
      forcedThroughOrigin: true,
    };
  }

  // Hồi quy tuyến tính tổng quát s = k * t^2 + b (không mặc định ép qua gốc)
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;

  for (const p of valid) {
    sumX += p.tSquared;
    sumY += p.sMeters;
    sumXY += p.tSquared * p.sMeters;
    sumXX += p.tSquared * p.tSquared;
  }

  const denom = n * sumXX - sumX * sumX;
  if (Math.abs(denom) < 1e-15) {
    return null;
  }

  const slopeK = (n * sumXY - sumX * sumY) / denom;
  const interceptB = (sumY - slopeK * sumX) / n;
  const meanY = sumY / n;

  let ssRes = 0;
  let ssTot = 0;
  for (const p of valid) {
    const yPred = slopeK * p.tSquared + interceptB;
    ssRes += (p.sMeters - yPred) ** 2;
    ssTot += (p.sMeters - meanY) ** 2;
  }

  const rSquared = ssTot > 1e-12 ? Math.max(0, 1 - ssRes / ssTot) : 1;

  return {
    slopeK,
    interceptB,
    estimatedG: 2 * slopeK,
    rSquared,
    pointCount: n,
    forcedThroughOrigin: false,
  };
}
