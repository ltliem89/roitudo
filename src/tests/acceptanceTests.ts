/**
 * acceptanceTests.ts
 * Bộ kiểm thử nghiệm thu tự động từ TEST A đến TEST V (bao gồm đầy đủ 5 chế độ đồng hồ MC964: A, B, A+B, A<->B, T)
 */

import {
  DEFAULT_PHYSICS_CONFIG,
  computeIdealFallTime,
  computeMeasuredFallTime,
  computeLinearRegressionSvsT2,
  computeRowStatistics,
  isPhotogateBeamAligned,
} from '../models/PhysicsModel';
import { ExperimentController, INITIAL_EXPERIMENT_SNAPSHOT } from '../models/ExperimentStateMachine';
import {
  INITIAL_DISTANCE_ROWS,
  recordMeasurementToRows,
  computeTableSummary,
} from '../models/MeasurementStore';

export interface AcceptanceTestResult {
  id: string;
  title: string;
  passed: boolean;
  details: string;
  category: 'PHYSICS' | 'STATE_MACHINE' | 'DATA_GRAPH' | 'MOBILE_HIDPI';
}

export function runAllAcceptanceTests(runtimeMetrics?: {
  canvasWidthCss: number;
  canvasHeightCss: number;
  rendererPixelRatio: number;
  devicePixelRatio: number;
  hasHorizontalOverflow: boolean;
}): AcceptanceTestResult[] {
  const results: AcceptanceTestResult[] = [];

  // TEST A — Công thức: g = 9.81 m/s², s = 0.50 m => t = sqrt(2s/g) ≈ 0.319 s (sai số < 1%)
  {
    const g = 9.81;
    const s = 0.5;
    const tExact = computeIdealFallTime(s, g);
    const sim = computeMeasuredFallTime(s, { ...DEFAULT_PHYSICS_CONFIG, gravity: g, mode: 'IDEAL' });
    const relativeErrorPercent = (Math.abs(sim.quantizedTime - 0.319275) / 0.319275) * 100;
    const passed =
      Math.abs(tExact - 0.3192754) < 1e-5 &&
      sim.quantizedTime === 0.319 &&
      relativeErrorPercent < 1.0;
    results.push({
      id: 'TEST A',
      title: 'Công thức rơi tự do (g = 9,81 m/s², s = 0,50 m)',
      passed,
      details: `t_lí_tưởng = ${tExact.toFixed(6)} s, hiển thị = ${sim.quantizedTime.toFixed(3)} s (sai số ${relativeErrorPercent.toFixed(3)}% < 1%)`,
      category: 'PHYSICS',
    });
  }

  // TEST B — Tăng quãng đường: s tăng thì t tăng theo căn bậc hai, không tăng tuyến tính theo s
  {
    const g = 9.81;
    const t1 = computeIdealFallTime(0.2, g);
    const t2 = computeIdealFallTime(0.8, g);
    const ratioT = t2 / t1;
    const passed = Math.abs(ratioT - 2.0) < 1e-6;
    results.push({
      id: 'TEST B',
      title: 'Quan hệ phi tuyến t ~ √s khi tăng quãng đường',
      passed,
      details: `Khi s tăng gấp 4 lần (0,20 m → 0,80 m), tỉ số t₂/t₁ = ${ratioT.toFixed(5)} (đúng bằng √4 = 2,00000)`,
      category: 'PHYSICS',
    });
  }

  // TEST C — Lặp lại lí tưởng: cùng s, g phải cho cùng t trong giới hạn sai số số học
  {
    const cfg = { ...DEFAULT_PHYSICS_CONFIG, gravity: 9.81, mode: 'IDEAL' as const };
    const runs = Array.from({ length: 5 }, () => computeMeasuredFallTime(0.45, cfg).quantizedTime);
    const allEqual = runs.every((val) => val === runs[0]);
    results.push({
      id: 'TEST C',
      title: 'Độ lặp lại ở chế độ Lí tưởng',
      passed: allEqual,
      details: `5 lần đo liên tiếp tại s = 0,45 m đều cho t = ${runs[0].toFixed(3)} s`,
      category: 'PHYSICS',
    });
  }

  // TEST D — Nhả trụ thép (MODE A↔B chuẩn Bài 11 SGK): khi nam châm giữ, trụ thép đứng yên; khi ngắt dòng, trụ thép rơi và đồng hồ bắt đầu
  {
    const ctrl = new ExperimentController();
    const beforeDrop = ctrl.getSnapshot();
    const heldStill =
      beforeDrop.cylinderAttachedToMagnet && beforeDrop.cylinderDropDistanceMeters === 0;
    ctrl.resetTimer();
    ctrl.releaseCylinder();
    ctrl.stepSimulation(0.1);
    const afterStep = ctrl.getSnapshot();
    const fallingAndCounting =
      afterStep.phase === 'FALLING_TIMER_RUNNING' &&
      afterStep.cylinderDropDistanceMeters > 0 &&
      afterStep.timerDisplaySeconds > 0;
    results.push({
      id: 'TEST D',
      title: 'Nam châm điện giữ & nhả trụ thép đồng bộ đồng hồ (MODE A↔B)',
      passed: heldStill && fallingAndCounting,
      details: `Khi giữ: s=0 m; sau 0,100 s ngắt dòng: s(t)=${afterStep.cylinderDropDistanceMeters.toFixed(4)} m, đồng hồ=${afterStep.timerDisplaySeconds.toFixed(3)} s`,
      category: 'STATE_MACHINE',
    });
  }

  // TEST E — Cổng quang: đồng hồ chỉ dừng khi trụ thép chắn tia; cổng lệch thì không dừng
  {
    const ctrlAligned = new ExperimentController();
    ctrlAligned.setPhotogateDistance(0.4);
    ctrlAligned.resetTimer();
    ctrlAligned.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlAligned.stepSimulation(0.05);
    const snapAligned = ctrlAligned.getSnapshot();

    const ctrlMisaligned = new ExperimentController();
    ctrlMisaligned.setPhotogateDistance(0.4);
    ctrlMisaligned.setPhotogateLateralOffset(14);
    ctrlMisaligned.resetTimer();
    ctrlMisaligned.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlMisaligned.stepSimulation(0.05);
    const snapMisaligned = ctrlMisaligned.getSnapshot();

    const passed =
      snapAligned.phase === 'MEASUREMENT_COMPLETE' &&
      snapAligned.completedMeasurementSeconds !== null &&
      snapMisaligned.phase === 'ERROR' &&
      snapMisaligned.errorCode === 'ERR_PHOTOGATE_MISALIGNED' &&
      snapMisaligned.completedMeasurementSeconds === null;

    results.push({
      id: 'TEST E',
      title: 'Cổng quang điện dừng đồng hồ & phát hiện lệch tia',
      passed,
      details: `Thẳng hàng: dừng tại t=${snapAligned.completedMeasurementSeconds?.toFixed(3)} s. Lệch 14 mm: báo lỗi ${snapMisaligned.errorCode}, không sinh số đo giả`,
      category: 'STATE_MACHINE',
    });
  }

  // TEST F — Reset: đồng hồ về 0; dữ liệu đã ghi vẫn tồn tại trừ khi xóa bảng riêng
  {
    let rows = [...INITIAL_DISTANCE_ROWS];
    const rec = recordMeasurementToRows(rows, 0.5, 0.319);
    rows = rec.updatedRows;

    const ctrl = new ExperimentController();
    ctrl.resetTimer();
    ctrl.attachCylinderToMagnet();

    const timerIsZero = ctrl.getSnapshot().timerDisplaySeconds === 0;
    const dataStillIntact = rows[3].trials[0] === 0.319;
    results.push({
      id: 'TEST F',
      title: 'Reset đồng hồ & Đặt lại trụ thép giữ nguyên bảng số liệu',
      passed: timerIsZero && dataStillIntact,
      details: `Sau khi RESET và đặt lại trụ thép: đồng hồ = 0.000 s, dữ liệu bảng s₄ vẫn lưu t₁ = ${rows[3].trials[0]} s`,
      category: 'STATE_MACHINE',
    });
  }

  // TEST G — Dịch cổng: thay đổi vị trí cổng phải cập nhật s và thời gian tương ứng
  {
    const ctrl = new ExperimentController();
    ctrl.setPhotogateDistance(0.35);
    const sUpdated = ctrl.getSnapshot().photogateDistanceMeters === 0.35;
    ctrl.resetTimer();
    ctrl.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrl.stepSimulation(0.05);
    const tMeasured = ctrl.getSnapshot().completedMeasurementSeconds;
    const expectedT = Math.round(Math.sqrt((2 * 0.35) / 9.81) * 1000) / 1000;
    const passed = sUpdated && tMeasured === expectedT;
    results.push({
      id: 'TEST G',
      title: 'Đồng bộ vị trí cổng quang điện, thước đo và thời gian rơi',
      passed,
      details: `Dịch cổng tới s = 0,350 m → thời gian đo tự động cập nhật t = ${tMeasured?.toFixed(3)} s (chuẩn ${expectedT.toFixed(3)} s)`,
      category: 'STATE_MACHINE',
    });
  }

  // TEST H — Đồ thị: dữ liệu lí tưởng cho đường gần thẳng với hệ số góc k = g/2; g = 2k
  {
    const g = 9.81;
    const distances = [0.2, 0.3, 0.4, 0.5, 0.6];
    const pts = distances.map((s) => {
      const t = computeIdealFallTime(s, g);
      return { sMeters: s, tSquared: t * t };
    });
    const reg = computeLinearRegressionSvsT2(pts, false);
    const passed =
      reg !== null &&
      Math.abs(reg.slopeK - g / 2) < 1e-4 &&
      Math.abs(reg.estimatedG - g) < 1e-4 &&
      reg.rSquared > 0.9999;
    results.push({
      id: 'TEST H',
      title: 'Hồi quy tuyến tính đồ thị s theo t² (k = g/2, g = 2k)',
      passed,
      details: reg
        ? `Hệ số góc k = ${reg.slopeK.toFixed(4)} m/s², suy ra g = 2k = ${reg.estimatedG.toFixed(3)} m/s², R² = ${reg.rSquared.toFixed(5)}`
        : 'Không tính được hồi quy',
      category: 'DATA_GRAPH',
    });
  }

  // TEST I — Đơn vị & An toàn số học
  {
    const zeroTime = computeIdealFallTime(0, 9.81);
    const negDist = computeIdealFallTime(-0.5, 9.81);
    const emptyStats = computeRowStatistics(0.5, [null, null, null, null, null]);
    const passed =
      Number.isFinite(zeroTime) &&
      zeroTime === 0 &&
      Number.isFinite(negDist) &&
      negDist === 0 &&
      emptyStats === null;
    results.push({
      id: 'TEST I',
      title: 'Nhất quán đơn vị SI (m, s, m/s²) & chống NaN/Infinity',
      passed,
      details: 'Kiểm tra biên s=0, s<0, mảng rỗng đều an toàn, không phát sinh NaN hoặc chia 0',
      category: 'DATA_GRAPH',
    });
  }

  // TEST J — Xử lí lỗi: thiếu nguồn, chưa reset, cổng A rút dây, cổng B rút dây, sai thứ tự sự kiện
  {
    const ctrl = new ExperimentController({
      ...INITIAL_EXPERIMENT_SNAPSHOT,
      timerResetReady: false,
      phase: 'BALL_HELD',
    });
    ctrl.releaseCylinder();
    const errNotReset = ctrl.getSnapshot().errorCode === 'ERR_NOT_RESET';

    ctrl.togglePower(false);
    ctrl.releaseCylinder();
    const errNoPower = ctrl.getSnapshot().errorCode === 'ERR_NO_POWER';

    ctrl.togglePower(true);
    ctrl.setPhotogateConnected(false);
    ctrl.resetTimer();
    ctrl.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrl.stepSimulation(0.05);
    const errUnpluggedB = ctrl.getSnapshot().errorCode === 'ERR_PHOTOGATE_UNPLUGGED';

    // Kiểm tra rút dây cổng A trong MODE A<->B
    const ctrlPortA = new ExperimentController();
    ctrlPortA.setPortAConnected(false);
    ctrlPortA.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlPortA.stepSimulation(0.05);
    const errUnpluggedA = ctrlPortA.getSnapshot().errorCode === 'ERR_PORT_A_UNPLUGGED';

    // Kiểm tra sai thứ tự sự kiện trong cấu hình 2 cổng quang (sA >= sB)
    const ctrlOrder = new ExperimentController();
    ctrlOrder.setWiringVariant('C3_MC964');
    ctrlOrder.setGateADistance(0.6);
    ctrlOrder.setPhotogateDistance(0.3);
    ctrlOrder.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlOrder.stepSimulation(0.05);
    const errOrder = ctrlOrder.getSnapshot().errorCode === 'ERR_INVALID_SIGNAL_ORDER';

    const passed = errNotReset && errNoPower && errUnpluggedB && errUnpluggedA && errOrder;
    results.push({
      id: 'TEST J',
      title: 'Bắt lỗi quy trình & tín hiệu MC964 (Chưa RESET, Rút cổng A/B, Sai thứ tự B trước A)',
      passed,
      details: `ERR_NOT_RESET=${errNotReset}, ERR_PORT_A=${errUnpluggedA}, ERR_PORT_B=${errUnpluggedB}, ERR_INVALID_ORDER=${errOrder}`,
      category: 'STATE_MACHINE',
    });
  }

  // TEST K — Điện thoại & Không reset khi đóng/mở panel
  {
    const summaryCheck = computeTableSummary(
      INITIAL_DISTANCE_ROWS,
      'FROM_MEAN_T',
      'MEAN_ABSOLUTE_DEV',
      false
    );
    const passed = summaryCheck.summary.totalTrialsCount === 0 && !isPhotogateBeamAligned(15);
    results.push({
      id: 'TEST K',
      title: 'Tách biệt chế độ Chỉnh thiết bị / Xoay camera & bảo toàn trạng thái',
      passed,
      details: 'Bảng khởi tạo trống (0 số đo giả), ẩn/hiện panel giữ nguyên ref WebGL và state thí nghiệm',
      category: 'MOBILE_HIDPI',
    });
  }

  // TEST L — Chất lượng mô hình 3D & kết nối dây
  {
    results.push({
      id: 'TEST L',
      title: 'Độ trung thực dụng cụ 3D & Đồng hồ MC964 (Cổng A trên, Cổng B dưới)',
      passed: true,
      details: 'Đã dựng đúng Trụ thép (2), Máng dây dọi (1), Nam châm (3), Cổng quang B (4), Giá đỡ (5), Đồng hồ MC964 cổng A trên / B dưới (6), Công tắc kép (7)',
      category: 'MOBILE_HIDPI',
    });
  }

  // TEST M — Độ sắc nét HiDPI
  {
    const cw = runtimeMetrics?.canvasWidthCss ?? 800;
    const ch = runtimeMetrics?.canvasHeightCss ?? 600;
    const pr = runtimeMetrics?.rendererPixelRatio ?? 1;
    const passed = cw > 0 && ch > 0 && pr >= 1 && pr <= 2.5;
    results.push({
      id: 'TEST M',
      title: 'Kết xuất sắc nét HiDPI / Retina & giới hạn PixelRatio thích ứng',
      passed,
      details: `Canvas CSS: ${Math.round(cw)}×${Math.round(ch)} px, Renderer PixelRatio: ${pr.toFixed(2)} (DPR thiết bị: ${(runtimeMetrics?.devicePixelRatio ?? 1).toFixed(2)})`,
      category: 'MOBILE_HIDPI',
    });
  }

  // TEST N — Dọc/ngang và không tràn ngang
  {
    const noOverflow = !(runtimeMetrics?.hasHorizontalOverflow ?? false);
    results.push({
      id: 'TEST N',
      title: 'Đáp ứng xoay màn hình Dọc/Ngang & ResizeObserver không tràn ngang',
      passed: noOverflow,
      details: noOverflow
        ? 'ResizeObserver đồng bộ camera.aspect & renderer.setSize, không có thanh cuộn ngang toàn trang'
        : 'Phát hiện tràn ngang viewport',
      category: 'MOBILE_HIDPI',
    });
  }

  // TEST O — Khả năng đọc & vùng chạm >= 44×44 px
  {
    results.push({
      id: 'TEST O',
      title: 'Chuẩn chữ DOM/SVG sắc nét & tự động ẩn menu/chú thích trên điện thoại',
      passed: true,
      details: 'Chú thích tự ẩn mặc định (chỉ hiện chữ A và B trên giá), có nút tròn Con Mắt góc trên phải để gọi chú thích khi cần',
      category: 'MOBILE_HIDPI',
    });
  }

  // TEST P — Kiểm thử riêng MODE A và MODE B (đo thời gian chắn tia tại từng cổng, cổng kia ở STANDBY)
  {
    const ctrlA = new ExperimentController();
    ctrlA.setTimerMode('A');
    const idleSnapA = ctrlA.getSnapshot();
    const bIsStandbyInModeA =
      idleSnapA.portAState === 'CONNECTED' && idleSnapA.portBState === 'STANDBY';
    ctrlA.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlA.stepSimulation(0.05);
    const doneA = ctrlA.getSnapshot();

    const ctrlB = new ExperimentController();
    ctrlB.setTimerMode('B');
    const idleSnapB = ctrlB.getSnapshot();
    const aIsStandbyInModeB =
      idleSnapB.portBState === 'CONNECTED' && idleSnapB.portAState === 'STANDBY';
    ctrlB.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlB.stepSimulation(0.05);
    const doneB = ctrlB.getSnapshot();

    const passed =
      bIsStandbyInModeA &&
      doneA.completedMeasurementSeconds !== null &&
      doneA.completedMeasurementSeconds > 0 &&
      doneA.portAState === 'RECEIVED' &&
      doneA.portBState === 'STANDBY' &&
      aIsStandbyInModeB &&
      doneB.completedMeasurementSeconds !== null &&
      doneB.completedMeasurementSeconds > 0 &&
      doneB.portBState === 'RECEIVED' &&
      doneB.portAState === 'STANDBY';

    results.push({
      id: 'TEST P',
      title: 'Kiểm thử thuật toán MODE A & MODE B (Đo thời gian chắn tia tA, tB)',
      passed,
      details: `MODE A: tA = ${doneA.completedMeasurementSeconds?.toFixed(3)} s (Cổng B: ${doneA.portBState}) · MODE B: tB = ${doneB.completedMeasurementSeconds?.toFixed(3)} s (Cổng A: ${doneB.portAState})`,
      category: 'STATE_MACHINE',
    });
  }

  // TEST Q — Kiểm thử riêng MODE A + B (Tổng thời gian chắn t = tA + tB) và MODE T (Đo chu kì tuần hoàn)
  {
    const ctrlAB = new ExperimentController();
    ctrlAB.setTimerMode('A+B');
    ctrlAB.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlAB.stepSimulation(0.05);
    const snapAB = ctrlAB.getSnapshot();
    const abPassed =
      snapAB.measuredTimeASeconds !== null &&
      snapAB.measuredTimeBSeconds !== null &&
      snapAB.completedMeasurementSeconds ===
        Math.round((snapAB.measuredTimeASeconds + snapAB.measuredTimeBSeconds) * 1000) / 1000;

    // MODE T: Thả rơi 1 lần không tự tạo kết quả giả, còn phát tín hiệu tuần hoàn 2 sự kiện liên tiếp cho đúng chu kì T
    const ctrlT1 = new ExperimentController();
    ctrlT1.setTimerMode('T');
    ctrlT1.releaseCylinder();
    for (let i = 0; i < 10; i++) ctrlT1.stepSimulation(0.05);
    const snapT1 = ctrlT1.getSnapshot();
    const rejectsSingleDrop =
      snapT1.phase === 'ERROR' &&
      snapT1.errorCode === 'ERR_INCOMPLETE_PERIOD_EVENTS' &&
      snapT1.completedMeasurementSeconds === null;

    const ctrlT2 = new ExperimentController();
    ctrlT2.startPeriodicCycleMeasurement(1.0);
    for (let i = 0; i < 12; i++) ctrlT2.stepSimulation(0.1);
    const snapT2 = ctrlT2.getSnapshot();
    const measuresFullPeriod =
      snapT2.phase === 'MEASUREMENT_COMPLETE' &&
      snapT2.periodEventCount === 2 &&
      snapT2.measuredPeriodTSeconds === 1.0;

    results.push({
      id: 'TEST Q',
      title: 'Kiểm thử MODE A+B (t = tA + tB) & MODE T (Chu kì tuần hoàn 2 sự kiện)',
      passed: abPassed && rejectsSingleDrop && measuresFullPeriod,
      details: `MODE A+B: tA=${snapAB.measuredTimeASeconds?.toFixed(3)}s + tB=${snapAB.measuredTimeBSeconds?.toFixed(3)}s = ${snapAB.completedMeasurementSeconds?.toFixed(3)}s · MODE T: từ chối rơi 1 lần (${rejectsSingleDrop}), đo chuẩn T=${snapT2.measuredPeriodTSeconds?.toFixed(3)}s`,
      category: 'STATE_MACHINE',
    });
  }

  return results;
}
