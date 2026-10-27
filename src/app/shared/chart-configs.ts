import { ChartConfiguration } from 'chart.js';
import { ChartColors } from './chart';

// Chart builders following the dataviz rules: thin marks, 4px rounded data ends,
// 2px lines, one y-axis, recessive grid, a legend only for 2+ series, and text in
// text colours (never the series colour).

const pkr = new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 });
const money = (v: number) => `Rs ${pkr.format(v)}`;
const compact = (v: number) => (Math.abs(v) >= 1000 ? `${pkr.format(v / 1000)}k` : pkr.format(v));

function axes(c: ChartColors, isMoney: boolean, horizontal = false) {
  const value = {
    beginAtZero: true,
    grid: { color: c.grid },
    border: { display: false },
    ticks: {
      color: c.text,
      callback: (v: string | number) => (isMoney ? compact(Number(v)) : v),
      precision: 0,
    },
  };
  const category = {
    grid: { display: false },
    border: { color: c.grid },
    ticks: { color: c.text, autoSkip: true, maxRotation: 0 },
  };
  return horizontal ? { x: value, y: category } : { x: category, y: value };
}

export function barChart(
  c: ChartColors,
  labels: string[],
  values: number[],
  opts: { label: string; money?: boolean; horizontal?: boolean; colorIndex?: number },
): ChartConfiguration {
  const color = c.series[opts.colorIndex ?? 0];
  return {
    type: 'bar',
    data: {
      labels,
      datasets: [
        {
          label: opts.label,
          data: values,
          backgroundColor: color,
          hoverBackgroundColor: color,
          borderRadius: 4,
          borderSkipped: 'start',
          maxBarThickness: 28,
          categoryPercentage: 0.8,
        },
      ],
    },
    options: {
      indexAxis: opts.horizontal ? 'y' : 'x',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (ctx) => `${opts.label}: ${opts.money ? money(Number(ctx.raw)) : ctx.raw}`,
          },
        },
      },
      scales: axes(c, !!opts.money, opts.horizontal),
    },
  };
}

export function lineChart(
  c: ChartColors,
  labels: string[],
  series: { label: string; values: number[] }[],
  opts: { money?: boolean } = {},
): ChartConfiguration {
  return {
    type: 'line',
    data: {
      labels,
      datasets: series.map((s, i) => ({
        label: s.label,
        data: s.values,
        borderColor: c.series[i],
        backgroundColor: c.series[i],
        borderWidth: 2,
        pointRadius: labels.length > 40 ? 0 : 3,
        pointHoverRadius: 5,
        tension: 0.25,
      })),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: {
          display: series.length > 1,
          position: 'top',
          align: 'start',
          labels: { color: c.text, boxWidth: 12, boxHeight: 2 },
        },
        tooltip: {
          callbacks: {
            label: (ctx) =>
              `${ctx.dataset.label}: ${opts.money ? money(Number(ctx.raw)) : ctx.raw}`,
          },
        },
      },
      scales: axes(c, !!opts.money),
    },
  };
}
