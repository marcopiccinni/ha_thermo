import {
  historyChartMargins,
  pickTimeTickStepMs,
  xAxisTickMarks,
  pickYAxisStep,
  yAxisTickValues,
} from "../custom_components/ha_thermo/www/ha-thermo-common.js";

const widths = [250, 400, 600, 900];
const heights = [150, 180, 220, 260];
const H24 = 24 * 3600000;
const H48 = 48 * 3600000;
const start = Date.parse("2026-11-11T00:00:00");
const report = { x24: [], x48: [], y: [] };

widths.forEach((w, i) => {
  const chartH = heights[i];
  const { plotW, plotH } = historyChartMargins(w, chartH);
  const end24 = start + H24;
  const end48 = start + H48;
  const n24 = xAxisTickMarks(start, end24, plotW).length;
  const n48 = xAxisTickMarks(start, end48, plotW).length;
  const step = pickTimeTickStepMs(H24, plotW);
  report.x24.push({ w, plotW, stepMin: step / 60000, ticks: n24 });
  report.x48.push({ w, plotW, ticks: n48 });
  const yTicks = yAxisTickValues(17, 21, plotH).length;
  report.y.push({ w, plotH, yStep: pickYAxisStep(17, 21, plotH), ticks: yTicks });
});

const mono = (arr, key) => {
  for (let i = 1; i < arr.length; i += 1) {
    if (arr[i][key] < arr[i - 1][key]) {
      console.error("tick count should grow with width", arr);
      process.exit(1);
    }
  }
};

mono(report.x24, "ticks");
mono(report.x48, "ticks");
mono(report.y, "ticks");

console.log(JSON.stringify(report, null, 2));
