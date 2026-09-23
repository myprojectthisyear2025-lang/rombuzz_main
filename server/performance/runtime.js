/** Path: server/performance/runtime.js
 * Purpose: Process-wide event-loop context to distinguish database waits from concurrent JS blocking. */
const { performance, monitorEventLoopDelay } = require('node:perf_hooks');
const { enabled } = require('./context');
let window = null;
if (enabled) {
  const histogram = monitorEventLoopDelay({ resolution: 20 });
  histogram.enable();
  const timer = setInterval(() => {
    window = { p99Ms: histogram.percentile(99) / 1e6, measuredAt: performance.now() };
    histogram.reset();
  }, 1000);
  timer.unref();
}
function runtimeStart() {
  return { elu: performance.eventLoopUtilization(), cpu: process.cpuUsage() };
}
function runtimeEnd(start) {
  const cpu = process.cpuUsage(start.cpu);
  return { processEventLoopUtilization: performance.eventLoopUtilization(start.elu).utilization,
    processCpuUserMs: cpu.user / 1000, processCpuSystemMs: cpu.system / 1000,
    lastWindowEventLoopP99Ms: window?.p99Ms ?? null,
    lastWindowAgeMs: window ? performance.now() - window.measuredAt : null };
}
module.exports = { runtimeStart, runtimeEnd };
