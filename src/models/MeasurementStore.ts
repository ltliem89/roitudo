/**
 * MeasurementStore.ts
 * Quản lí bảng số liệu 5 mức quãng đường (s1..s5) × tối đa 5 lần đo mỗi mức (t1..t5),
 * tính toán thống kê và xuất dữ liệu CSV.
 *
 * Tuân thủ nghiêm ngặt đặc tả:
 * - Không tự điền dữ liệu trước khi học sinh thực hành đo.
 * - Nút đặt lại trụ thép hoặc reset đồng hồ không xóa bảng số liệu.
 * - Có chức năng Ghi kết quả, Xóa lần đo, Xuất CSV và Xóa bảng (có xác nhận).
 */

import {
  GCalculationMethod,
  UncertaintyMethod,
  RowStatistics,
  computeRowStatistics,
  computeLinearRegressionSvsT2,
  LinearRegressionResult,
} from './PhysicsModel';

export interface DistanceRowData {
  id: string;
  label: string; // 's₁', 's₂', 's₃', 's₄', 's₅'
  distanceMeters: number; // Giá trị s (m), ví dụ 0.20, 0.30, 0.40, 0.50, 0.60
  trials: [number | null, number | null, number | null, number | null, number | null];
}

export const INITIAL_DISTANCE_ROWS: DistanceRowData[] = [
  { id: 's1', label: 's₁', distanceMeters: 0.2, trials: [null, null, null, null, null] },
  { id: 's2', label: 's₂', distanceMeters: 0.3, trials: [null, null, null, null, null] },
  { id: 's3', label: 's₃', distanceMeters: 0.4, trials: [null, null, null, null, null] },
  { id: 's4', label: 's₄', distanceMeters: 0.5, trials: [null, null, null, null, null] },
  { id: 's5', label: 's₅', distanceMeters: 0.6, trials: [null, null, null, null, null] },
];

export interface SummaryStatistics {
  validRowsCount: number;
  totalTrialsCount: number;
  meanG: number | null;
  deltaG: number | null;
  regression: LinearRegressionResult | null;
}

/**
 * Ghi một kết quả đo (s, t) vào bảng 5 mức × 5 lần đo:
 * - Nếu đã có dòng trùng với quãng đường s (sai lệch <= 0.002 m) và còn ô trống, điền vào ô trống tiếp theo.
 * - Nếu chưa có dòng trùng s, tìm một dòng hoàn toàn chưa có lần đo nào để gán quãng đường s mới và ghi t₁.
 * - Nếu dòng trùng s đã đủ 5 lần đo, ghi đè lần đo thứ 5 hoặc báo đã đầy.
 */
export function recordMeasurementToRows(
  rows: DistanceRowData[],
  distanceMeters: number,
  timeSeconds: number
): {
  updatedRows: DistanceRowData[];
  recordedRowIndex: number;
  recordedTrialIndex: number;
  message: string;
} {
  const nextRows: DistanceRowData[] = rows.map((r) => ({
    ...r,
    trials: [...r.trials] as [number | null, number | null, number | null, number | null, number | null],
  }));

  // 1. Tìm dòng có cùng quãng đường s (trong ngưỡng 0.001 m)
  let targetRowIdx = nextRows.findIndex(
    (r) => Math.abs(r.distanceMeters - distanceMeters) < 0.0015
  );

  // 2. Nếu chưa có dòng trùng s, tìm dòng đầu tiên hoàn toàn trống để gán s mới
  if (targetRowIdx === -1) {
    const emptyRowIdx = nextRows.findIndex((r) => r.trials.every((t) => t === null));
    if (emptyRowIdx !== -1) {
      targetRowIdx = emptyRowIdx;
      nextRows[targetRowIdx].distanceMeters = distanceMeters;
    } else {
      // Nếu cả 5 dòng đều đã có dữ liệu, chọn dòng có s gần nhất
      let bestIdx = 0;
      let bestDiff = Infinity;
      nextRows.forEach((r, idx) => {
        const diff = Math.abs(r.distanceMeters - distanceMeters);
        if (diff < bestDiff) {
          bestDiff = diff;
          bestIdx = idx;
        }
      });
      targetRowIdx = bestIdx;
      // Nếu khác s thì reset dòng đó sang s mới
      if (bestDiff >= 0.0015) {
        nextRows[targetRowIdx].distanceMeters = distanceMeters;
        nextRows[targetRowIdx].trials = [null, null, null, null, null];
      }
    }
  }

  const row = nextRows[targetRowIdx];
  let trialIdx = row.trials.findIndex((t) => t === null);
  if (trialIdx === -1) {
    // Đã đủ 5 lần đo, cập nhật ô thứ 5 (index 4)
    trialIdx = 4;
  }

  row.trials[trialIdx] = timeSeconds;

  return {
    updatedRows: nextRows,
    recordedRowIndex: targetRowIdx,
    recordedTrialIndex: trialIdx,
    message: `Đã ghi vào mức ${row.label} (s = ${row.distanceMeters.toFixed(3)} m), lần đo thứ ${trialIdx + 1}: t = ${timeSeconds.toFixed(3)} s.`,
  };
}

/**
 * Xóa một ô đo cụ thể trong bảng
 */
export function deleteSingleTrial(
  rows: DistanceRowData[],
  rowIndex: number,
  trialIndex: number
): DistanceRowData[] {
  return rows.map((r, rIdx) => {
    if (rIdx !== rowIndex) return r;
    const nextTrials = [...r.trials] as [
      number | null,
      number | null,
      number | null,
      number | null,
      number | null,
    ];
    nextTrials[trialIndex] = null;
    return {
      ...r,
      trials: nextTrials,
    };
  });
}

/**
 * Tính toán tổng hợp toàn bộ bảng số liệu và hồi quy đồ thị s theo t²
 */
export function computeTableSummary(
  rows: DistanceRowData[],
  gMethod: GCalculationMethod,
  uncertaintyMethod: UncertaintyMethod,
  forceOriginRegression: boolean
): {
  rowStats: (RowStatistics | null)[];
  summary: SummaryStatistics;
  graphPoints: { label: string; sMeters: number; meanTime: number; tSquared: number; gValue: number }[];
} {
  const rowStats = rows.map((r) =>
    computeRowStatistics(r.distanceMeters, r.trials, gMethod, uncertaintyMethod)
  );

  const validEntries: { row: DistanceRowData; stats: RowStatistics }[] = [];
  let totalTrialsCount = 0;

  rows.forEach((r, idx) => {
    const st = rowStats[idx];
    if (st) {
      validEntries.push({ row: r, stats: st });
      totalTrialsCount += st.count;
    }
  });

  const graphPoints = validEntries.map(({ row, stats }) => ({
    label: row.label,
    sMeters: row.distanceMeters,
    meanTime: stats.meanTime,
    tSquared: stats.meanTimeSquared,
    gValue: stats.selectedG,
  }));

  let meanG: number | null = null;
  let deltaG: number | null = null;

  if (validEntries.length > 0) {
    const gList = validEntries.map((e) => e.stats.selectedG);
    meanG = gList.reduce((a, b) => a + b, 0) / gList.length;

    if (validEntries.length > 1) {
      if (uncertaintyMethod === 'SAMPLE_STD_DEV') {
        const variance =
          gList.reduce((acc, g) => acc + (g - (meanG as number)) ** 2, 0) / (gList.length - 1);
        deltaG = Math.sqrt(variance);
      } else {
        deltaG =
          gList.reduce((acc, g) => acc + Math.abs(g - (meanG as number)), 0) / gList.length;
      }
    } else {
      deltaG = validEntries[0].stats.deltaG;
    }
  }

  const regression = computeLinearRegressionSvsT2(
    graphPoints.map((p) => ({ tSquared: p.tSquared, sMeters: p.sMeters })),
    forceOriginRegression
  );

  return {
    rowStats,
    summary: {
      validRowsCount: validEntries.length,
      totalTrialsCount,
      meanG,
      deltaG,
      regression,
    },
    graphPoints,
  };
}

/**
 * Tạo chuỗi nội dung CSV chuẩn UTF-8 (có BOM cho Excel tiếng Việt) để tải xuống
 */
export function exportTableToCSV(
  rows: DistanceRowData[],
  gMethod: GCalculationMethod,
  uncertaintyMethod: UncertaintyMethod,
  forceOriginRegression: boolean
): string {
  const { rowStats, summary } = computeTableSummary(
    rows,
    gMethod,
    uncertaintyMethod,
    forceOriginRegression
  );

  const headers = [
    'Mức quãng đường',
    's (m)',
    'Lần 1 t1 (s)',
    'Lần 2 t2 (s)',
    'Lần 3 t3 (s)',
    'Lần 4 t4 (s)',
    'Lần 5 t5 (s)',
    't_tb (s)',
    't_tb^2 (s^2)',
    'g (m/s^2)',
    'Delta g (m/s^2)',
  ];

  const lines: string[] = [headers.join(',')];

  rows.forEach((r, idx) => {
    const st = rowStats[idx];
    const cols = [
      r.label,
      r.distanceMeters.toFixed(3),
      ...r.trials.map((t) => (t !== null ? t.toFixed(3) : '')),
      st ? st.meanTime.toFixed(4) : '',
      st ? st.meanTimeSquared.toFixed(5) : '',
      st ? st.selectedG.toFixed(3) : '',
      st ? st.deltaG.toFixed(3) : '',
    ];
    lines.push(cols.join(','));
  });

  lines.push('');
  if (summary.meanG !== null) {
    lines.push(`Gia tốc trọng trường trung bình g_tb (m/s^2),${summary.meanG.toFixed(3)}`);
    lines.push(`Sai số tuyệt đối Delta g (m/s^2),${(summary.deltaG ?? 0).toFixed(3)}`);
  }
  if (summary.regression) {
    lines.push(`Hệ số góc đồ thị k = s/t^2 (m/s^2),${summary.regression.slopeK.toFixed(4)}`);
    lines.push(`Gia tốc từ hệ số góc g = 2k (m/s^2),${summary.regression.estimatedG.toFixed(3)}`);
    lines.push(`Hệ số xác định R^2,${summary.regression.rSquared.toFixed(5)}`);
  }

  return '\uFEFF' + lines.join('\n');
}
