import {
  afterRenderEffect,
  Component,
  DestroyRef,
  ElementRef,
  inject,
  input,
  viewChild,
} from '@angular/core';
import {
  ArcElement,
  BarController,
  BarElement,
  DoughnutController,
  CategoryScale,
  Chart,
  ChartConfiguration,
  Filler,
  Legend,
  LinearScale,
  LineController,
  LineElement,
  PointElement,
  Tooltip,
} from 'chart.js';
import { ThemeService } from '../core/theme.service';

// Register only what we use so Chart.js tree-shakes.
Chart.register(
  ArcElement,
  DoughnutController,
  LineController,
  BarController,
  LineElement,
  BarElement,
  PointElement,
  CategoryScale,
  LinearScale,
  Tooltip,
  Legend,
  Filler,
);

export interface ChartColors {
  series: string[];
  text: string;
  grid: string;
}

/** Reads the chart tokens defined in styles.scss for the active theme. */
export function readChartColors(): ChartColors {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return {
    series: [
      v('--chart-series-1'),
      v('--chart-series-2'),
      v('--chart-series-3'),
      v('--chart-series-4'),
    ],
    text: v('--chart-text'),
    grid: v('--chart-grid'),
  };
}

/**
 * Thin Chart.js wrapper. `build` receives the current theme colors and is re-run
 * (and the chart recreated) whenever the theme or the build function changes.
 */
@Component({
  selector: 'app-chart',
  template: `
    <div class="box" [style.height.px]="height()">
      <canvas #canvas role="img" [attr.aria-label]="label()"></canvas>
    </div>
  `,
  styles: `
    .box {
      position: relative;
      width: 100%;
    }
  `,
})
export class ChartComponent {
  readonly build = input.required<(colors: ChartColors) => ChartConfiguration>();
  readonly label = input.required<string>();
  readonly height = input(280);

  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly theme = inject(ThemeService);
  private chart?: Chart;

  constructor() {
    afterRenderEffect(() => {
      this.theme.theme(); // re-run on theme change
      const config = this.build()(readChartColors());
      this.chart?.destroy();
      this.chart = new Chart(this.canvas().nativeElement, config);
    });
    inject(DestroyRef).onDestroy(() => this.chart?.destroy());
  }
}
