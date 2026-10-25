import React, { useState } from 'react';
import { LinearRegressionResult } from '../models/PhysicsModel';

export interface GraphPointItem {
  label: string;
  sMeters: number;
  meanTime: number;
  tSquared: number;
  gValue: number;
}

interface RegressionGraphSvsT2Props {
  points: GraphPointItem[];
  regression: LinearRegressionResult | null;
  showTrendline: boolean;
  onToggleTrendline: () => void;
  forceOrigin: boolean;
  onToggleForceOrigin: () => void;
  trueGravity: number;
}

export const RegressionGraphSvsT2: React.FC<RegressionGraphSvsT2Props> = ({
  points,
  regression,
  showTrendline,
  onToggleTrendline,
  forceOrigin,
  onToggleForceOrigin,
}) => {
  const [selectedPointIdx, setSelectedPointIdx] = useState<number | null>(null);

  // Kích thước tọa độ SVG chuẩn
  const svgW = 560;
  const svgH = 310;
  const padL = 62;
  const padR = 26;
  const padT = 24;
  const padB = 48;
  const plotW = svgW - padL - padR;
  const plotH = svgH - padT - padB;

  // Miền giá trị trục hoành t² (s²) và trục tung s (m)
  const maxT2Data = points.reduce((m, p) => Math.max(m, p.tSquared), 0.14);
  const maxX = Math.max(0.16, Math.ceil(maxT2Data * 20) / 20 + 0.02);
  const maxSData = points.reduce((m, p) => Math.max(m, p.sMeters), 0.7);
  const maxY = Math.max(0.85, Math.ceil(maxSData * 10) / 10 + 0.05);

  const toScreenX = (t2: number) => padL + (Math.max(0, Math.min(maxX, t2)) / maxX) * plotW;
  const toScreenY = (s: number) => padT + plotH - (Math.max(0, Math.min(maxY, s)) / maxY) * plotH;

  // Chia vạch lưới
  const xTicks = [0, 0.04, 0.08, 0.12, 0.16, 0.2].filter((v) => v <= maxX + 0.001);
  if (xTicks[xTicks.length - 1] < maxX * 0.85) {
    xTicks.push(Number(maxX.toFixed(2)));
  }
  const yTicks = [0, 0.2, 0.4, 0.6, 0.8];

  // Tọa độ đường hồi quy tuyến tính s = k * t² + b
  let lineCoords: { x1: number; y1: number; x2: number; y2: number } | null = null;
  if (regression && showTrendline) {
    const xStart = 0;
    const yStart = regression.slopeK * xStart + regression.interceptB;
    const xEnd = maxX * 0.96;
    const yEnd = regression.slopeK * xEnd + regression.interceptB;
    lineCoords = {
      x1: toScreenX(xStart),
      y1: toScreenY(yStart),
      x2: toScreenX(xEnd),
      y2: toScreenY(yEnd),
    };
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Thanh công cụ đồ thị */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToggleTrendline}
            className={`min-h-[38px] px-3 py-1.5 rounded-md font-medium border transition-colors whitespace-nowrap ${
              showTrendline
                ? 'bg-sky-600 text-white border-sky-400'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {showTrendline ? 'Đang hiện đường hồi quy' : 'Hiện đường hồi quy'}
          </button>

          <button
            type="button"
            onClick={onToggleForceOrigin}
            className={`min-h-[38px] px-3 py-1.5 rounded-md font-medium border transition-colors whitespace-nowrap ${
              forceOrigin
                ? 'bg-amber-600 text-white border-amber-400'
                : 'bg-slate-800 text-slate-300 border-slate-700 hover:bg-slate-700'
            }`}
          >
            {forceOrigin ? 'Chế độ: Đi qua gốc (s = k·t²)' : 'Chế độ: Hồi quy tổng quát (s = k·t² + b)'}
          </button>
        </div>

        {/* Thông số hệ số góc k và g = 2k */}
        {regression ? (
          <div className="flex flex-wrap items-center gap-3 px-3 py-1.5 rounded-md bg-slate-900 border border-slate-700 font-mono-tabular text-xs">
            <span className="text-slate-300">
              Hệ số góc <strong className="text-sky-400">k = {regression.slopeK.toFixed(4)}</strong> m/s²
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-200">
              Suy ra <strong className="text-emerald-400">g = 2k = {regression.estimatedG.toFixed(3)} m/s²</strong>
            </span>
            <span aria-hidden="true" className="text-slate-600">·</span>
            <span className="text-slate-400">R² = {regression.rSquared.toFixed(4)}</span>
          </div>
        ) : (
          <span className="text-xs text-amber-300">
            Cần ghi ít nhất {forceOrigin ? '1' : '2'} mức quãng đường khác nhau để dựng đường hồi quy tuyến tính.
          </span>
        )}
      </div>

      {/* Khung vẽ SVG sắc nét ở mọi mức zoom HiDPI */}
      <div className="relative w-full bg-slate-950 rounded-lg border border-slate-800 p-2 overflow-hidden">
        <svg
          viewBox={`0 0 ${svgW} ${svgH}`}
          className="w-full h-auto max-h-[290px] select-none"
          role="img"
          aria-label="Đồ thị quãng đường s theo bình phương thời gian t bình phương"
        >
          {/* Lưới ngang (s) */}
          {yTicks.map((yVal) => {
            const py = toScreenY(yVal);
            return (
              <g key={`y-${yVal}`}>
                <line
                  x1={padL}
                  y1={py}
                  x2={svgW - padR}
                  y2={py}
                  stroke={yVal === 0 ? '#64748b' : '#1e293b'}
                  strokeWidth={yVal === 0 ? 1.5 : 1}
                />
                <text
                  x={padL - 10}
                  y={py + 4}
                  textAnchor="end"
                  fill="#94a3b8"
                  fontSize="12"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {yVal.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* Lưới dọc (t²) */}
          {xTicks.map((xVal) => {
            const px = toScreenX(xVal);
            return (
              <g key={`x-${xVal}`}>
                <line
                  x1={px}
                  y1={padT}
                  x2={px}
                  y2={svgH - padB}
                  stroke={xVal === 0 ? '#64748b' : '#1e293b'}
                  strokeWidth={xVal === 0 ? 1.5 : 1}
                />
                <text
                  x={px}
                  y={svgH - padB + 18}
                  textAnchor="middle"
                  fill="#94a3b8"
                  fontSize="12"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {xVal.toFixed(3)}
                </text>
              </g>
            );
          })}

          {/* Nhãn trục tung s (m) và trục hoành t² (s²) */}
          <text
            x={16}
            y={padT + plotH / 2}
            transform={`rotate(-90, 16, ${padT + plotH / 2})`}
            textAnchor="middle"
            fill="#e2e8f0"
            fontSize="13"
            fontWeight="600"
          >
            Quãng đường rơi s (m)
          </text>

          <text
            x={padL + plotW / 2}
            y={svgH - 8}
            textAnchor="middle"
            fill="#e2e8f0"
            fontSize="13"
            fontWeight="600"
          >
            Bình phương thời gian t² (s²)
          </text>

          {/* Đường xu hướng hồi quy */}
          {lineCoords && (
            <line
              x1={lineCoords.x1}
              y1={lineCoords.y1}
              x2={lineCoords.x2}
              y2={lineCoords.y2}
              stroke="#38bdf8"
              strokeWidth="2.5"
              strokeDasharray="6 4"
            />
          )}

          {/* Các điểm dữ liệu thực nghiệm đã ghi */}
          {points.map((pt, idx) => {
            const cx = toScreenX(pt.tSquared);
            const cy = toScreenY(pt.sMeters);
            const isSelected = selectedPointIdx === idx;
            return (
              <g
                key={pt.label}
                className="cursor-pointer"
                onClick={() => setSelectedPointIdx(isSelected ? null : idx)}
              >
                <circle
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 8 : 6}
                  fill={isSelected ? '#f59e0b' : '#10b981'}
                  stroke="#0f172a"
                  strokeWidth="2"
                />
                <text
                  x={cx + 9}
                  y={cy - 8}
                  fill="#f8fafc"
                  fontSize="12"
                  fontWeight="600"
                  fontFamily="JetBrains Mono, monospace"
                >
                  {pt.label}
                </text>
              </g>
            );
          })}
        </svg>

        {points.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center bg-slate-950/80 p-4 text-center">
            <p className="text-sm text-slate-300 max-w-md">
              Chưa có điểm dữ liệu nào. Hãy thực hiện phép đo ở các quãng đường s khác nhau và nhấn{' '}
              <strong className="text-emerald-400">Ghi kết quả</strong> để vẽ đồ thị s theo t².
            </p>
          </div>
        )}
      </div>

      {/* Chi tiết điểm đang chọn hoặc giải thích ý nghĩa vật lí */}
      {selectedPointIdx !== null && points[selectedPointIdx] ? (
        <div className="px-3 py-2 rounded-md bg-slate-900 border border-slate-700 text-xs font-mono-tabular flex flex-wrap items-center justify-between gap-2">
          <span>
            Điểm <strong className="text-amber-400">{points[selectedPointIdx].label}</strong>: s ={' '}
            {points[selectedPointIdx].sMeters.toFixed(3)} m
          </span>
          <span>t_tb = {points[selectedPointIdx].meanTime.toFixed(4)} s</span>
          <span>t_tb² = {points[selectedPointIdx].tSquared.toFixed(5)} s²</span>
          <span className="text-emerald-400 font-semibold">
            g = {points[selectedPointIdx].gValue.toFixed(3)} m/s²
          </span>
        </div>
      ) : (
        <p className="text-xs text-slate-400">
          Phương trình lí thuyết: <span className="font-mono-tabular text-slate-200">s = ½·g·t²</span>. Khi đặt{' '}
          <span className="font-mono-tabular text-slate-200">x = t²</span> (trục hoành) và{' '}
          <span className="font-mono-tabular text-slate-200">y = s</span> (trục tung), đồ thị là đường thẳng có hệ số góc{' '}
          <span className="font-mono-tabular text-sky-300">k = g/2</span>, do đó{' '}
          <span className="font-mono-tabular text-emerald-300">g = 2k</span>.
        </p>
      )}
    </div>
  );
};
