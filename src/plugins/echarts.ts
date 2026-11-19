/**
 * ECharts 按需注册（vue-echarts 用）
 */
import { use } from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';

let registered = false;

export function setupEcharts() {
  if (registered) return;
  use([CanvasRenderer, LineChart, GridComponent, TooltipComponent]);
  registered = true;
}
