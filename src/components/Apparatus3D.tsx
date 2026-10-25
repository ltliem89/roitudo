import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  Eye,
  EyeOff,
} from 'lucide-react';
import {
  ExperimentSnapshot,
  PORT_STATE_LABELS,
  PortSignalState,
} from '../models/ExperimentStateMachine';
import { PhysicsConfig, formatTimerDisplay } from '../models/PhysicsModel';
import {
  CameraPresetId,
  EquipmentId,
  EQUIPMENT_CATALOG,
} from '../models/EquipmentInfo';
import { labSound } from '../utils/soundEffects';

export type GraphicsQualityPreset = 'AUTO' | 'HIGH' | 'BALANCED' | 'BATTERY_SAVER';
export type TouchInteractionMode = 'ORBIT_CAMERA' | 'ADJUST_DEVICE';

export interface RuntimeRenderMetrics {
  fps: number;
  canvasWidthCss: number;
  canvasHeightCss: number;
  rendererPixelRatio: number;
  devicePixelRatio: number;
  isSoftwareGl: boolean;
  activeQualityLabel: string;
}

interface Apparatus3DProps {
  snapshot: ExperimentSnapshot;
  physicsConfig: PhysicsConfig;
  playbackSpeed: number; // 1 = thực tế, 0.25 = quay chậm 4x, 0.1 = siêu chậm 10x
  autoTrackFall: boolean;
  cameraPreset: CameraPresetId;
  touchMode: TouchInteractionMode;
  qualityPreset: GraphicsQualityPreset;
  showEquipmentLabels: boolean;
  onToggleLabels: () => void;
  showScientificVisuals: boolean;
  selectedEquipment: EquipmentId | null;
  onSelectEquipment: (id: EquipmentId | null) => void;
  onChangePhotogateDistance: (newDistanceMeters: number) => void;
  onChangeGateADistance?: (newDistanceMeters: number) => void;
  onTogglePower: () => void;
  onResetTimer: () => void;
  onReleaseCylinder: () => void;
  onAttachCylinder: () => void;
  onCycleTimerMode: () => void;
  onSimulationTick: (deltaSeconds: number) => void;
  onUpdateRenderMetrics?: (metrics: RuntimeRenderMetrics) => void;
}

// Pre-allocated module-scope math helpers (Zero GC in render loop)
const _projVec = new THREE.Vector3();
const _camTargetPos = new THREE.Vector3();
const _camTargetLook = new THREE.Vector3();
const _rayPlaneIntersection = new THREE.Vector3();
const _dragPlaneNormal = new THREE.Vector3(0, 0, 1);
const _dragPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), -0.065);
const _panOffset = new THREE.Vector3();
const _camRight = new THREE.Vector3();
const _camUp = new THREE.Vector3();
const _emissiveHighlightColor = new THREE.Color(0x0284c7);
const _emissiveActiveDragColor = new THREE.Color(0xd97706);
const _emissiveZero = new THREE.Color(0x000000);

// Hằng số hình học thế giới 3D (đơn vị: mét)
const DROP_ORIGIN_Y = 0.90; // Mặt đáy trụ thép khi được nam châm điện giữ (mốc s = 0.000 m)
const DROP_LINE_X = 0.0;
const DROP_LINE_Z = 0.065; // Đường rơi nằm phía trước trục trụ đứng 6.5 cm
const CYLINDER_HEIGHT = 0.032; // Trụ thép cao 32 mm
const CYLINDER_RADIUS = 0.0105; // Đường kính 21 mm
const CATCH_TRAY_SURFACE_Y = 0.05; // Mặt đệm hứng ở Y = 0.05 m (ứng với s_max = 0.85 m)

const CAMERA_PRESETS: Record<
  CameraPresetId,
  { pos: [number, number, number]; target: [number, number, number] }
> = {
  OVERVIEW: { pos: [0.38, 0.52, 1.56], target: [0.03, 0.50, 0.05] },
  MEASUREMENT_ANGLE: { pos: [0.0, 0.50, 1.48], target: [0.0, 0.50, 0.04] },
  CLOSEUP_MAGNET: { pos: [0.25, 0.76, 0.38], target: [0.0, 0.75, 0.065] },
  CLOSEUP_PHOTOGATE: { pos: [0.25, 0.48, 0.36], target: [0.0, 0.45, 0.065] },
  CLOSEUP_TIMER: { pos: [0.34, 0.28, 0.44], target: [0.34, 0.11, 0.08] },
  CLOSEUP_SWITCH: { pos: [-0.26, 0.24, 0.42], target: [-0.26, 0.05, 0.16] },
};

/**
 * Tính toán vị trí Camera Toàn cảnh tối ưu theo FOV và tỉ lệ khung hình (aspect)
 * để toàn bộ hệ thống từ chân đế bàn gỗ (Y = -0.05m) đến đỉnh giá đỡ & nam châm điện (Y = 1.08m)
 * luôn nằm trọn 100% trong khung nhìn từ trên xuống dưới.
 */
function computeFullApparatusOverviewPose(fovDeg: number, aspect: number): {
  pos: [number, number, number];
  target: [number, number, number];
} {
  const fovRad = THREE.MathUtils.degToRad(fovDeg);
  const halfTan = Math.tan(fovRad * 0.5);
  // Chiều cao toàn bộ hệ thống + khoảng đệm trên/dưới thoải mái: 1.24 m (tâm Y = 0.50 m)
  const verticalSpan = 1.24;
  // Chiều ngang toàn bộ từ hộp công tắc bên trái (-0.32 m) sang đồng hồ bên phải (+0.48 m): 0.94 m
  const horizontalSpan = 0.94;
  const distForHeight = (verticalSpan * 0.5) / halfTan;
  const distForWidth = (horizontalSpan * 0.5) / (halfTan * Math.max(0.45, aspect));
  const optimalZDist = Math.max(distForHeight, distForWidth);
  return {
    pos: [0.34, 0.52, 0.05 + optimalZDist],
    target: [0.03, 0.50, 0.05],
  };
}

/**
 * Tạo texture vân gỗ tự nhiên sắc nét cho mặt bàn thí nghiệm
 */
function createWoodTableTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#8c5828';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const plankCount = 8;
  const plankH = canvas.height / plankCount;

  for (let p = 0; p < plankCount; p++) {
    const y0 = p * plankH;
    const toneShift = ((p % 3) - 1) * 8;
    const baseR = 142 + toneShift;
    const baseG = 88 + Math.round(toneShift * 0.65);
    const baseB = 42 + Math.round(toneShift * 0.35);

    const grad = ctx.createLinearGradient(0, y0, 0, y0 + plankH);
    grad.addColorStop(0, `rgb(${baseR - 8}, ${baseG - 6}, ${baseB - 4})`);
    grad.addColorStop(0.5, `rgb(${baseR + 6}, ${baseG + 4}, ${baseB + 2})`);
    grad.addColorStop(1, `rgb(${baseR - 10}, ${baseG - 7}, ${baseB - 5})`);
    ctx.fillStyle = grad;
    ctx.fillRect(0, y0, canvas.width, plankH);

    for (let i = 0; i < 45; i++) {
      const yLine = y0 + (i / 45) * plankH;
      ctx.beginPath();
      ctx.strokeStyle =
        i % 2 === 0 ? 'rgba(62, 34, 12, 0.18)' : 'rgba(210, 155, 95, 0.12)';
      ctx.lineWidth = 1 + (i % 3) * 0.8;
      for (let x = 0; x <= canvas.width; x += 32) {
        const wave = Math.sin(x * 0.012 + p * 2.1 + i * 0.3) * 4.5;
        if (x === 0) ctx.moveTo(x, yLine + wave);
        else ctx.lineTo(x, yLine + wave);
      }
      ctx.stroke();
    }

    ctx.strokeStyle = 'rgba(42, 22, 8, 0.65)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(0, y0);
    ctx.lineTo(canvas.width, y0);
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Vẽ texture thước chia milimet & centimet độ phân giải cao (0 cm đến 85 cm)
 */
function createHighResRulerTexture(maxAnisotropy: number): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d')!;

  const grad = ctx.createLinearGradient(0, 0, canvas.width, 0);
  grad.addColorStop(0, '#f1f5f9');
  grad.addColorStop(0.5, '#ffffff');
  grad.addColorStop(1, '#e2e8f0');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.strokeStyle = '#475569';
  ctx.lineWidth = 4;
  ctx.strokeRect(2, 2, canvas.width - 4, canvas.height - 4);

  const totalMm = 850;
  const padTop = 36;
  const padBottom = 36;
  const usableHeight = canvas.height - padTop - padBottom;

  ctx.fillStyle = '#0f172a';
  ctx.strokeStyle = '#0f172a';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let mm = 0; mm <= totalMm; mm++) {
    const y = padTop + (mm / totalMm) * usableHeight;
    const isCm = mm % 10 === 0;
    const isHalfCm = mm % 5 === 0 && !isCm;

    ctx.beginPath();
    if (isCm) {
      ctx.lineWidth = 3.5;
      ctx.moveTo(canvas.width - 82, y);
      ctx.lineTo(canvas.width - 4, y);
      ctx.stroke();

      const cmVal = mm / 10;
      if (cmVal % 5 === 0) {
        ctx.font = 'bold 30px "JetBrains Mono", monospace';
        ctx.fillStyle = cmVal === 0 ? '#0284c7' : '#0f172a';
        ctx.fillText(`${cmVal}`, canvas.width - 90, y);
      } else {
        ctx.font = '600 22px "JetBrains Mono", monospace';
        ctx.fillStyle = '#334155';
        ctx.fillText(`${cmVal}`, canvas.width - 88, y);
      }
    } else if (isHalfCm) {
      ctx.lineWidth = 2.4;
      ctx.moveTo(canvas.width - 52, y);
      ctx.lineTo(canvas.width - 4, y);
      ctx.stroke();
    } else {
      ctx.lineWidth = 1.4;
      ctx.moveTo(canvas.width - 32, y);
      ctx.lineTo(canvas.width - 4, y);
      ctx.stroke();
    }
  }

  ctx.save();
  ctx.fillStyle = '#0284c7';
  ctx.font = 'bold 26px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('cm', 16, padTop + 4);
  ctx.restore();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

function getPortColorHex(state: PortSignalState): string {
  switch (state) {
    case 'ACTIVE':
      return '#f59e0b';
    case 'RECEIVED':
      return '#10b981';
    case 'CONNECTED':
      return '#38bdf8';
    case 'STANDBY':
      return '#64748b';
    case 'DISCONNECTED':
    default:
      return '#ef4444';
  }
}

/**
 * Vẽ màn hình mặt trước của Đồng hồ đo thời gian hiện số MC964:
 * - Cột ổ cắm vật lí 3D nằm sát mép trái (cx = 40) để dây dẫn từ giá đỡ bên trái đi thẳng vào ổ cắm,
 *   tuyệt đối không vắt ngang qua màn hình LED hay che chữ thông số.
 * - Cột thẻ trạng thái CỔNG A (TRÊN) và CỔNG B (DƯỚI) nằm kế bên (cx = 74..228), hoàn toàn thông thoáng.
 * - Màn hình LED 7 đoạn cỡ lớn và dải MODE nằm bên phải (cx = 238..622).
 */
function updateTimerScreenCanvas(
  canvas: HTMLCanvasElement,
  snapshot: ExperimentSnapshot,
  physicsConfig: PhysicsConfig
) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = canvas.width;
  const h = canvas.height;

  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 6;
  ctx.strokeRect(8, 8, w - 16, h - 16);

  // Tiêu đề đồng hồ MC964
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 20px "Plus Jakarta Sans", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText('ĐỒNG HỒ HIỆN SỐ MC964', 22, 36);

  ctx.fillStyle = '#38bdf8';
  ctx.font = 'bold 17px "JetBrains Mono", monospace';
  ctx.textAlign = 'right';
  ctx.fillText(`MODE: ${snapshot.c3Mode === 'A<->B' ? 'A↔B' : snapshot.c3Mode}`, w - 22, 36);

  // =========================================================================
  // 1. DẢI Ổ CẮM VẬT LÍ BÊN TRÁI (cx = 16..66) + THẺ TRẠNG THÁI (cx = 72..226)
  // =========================================================================
  const drawSocketAndStatusRow = (
    portShort: string,
    portTitle: string,
    roleText: string,
    state: PortSignalState,
    ringColor: string,
    rowY: number,
    rowH: number
  ) => {
    const stateColor = getPortColorHex(state);
    const socketCenterX = 40;
    const socketCenterY = rowY + rowH * 0.54;

    // Khung ổ cắm bên trái (nơi gắn giắc 3D thực tế)
    ctx.fillStyle = '#090d16';
    ctx.fillRect(16, rowY, 48, rowH);
    ctx.strokeStyle = '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(16, rowY, 48, rowH);

    // Chữ ký hiệu nhỏ phía trên ổ cắm 3D (không bị giắc che)
    ctx.fillStyle = ringColor;
    ctx.font = 'bold 11px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(portShort, socketCenterX, rowY + 14);

    // Vòng bezel ổ cắm trên mặt máy
    ctx.strokeStyle = ringColor;
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(socketCenterX, socketCenterY + 4, 13, 0, Math.PI * 2);
    ctx.stroke();

    // Thẻ thông số trạng thái cổng nằm tách biệt bên phải ổ cắm (cx = 68..226) -> Không bao giờ bị dây che
    const cardX = 68;
    const cardW = 158;
    ctx.fillStyle = '#090d16';
    ctx.fillRect(cardX, rowY, cardW, rowH);
    ctx.strokeStyle = stateColor;
    ctx.lineWidth = state === 'ACTIVE' || state === 'RECEIVED' ? 2.8 : 1.5;
    ctx.strokeRect(cardX, rowY, cardW, rowH);

    // Đèn LED báo trạng thái cổng
    ctx.fillStyle = stateColor;
    ctx.beginPath();
    ctx.arc(cardX + 14, rowY + 19, 6, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f8fafc';
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(portTitle, cardX + 26, rowY + 24);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '500 11px "Plus Jakarta Sans", sans-serif';
    ctx.fillText(roleText, cardX + 10, rowY + 43);

    ctx.fillStyle = stateColor;
    ctx.font = 'bold 12px "JetBrains Mono", monospace';
    ctx.fillText(PORT_STATE_LABELS[state], cardX + 10, rowY + 62);
  };

  // Hàng 1 (Trên): CỔNG A
  drawSocketAndStatusRow(
    'IN A',
    'CỔNG A (TRÊN)',
    'Cổng quang điện A',
    snapshot.portAState,
    '#ef4444',
    50,
    72
  );

  // Hàng 2 (Giữa): CỔNG B
  drawSocketAndStatusRow(
    'IN B',
    'CỔNG B (DƯỚI)',
    'Cổng quang điện B',
    snapshot.portBState,
    '#0284c7',
    132,
    72
  );

  // Hàng 3 (Dưới cùng bên trái): CỔNG CÔNG TẮC / NAM CHÂM ĐIỆN
  const swActive = !snapshot.releaseSwitchClosed;
  const swColor = snapshot.powerOn ? (swActive ? '#f59e0b' : '#10b981') : '#64748b';
  ctx.fillStyle = '#090d16';
  ctx.fillRect(16, 214, 48, 62);
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(16, 214, 48, 62);
  ctx.fillStyle = '#f59e0b';
  ctx.font = 'bold 10px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('SW/EM', 40, 228);

  ctx.fillStyle = '#090d16';
  ctx.fillRect(68, 214, 158, 62);
  ctx.strokeStyle = swColor;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(68, 214, 158, 62);
  ctx.fillStyle = '#f8fafc';
  ctx.font = 'bold 13px "JetBrains Mono", monospace';
  ctx.textAlign = 'left';
  ctx.fillText('CÔNG TẮC KÉP', 78, 234);
  ctx.fillStyle = swColor;
  ctx.font = 'bold 12px "JetBrains Mono", monospace';
  ctx.fillText(
    !snapshot.powerOn ? 'NGUỒN TẮT' : swActive ? 'ĐÃ NHẢ VẬT (t=0)' : 'GIỮ NAM CHÂM',
    78,
    258
  );

  // =========================================================================
  // 2. VÙNG MÀN HÌNH LED 7 ĐOẠN CỠ LỚN BÊN PHẢI (cx = 238..620)
  // =========================================================================
  const ledX = 238;
  const ledY = 50;
  const ledW = 382;
  const ledH = 172;

  ctx.fillStyle = '#050811';
  ctx.fillRect(ledX, ledY, ledW, ledH);
  ctx.strokeStyle = '#1e293b';
  ctx.lineWidth = 4;
  ctx.strokeRect(ledX, ledY, ledW, ledH);

  // Hàng đèn báo trạng thái đồng hồ (READY / RUN / STOP)
  const drawIndicator = (label: string, active: boolean, color: string, xPos: number) => {
    ctx.fillStyle = active ? color : '#1e293b';
    ctx.beginPath();
    ctx.arc(xPos, ledY + 24, 6.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = active ? '#f8fafc' : '#475569';
    ctx.font = 'bold 13px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    ctx.fillText(label, xPos + 11, ledY + 29);
  };

  drawIndicator('READY', snapshot.timerResetReady, '#10b981', ledX + 18);
  drawIndicator('RUN', snapshot.phase === 'FALLING_TIMER_RUNNING', '#38bdf8', ledX + 104);
  drawIndicator(
    'STOP',
    snapshot.phase === 'PHOTOGATE_TRIGGERED' || snapshot.phase === 'MEASUREMENT_COMPLETE',
    '#f59e0b',
    ledX + 178
  );

  if (!snapshot.powerOn) {
    ctx.fillStyle = '#1e293b';
    ctx.font = 'bold 72px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText('8.8.8.8', ledX + ledW * 0.5, ledY + 108);

    ctx.fillStyle = '#64748b';
    ctx.font = '600 15px "Plus Jakarta Sans", sans-serif';
    ctx.fillText('NGUỒN TẮT (POWER OFF)', ledX + ledW * 0.5, ledY + 152);
  } else {
    const isError = snapshot.phase === 'ERROR';
    const displayStr = isError
      ? 'Err'
      : `${formatTimerDisplay(snapshot.timerDisplaySeconds, physicsConfig.timerScale)}s`;

    ctx.fillStyle = isError ? '#f97316' : '#ef4444';
    ctx.font = 'bold 66px "JetBrains Mono", monospace';
    ctx.textAlign = 'right';
    ctx.fillText(displayStr, ledX + ledW - 18, ledY + 104);

    // Dòng phụ bên dưới số LED tùy theo MODE
    ctx.font = 'bold 14px "JetBrains Mono", monospace';
    ctx.textAlign = 'left';
    if (snapshot.c3Mode === 'A+B') {
      const tAStr =
        snapshot.measuredTimeASeconds !== null
          ? snapshot.measuredTimeASeconds.toFixed(3)
          : '0.000';
      const tBStr =
        snapshot.measuredTimeBSeconds !== null
          ? snapshot.measuredTimeBSeconds.toFixed(3)
          : '0.000';
      ctx.fillStyle = '#fbbf24';
      ctx.fillText(`tA=${tAStr}s | tB=${tBStr}s (t=tA+tB)`, ledX + 14, ledY + 152);
    } else if (snapshot.c3Mode === 'A<->B') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('Hành trình: Cổng A  ━━━►  Cổng B', ledX + 14, ledY + 152);
    } else if (snapshot.c3Mode === 'T') {
      ctx.fillStyle = '#a78bfa';
      ctx.fillText(
        `Đo chu kì T | Sự kiện nhận: ${snapshot.periodEventCount}/2`,
        ledX + 14,
        ledY + 152
      );
    } else if (snapshot.c3Mode === 'A') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('Đo thời gian chắn chùm tia Cổng A', ledX + 14, ledY + 152);
    } else if (snapshot.c3Mode === 'B') {
      ctx.fillStyle = '#38bdf8';
      ctx.fillText('Đo thời gian chắn chùm tia Cổng B', ledX + 14, ledY + 152);
    }
  }

  // =========================================================================
  // 3. DẢI 5 CHẾ ĐỘ MODE (cx = 238..620, cy = 232..266) & NHÃN NÚT BẤM VẬT LÍ
  // =========================================================================
  const modes: ('A' | 'B' | 'A+B' | 'A<->B' | 'T')[] = ['A', 'B', 'A+B', 'A<->B', 'T'];
  modes.forEach((m, idx) => {
    const bx = 238 + idx * 77;
    const by = 232;
    const isSel = snapshot.c3Mode === m;
    ctx.fillStyle = isSel ? '#0284c7' : '#1e293b';
    ctx.fillRect(bx, by, 70, 30);
    ctx.fillStyle = isSel ? '#ffffff' : '#94a3b8';
    ctx.font = 'bold 15px "JetBrains Mono", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(m === 'A<->B' ? 'A↔B' : m, bx + 35, by + 20);
  });

  // Nhãn cho 3 nút cơ học 3D nằm ở góc dưới phải (nút 3D đặt ở cy = 304 nên nhãn ở cy = 282 không bị che)
  ctx.fillStyle = '#cbd5e1';
  ctx.font = 'bold 11px "JetBrains Mono", monospace';
  ctx.textAlign = 'center';
  ctx.fillText('POWER', 310, 284);
  ctx.fillText('RESET', 435, 284);
  ctx.fillText('MODE', 555, 284);
}

export const Apparatus3D: React.FC<Apparatus3DProps> = ({
  snapshot,
  physicsConfig,
  playbackSpeed,
  autoTrackFall,
  cameraPreset,
  touchMode,
  qualityPreset,
  showEquipmentLabels,
  onToggleLabels,
  showScientificVisuals,
  selectedEquipment,
  onSelectEquipment,
  onChangePhotogateDistance,
  onChangeGateADistance,
  onTogglePower,
  onResetTimer,
  onReleaseCylinder,
  onAttachCylinder,
  onCycleTimerMode,
  onSimulationTick,
  onUpdateRenderMetrics,
}) => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const labelRefs = useRef<Record<EquipmentId, HTMLButtonElement | null>>({
    PLUMB_CHANNEL: null,
    STEEL_CYLINDER: null,
    ELECTROMAGNET: null,
    PHOTOGATE: null,
    TRIPOD_STAND: null,
    DIGITAL_TIMER: null,
    RELEASE_SWITCH: null,
  });
  const markerSARef = useRef<HTMLDivElement | null>(null);
  const markerSRef = useRef<HTMLDivElement | null>(null);
  const markerZeroRef = useRef<HTMLDivElement | null>(null);
  const cylinderBadgeRef = useRef<HTMLDivElement | null>(null);
  const standBadgeARef = useRef<HTMLDivElement | null>(null);
  const standBadgeBRef = useRef<HTMLDivElement | null>(null);

  const [webglError, setWebglError] = useState<string | null>(null);
  const [activeDragTarget, setActiveDragTarget] = useState<
    'NONE' | 'PHOTOGATE_A' | 'PHOTOGATE' | 'CYLINDER'
  >('NONE');
  const [hoverHintText, setHoverHintText] = useState<string | null>(null);
  const autoTrackFallRef = useRef<boolean>(autoTrackFall);

  useEffect(() => {
    autoTrackFallRef.current = autoTrackFall;
  }, [autoTrackFall]);

  const latestPropsRef = useRef({
    snapshot,
    physicsConfig,
    playbackSpeed,
    autoTrackFall,
    cameraPreset,
    touchMode,
    qualityPreset,
    showEquipmentLabels,
    showScientificVisuals,
    selectedEquipment,
    onSelectEquipment,
    onChangePhotogateDistance,
    onChangeGateADistance,
    onTogglePower,
    onResetTimer,
    onReleaseCylinder,
    onAttachCylinder,
    onCycleTimerMode,
    onSimulationTick,
    onUpdateRenderMetrics,
  });

  useEffect(() => {
    latestPropsRef.current = {
      snapshot,
      physicsConfig,
      playbackSpeed,
      autoTrackFall,
      cameraPreset,
      touchMode,
      qualityPreset,
      showEquipmentLabels,
      showScientificVisuals,
      selectedEquipment,
      onSelectEquipment,
      onChangePhotogateDistance,
      onChangeGateADistance,
      onTogglePower,
      onResetTimer,
      onReleaseCylinder,
      onAttachCylinder,
      onCycleTimerMode,
      onSimulationTick,
      onUpdateRenderMetrics,
    };
  });

  const sceneObjectsRef = useRef<{
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    photogateAAssembly: THREE.Group;
    photogateAHighlightRing: THREE.Mesh;
    laserBeamAMesh: THREE.Mesh;
    triggerRingAMesh: THREE.Mesh;
    photogateALedMat: THREE.MeshStandardMaterial;
    photogateACableMesh: THREE.Mesh;
    photogateAssembly: THREE.Group;
    photogateForkOffsetGroup: THREE.Group;
    photogateHighlightRing: THREE.Mesh;
    laserBeamMesh: THREE.Mesh;
    triggerRingMesh: THREE.Mesh;
    photogateLedMat: THREE.MeshStandardMaterial;
    steelCylinderGroup: THREE.Group;
    cylinderRingMat: THREE.MeshBasicMaterial;
    magnetSnapPreviewRing: THREE.Mesh;
    velocityArrowGroup: THREE.Group;
    strobeInstancedMesh: THREE.InstancedMesh;
    magnetLedMat: THREE.MeshStandardMaterial;
    magnetCoilMat: THREE.MeshStandardMaterial;
    switchLeverGroup: THREE.Group;
    powerSwitchMesh: THREE.Mesh;
    timerScreenCanvas: HTMLCanvasElement;
    timerScreenTexture: THREE.CanvasTexture;
    photogateCableMesh: THREE.Mesh;
    photogateCableMat: THREE.MeshStandardMaterial;
    plugAGroup: THREE.Group;
    plugBGroup: THREE.Group;
    pulseSpheres: THREE.Mesh[];
    pulseSpheresB: THREE.Mesh[];
    dimensionLineMesh: THREE.Mesh;
    activeCameraPreset: CameraPresetId | null;
    isTransitioningCamera: boolean;
    manualCylinderDragY: number | null;
  } | null>(null);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const isSoftwareGl = (() => {
      try {
        const probeCanvas = document.createElement('canvas');
        const gl =
          probeCanvas.getContext('webgl2') ||
          probeCanvas.getContext('webgl') ||
          probeCanvas.getContext('experimental-webgl');
        if (!gl) return true;
        const glCtx = gl as WebGLRenderingContext;
        const ext = glCtx.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : glCtx.RENDERER;
        const gpu = String(glCtx.getParameter(param));
        glCtx.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return true;
      }
    })();

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglError('Trình duyệt hoặc thiết bị không hỗ trợ WebGL. Đang hiển thị chế độ 2D dự phòng.');
      return;
    }

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.18;

    const getTargetPixelRatio = (preset: GraphicsQualityPreset, adaptiveScale: number) => {
      if (isSoftwareGl) return 1.0;
      const dpr = window.devicePixelRatio || 1;
      if (preset === 'BATTERY_SAVER') return Math.min(dpr, 1.0);
      if (preset === 'BALANCED') return Math.min(dpr, 1.5) * adaptiveScale;
      if (preset === 'HIGH') return Math.min(dpr, 2.5) * adaptiveScale;
      return Math.min(dpr, 2.0) * adaptiveScale;
    };

    let adaptiveScale = 1.0;
    renderer.setPixelRatio(getTargetPixelRatio(latestPropsRef.current.qualityPreset, adaptiveScale));
    renderer.shadowMap.enabled = !isSoftwareGl && latestPropsRef.current.qualityPreset !== 'BATTERY_SAVER';
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const canvasEl = renderer.domElement;
    canvasEl.style.width = '100%';
    canvasEl.style.height = '100%';
    canvasEl.style.display = 'block';
    canvasEl.style.touchAction = 'none';
    container.innerHTML = '';
    container.appendChild(canvasEl);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x162235);
    scene.fog = new THREE.FogExp2(0x162235, 0.11);

    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    const rect = container.getBoundingClientRect();
    const initW = Math.max(1, rect.width);
    const initH = Math.max(1, rect.height);
    const initAspect = initW / initH;
    const initFov = initAspect < 0.75 ? 52 : initAspect < 1.0 ? 46 : 42;
    const camera = new THREE.PerspectiveCamera(initFov, initAspect, 0.02, 18);
    const initPreset =
      latestPropsRef.current.cameraPreset === 'OVERVIEW'
        ? computeFullApparatusOverviewPose(initFov, initAspect)
        : CAMERA_PRESETS[latestPropsRef.current.cameraPreset] || CAMERA_PRESETS.OVERVIEW;
    camera.position.set(...initPreset.pos);

    const controls = new OrbitControls(camera, canvasEl);
    controls.target.set(...initPreset.target);
    controls.enableDamping = !isSoftwareGl;
    controls.dampingFactor = 0.08;
    controls.enablePan = true;
    controls.screenSpacePanning = true;
    controls.panSpeed = 1.1;
    controls.minDistance = 0.20;
    controls.maxDistance = 3.2;
    controls.maxPolarAngle = Math.PI * 0.54;
    controls.update();

    let isUserControllingCamera = false;
    const onUserControlStart = () => {
      isUserControllingCamera = true;
      if (sceneObjectsRef.current) {
        sceneObjectsRef.current.isTransitioningCamera = false;
      }
    };
    const onUserControlEnd = () => {
      isUserControllingCamera = false;
    };
    controls.addEventListener('start', onUserControlStart);
    controls.addEventListener('end', onUserControlEnd);

    // 4. Hệ thống chiếu sáng Studio
    const hemiLight = new THREE.HemisphereLight(0xf0f9ff, 0x451a03, 0.95);
    hemiLight.position.set(0, 2.5, 0);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xfffbeb, 2.1);
    keyLight.position.set(1.15, 1.85, 1.35);
    keyLight.castShadow = !isSoftwareGl;
    keyLight.shadow.mapSize.width = 1024;
    keyLight.shadow.mapSize.height = 1024;
    const d = 0.85;
    keyLight.shadow.camera.left = -d;
    keyLight.shadow.camera.right = d;
    keyLight.shadow.camera.top = d;
    keyLight.shadow.camera.bottom = -d;
    keyLight.shadow.camera.near = 0.2;
    keyLight.shadow.camera.far = 4.5;
    keyLight.shadow.bias = -0.0005;
    keyLight.shadow.normalBias = 0.02;
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x7dd3fc, 0.85);
    rimLight.position.set(-1.1, 1.2, -0.8);
    scene.add(rimLight);

    // 5. Vật liệu PBR
    const maxAniso = renderer.capabilities.getMaxAnisotropy();
    const woodTex = createWoodTableTexture(maxAniso);

    const matWoodTop = new THREE.MeshStandardMaterial({
      map: woodTex,
      roughness: 0.38,
      metalness: 0.04,
    });
    const matWoodEdge = new THREE.MeshStandardMaterial({
      color: 0x5c3614,
      roughness: 0.48,
      metalness: 0.05,
    });
    const matWoodLegs = new THREE.MeshStandardMaterial({
      color: 0x4a2a0e,
      roughness: 0.55,
      metalness: 0.05,
    });
    const matCastIronBase = new THREE.MeshStandardMaterial({
      color: 0x1e293b,
      roughness: 0.5,
      metalness: 0.68,
    });
    const matStainlessRod = new THREE.MeshPhysicalMaterial({
      color: 0xe2e8f0,
      metalness: 0.9,
      roughness: 0.2,
      clearcoat: 0.2,
    });
    const matPolishedSteelCylinder = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      metalness: 0.92,
      roughness: 0.1,
      clearcoat: 0.5,
    });
    const matBrass = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.85,
      roughness: 0.22,
    });
    const matCopperCoil = new THREE.MeshStandardMaterial({
      color: 0xd97706,
      metalness: 0.82,
      roughness: 0.28,
      emissive: 0x000000,
    });
    const matDarkAbs = new THREE.MeshStandardMaterial({
      color: 0x111827,
      roughness: 0.4,
      metalness: 0.12,
    });
    const matClampAluminum = new THREE.MeshStandardMaterial({
      color: 0x475569,
      roughness: 0.32,
      metalness: 0.75,
    });
    const matRubber = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.85,
      metalness: 0.05,
    });
    const matRedTerminal = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.3,
      metalness: 0.15,
    });
    const matBlackTerminal = new THREE.MeshStandardMaterial({
      color: 0x1f2937,
      roughness: 0.35,
      metalness: 0.15,
    });
    const matBlueTerminal = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.35,
      metalness: 0.15,
    });

    // Quản lí danh sách các nhóm đối tượng có thể tương tác & highlight
    const interactiveMeshes: THREE.Object3D[] = [];
    const highlightableGroupsMap = new Map<string, THREE.Object3D>();

    const registerInteractive = (
      obj: THREE.Object3D,
      equipmentId: EquipmentId,
      actionType?: string,
      groupKey?: string
    ) => {
      const key = groupKey || `${equipmentId}_${actionType || 'DEFAULT'}`;
      highlightableGroupsMap.set(key, obj);
      obj.traverse((child) => {
        child.userData.equipmentId = equipmentId;
        if (actionType) child.userData.actionType = actionType;
        child.userData.highlightKey = key;
        if ((child as THREE.Mesh).isMesh) {
          const mesh = child as THREE.Mesh;
          // Clone material cho các bộ phận cần hiệu ứng highlight độc lập để không ảnh hưởng toàn cục
          if (
            actionType &&
            mesh.material &&
            !Array.isArray(mesh.material) &&
            (mesh.material as THREE.MeshStandardMaterial).emissive !== undefined
          ) {
            mesh.material = mesh.material.clone();
            const stdMat = mesh.material as THREE.MeshStandardMaterial;
            mesh.userData.baseEmissiveHex = stdMat.emissive.getHex();
            mesh.userData.baseEmissiveIntensity = stdMat.emissiveIntensity;
          }
        }
      });
      interactiveMeshes.push(obj);
    };

    // =========================================================================
    // DỰNG MẶT BÀN GỖ PHÒNG THÍ NGHIỆM (WOODEN LAB BENCH)
    // =========================================================================
    const benchGroup = new THREE.Group();

    const benchTop = new THREE.Mesh(new THREE.BoxGeometry(1.42, 0.045, 0.82), matWoodTop);
    benchTop.position.set(0.04, -0.0225, 0.08);
    benchTop.receiveShadow = true;
    benchGroup.add(benchTop);

    const benchApron = new THREE.Mesh(new THREE.BoxGeometry(1.34, 0.065, 0.74), matWoodEdge);
    benchApron.position.set(0.04, -0.075, 0.08);
    benchGroup.add(benchApron);

    const legCoords: [number, number][] = [
      [-0.58, -0.24],
      [0.66, -0.24],
      [-0.58, 0.40],
      [0.66, 0.40],
    ];
    legCoords.forEach(([lx, lz]) => {
      const tableLeg = new THREE.Mesh(new THREE.BoxGeometry(0.065, 0.65, 0.065), matWoodLegs);
      tableLeg.position.set(lx, -0.37, lz);
      benchGroup.add(tableLeg);
    });

    const deskMat = new THREE.Mesh(
      new THREE.CylinderGeometry(0.22, 0.22, 0.002, 32),
      new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85 })
    );
    deskMat.position.set(0, 0.001, 0.03);
    deskMat.receiveShadow = true;
    benchGroup.add(deskMat);

    scene.add(benchGroup);

    // =========================================================================
    // BỘ PHẬN (5): GIÁ ĐỠ ĐẾ BA CHÂN, TRỤ ĐỨNG, THƯỚC ĐO & KHAY HỨNG
    // =========================================================================
    const standGroup = new THREE.Group();

    const hubMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.058, 0.038, 24), matCastIronBase);
    hubMesh.position.set(0, 0.024, 0);
    hubMesh.castShadow = true;
    hubMesh.receiveShadow = true;
    standGroup.add(hubMesh);

    const legAngles = [-Math.PI / 6, Math.PI / 2, (7 * Math.PI) / 6];
    legAngles.forEach((angle) => {
      const legSubGroup = new THREE.Group();
      legSubGroup.rotation.y = angle;

      const armMesh = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.022, 0.165), matCastIronBase);
      armMesh.position.set(0, 0.019, 0.095);
      armMesh.castShadow = true;
      armMesh.receiveShadow = true;
      legSubGroup.add(armMesh);

      const footPad = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.019, 0.01, 16), matRubber);
      footPad.position.set(0, 0.005, 0.165);
      legSubGroup.add(footPad);

      const levelScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.038, 12), matBrass);
      levelScrew.position.set(0, 0.026, 0.165);
      legSubGroup.add(levelScrew);

      const screwKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.013, 0.013, 0.008, 16), matClampAluminum);
      screwKnob.position.set(0, 0.045, 0.165);
      legSubGroup.add(screwKnob);

      standGroup.add(legSubGroup);
    });

    const mainRod = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 1.02, 24), matStainlessRod);
    mainRod.position.set(0, 0.53, 0);
    mainRod.castShadow = true;
    standGroup.add(mainRod);

    const dropPathGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(DROP_LINE_X, DROP_ORIGIN_Y + 0.02, DROP_LINE_Z),
      new THREE.Vector3(DROP_LINE_X, CATCH_TRAY_SURFACE_Y, DROP_LINE_Z),
    ]);
    const dropPathMat = new THREE.LineDashedMaterial({
      color: 0x38bdf8,
      dashSize: 0.018,
      gapSize: 0.012,
      transparent: true,
      opacity: 0.55,
    });
    const dropPathLine = new THREE.Line(dropPathGeo, dropPathMat);
    dropPathLine.computeLineDistances();
    standGroup.add(dropPathLine);

    const catchTrayGroup = new THREE.Group();
    catchTrayGroup.position.set(DROP_LINE_X, 0.035, DROP_LINE_Z);

    const trayRim = new THREE.Mesh(new THREE.CylinderGeometry(0.042, 0.036, 0.026, 24), matClampAluminum);
    trayRim.castShadow = true;
    trayRim.receiveShadow = true;
    catchTrayGroup.add(trayRim);

    const trayPad = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.008, 24), matRubber);
    trayPad.position.set(0, 0.011, 0);
    catchTrayGroup.add(trayPad);
    standGroup.add(catchTrayGroup);

    const rulerTex = createHighResRulerTexture(maxAniso);
    const rulerFrontMat = new THREE.MeshStandardMaterial({
      map: rulerTex,
      roughness: 0.3,
      metalness: 0.1,
    });
    const rulerSideMat = new THREE.MeshStandardMaterial({
      color: 0xcbd5e1,
      roughness: 0.4,
      metalness: 0.6,
    });
    const rulerHeight = 0.872;
    const rulerMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.028, rulerHeight, 0.005),
      [rulerSideMat, rulerSideMat, rulerSideMat, rulerSideMat, rulerFrontMat, rulerSideMat]
    );
    rulerMesh.position.set(0.033, 0.475, 0.012);
    rulerMesh.castShadow = true;
    standGroup.add(rulerMesh);

    const zeroMarkerBar = new THREE.Mesh(
      new THREE.BoxGeometry(0.052, 0.0025, 0.055),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    zeroMarkerBar.position.set(0.018, DROP_ORIGIN_Y, 0.035);
    standGroup.add(zeroMarkerBar);

    const dimensionLineMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.002, 0.002, 1, 8),
      new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
    );
    dimensionLineMesh.position.set(0.054, DROP_ORIGIN_Y - 0.25, 0.035);
    standGroup.add(dimensionLineMesh);

    registerInteractive(standGroup, 'TRIPOD_STAND', undefined, 'STAND');
    scene.add(standGroup);

    // =========================================================================
    // BỘ PHẬN (1): MÁNG ĐỨNG CÓ GẮN DÂY DỌI
    // =========================================================================
    const plumbGroup = new THREE.Group();

    const channelBack = new THREE.Mesh(new THREE.BoxGeometry(0.014, 0.92, 0.018), matClampAluminum);
    channelBack.position.set(-0.042, 0.52, 0);
    channelBack.castShadow = true;
    plumbGroup.add(channelBack);

    const flangeLeft = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.92, 0.014), matStainlessRod);
    flangeLeft.position.set(-0.049, 0.52, 0.012);
    plumbGroup.add(flangeLeft);

    const flangeRight = new THREE.Mesh(new THREE.BoxGeometry(0.003, 0.92, 0.014), matStainlessRod);
    flangeRight.position.set(-0.035, 0.52, 0.012);
    plumbGroup.add(flangeRight);

    const plumbTopArm = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.01, 0.055), matClampAluminum);
    plumbTopArm.position.set(-0.042, 0.975, 0.02);
    plumbGroup.add(plumbTopArm);

    const plumbString = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0009, 0.0009, 0.82, 8),
      new THREE.MeshBasicMaterial({ color: 0xfef08a })
    );
    plumbString.position.set(-0.042, 0.56, 0.042);
    plumbGroup.add(plumbString);

    const bobPoints = [
      new THREE.Vector2(0.0, 0.0),
      new THREE.Vector2(0.012, 0.022),
      new THREE.Vector2(0.012, 0.034),
      new THREE.Vector2(0.004, 0.042),
      new THREE.Vector2(0.0, 0.044),
    ];
    const bobGeo = new THREE.LatheGeometry(bobPoints, 20);
    const plumbBob = new THREE.Mesh(bobGeo, matBrass);
    plumbBob.position.set(-0.042, 0.13, 0.042);
    plumbBob.castShadow = true;
    plumbGroup.add(plumbBob);

    const targetRing = new THREE.Mesh(new THREE.TorusGeometry(0.012, 0.002, 12, 24), matBrass);
    targetRing.rotation.x = Math.PI / 2;
    targetRing.position.set(-0.042, 0.115, 0.042);
    plumbGroup.add(targetRing);

    const targetArm = new THREE.Mesh(new THREE.BoxGeometry(0.01, 0.006, 0.042), matClampAluminum);
    targetArm.position.set(-0.042, 0.115, 0.02);
    plumbGroup.add(targetArm);

    registerInteractive(plumbGroup, 'PLUMB_CHANNEL', undefined, 'PLUMB');
    scene.add(plumbGroup);

    // =========================================================================
    // BỘ PHẬN (3): NAM CHÂM ĐIỆN & KẸP ĐỈNH
    // =========================================================================
    const magnetGroup = new THREE.Group();
    const magnetPoleTipY = DROP_ORIGIN_Y + CYLINDER_HEIGHT; // 0.932 m

    const magnetClamp = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.034, 0.095), matClampAluminum);
    magnetClamp.position.set(0, 0.972, 0.032);
    magnetClamp.castShadow = true;
    magnetGroup.add(magnetClamp);

    const magnetThumbScrew = new THREE.Mesh(new THREE.CylinderGeometry(0.009, 0.009, 0.022, 16), matBrass);
    magnetThumbScrew.rotation.z = Math.PI / 2;
    magnetThumbScrew.position.set(-0.026, 0.972, 0.0);
    magnetGroup.add(magnetThumbScrew);

    const magnetHousing = new THREE.Mesh(
      new THREE.CylinderGeometry(0.025, 0.025, 0.062, 24),
      matDarkAbs
    );
    magnetHousing.position.set(DROP_LINE_X, 0.972, DROP_LINE_Z);
    magnetHousing.castShadow = true;
    magnetGroup.add(magnetHousing);

    const magnetCoilMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0255, 0.0255, 0.032, 24),
      matCopperCoil
    );
    magnetCoilMesh.position.set(DROP_LINE_X, 0.972, DROP_LINE_Z);
    magnetGroup.add(magnetCoilMesh);

    const corePole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.01, 0.0085, 0.02, 20),
      matStainlessRod
    );
    corePole.position.set(DROP_LINE_X, magnetPoleTipY + 0.009, DROP_LINE_Z);
    magnetGroup.add(corePole);

    const magnetLedMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.5,
      roughness: 0.2,
    });
    const magnetLed = new THREE.Mesh(new THREE.SphereGeometry(0.0045, 12, 12), magnetLedMat);
    magnetLed.position.set(DROP_LINE_X + 0.016, 1.006, DROP_LINE_Z + 0.012);
    magnetGroup.add(magnetLed);

    const postRed = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.016, 12), matRedTerminal);
    postRed.position.set(-0.01, 1.01, DROP_LINE_Z);
    magnetGroup.add(postRed);

    const postBlack = new THREE.Mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.016, 12), matBlackTerminal);
    postBlack.position.set(0.01, 1.01, DROP_LINE_Z);
    magnetGroup.add(postBlack);

    // Vòng chỉ thị hít từ trường khi người dùng kéo Trụ thép lại gần đầu nam châm điện
    const magnetSnapPreviewRing = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.024, 32),
      new THREE.MeshBasicMaterial({
        color: 0x10b981,
        transparent: true,
        opacity: 0.85,
        side: THREE.DoubleSide,
      })
    );
    magnetSnapPreviewRing.rotation.x = Math.PI / 2;
    magnetSnapPreviewRing.position.set(DROP_LINE_X, DROP_ORIGIN_Y, DROP_LINE_Z);
    magnetSnapPreviewRing.visible = false;
    scene.add(magnetSnapPreviewRing);

    registerInteractive(magnetGroup, 'ELECTROMAGNET', 'ATTACH_CYLINDER', 'MAGNET');
    scene.add(magnetGroup);

    // =========================================================================
    // BỘ PHẬN (2): VẬT BẰNG THÉP HÌNH TRỤ (CÓ THỂ KÉO THẢ TRỰC TIẾP TRONG 3D)
    // =========================================================================
    const steelCylinderGroup = new THREE.Group();

    const cylBevel = 0.0018;
    const cylPoints = [
      new THREE.Vector2(0, 0),
      new THREE.Vector2(CYLINDER_RADIUS - cylBevel, 0),
      new THREE.Vector2(CYLINDER_RADIUS, cylBevel),
      new THREE.Vector2(CYLINDER_RADIUS, CYLINDER_HEIGHT - cylBevel),
      new THREE.Vector2(CYLINDER_RADIUS - cylBevel, CYLINDER_HEIGHT),
      new THREE.Vector2(0, CYLINDER_HEIGHT),
    ];
    const cylGeo = new THREE.LatheGeometry(cylPoints, 32);
    const cylMesh = new THREE.Mesh(cylGeo, matPolishedSteelCylinder);
    cylMesh.castShadow = true;
    cylMesh.receiveShadow = true;
    steelCylinderGroup.add(cylMesh);

    const locatorBand = new THREE.Mesh(
      new THREE.CylinderGeometry(CYLINDER_RADIUS + 0.0005, CYLINDER_RADIUS + 0.0005, 0.007, 28),
      new THREE.MeshStandardMaterial({
        color: 0xf97316,
        metalness: 0.4,
        roughness: 0.25,
        emissive: 0x9a3412,
        emissiveIntensity: 0.45,
      })
    );
    locatorBand.position.y = CYLINDER_HEIGHT * 0.5;
    steelCylinderGroup.add(locatorBand);

    const cylinderRingMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide,
    });
    const cylinderHighlighterRing = new THREE.Mesh(
      new THREE.RingGeometry(CYLINDER_RADIUS + 0.004, CYLINDER_RADIUS + 0.009, 32),
      cylinderRingMat
    );
    cylinderHighlighterRing.rotation.x = Math.PI / 2;
    cylinderHighlighterRing.position.y = 0.001;
    steelCylinderGroup.add(cylinderHighlighterRing);

    // Hitbox cảm ứng rộng quanh Trụ thép để người dùng dễ dàng chạm và kéo thả trực tiếp
    const cylinderDragHitBox = new THREE.Mesh(
      new THREE.CylinderGeometry(0.042, 0.042, 0.085, 16),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    cylinderDragHitBox.position.y = CYLINDER_HEIGHT * 0.5;
    steelCylinderGroup.add(cylinderDragHitBox);

    const velocityArrowGroup = new THREE.Group();
    const arrowShaft = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0022, 0.0022, 0.06, 10),
      new THREE.MeshBasicMaterial({ color: 0x10b981 })
    );
    arrowShaft.position.y = -0.03;
    velocityArrowGroup.add(arrowShaft);

    const arrowHead = new THREE.Mesh(
      new THREE.ConeGeometry(0.006, 0.018, 12),
      new THREE.MeshBasicMaterial({ color: 0x10b981 })
    );
    arrowHead.rotation.x = Math.PI;
    arrowHead.position.y = -0.065;
    velocityArrowGroup.add(arrowHead);
    velocityArrowGroup.visible = false;
    steelCylinderGroup.add(velocityArrowGroup);

    steelCylinderGroup.position.set(DROP_LINE_X, DROP_ORIGIN_Y, DROP_LINE_Z);
    registerInteractive(steelCylinderGroup, 'STEEL_CYLINDER', 'DRAG_CYLINDER', 'CYLINDER');
    scene.add(steelCylinderGroup);

    const strobeMat = new THREE.MeshStandardMaterial({
      color: 0x38bdf8,
      transparent: true,
      opacity: 0.34,
      roughness: 0.2,
      metalness: 0.5,
      depthWrite: false,
    });
    const strobeInstancedMesh = new THREE.InstancedMesh(cylGeo, strobeMat, 20);
    strobeInstancedMesh.frustumCulled = false;
    strobeInstancedMesh.visible = false;
    scene.add(strobeInstancedMesh);

    // =========================================================================
    // BỘ PHẬN (4A): CỔNG QUANG ĐIỆN A (CHỮ U GIỐNG CỔNG B, KẸP TRƯỢT PHÍA TRÊN)
    // =========================================================================
    const photogateAAssembly = new THREE.Group();
    const initGateAY = DROP_ORIGIN_Y - latestPropsRef.current.snapshot.gateADistanceMeters;
    photogateAAssembly.position.set(0, initGateAY, 0);

    const gateClampA = new THREE.Mesh(
      new THREE.BoxGeometry(0.038, 0.038, 0.05),
      matClampAluminum
    );
    gateClampA.position.set(0, 0, 0.008);
    gateClampA.castShadow = true;
    photogateAAssembly.add(gateClampA);

    // Vòng đai đỏ đánh dấu kênh A trên kẹp cổng quang A
    const gateACollar = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.01, 0.052),
      matRedTerminal
    );
    gateACollar.position.set(0, 0.014, 0.008);
    photogateAAssembly.add(gateACollar);

    const gateKnobShaftA = new THREE.Mesh(
      new THREE.CylinderGeometry(0.006, 0.006, 0.028, 12),
      matStainlessRod
    );
    gateKnobShaftA.rotation.z = Math.PI / 2;
    gateKnobShaftA.position.set(-0.026, 0, 0);
    photogateAAssembly.add(gateKnobShaftA);

    const gateKnobHeadA = new THREE.Mesh(
      new THREE.CylinderGeometry(0.016, 0.016, 0.014, 20),
      matRedTerminal
    );
    gateKnobHeadA.rotation.z = Math.PI / 2;
    gateKnobHeadA.position.set(-0.042, 0, 0);
    photogateAAssembly.add(gateKnobHeadA);

    const rulerPointerA = new THREE.Mesh(
      new THREE.ConeGeometry(0.0055, 0.018, 4),
      new THREE.MeshBasicMaterial({ color: 0xef4444 })
    );
    rulerPointerA.rotation.z = -Math.PI / 2;
    rulerPointerA.position.set(0.019, 0, 0.016);
    photogateAAssembly.add(rulerPointerA);

    const photogateAForkGroup = new THREE.Group();

    const gateArmA = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.045), matDarkAbs);
    gateArmA.position.set(0, 0, 0.036);
    photogateAForkGroup.add(gateArmA);

    const uBaseA = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.024, 0.014), matDarkAbs);
    uBaseA.position.set(0, 0, 0.042);
    uBaseA.castShadow = true;
    photogateAForkGroup.add(uBaseA);

    const leftProngA = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.024, 0.048), matDarkAbs);
    leftProngA.position.set(-0.0355, 0, 0.065);
    leftProngA.castShadow = true;
    photogateAForkGroup.add(leftProngA);

    const rightProngA = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.024, 0.048), matDarkAbs);
    rightProngA.position.set(0.0355, 0, 0.065);
    rightProngA.castShadow = true;
    photogateAForkGroup.add(rightProngA);

    const photogateAHighlightRing = new THREE.Mesh(
      new THREE.RingGeometry(0.044, 0.051, 32),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.78,
        side: THREE.DoubleSide,
      })
    );
    photogateAHighlightRing.rotation.x = Math.PI / 2;
    photogateAHighlightRing.position.set(0, 0, DROP_LINE_Z);
    photogateAHighlightRing.visible = false;
    photogateAForkGroup.add(photogateAHighlightRing);

    const lensMatA = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.9,
      roughness: 0.15,
    });
    const emitterLensA = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 12),
      lensMatA
    );
    emitterLensA.rotation.z = Math.PI / 2;
    emitterLensA.position.set(-0.03, 0, DROP_LINE_Z);
    photogateAForkGroup.add(emitterLensA);

    const receiverLensA = emitterLensA.clone();
    receiverLensA.position.set(0.03, 0, DROP_LINE_Z);
    photogateAForkGroup.add(receiverLensA);

    const laserBeamAMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0014, 0.0014, 0.06, 12),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.65,
      })
    );
    laserBeamAMesh.rotation.z = Math.PI / 2;
    laserBeamAMesh.position.set(0, 0, DROP_LINE_Z);
    photogateAForkGroup.add(laserBeamAMesh);

    const triggerRingAMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.024, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    triggerRingAMesh.rotation.x = Math.PI / 2;
    triggerRingAMesh.position.set(0, 0, DROP_LINE_Z);
    triggerRingAMesh.visible = false;
    photogateAForkGroup.add(triggerRingAMesh);

    const photogateALedMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.4,
    });
    const photogateALed = new THREE.Mesh(
      new THREE.SphereGeometry(0.004, 12, 12),
      photogateALedMat
    );
    photogateALed.position.set(0.0355, 0.014, 0.055);
    photogateAForkGroup.add(photogateALed);

    photogateAAssembly.add(photogateAForkGroup);

    const dragHitBoxA = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.085, 0.14),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    dragHitBoxA.position.set(0, 0, 0.045);
    photogateAAssembly.add(dragHitBoxA);

    registerInteractive(photogateAAssembly, 'PHOTOGATE', 'DRAG_PHOTOGATE_A', 'PHOTOGATE_A');
    scene.add(photogateAAssembly);

    // =========================================================================
    // BỘ PHẬN (4B): CỔNG QUANG ĐIỆN B (CHỮ U & KẸP TRƯỢT PHÍA DƯỚI)
    // =========================================================================
    const photogateAssembly = new THREE.Group();
    const initGateY = DROP_ORIGIN_Y - latestPropsRef.current.snapshot.photogateDistanceMeters;
    photogateAssembly.position.set(0, initGateY, 0);

    const gateClamp = new THREE.Mesh(new THREE.BoxGeometry(0.038, 0.038, 0.05), matClampAluminum);
    gateClamp.position.set(0, 0, 0.008);
    gateClamp.castShadow = true;
    photogateAssembly.add(gateClamp);

    // Vòng đai xanh dương đánh dấu kênh B trên kẹp cổng quang B
    const gateBCollar = new THREE.Mesh(
      new THREE.BoxGeometry(0.04, 0.01, 0.052),
      matBlueTerminal
    );
    gateBCollar.position.set(0, 0.014, 0.008);
    photogateAssembly.add(gateBCollar);

    const gateKnobShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.028, 12), matStainlessRod);
    gateKnobShaft.rotation.z = Math.PI / 2;
    gateKnobShaft.position.set(-0.026, 0, 0);
    photogateAssembly.add(gateKnobShaft);

    const gateKnobHead = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.014, 20), matBrass);
    gateKnobHead.rotation.z = Math.PI / 2;
    gateKnobHead.position.set(-0.042, 0, 0);
    photogateAssembly.add(gateKnobHead);

    const rulerPointer = new THREE.Mesh(
      new THREE.ConeGeometry(0.0055, 0.018, 4),
      new THREE.MeshBasicMaterial({ color: 0xf59e0b })
    );
    rulerPointer.rotation.z = -Math.PI / 2;
    rulerPointer.position.set(0.019, 0, 0.016);
    photogateAssembly.add(rulerPointer);

    const photogateForkOffsetGroup = new THREE.Group();

    const gateArm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.016, 0.045), matDarkAbs);
    gateArm.position.set(0, 0, 0.036);
    photogateForkOffsetGroup.add(gateArm);

    const uBase = new THREE.Mesh(new THREE.BoxGeometry(0.082, 0.024, 0.014), matDarkAbs);
    uBase.position.set(0, 0, 0.042);
    uBase.castShadow = true;
    photogateForkOffsetGroup.add(uBase);

    const leftProng = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.024, 0.048), matDarkAbs);
    leftProng.position.set(-0.0355, 0, 0.065);
    leftProng.castShadow = true;
    photogateForkOffsetGroup.add(leftProng);

    const rightProng = new THREE.Mesh(new THREE.BoxGeometry(0.011, 0.024, 0.048), matDarkAbs);
    rightProng.position.set(0.0355, 0, 0.065);
    rightProng.castShadow = true;
    photogateForkOffsetGroup.add(rightProng);

    // Vòng phản hồi thị giác (Visual Highlight Halo) bao quanh cổng quang khi hover hoặc đang kéo
    const photogateHighlightRing = new THREE.Mesh(
      new THREE.RingGeometry(0.044, 0.051, 32),
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide,
      })
    );
    photogateHighlightRing.rotation.x = Math.PI / 2;
    photogateHighlightRing.position.set(0, 0, DROP_LINE_Z);
    photogateHighlightRing.visible = false;
    photogateForkOffsetGroup.add(photogateHighlightRing);

    const lensMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      emissive: 0x991b1b,
      emissiveIntensity: 0.9,
      roughness: 0.15,
    });
    const emitterLens = new THREE.Mesh(new THREE.CylinderGeometry(0.0035, 0.0035, 0.004, 12), lensMat);
    emitterLens.rotation.z = Math.PI / 2;
    emitterLens.position.set(-0.03, 0, DROP_LINE_Z);
    photogateForkOffsetGroup.add(emitterLens);

    const receiverLens = emitterLens.clone();
    receiverLens.position.set(0.03, 0, DROP_LINE_Z);
    photogateForkOffsetGroup.add(receiverLens);

    const laserBeamMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0014, 0.0014, 0.06, 12),
      new THREE.MeshBasicMaterial({
        color: 0xef4444,
        transparent: true,
        opacity: 0.65,
      })
    );
    laserBeamMesh.rotation.z = Math.PI / 2;
    laserBeamMesh.position.set(0, 0, DROP_LINE_Z);
    photogateForkOffsetGroup.add(laserBeamMesh);

    const triggerRingMesh = new THREE.Mesh(
      new THREE.RingGeometry(0.014, 0.024, 28),
      new THREE.MeshBasicMaterial({
        color: 0xf59e0b,
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
      })
    );
    triggerRingMesh.rotation.x = Math.PI / 2;
    triggerRingMesh.position.set(0, 0, DROP_LINE_Z);
    triggerRingMesh.visible = false;
    photogateForkOffsetGroup.add(triggerRingMesh);

    const photogateLedMat = new THREE.MeshStandardMaterial({
      color: 0x10b981,
      emissive: 0x10b981,
      emissiveIntensity: 1.4,
    });
    const photogateLed = new THREE.Mesh(new THREE.SphereGeometry(0.004, 12, 12), photogateLedMat);
    photogateLed.position.set(0.0355, 0.014, 0.055);
    photogateForkOffsetGroup.add(photogateLed);

    photogateAssembly.add(photogateForkOffsetGroup);

    const dragHitBox = new THREE.Mesh(
      new THREE.BoxGeometry(0.16, 0.085, 0.14),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    dragHitBox.position.set(0, 0, 0.045);
    photogateAssembly.add(dragHitBox);

    registerInteractive(photogateAssembly, 'PHOTOGATE', 'DRAG_PHOTOGATE', 'PHOTOGATE');
    scene.add(photogateAssembly);

    // =========================================================================
    // BỘ PHẬN (6): ĐỒNG HỒ ĐO THỜI GIAN HIỆN SỐ
    // =========================================================================
    const timerGroup = new THREE.Group();
    timerGroup.position.set(0.34, 0, 0.08);

    const timerBody = new THREE.Mesh(
      new THREE.BoxGeometry(0.28, 0.15, 0.18),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.42, metalness: 0.25 })
    );
    timerBody.position.set(0, 0.075, 0);
    timerBody.castShadow = true;
    timerBody.receiveShadow = true;
    timerGroup.add(timerBody);

    const timerScreenCanvas = document.createElement('canvas');
    timerScreenCanvas.width = 640;
    timerScreenCanvas.height = 340;
    updateTimerScreenCanvas(
      timerScreenCanvas,
      latestPropsRef.current.snapshot,
      latestPropsRef.current.physicsConfig
    );
    const timerScreenTexture = new THREE.CanvasTexture(timerScreenCanvas);
    timerScreenTexture.colorSpace = THREE.SRGBColorSpace;
    timerScreenTexture.anisotropy = maxAniso;

    const timerFrontPlate = new THREE.Mesh(
      new THREE.PlaneGeometry(0.264, 0.136),
      new THREE.MeshStandardMaterial({
        map: timerScreenTexture,
        roughness: 0.22,
        metalness: 0.05,
      })
    );
    timerFrontPlate.position.set(0, 0.075, 0.091);
    timerGroup.add(timerFrontPlate);

    const powerSwitchMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.024, 0.015, 0.014),
      new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.3 })
    );
    powerSwitchMesh.position.set(-0.004, 0.019, 0.096);
    registerInteractive(powerSwitchMesh, 'DIGITAL_TIMER', 'TOGGLE_POWER', 'BTN_POWER');
    timerGroup.add(powerSwitchMesh);

    const resetBtnMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.014, 20),
      new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.25, metalness: 0.2 })
    );
    resetBtnMesh.rotation.x = Math.PI / 2;
    resetBtnMesh.position.set(0.047, 0.019, 0.096);
    registerInteractive(resetBtnMesh, 'DIGITAL_TIMER', 'RESET_TIMER', 'BTN_RESET');
    timerGroup.add(resetBtnMesh);

    const modeBtnMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(0.0105, 0.0105, 0.014, 20),
      new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.3, metalness: 0.3 })
    );
    modeBtnMesh.rotation.x = Math.PI / 2;
    modeBtnMesh.position.set(0.097, 0.019, 0.096);
    registerInteractive(modeBtnMesh, 'DIGITAL_TIMER', 'CYCLE_MODE', 'BTN_MODE');
    timerGroup.add(modeBtnMesh);

    // =========================================================================
    // Ổ CẮM TÍN HIỆU 3D TRÊN DẢI MÉP TRÁI MẶT ĐỒNG HỒ MC964 (local x = -0.1155, world x = 0.2245)
    // Đặt ở mép trái (gần cột giá đỡ x = 0) giúp dây từ Cổng A, Cổng B và Công tắc
    // đi thẳng từ bên trái vào ổ cắm mà KHÔNG BAO GIỜ vắt ngang qua màn hình hay che thông số.
    // =========================================================================
    const buildPanelSocket3D = (localY: number, coreMat: THREE.Material) => {
      const sockGroup = new THREE.Group();
      sockGroup.position.set(-0.1155, localY, 0.091);

      // Vòng đai ốc lục giác / ren kim loại mạ crôm
      const bezelMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0085, 0.0095, 0.007, 18),
        matStainlessRod
      );
      bezelMesh.rotation.x = Math.PI / 2;
      bezelMesh.position.z = 0.0035;
      sockGroup.add(bezelMesh);

      // Lõi cách điện màu theo kênh (Đỏ cho A, Xanh cho B, Đen/Cam cho Công tắc)
      const coreMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0062, 0.0062, 0.009, 16),
        coreMat
      );
      coreMesh.rotation.x = Math.PI / 2;
      coreMesh.position.z = 0.0045;
      sockGroup.add(coreMesh);

      // Lỗ kim loại chính giữa ổ cắm
      const pinHoleMesh = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0028, 0.0028, 0.01, 12),
        matDarkAbs
      );
      pinHoleMesh.rotation.x = Math.PI / 2;
      pinHoleMesh.position.z = 0.005;
      sockGroup.add(pinHoleMesh);

      return sockGroup;
    };

    // Ổ cắm CỔNG A (Ở phía trên: local y = 0.104, world y = 0.104)
    const jackA = buildPanelSocket3D(0.104, matRedTerminal);
    timerGroup.add(jackA);

    // Ổ cắm CỔNG B (Ở phía dưới: local y = 0.071, world y = 0.071)
    const jackB = buildPanelSocket3D(0.071, matBlueTerminal);
    timerGroup.add(jackB);

    // Ổ cắm phụ CÔNG TẮC / NAM CHÂM (Ở dưới cùng: local y = 0.038, world y = 0.038)
    const jackSwitch = buildPanelSocket3D(0.038, matBlackTerminal);
    timerGroup.add(jackSwitch);

    registerInteractive(timerBody, 'DIGITAL_TIMER', undefined, 'TIMER_BODY');
    registerInteractive(timerFrontPlate, 'DIGITAL_TIMER', undefined, 'TIMER_BODY');
    scene.add(timerGroup);

    // Tạo phích cắm 3D có chuôi cao su chống gãy cáp (Strain-Relief Aviation Plug)
    const buildAviationPlug3D = (bodyMat: THREE.Material) => {
      const plugGroup = new THREE.Group();

      // Đầu kim loại cắm vào ổ
      const metalTip = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0048, 0.0048, 0.01, 14),
        matStainlessRod
      );
      metalTip.rotation.x = Math.PI / 2;
      metalTip.position.z = -0.004;
      plugGroup.add(metalTip);

      // Thân phích cắm bọc nhựa màu
      const gripBody = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0072, 0.0068, 0.015, 16),
        bodyMat
      );
      gripBody.rotation.x = Math.PI / 2;
      gripBody.position.z = 0.006;
      gripBody.castShadow = true;
      plugGroup.add(gripBody);

      // Vòng khía kim loại
      const knurlRing = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0076, 0.0076, 0.004, 16),
        matStainlessRod
      );
      knurlRing.rotation.x = Math.PI / 2;
      knurlRing.position.z = 0.001;
      plugGroup.add(knurlRing);

      // Chuôi cao su thuôn chống gãy đầu dây (Strain-relief boot) hướng về +Z (z = 0.013 -> 0.026)
      const rubberBoot = new THREE.Mesh(
        new THREE.CylinderGeometry(0.0038, 0.0062, 0.013, 14),
        matRubber
      );
      rubberBoot.rotation.x = Math.PI / 2;
      rubberBoot.position.z = 0.0195;
      plugGroup.add(rubberBoot);

      return plugGroup;
    };

    const plugAGroup = buildAviationPlug3D(matRedTerminal);
    const plugBGroup = buildAviationPlug3D(matBlueTerminal);
    const plugSwitchGroup = buildAviationPlug3D(matBlackTerminal);
    // Phích cắm công tắc luôn cắm ở ổ dưới cùng (world x = 0.2245, y = 0.038, z = 0.178)
    plugSwitchGroup.position.set(0.2245, 0.038, 0.178);
    scene.add(plugAGroup);
    scene.add(plugBGroup);
    scene.add(plugSwitchGroup);

    // Kẹp giữ dây cố định trên mặt bàn gỗ (Bench Cable Clips) để các dây đi gọn gàng thực tế
    const createCableClip = (x: number, z: number, rotY = 0) => {
      const clip = new THREE.Mesh(
        new THREE.BoxGeometry(0.016, 0.007, 0.014),
        matDarkAbs
      );
      clip.position.set(x, 0.0035, z);
      clip.rotation.y = rotY;
      clip.receiveShadow = true;
      scene.add(clip);
    };
    createCableClip(-0.14, 0.215, 0.2);
    createCableClip(0.04, 0.232, 0);
    createCableClip(0.135, 0.185, -0.35);

    // =========================================================================
    // BỘ PHẬN (7): CÔNG TẮC KÉP ĐIỀU KHIỂN NHẢ TRỤ THÉP
    // =========================================================================
    const switchGroup = new THREE.Group();
    switchGroup.position.set(-0.26, 0, 0.16);

    const switchBase = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.028, 0.085), matDarkAbs);
    switchBase.position.set(0, 0.014, 0);
    switchBase.castShadow = true;
    switchBase.receiveShadow = true;
    switchGroup.add(switchBase);

    const switchLeverGroup = new THREE.Group();
    switchLeverGroup.position.set(0, 0.028, 0);

    const leverArm = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.038, 0.012), matStainlessRod);
    leverArm.position.set(0, 0.018, 0);
    switchLeverGroup.add(leverArm);

    const leverKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.012, 0.018, 16), matRedTerminal);
    leverKnob.position.set(0, 0.04, 0);
    leverKnob.castShadow = true;
    switchLeverGroup.add(leverKnob);

    switchGroup.add(switchLeverGroup);

    const swPost1 = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.014, 12), matRedTerminal);
    swPost1.position.set(-0.032, 0.032, -0.024);
    switchGroup.add(swPost1);

    const swPost2 = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.014, 12), matBlackTerminal);
    swPost2.position.set(0.032, 0.032, -0.024);
    switchGroup.add(swPost2);

    registerInteractive(switchGroup, 'RELEASE_SWITCH', 'RELEASE_CYLINDER', 'SWITCH');
    scene.add(switchGroup);

    // =========================================================================
    // HỆ THỐNG DÂY DẪN 3D THỰC TẾ – PHÂN TẦNG KHÔNG GIAN, KHÔNG CHE MÀN HÌNH ĐỒNG HỒ
    // - Mọi dây đều đi ở vùng bên trái đồng hồ (x <= 0.2245) và phía trước ổ cắm (z >= 0.204)
    // - Tuyệt đối không đâm xuyên qua thân đồng hồ và không vắt ngang qua mặt hiển thị LED
    // =========================================================================

    // 1. Dây nguồn từ Công tắc kép (cọc trái) đi vòng phía sau giá đỡ lên Nam châm điện đỉnh trụ
    const magnetCableCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.292, 0.035, 0.136),
      new THREE.Vector3(-0.24, 0.010, 0.035),
      new THREE.Vector3(-0.11, 0.012, -0.035),
      new THREE.Vector3(-0.032, 0.36, -0.025),
      new THREE.Vector3(-0.024, 0.88, -0.012),
      new THREE.Vector3(-0.01, 1.01, DROP_LINE_Z),
    ]);
    const magnetCableMesh = new THREE.Mesh(
      new THREE.TubeGeometry(magnetCableCurve, 40, 0.0032, 10, false),
      new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.42 })
    );
    magnetCableMesh.castShadow = true;
    scene.add(magnetCableMesh);

    // 2. Dây tín hiệu kích hoạt từ Công tắc kép (cọc phải) đi sát mặt bàn phía trước vào ổ SW/EM dưới cùng
    const switchToTimerCurve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-0.228, 0.035, 0.136),
      new THREE.Vector3(-0.14, 0.009, 0.215),
      new THREE.Vector3(0.04, 0.009, 0.232),
      new THREE.Vector3(0.175, 0.014, 0.228),
      new THREE.Vector3(0.218, 0.036, 0.216),
      new THREE.Vector3(0.2245, 0.038, 0.204),
    ]);
    const switchToTimerMesh = new THREE.Mesh(
      new THREE.TubeGeometry(switchToTimerCurve, 36, 0.003, 10, false),
      new THREE.MeshStandardMaterial({ color: 0xd97706, roughness: 0.42 })
    );
    switchToTimerMesh.castShadow = true;
    scene.add(switchToTimerMesh);

    // Hàm cập nhật vị trí phích cắm 3D của Cổng A và Cổng B (cắm vào ổ hoặc rút ra đặt trên bàn)
    const updatePlugATransform = (connected: boolean) => {
      if (connected) {
        plugAGroup.position.set(0.2245, 0.104, 0.178);
        plugAGroup.rotation.set(0, 0, 0);
      } else {
        plugAGroup.position.set(0.168, 0.009, 0.236);
        plugAGroup.rotation.set(0, -0.45, 0);
      }
    };
    const updatePlugBTransform = (connected: boolean) => {
      if (connected) {
        plugBGroup.position.set(0.2245, 0.071, 0.178);
        plugBGroup.rotation.set(0, 0, 0);
      } else {
        plugBGroup.position.set(0.142, 0.009, 0.252);
        plugBGroup.rotation.set(0, -0.55, 0);
      }
    };
    updatePlugATransform(latestPropsRef.current.snapshot.portAConnected);
    updatePlugBTransform(latestPropsRef.current.snapshot.photogateConnected);

    // 3. Dây tín hiệu ĐỎ từ Cổng quang điện A (trên giá đỡ) nối vào CỔNG A (phía trên, mép trái đồng hồ)
    // Đi theo cung lơ lửng tầng trên (y >= 0.104), uốn từ bên trái vào thẳng đuôi phích cắm A (x = 0.2245, z = 0.204)
    let activePhotogateACurve = new THREE.CatmullRomCurve3([]);
    const photogateACableMat = new THREE.MeshStandardMaterial({
      color: 0xef4444,
      roughness: 0.36,
      metalness: 0.05,
    });
    const buildPhotogateACableGeo = (gateAY: number, connected: boolean) => {
      const startPt = new THREE.Vector3(0.036, gateAY, 0.038);
      if (connected) {
        activePhotogateACurve = new THREE.CatmullRomCurve3([
          startPt,
          new THREE.Vector3(0.088, Math.max(0.155, gateAY - 0.035), 0.068),
          new THREE.Vector3(0.148, Math.max(0.122, gateAY * 0.46), 0.142),
          new THREE.Vector3(0.206, 0.106, 0.214),
          new THREE.Vector3(0.2245, 0.104, 0.204), // Đúng đầu chuôi cao su phích cắm CỔNG A (Trên)
        ]);
      } else {
        activePhotogateACurve = new THREE.CatmullRomCurve3([
          startPt,
          new THREE.Vector3(0.085, Math.max(0.12, gateAY * 0.65), 0.085),
          new THREE.Vector3(0.132, 0.025, 0.175),
          new THREE.Vector3(0.168, 0.009, 0.236), // Nối tới phích cắm A đang rút để trên mặt bàn
        ]);
      }
      return new THREE.TubeGeometry(activePhotogateACurve, 36, 0.0034, 10, false);
    };
    const photogateACableMesh = new THREE.Mesh(
      buildPhotogateACableGeo(initGateAY, latestPropsRef.current.snapshot.portAConnected),
      photogateACableMat
    );
    photogateACableMesh.castShadow = true;
    scene.add(photogateACableMesh);

    // 4. Dây tín hiệu XANH DƯƠNG từ Cổng quang điện B (trên giá đỡ) nối vào CỔNG B (phía dưới, mép trái đồng hồ)
    // Đi qua kẹp giữ dây trên mặt bàn (x = 0.135, z = 0.185) rồi vòng lên thẳng đuôi phích cắm B (y = 0.071)
    let activePhotogateCurve = new THREE.CatmullRomCurve3([]);
    const photogateCableMat = new THREE.MeshStandardMaterial({
      color: 0x0284c7,
      roughness: 0.36,
      metalness: 0.05,
    });
    const buildPhotogateCableGeo = (gateY: number, connected: boolean) => {
      const startPt = new THREE.Vector3(0.036, gateY, 0.038);
      if (connected) {
        activePhotogateCurve = new THREE.CatmullRomCurve3([
          startPt,
          new THREE.Vector3(0.078, Math.max(0.075, gateY - 0.045), 0.105),
          new THREE.Vector3(0.135, 0.011, 0.185), // Đi qua kẹp cố định dây trên mặt bàn gỗ
          new THREE.Vector3(0.202, 0.066, 0.216),
          new THREE.Vector3(0.2245, 0.071, 0.204), // Đúng đầu chuôi cao su phích cắm CỔNG B (Dưới)
        ]);
      } else {
        activePhotogateCurve = new THREE.CatmullRomCurve3([
          startPt,
          new THREE.Vector3(0.078, Math.max(0.06, gateY * 0.6), 0.11),
          new THREE.Vector3(0.118, 0.011, 0.195),
          new THREE.Vector3(0.142, 0.009, 0.252), // Nối tới phích cắm B đang rút để trên mặt bàn
        ]);
      }
      return new THREE.TubeGeometry(activePhotogateCurve, 36, 0.0034, 10, false);
    };
    const photogateCableMesh = new THREE.Mesh(
      buildPhotogateCableGeo(initGateY, latestPropsRef.current.snapshot.photogateConnected),
      photogateCableMat
    );
    photogateCableMesh.castShadow = true;
    scene.add(photogateCableMesh);

    const pulseSpheres: THREE.Mesh[] = [];
    const pulseGeo = new THREE.SphereGeometry(0.0055, 10, 10);
    const pulseMatA = new THREE.MeshBasicMaterial({ color: 0xfbbf24 });
    for (let i = 0; i < 4; i++) {
      const p = new THREE.Mesh(pulseGeo, pulseMatA);
      p.visible = false;
      scene.add(p);
      pulseSpheres.push(p);
    }

    const pulseSpheresB: THREE.Mesh[] = [];
    const pulseMatB = new THREE.MeshBasicMaterial({ color: 0x38bdf8 });
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(pulseGeo, pulseMatB);
      p.visible = false;
      scene.add(p);
      pulseSpheresB.push(p);
    }

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    sceneObjectsRef.current = {
      camera,
      controls,
      photogateAAssembly,
      photogateAHighlightRing,
      laserBeamAMesh,
      triggerRingAMesh,
      photogateALedMat,
      photogateACableMesh,
      photogateAssembly,
      photogateForkOffsetGroup,
      photogateHighlightRing,
      laserBeamMesh,
      triggerRingMesh,
      photogateLedMat,
      steelCylinderGroup,
      cylinderRingMat,
      magnetSnapPreviewRing,
      velocityArrowGroup,
      strobeInstancedMesh,
      magnetLedMat,
      magnetCoilMat: matCopperCoil,
      switchLeverGroup,
      powerSwitchMesh,
      timerScreenCanvas,
      timerScreenTexture,
      photogateCableMesh,
      photogateCableMat,
      plugAGroup,
      plugBGroup,
      pulseSpheres,
      pulseSpheresB,
      dimensionLineMesh,
      activeCameraPreset: latestPropsRef.current.cameraPreset,
      isTransitioningCamera: false,
      manualCylinderDragY: null,
    };

    // =========================================================================
    // HỆ THỐNG RAYCASTER MƯỢT MÀ: HOVER HIGHLIGHT & KÉO THẢ TRỰC TIẾP TRỤ THÉP / CỔNG A / CỔNG B
    // =========================================================================
    const raycaster = new THREE.Raycaster();
    const pointerNdc = new THREE.Vector2();
    let currentDragTarget: 'NONE' | 'PHOTOGATE_A' | 'PHOTOGATE' | 'CYLINDER' = 'NONE';
    let dragGrabOffsetY = 0; // Lưu độ lệch điểm chạm ban đầu để vật thể không bị giật (zero jump)
    let currentHoveredKey: string | null = null;
    let pointerDownPos = { x: 0, y: 0 };
    let lastHoverRaycastMs = 0;
    let lastGateACableY = initGateAY;
    let lastGateAConnected = latestPropsRef.current.snapshot.portAConnected;
    let lastGateCableY = initGateY;
    let lastGateConnected = latestPropsRef.current.snapshot.photogateConnected;

    const applyGroupHighlight = (key: string | null, isDragging: boolean) => {
      highlightableGroupsMap.forEach((groupObj, groupKey) => {
        const isTarget = groupKey === key;
        groupObj.traverse((child) => {
          if ((child as THREE.Mesh).isMesh && child.userData.baseEmissiveHex !== undefined) {
            const stdMat = (child as THREE.Mesh).material as THREE.MeshStandardMaterial;
            if (isTarget) {
              stdMat.emissive.copy(
                isDragging ? _emissiveActiveDragColor : _emissiveHighlightColor
              );
              stdMat.emissiveIntensity = isDragging ? 0.65 : 0.45;
            } else {
              stdMat.emissive.setHex(child.userData.baseEmissiveHex);
              stdMat.emissiveIntensity = child.userData.baseEmissiveIntensity ?? 1;
            }
          }
        });
      });

      if (sceneObjectsRef.current) {
        sceneObjectsRef.current.photogateAHighlightRing.visible =
          key === 'PHOTOGATE_A' || currentDragTarget === 'PHOTOGATE_A';
        const ringMatA = sceneObjectsRef.current.photogateAHighlightRing
          .material as THREE.MeshBasicMaterial;
        ringMatA.color.setHex(currentDragTarget === 'PHOTOGATE_A' ? 0xf59e0b : 0xef4444);

        sceneObjectsRef.current.photogateHighlightRing.visible =
          key === 'PHOTOGATE' || currentDragTarget === 'PHOTOGATE';
        const ringMat = sceneObjectsRef.current.photogateHighlightRing
          .material as THREE.MeshBasicMaterial;
        ringMat.color.setHex(currentDragTarget === 'PHOTOGATE' ? 0xf59e0b : 0x38bdf8);
      }
    };

    const updatePointerNdc = (clientX: number, clientY: number) => {
      const bounds = canvasEl.getBoundingClientRect();
      pointerNdc.x = ((clientX - bounds.left) / Math.max(1, bounds.width)) * 2 - 1;
      pointerNdc.y = -((clientY - bounds.top) / Math.max(1, bounds.height)) * 2 + 1;
    };

    const getVerticalPlaneIntersectionY = (): number | null => {
      camera.getWorldDirection(_dragPlaneNormal);
      _dragPlaneNormal.y = 0;
      if (_dragPlaneNormal.lengthSq() < 1e-4) {
        _dragPlaneNormal.set(0, 0, 1);
      } else {
        _dragPlaneNormal.normalize();
      }
      _dragPlane.setFromNormalAndCoplanarPoint(
        _dragPlaneNormal,
        new THREE.Vector3(DROP_LINE_X, 0.5, DROP_LINE_Z)
      );
      if (raycaster.ray.intersectPlane(_dragPlane, _rayPlaneIntersection)) {
        return _rayPlaneIntersection.y;
      }
      return null;
    };

    const onPointerDown = (e: PointerEvent) => {
      pointerDownPos = { x: e.clientX, y: e.clientY };
      updatePointerNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);

      const hits = raycaster.intersectObjects(interactiveMeshes, true);
      if (hits.length > 0) {
        const hitObj = hits[0].object;
        const eqId = hitObj.userData.equipmentId as EquipmentId | undefined;
        const actionType = hitObj.userData.actionType as string | undefined;
        const highlightKey = hitObj.userData.highlightKey as string | undefined;

        const planeY = getVerticalPlaneIntersectionY();

        // 1A. Ưu tiên kéo Cổng quang điện A (khi Cổng A đang hiển thị)
        if (
          actionType === 'DRAG_PHOTOGATE_A' &&
          sceneObjectsRef.current?.photogateAAssembly.visible
        ) {
          currentDragTarget = 'PHOTOGATE_A';
          setActiveDragTarget('PHOTOGATE_A');
          const currentGateAY =
            sceneObjectsRef.current?.photogateAAssembly.position.y ??
            DROP_ORIGIN_Y - latestPropsRef.current.snapshot.gateADistanceMeters;
          dragGrabOffsetY = planeY !== null ? planeY - currentGateAY : 0;
          controls.enabled = false;
          applyGroupHighlight('PHOTOGATE_A', true);
          canvasEl.setPointerCapture(e.pointerId);
          e.stopPropagation();
          return;
        }

        // 1B. Ưu tiên kéo Cổng quang điện B (khi Cổng B đang hiển thị)
        if (
          (actionType === 'DRAG_PHOTOGATE' || eqId === 'PHOTOGATE') &&
          sceneObjectsRef.current?.photogateAssembly.visible
        ) {
          currentDragTarget = 'PHOTOGATE';
          setActiveDragTarget('PHOTOGATE');
          const currentGateY =
            sceneObjectsRef.current?.photogateAssembly.position.y ??
            DROP_ORIGIN_Y - latestPropsRef.current.snapshot.photogateDistanceMeters;
          dragGrabOffsetY = planeY !== null ? planeY - currentGateY : 0;
          controls.enabled = false;
          applyGroupHighlight('PHOTOGATE', true);
          canvasEl.setPointerCapture(e.pointerId);
          e.stopPropagation();
          return;
        }

        // 2. Ưu tiên kéo thả trực tiếp Trụ thép
        if (actionType === 'DRAG_CYLINDER' || eqId === 'STEEL_CYLINDER') {
          const snap = latestPropsRef.current.snapshot;
          if (
            snap.phase !== 'FALLING_TIMER_RUNNING' &&
            snap.phase !== 'PHOTOGATE_TRIGGERED'
          ) {
            currentDragTarget = 'CYLINDER';
            setActiveDragTarget('CYLINDER');
            const currentCylY =
              sceneObjectsRef.current?.steelCylinderGroup.position.y ?? DROP_ORIGIN_Y;
            dragGrabOffsetY = planeY !== null ? planeY - currentCylY : 0;
            if (sceneObjectsRef.current) {
              sceneObjectsRef.current.manualCylinderDragY = currentCylY;
              sceneObjectsRef.current.magnetSnapPreviewRing.visible = true;
            }
            controls.enabled = false;
            applyGroupHighlight('CYLINDER', true);
            canvasEl.setPointerCapture(e.pointerId);
            e.stopPropagation();
            return;
          }
        }

        if (highlightKey) {
          applyGroupHighlight(highlightKey, false);
        }
      }
    };

    const onPointerMove = (e: PointerEvent) => {
      updatePointerNdc(e.clientX, e.clientY);
      raycaster.setFromCamera(pointerNdc, camera);

      // Xử lí khi đang kéo Cổng quang điện A
      if (currentDragTarget === 'PHOTOGATE_A') {
        canvasEl.style.cursor = 'ns-resize';
        const planeY = getVerticalPlaneIntersectionY();
        if (planeY !== null) {
          const targetGateAY = planeY - dragGrabOffsetY;
          const rawSA = DROP_ORIGIN_Y - targetGateAY;
          const clampedSA = Math.max(0.05, Math.min(0.75, Math.round(rawSA * 1000) / 1000));
          latestPropsRef.current.onChangeGateADistance?.(clampedSA);
        }
        return;
      }

      // Xử lí khi đang kéo Cổng quang điện B (mượt mà với grab offset, độ chia 1 mm)
      if (currentDragTarget === 'PHOTOGATE') {
        canvasEl.style.cursor = 'ns-resize';
        const planeY = getVerticalPlaneIntersectionY();
        if (planeY !== null) {
          const targetGateY = planeY - dragGrabOffsetY;
          const rawS = DROP_ORIGIN_Y - targetGateY;
          const clampedS = Math.max(0.1, Math.min(0.8, Math.round(rawS * 1000) / 1000));
          latestPropsRef.current.onChangePhotogateDistance(clampedS);
        }
        return;
      }

      // Xử lí khi đang kéo trực tiếp Trụ thép lên/xuống dọc đường rơi
      if (currentDragTarget === 'CYLINDER') {
        canvasEl.style.cursor = 'grabbing';
        const planeY = getVerticalPlaneIntersectionY();
        if (planeY !== null && sceneObjectsRef.current) {
          const targetCylY = Math.max(
            CATCH_TRAY_SURFACE_Y,
            Math.min(DROP_ORIGIN_Y, planeY - dragGrabOffsetY)
          );
          sceneObjectsRef.current.manualCylinderDragY = targetCylY;
        }
        return;
      }

      // Khi không kéo: Kiểm tra Hover với throttle 30ms để hiển thị phản hồi thị giác (Highlight)
      const now = performance.now();
      if (now - lastHoverRaycastMs < 30) return;
      lastHoverRaycastMs = now;

      const hits = raycaster.intersectObjects(interactiveMeshes, true);
      if (hits.length > 0) {
        const hitObj = hits[0].object;
        const actionType = hitObj.userData.actionType as string | undefined;
        const highlightKey = hitObj.userData.highlightKey as string | undefined;

        if (highlightKey !== currentHoveredKey) {
          currentHoveredKey = highlightKey || null;
          applyGroupHighlight(currentHoveredKey, false);
        }

        canvasEl.style.cursor =
          actionType === 'DRAG_PHOTOGATE_A' || actionType === 'DRAG_PHOTOGATE'
            ? 'ns-resize'
            : actionType === 'DRAG_CYLINDER'
            ? 'grab'
            : 'pointer';
      } else {
        if (currentHoveredKey !== null) {
          currentHoveredKey = null;
          applyGroupHighlight(null, false);
        }
        canvasEl.style.cursor = 'grab';
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      const moveDist = Math.hypot(e.clientX - pointerDownPos.x, e.clientY - pointerDownPos.y);

      if (currentDragTarget === 'PHOTOGATE_A' || currentDragTarget === 'PHOTOGATE') {
        currentDragTarget = 'NONE';
        setActiveDragTarget('NONE');
        controls.enabled = latestPropsRef.current.touchMode === 'ORBIT_CAMERA';
        applyGroupHighlight(currentHoveredKey, false);
        canvasEl.style.cursor = 'grab';
        try {
          canvasEl.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }
        return;
      }

      if (currentDragTarget === 'CYLINDER') {
        const draggedY = sceneObjectsRef.current?.manualCylinderDragY ?? DROP_ORIGIN_Y;
        if (sceneObjectsRef.current) {
          sceneObjectsRef.current.manualCylinderDragY = null;
          sceneObjectsRef.current.magnetSnapPreviewRing.visible = false;
        }
        currentDragTarget = 'NONE';
        setActiveDragTarget('NONE');
        controls.enabled = latestPropsRef.current.touchMode === 'ORBIT_CAMERA';
        applyGroupHighlight(currentHoveredKey, false);
        canvasEl.style.cursor = 'grab';
        try {
          canvasEl.releasePointerCapture(e.pointerId);
        } catch {
          // Ignore
        }

        const snap = latestPropsRef.current.snapshot;
        // Nếu người dùng kéo thực sự (> 8px):
        if (moveDist >= 8) {
          if (draggedY >= DROP_ORIGIN_Y - 0.08) {
            // Kéo lên gần đầu nam châm điện -> Hút gắn vào nam châm!
            latestPropsRef.current.onAttachCylinder();
          } else {
            // Kéo trụ thép xuống dưới nam châm và buông tay -> Kích hoạt thả rơi!
            latestPropsRef.current.onReleaseCylinder();
          }
          return;
        } else {
          // Nếu chỉ click/chạm nhẹ vào trụ thép:
          latestPropsRef.current.onSelectEquipment('STEEL_CYLINDER');
          if (!snap.cylinderAttachedToMagnet) {
            latestPropsRef.current.onAttachCylinder();
          } else {
            latestPropsRef.current.onReleaseCylinder();
          }
          return;
        }
      }

      // Click ngắn trên các thiết bị khác
      if (moveDist < 8) {
        updatePointerNdc(e.clientX, e.clientY);
        raycaster.setFromCamera(pointerNdc, camera);
        const hits = raycaster.intersectObjects(interactiveMeshes, true);
        if (hits.length > 0) {
          const hitObj = hits[0].object;
          const eqId = hitObj.userData.equipmentId as EquipmentId | undefined;
          const actionType = hitObj.userData.actionType as string | undefined;

          if (eqId) {
            latestPropsRef.current.onSelectEquipment(eqId);
          }

          if (actionType === 'TOGGLE_POWER') {
            latestPropsRef.current.onTogglePower();
          } else if (actionType === 'RESET_TIMER') {
            latestPropsRef.current.onResetTimer();
          } else if (actionType === 'CYCLE_MODE') {
            latestPropsRef.current.onCycleTimerMode();
          } else if (actionType === 'RELEASE_CYLINDER') {
            latestPropsRef.current.onReleaseCylinder();
          } else if (actionType === 'ATTACH_CYLINDER') {
            const snap = latestPropsRef.current.snapshot;
            if (!snap.cylinderAttachedToMagnet && snap.phase !== 'FALLING_TIMER_RUNNING') {
              latestPropsRef.current.onAttachCylinder();
            } else {
              labSound.playSwitchClick(820);
            }
          }
        }
      }
    };

    canvasEl.addEventListener('pointerdown', onPointerDown);
    canvasEl.addEventListener('pointermove', onPointerMove);
    canvasEl.addEventListener('pointerup', onPointerUp);
    canvasEl.addEventListener('pointercancel', onPointerUp);

    let currentCssW = initW;
    let currentCssH = initH;

    const handleResize = () => {
      if (!container) return;
      const bounds = container.getBoundingClientRect();
      const w = Math.max(1, bounds.width);
      const h = Math.max(1, bounds.height);
      currentCssW = w;
      currentCssH = h;

      const aspect = w / h;
      camera.aspect = aspect;
      camera.fov = aspect < 0.75 ? 52 : aspect < 1.0 ? 46 : 42;
      camera.updateProjectionMatrix();

      if (
        latestPropsRef.current.cameraPreset === 'OVERVIEW' &&
        !isUserControllingCamera
      ) {
        const overviewPose = computeFullApparatusOverviewPose(camera.fov, aspect);
        camera.position.set(...overviewPose.pos);
        controls.target.set(...overviewPose.target);
        controls.update();
      }

      const targetPr = getTargetPixelRatio(latestPropsRef.current.qualityPreset, adaptiveScale);
      renderer.setPixelRatio(targetPr);
      renderer.setSize(w, h, false);
    };

    handleResize();
    const resizeObserver = new ResizeObserver(() => {
      handleResize();
    });
    resizeObserver.observe(container);
    window.addEventListener('orientationchange', handleResize);

    // =========================================================================
    // VÒNG LẶP ANIMATION + CAMERA TỰ ĐỘNG ĐIỀU CHỈNH KHOẢNG CÁCH TỐI ƯU KHI VẬT RƠI
    // =========================================================================
    let frameId = 0;
    let lastTimeMs = performance.now();
    let fpsFrameCount = 0;
    let fpsAccumMs = 0;
    let currentFps = 60;
    let lastScreenStateKey = '';
    const dummyMatrix = new THREE.Matrix4();

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      if (gl && typeof gl.fenceSync === 'function') {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        gl.flush();
        const poll = () => {
          const state = sync && gl.getSyncParameter(sync, gl.SYNC_STATUS);
          if (state === gl.UNSIGNALED) {
            frameId = window.setTimeout(poll, 5);
          } else {
            if (sync) gl.deleteSync(sync);
            frameId = window.setTimeout(cb, 80);
          }
        };
        frameId = window.setTimeout(poll, 5);
      } else {
        frameId = window.setTimeout(cb, 80);
      }
    }

    function tick() {
      const nowMs = performance.now();
      const rawDt = Math.min(0.08, Math.max(0.001, (nowMs - lastTimeMs) / 1000));
      lastTimeMs = nowMs;

      fpsFrameCount++;
      fpsAccumMs += rawDt * 1000;
      if (fpsAccumMs >= 750) {
        currentFps = Math.round((fpsFrameCount * 1000) / fpsAccumMs);
        fpsFrameCount = 0;
        fpsAccumMs = 0;

        const qPreset = latestPropsRef.current.qualityPreset;
        if (qPreset === 'AUTO' && !isSoftwareGl) {
          if (currentFps < 28 && adaptiveScale > 0.7) {
            adaptiveScale = Math.max(0.65, adaptiveScale - 0.15);
            renderer.setPixelRatio(getTargetPixelRatio(qPreset, adaptiveScale));
            renderer.shadowMap.enabled = false;
          } else if (currentFps > 52 && adaptiveScale < 1.0) {
            adaptiveScale = Math.min(1.0, adaptiveScale + 0.1);
            renderer.setPixelRatio(getTargetPixelRatio(qPreset, adaptiveScale));
            renderer.shadowMap.enabled = true;
          }
        } else if (!isSoftwareGl) {
          adaptiveScale = 1.0;
          const targetPr = getTargetPixelRatio(qPreset, 1.0);
          if (Math.abs(renderer.getPixelRatio() - targetPr) > 0.05) {
            renderer.setPixelRatio(targetPr);
          }
          renderer.shadowMap.enabled = qPreset !== 'BATTERY_SAVER';
        }

        latestPropsRef.current.onUpdateRenderMetrics?.({
          fps: currentFps,
          canvasWidthCss: currentCssW,
          canvasHeightCss: currentCssH,
          rendererPixelRatio: renderer.getPixelRatio(),
          devicePixelRatio: window.devicePixelRatio || 1,
          isSoftwareGl,
          activeQualityLabel: isSoftwareGl
            ? 'Software WebGL (Tối ưu)'
            : `${qPreset} (${renderer.getPixelRatio().toFixed(2)}x)`,
        });
      }

      const props = latestPropsRef.current;
      const snap = props.snapshot;
      const objs = sceneObjectsRef.current;

      if (
        snap.phase === 'FALLING_TIMER_RUNNING' ||
        snap.phase === 'PHOTOGATE_TRIGGERED'
      ) {
        props.onSimulationTick(rawDt * props.playbackSpeed);
      }

      if (objs) {
        // 1. Vị trí Trụ thép (ưu tiên vị trí người dùng đang kéo tay, nếu không thì lấy từ mô hình vật lí)
        const targetCylinderY =
          objs.manualCylinderDragY !== null
            ? objs.manualCylinderDragY
            : DROP_ORIGIN_Y - snap.cylinderDropDistanceMeters;
        objs.steelCylinderGroup.position.set(DROP_LINE_X, targetCylinderY, DROP_LINE_Z);

        if (objs.manualCylinderDragY !== null) {
          objs.cylinderRingMat.color.setHex(
            objs.manualCylinderDragY >= DROP_ORIGIN_Y - 0.08 ? 0x10b981 : 0xf59e0b
          );
        } else if (snap.phase === 'FALLING_TIMER_RUNNING') {
          objs.cylinderRingMat.color.setHex(0x10b981);
        } else if (snap.phase === 'PHOTOGATE_TRIGGERED') {
          objs.cylinderRingMat.color.setHex(0xf59e0b);
        } else {
          objs.cylinderRingMat.color.setHex(0x38bdf8);
        }

        if (
          (props.showScientificVisuals || props.playbackSpeed < 1) &&
          snap.cylinderVelocityMetersPerSec > 0.05
        ) {
          objs.velocityArrowGroup.visible = true;
          const vScale = Math.min(2.2, Math.max(0.4, snap.cylinderVelocityMetersPerSec * 0.35));
          objs.velocityArrowGroup.scale.set(1, vScale, 1);
        } else {
          objs.velocityArrowGroup.visible = false;
        }

        const showStrobes =
          (props.showScientificVisuals ||
            snap.phase === 'FALLING_TIMER_RUNNING' ||
            snap.phase === 'PHOTOGATE_TRIGGERED') &&
          snap.strobePositionsMeters.length > 1;
        if (showStrobes) {
          objs.strobeInstancedMesh.visible = true;
          const count = Math.min(20, snap.strobePositionsMeters.length);
          objs.strobeInstancedMesh.count = count;
          for (let i = 0; i < count; i++) {
            const dMeters = snap.strobePositionsMeters[i];
            dummyMatrix.makeTranslation(DROP_LINE_X, DROP_ORIGIN_Y - dMeters, DROP_LINE_Z);
            objs.strobeInstancedMesh.setMatrixAt(i, dummyMatrix);
          }
          objs.strobeInstancedMesh.instanceMatrix.needsUpdate = true;
        } else {
          objs.strobeInstancedMesh.visible = false;
        }

        // 2. Xác định hiển thị Cổng quang điện A và Cổng quang điện B theo chế độ MODE đang chọn:
        // - Khi chọn MODE A (hoặc MODE T): Hiện Cổng quang điện A + ký hiệu A; ẩn Cổng B
        // - Khi chọn MODE B: Hiện Cổng quang điện B + ký hiệu B; ẩn Cổng A
        // - Khi chọn MODE A+B hoặc MODE A↔B: Hiện cả Cổng quang điện A (ký hiệu A) và Cổng quang điện B (ký hiệu B)
        const showGateA =
          snap.c3Mode === 'A' ||
          snap.c3Mode === 'A+B' ||
          snap.c3Mode === 'A<->B' ||
          snap.c3Mode === 'T';
        const showGateB =
          snap.c3Mode === 'B' ||
          snap.c3Mode === 'A+B' ||
          snap.c3Mode === 'A<->B';

        objs.photogateAAssembly.visible = showGateA;
        objs.photogateACableMesh.visible = showGateA;
        objs.plugAGroup.visible = showGateA;

        objs.photogateAssembly.visible = showGateB;
        objs.photogateCableMesh.visible = showGateB;
        objs.plugBGroup.visible = showGateB;

        // 2A. Cập nhật vị trí & trạng thái Cổng quang điện A (s_A)
        const gateAY = DROP_ORIGIN_Y - snap.gateADistanceMeters;
        objs.photogateAAssembly.position.y =
          currentDragTarget === 'PHOTOGATE_A'
            ? gateAY
            : THREE.MathUtils.damp(objs.photogateAAssembly.position.y, gateAY, 28, rawDt);

        const currentGateAY = objs.photogateAAssembly.position.y;
        if (
          Math.abs(currentGateAY - lastGateACableY) > 0.002 ||
          snap.portAConnected !== lastGateAConnected
        ) {
          lastGateACableY = currentGateAY;
          lastGateAConnected = snap.portAConnected;
          updatePlugATransform(snap.portAConnected);
          objs.photogateACableMesh.geometry.dispose();
          objs.photogateACableMesh.geometry = buildPhotogateACableGeo(
            currentGateAY,
            snap.portAConnected
          );
        }

        objs.laserBeamAMesh.visible = showGateA && snap.powerOn && snap.portAConnected;
        objs.triggerRingAMesh.visible =
          showGateA && (snap.isBeamABlockedNow || snap.portAState === 'ACTIVE');

        if (!snap.powerOn || !snap.portAConnected) {
          objs.photogateALedMat.color.setHex(0x334155);
          objs.photogateALedMat.emissive.setHex(0x000000);
        } else if (snap.isBeamABlockedNow || snap.portAState === 'ACTIVE') {
          objs.photogateALedMat.color.setHex(0xf59e0b);
          objs.photogateALedMat.emissive.setHex(0xf59e0b);
        } else {
          objs.photogateALedMat.color.setHex(0x10b981);
          objs.photogateALedMat.emissive.setHex(0x10b981);
        }

        // 2B. Cập nhật vị trí & trạng thái Cổng quang điện B (s)
        const gateY = DROP_ORIGIN_Y - snap.photogateDistanceMeters;
        objs.photogateAssembly.position.y =
          currentDragTarget === 'PHOTOGATE'
            ? gateY
            : THREE.MathUtils.damp(objs.photogateAssembly.position.y, gateY, 28, rawDt);

        const lateralMeters = snap.photogateLateralOffsetMm / 1000;
        objs.photogateForkOffsetGroup.position.x = THREE.MathUtils.damp(
          objs.photogateForkOffsetGroup.position.x,
          lateralMeters,
          20,
          rawDt
        );

        const currentGateY = objs.photogateAssembly.position.y;
        const activeRefY = showGateB ? currentGateY : currentGateAY;
        const sLen = Math.max(0.01, DROP_ORIGIN_Y - activeRefY);
        objs.dimensionLineMesh.scale.set(1, sLen, 1);
        objs.dimensionLineMesh.position.set(0.054, DROP_ORIGIN_Y - sLen / 2, 0.035);

        if (
          Math.abs(currentGateY - lastGateCableY) > 0.002 ||
          snap.photogateConnected !== lastGateConnected
        ) {
          lastGateCableY = currentGateY;
          lastGateConnected = snap.photogateConnected;
          updatePlugBTransform(snap.photogateConnected);
          objs.photogateCableMesh.geometry.dispose();
          objs.photogateCableMesh.geometry = buildPhotogateCableGeo(
            currentGateY,
            snap.photogateConnected
          );
        }

        objs.laserBeamMesh.visible = showGateB && snap.powerOn && snap.photogateConnected;
        objs.triggerRingMesh.visible =
          showGateB && (snap.isBeamBlockedNow || snap.phase === 'PHOTOGATE_TRIGGERED');

        if (!snap.powerOn || !snap.photogateConnected) {
          objs.photogateLedMat.color.setHex(0x334155);
          objs.photogateLedMat.emissive.setHex(0x000000);
        } else if (snap.isBeamBlockedNow || snap.phase === 'PHOTOGATE_TRIGGERED') {
          objs.photogateLedMat.color.setHex(0xf59e0b);
          objs.photogateLedMat.emissive.setHex(0xf59e0b);
        } else {
          objs.photogateLedMat.color.setHex(0x10b981);
          objs.photogateLedMat.emissive.setHex(0x10b981);
        }

        // 3. Trạng thái Nam châm điện & Công tắc kép
        if (snap.electromagnetEnergized && snap.powerOn) {
          objs.magnetLedMat.color.setHex(0x10b981);
          objs.magnetLedMat.emissive.setHex(0x10b981);
          objs.magnetCoilMat.emissive.setHex(props.showScientificVisuals ? 0x451a03 : 0x000000);
        } else {
          objs.magnetLedMat.color.setHex(0x334155);
          objs.magnetLedMat.emissive.setHex(0x000000);
          objs.magnetCoilMat.emissive.setHex(0x000000);
        }

        const targetSwitchAngle = snap.releaseSwitchClosed ? 0.25 : -0.32;
        objs.switchLeverGroup.rotation.x = THREE.MathUtils.damp(
          objs.switchLeverGroup.rotation.x,
          targetSwitchAngle,
          18,
          rawDt
        );

        // Hiệu ứng xung tín hiệu chạy trên dây Cổng quang A (vào cổng A trên) và dây Cổng quang B (vào cổng B dưới)
        objs.pulseSpheres.forEach((sphere, idx) => {
          const activeSignalA =
            showGateA &&
            snap.powerOn &&
            snap.portAConnected &&
            (snap.portAState === 'ACTIVE' || snap.phase === 'FALLING_TIMER_RUNNING');
          if (activeSignalA) {
            sphere.visible = true;
            const u = ((nowMs * 0.0014 + idx * 0.25) % 1 + 1) % 1;
            activePhotogateACurve.getPointAt(u, sphere.position);
          } else {
            sphere.visible = false;
          }
        });

        objs.pulseSpheresB.forEach((sphere, idx) => {
          const activeSignalB =
            showGateB &&
            snap.powerOn &&
            snap.portBConnected &&
            (snap.portBState === 'ACTIVE' || snap.phase === 'PHOTOGATE_TRIGGERED');
          if (activeSignalB) {
            sphere.visible = true;
            const u = ((nowMs * 0.0018 + idx * 0.33) % 1 + 1) % 1;
            activePhotogateCurve.getPointAt(u, sphere.position);
          } else {
            sphere.visible = false;
          }
        });

        // 4. Màn hình LED đồng hồ MC964
        const screenKey = `${snap.powerOn}_${snap.phase}_${snap.timerDisplaySeconds.toFixed(3)}_${snap.timerResetReady}_${snap.wiringVariant}_${snap.c3Mode}_${snap.portAState}_${snap.portBState}_${snap.periodEventCount}_${props.physicsConfig.timerScale}`;
        if (screenKey !== lastScreenStateKey) {
          lastScreenStateKey = screenKey;
          updateTimerScreenCanvas(objs.timerScreenCanvas, snap, props.physicsConfig);
          objs.timerScreenTexture.needsUpdate = true;
        }

        // =====================================================================
        // 5. CAMERA TỰ ĐỘNG ĐIỀU CHỈNH KHOẢNG CÁCH & GÓC NHÌN TỐI ƯU KHI VẬT RƠI
        // =====================================================================
        if (objs.activeCameraPreset !== props.cameraPreset) {
          objs.activeCameraPreset = props.cameraPreset;
          objs.isTransitioningCamera = true;
        }

        const isFallingNow =
          snap.phase === 'FALLING_TIMER_RUNNING' || snap.phase === 'PHOTOGATE_TRIGGERED';

        if (autoTrackFallRef.current && isFallingNow && !isUserControllingCamera) {
          objs.isTransitioningCamera = false;

          const overviewPose = computeFullApparatusOverviewPose(camera.fov, camera.aspect);
          const trackedTargetY = THREE.MathUtils.lerp(0.50, targetCylinderY, 0.18);

          _camTargetLook.set(0.03, Math.max(0.42, Math.min(0.56, trackedTargetY)), 0.05);
          _camTargetPos.set(
            overviewPose.pos[0],
            _camTargetLook.y + 0.02,
            overviewPose.pos[2]
          );

          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 5.5, rawDt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 6.5, rawDt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 5.5, rawDt);

          controls.target.x = THREE.MathUtils.damp(
            controls.target.x,
            _camTargetLook.x,
            6.5,
            rawDt
          );
          controls.target.y = THREE.MathUtils.damp(
            controls.target.y,
            _camTargetLook.y,
            7.5,
            rawDt
          );
          controls.target.z = THREE.MathUtils.damp(
            controls.target.z,
            _camTargetLook.z,
            6.5,
            rawDt
          );
        } else if (objs.isTransitioningCamera) {
          const targetPreset =
            props.cameraPreset === 'OVERVIEW'
              ? computeFullApparatusOverviewPose(camera.fov, camera.aspect)
              : CAMERA_PRESETS[props.cameraPreset] || CAMERA_PRESETS.OVERVIEW;
          _camTargetPos.set(...targetPreset.pos);
          _camTargetLook.set(...targetPreset.target);

          camera.position.x = THREE.MathUtils.damp(camera.position.x, _camTargetPos.x, 7, rawDt);
          camera.position.y = THREE.MathUtils.damp(camera.position.y, _camTargetPos.y, 7, rawDt);
          camera.position.z = THREE.MathUtils.damp(camera.position.z, _camTargetPos.z, 7, rawDt);

          controls.target.x = THREE.MathUtils.damp(controls.target.x, _camTargetLook.x, 7, rawDt);
          controls.target.y = THREE.MathUtils.damp(controls.target.y, _camTargetLook.y, 7, rawDt);
          controls.target.z = THREE.MathUtils.damp(controls.target.z, _camTargetLook.z, 7, rawDt);

          if (
            camera.position.distanceToSquared(_camTargetPos) < 0.0002 &&
            controls.target.distanceToSquared(_camTargetLook) < 0.0002
          ) {
            objs.isTransitioningCamera = false;
          }
        }

        controls.enabled =
          currentDragTarget === 'NONE' && props.touchMode === 'ORBIT_CAMERA';
        controls.update();

        // 6. CẬP NHẬT KÝ HIỆU "A" (CỔNG QUANG A) VÀ "B" (CỔNG QUANG B) TRÊN GIÁ ĐỠ THEO MODE ĐANG CHỌN
        if (standBadgeARef.current) {
          if (!showGateA) {
            standBadgeARef.current.style.opacity = '0';
          } else {
            _projVec.set(-0.058, objs.photogateAAssembly.position.y, 0.05).project(camera);
            if (_projVec.z <= 1) {
              const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
              const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
              standBadgeARef.current.style.opacity = '1';
              standBadgeARef.current.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(-50%, -50%)`;
            } else {
              standBadgeARef.current.style.opacity = '0';
            }
          }
        }

        if (standBadgeBRef.current) {
          if (!showGateB) {
            standBadgeBRef.current.style.opacity = '0';
          } else {
            _projVec.set(-0.058, objs.photogateAssembly.position.y, 0.05).project(camera);
            if (_projVec.z <= 1) {
              const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
              const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
              standBadgeBRef.current.style.opacity = '1';
              standBadgeBRef.current.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(-50%, -50%)`;
            } else {
              standBadgeBRef.current.style.opacity = '0';
            }
          }
        }

        // 7. Các chữ chú thích chi tiết chỉ hiện khi người dùng bật nút Con Mắt (showEquipmentLabels)
        if (props.showEquipmentLabels) {
          (Object.keys(EQUIPMENT_CATALOG) as EquipmentId[]).forEach((eqId) => {
            const btnEl = labelRefs.current[eqId];
            if (!btnEl) return;

            const item = EQUIPMENT_CATALOG[eqId];
            if (eqId === 'PHOTOGATE') {
              const anchorGateY = showGateB
                ? objs.photogateAssembly.position.y
                : objs.photogateAAssembly.position.y;
              _projVec.set(-0.08, anchorGateY, 0.065);
            } else if (eqId === 'STEEL_CYLINDER') {
              _projVec.set(
                DROP_LINE_X - 0.07,
                objs.steelCylinderGroup.position.y + 0.016,
                DROP_LINE_Z
              );
            } else {
              _projVec.set(...item.worldAnchor);
            }

            _projVec.project(camera);
            if (_projVec.z > 1) {
              btnEl.style.opacity = '0';
              btnEl.style.pointerEvents = 'none';
            } else {
              const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
              const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
              btnEl.style.opacity = '1';
              btnEl.style.pointerEvents = 'auto';
              btnEl.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(-50%, -50%)`;
            }
          });

          if (cylinderBadgeRef.current) {
            if (
              snap.phase === 'FALLING_TIMER_RUNNING' ||
              snap.phase === 'PHOTOGATE_TRIGGERED' ||
              objs.manualCylinderDragY !== null
            ) {
              _projVec
                .set(DROP_LINE_X + 0.04, objs.steelCylinderGroup.position.y + 0.015, DROP_LINE_Z)
                .project(camera);
              if (_projVec.z <= 1) {
                const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
                const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
                cylinderBadgeRef.current.style.opacity = '1';
                cylinderBadgeRef.current.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(8px, -50%)`;
              } else {
                cylinderBadgeRef.current.style.opacity = '0';
              }
            } else {
              cylinderBadgeRef.current.style.opacity = '0';
            }
          }

          if (markerZeroRef.current) {
            _projVec.set(0.065, DROP_ORIGIN_Y, 0.035).project(camera);
            if (_projVec.z <= 1) {
              const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
              const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
              markerZeroRef.current.style.opacity = '1';
              markerZeroRef.current.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(8px, -50%)`;
            } else {
              markerZeroRef.current.style.opacity = '0';
            }
          }

          if (markerSARef.current) {
            if (!showGateA) {
              markerSARef.current.style.opacity = '0';
            } else {
              _projVec.set(0.065, objs.photogateAAssembly.position.y, 0.035).project(camera);
              if (_projVec.z <= 1) {
                const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
                const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
                markerSARef.current.style.opacity = '1';
                markerSARef.current.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(8px, -50%)`;
              } else {
                markerSARef.current.style.opacity = '0';
              }
            }
          }

          if (markerSRef.current) {
            if (!showGateB) {
              markerSRef.current.style.opacity = '0';
            } else {
              _projVec.set(0.065, objs.photogateAssembly.position.y, 0.035).project(camera);
              if (_projVec.z <= 1) {
                const xPx = (_projVec.x * 0.5 + 0.5) * currentCssW;
                const yPx = (-(_projVec.y * 0.5) + 0.5) * currentCssH;
                markerSRef.current.style.opacity = '1';
                markerSRef.current.style.transform = `translate3d(${Math.round(xPx)}px, ${Math.round(yPx)}px, 0) translate(8px, -50%)`;
              } else {
                markerSRef.current.style.opacity = '0';
              }
            }
          }
        }
      }

      renderer.render(scene, camera);

      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    frameId = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      resizeObserver.disconnect();
      window.removeEventListener('orientationchange', handleResize);
      controls.removeEventListener('start', onUserControlStart);
      controls.removeEventListener('end', onUserControlEnd);
      canvasEl.removeEventListener('pointerdown', onPointerDown);
      canvasEl.removeEventListener('pointermove', onPointerMove);
      canvasEl.removeEventListener('pointerup', onPointerUp);
      canvasEl.removeEventListener('pointercancel', onPointerUp);
      controls.dispose();
      renderer.dispose();
    };
  }, []);

  if (webglError) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center bg-slate-950 p-6 text-center">
        <p className="text-base font-semibold text-amber-400 mb-2">{webglError}</p>
        <p className="text-sm text-slate-300 max-w-md">
          Quãng đường hiện tại: s = {snapshot.photogateDistanceMeters.toFixed(3)} m · Đồng hồ:{' '}
          {formatTimerDisplay(snapshot.timerDisplaySeconds, physicsConfig.timerScale)} s
        </p>
      </div>
    );
  }

  return (
    <div className="relative w-full h-full overflow-hidden select-none">
      {/* Container chứa WebGL Canvas */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Nút Tròn Con Mắt ở góc trên phải màn hình mô phỏng để Ẩn / Hiện các chữ chú thích */}
      <button
        type="button"
        onClick={onToggleLabels}
        title={
          showEquipmentLabels
            ? 'Ẩn chú thích thiết bị: Tắt các nhãn tên chi tiết và vạch tọa độ trên màn hình 3D để quan sát mô hình thoáng hơn'
            : 'Hiện chú thích thiết bị: Bật đầy đủ nhãn tên các bộ phận và tọa độ cổng quang sA, s trên màn hình 3D'
        }
        aria-label={
          showEquipmentLabels ? 'Ẩn chú thích trên màn hình' : 'Hiện chú thích trên màn hình'
        }
        className={`pointer-events-auto absolute top-3 right-3 z-30 w-10 h-10 rounded-full flex items-center justify-center border shadow-xl transition-colors ${
          showEquipmentLabels
            ? 'bg-sky-600 text-white border-sky-300'
            : 'bg-slate-900/90 hover:bg-slate-800 text-slate-300 border-slate-700'
        }`}
      >
        {showEquipmentLabels ? <Eye className="w-5 h-5" /> : <EyeOff className="w-5 h-5" />}
      </button>

      {/* CHỈ HIỂN THỊ CHỮ "A" Ở CỔNG A VÀ CHỮ "B" Ở CỔNG B TRÊN GIÁ ĐỠ MẶC ĐỊNH */}
      <div
        ref={standBadgeARef}
        className={`pointer-events-none absolute top-0 left-0 z-20 w-7 h-7 rounded-full flex items-center justify-center font-mono-tabular text-xs font-extrabold border-2 shadow-lg transition-colors ${
          snapshot.portAState === 'ACTIVE'
            ? 'bg-amber-500 text-slate-950 border-white scale-110'
            : snapshot.portAState === 'RECEIVED'
            ? 'bg-emerald-600 text-white border-emerald-200'
            : snapshot.portAState === 'CONNECTED'
            ? 'bg-red-600 text-white border-red-200'
            : 'bg-slate-800/90 text-slate-400 border-slate-600'
        }`}
      >
        A
      </div>

      <div
        ref={standBadgeBRef}
        className={`pointer-events-none absolute top-0 left-0 z-20 w-7 h-7 rounded-full flex items-center justify-center font-mono-tabular text-xs font-extrabold border-2 shadow-lg transition-colors ${
          snapshot.portBState === 'ACTIVE'
            ? 'bg-amber-500 text-slate-950 border-white scale-110'
            : snapshot.portBState === 'RECEIVED'
            ? 'bg-emerald-600 text-white border-emerald-200'
            : snapshot.portBState === 'CONNECTED'
            ? 'bg-sky-600 text-white border-sky-200'
            : 'bg-slate-800/90 text-slate-400 border-slate-600'
        }`}
      >
        B
      </div>

      {/* TOÀN BỘ CÁC CHỮ CHÚ THÍCH TRÊN MÀN HÌNH TỰ ẨN MẶC ĐỊNH, CHỈ HIỆN KHI BẤM NÚT TRÒN CON MẮT */}
      {showEquipmentLabels && (
        <>

          <div
            ref={cylinderBadgeRef}
            style={{ opacity: 0 }}
            className="pointer-events-none absolute top-0 left-0 z-20 px-2.5 py-1 rounded-md bg-emerald-600 text-white border border-emerald-300 text-xs font-mono-tabular font-bold shadow-lg whitespace-nowrap"
          >
            Trụ thép: s = {(snapshot.cylinderDropDistanceMeters * 100).toFixed(1)} cm · v ={' '}
            {snapshot.cylinderVelocityMetersPerSec.toFixed(2)} m/s
          </div>

          <div
            ref={markerZeroRef}
            className="pointer-events-none absolute top-0 left-0 z-10 px-2 py-0.5 rounded bg-slate-900/90 border border-sky-500/60 text-[11px] font-mono-tabular text-sky-300 whitespace-nowrap transition-opacity duration-75"
          >
            Mốc 0 (Đáy trụ: 0,0 cm)
          </div>

          <div
            ref={markerSARef}
            className={`pointer-events-none absolute top-0 left-0 z-10 px-2.5 py-1 rounded border text-xs font-mono-tabular font-bold whitespace-nowrap transition-opacity duration-75 ${
              activeDragTarget === 'PHOTOGATE_A'
                ? 'bg-red-500 text-white border-red-200 shadow-xl scale-105'
                : 'bg-slate-900/95 text-red-300 border-red-500/80 shadow-md'
            }`}
          >
            Cổng quang A: sA = {snapshot.gateADistanceMeters.toFixed(3)} m (
            {(snapshot.gateADistanceMeters * 100).toFixed(1)} cm)
          </div>

          <div
            ref={markerSRef}
            className={`pointer-events-none absolute top-0 left-0 z-10 px-2.5 py-1 rounded border text-xs font-mono-tabular font-bold whitespace-nowrap transition-opacity duration-75 ${
              activeDragTarget === 'PHOTOGATE'
                ? 'bg-amber-500 text-slate-950 border-amber-200 shadow-xl scale-105'
                : 'bg-slate-900/95 text-amber-300 border-amber-500/80 shadow-md'
            }`}
          >
            Cổng quang B: s = {snapshot.photogateDistanceMeters.toFixed(3)} m (
            {(snapshot.photogateDistanceMeters * 100).toFixed(1)} cm)
          </div>

          <div className="pointer-events-none absolute inset-0 overflow-hidden z-10">
            {(Object.keys(EQUIPMENT_CATALOG) as EquipmentId[]).map((eqId) => {
              const item = EQUIPMENT_CATALOG[eqId];
              const isSelected = selectedEquipment === eqId;
              return (
                <button
                  key={eqId}
                  ref={(el) => {
                    labelRefs.current[eqId] = el;
                  }}
                  type="button"
                  onClick={() => onSelectEquipment(isSelected ? null : eqId)}
                  className={`pointer-events-auto absolute top-0 left-0 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-colors shadow-md border ${
                    isSelected
                      ? 'bg-sky-600 text-white border-sky-300'
                      : 'bg-slate-900/90 text-slate-100 border-slate-700 hover:border-sky-400 hover:text-sky-200'
                  }`}
                >
                  {item.shortLabel}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
};
