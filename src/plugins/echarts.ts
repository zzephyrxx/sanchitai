import { BarChart, GaugeChart, LineChart, PieChart, RadarChart } from 'echarts/charts';
import { GridComponent, LegendComponent, PolarComponent, RadarComponent, TooltipComponent } from 'echarts/components';
/**
 * ECharts 按需注册（vue-echarts 用）
 * 统一承载总览折线、五维健康雷达、60+40 积分仪表、志愿时长圆环与党小组活力同心环
 */
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';

let registered = false;

export function setupEcharts() {
  if (registered) return;
  use([
    CanvasRenderer,
    LineChart,
    RadarChart,
    GaugeChart,
    PieChart,
    BarChart,
    GridComponent,
    TooltipComponent,
    LegendComponent,
    RadarComponent,
    PolarComponent
  ]);
  registered = true;
}
