import React from "react";
import { t } from "../i18n.js";

function finiteNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function normalizedSegments(segments = []) {
  const clean = (Array.isArray(segments) ? segments : [])
    .filter((segment) => segment && typeof segment === "object" && typeof segment.color === "string" && segment.color.trim())
    .map((segment) => ({ ...segment, value: finiteNumber(segment.value) }))
    .filter((segment) => segment.value !== null && segment.value > 0);
  const total = clean.reduce((sum, segment) => sum + segment.value, 0);
  return clean.map((segment) => ({ ...segment, pct: total ? segment.value / total * 100 : 0 }));
}

function conicGradient(segments = []) {
  let cursor = 0;
  const stops = normalizedSegments(segments).map((segment) => {
    const start = cursor;
    cursor += segment.pct;
    return `${segment.color} ${start}% ${cursor}%`;
  });
  return stops.length ? `conic-gradient(${stops.join(",")})` : "conic-gradient(#ece8e2 0 100%)";
}

function lineGeometry(values = [], width = 100, height = 36) {
  const clean = (Array.isArray(values) ? values : []).map(finiteNumber).filter((value) => value !== null);
  if (clean.length < 2) return null;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  const points = clean.map((value, index) => [index / (clean.length - 1) * width, height - ((value - min) / range * (height - 4) + 2)]);
  const line = `M ${points.map(([x, y]) => `${x} ${y}`).join(" L ")}`;
  return { line, area: `${line} L ${width} ${height} L 0 ${height} Z` };
}

export function DonutChart({ segments, value, label, ariaLabel }) {
  const clean = normalizedSegments(segments);
  if (!clean.length) return <span className="cockpitChartUnavailable">{t("数据不足", "Insufficient data")}</span>;
  const gradient = conicGradient(clean);
  return <div className="cockpitDonut" role="img" aria-label={ariaLabel} style={{ background: gradient }}>
    <span><b>{value}</b><small>{label}</small></span>
  </div>;
}

export function GaugeChart({ value, min = 0, max = 100, label, detail, tone = "positive", ariaLabel }) {
  const numericValue = finiteNumber(value);
  const numericMin = finiteNumber(min);
  const numericMax = finiteNumber(max);
  if ([numericValue, numericMin, numericMax].includes(null) || numericMax <= numericMin) {
    return <span className="cockpitChartUnavailable">{t("数据不足", "Insufficient data")}</span>;
  }
  const pct = Math.max(0, Math.min(100, (numericValue - numericMin) / (numericMax - numericMin) * 100));
  return <div
    className={`cockpitGauge ${tone}`}
    role="img"
    aria-label={ariaLabel || `${label}: ${value}`}
    style={{ "--cockpit-gauge-value": `${pct}%` }}
  >
    <span><b>{value}</b><small>{label}</small>{detail && <em>{detail}</em>}</span>
  </div>;
}

export function AreaTrend({ values, tone = "positive", label, height }) {
  const geometry = lineGeometry(values, 100, 36);
  return geometry ? <svg
    className={`cockpitAreaTrend ${tone}`}
    role="img"
    aria-label={label}
    viewBox="0 0 100 36"
    preserveAspectRatio="none"
    style={height ? { height } : undefined}
  >
    <path className="area" d={geometry.area}/><path className="line" d={geometry.line}/>
  </svg> : <span className="cockpitChartUnavailable">{t("数据不足", "Insufficient data")}</span>;
}

export function DistributionPlot({ values = [], label, tone = "brand", formatValue = (value) => value }) {
  const clean = (Array.isArray(values) ? values : []).map(finiteNumber).filter((value) => value !== null);
  if (!clean.length) return <span className="cockpitChartUnavailable">{t("数据不足", "Insufficient data")}</span>;
  const min = Math.min(...clean);
  const max = Math.max(...clean);
  const range = max - min || 1;
  return <svg className={`cockpitDistribution ${tone}`} role="img" aria-label={label} viewBox="0 0 100 28" preserveAspectRatio="none">
    <line x1="2" x2="98" y1="14" y2="14"/>
    {clean.map((value, index) => <circle key={`${value}-${index}`} cx={2 + ((value - min) / range) * 96} cy="14" r="2">
      <title>{String(formatValue(value))}</title>
    </circle>)}
  </svg>;
}

export function BreadthBars({ items = [], ariaLabel, formatValue = (value) => `${value}%` }) {
  const clean = (Array.isArray(items) ? items : [])
    .filter((item) => item && typeof item === "object")
    .map((item) => ({ ...item, value: finiteNumber(item.value) }))
    .filter((item) => item.value !== null);
  if (!clean.length) return <span className="cockpitChartUnavailable">{t("数据不足", "Insufficient data")}</span>;
  return <div className="cockpitBreadthBars" role="img" aria-label={ariaLabel}>
    {clean.map((item, index) => {
      const value = item.value;
      const width = Math.max(0, Math.min(100, value));
      return <div className={item.tone || "neutral"} key={item.id || item.label || index}>
        <span><b>{item.label}</b><em>{formatValue(value, item)}</em></span>
        <i aria-hidden="true"><b style={{ width: `${width}%`, background: item.color }}/></i>
      </div>;
    })}
  </div>;
}
