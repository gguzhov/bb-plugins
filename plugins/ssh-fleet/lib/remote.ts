export const REMOTE_SCRIPT = [
  "read_cpu() { awk '/^cpu /{print $2,$3,$4,$5,$6,$7,$8; exit}' /proc/stat 2>/dev/null || true; }",
  "read_net() { awk 'NR>2 && $1 !~ /^lo:/ { rx += $2; tx += $10 } END { printf \"%d %d\", rx + 0, tx + 0 }' /proc/net/dev 2>/dev/null || true; }",
  "n1=$(read_net)",
  "a=$(read_cpu)",
  "sleep 1",
  "b=$(read_cpu)",
  "n2=$(read_net)",
  "awk -v a=\"$a\" -v b=\"$b\" 'BEGIN {",
  "  n = split(a, x, \" \"); m = split(b, y, \" \");",
  "  if (n >= 7 && m >= 7) {",
  "    t1 = 0; t2 = 0;",
  "    for (i = 1; i <= 7; i++) { t1 += x[i]; t2 += y[i] }",
  "    dt = t2 - t1; di = (y[4] + y[5]) - (x[4] + x[5]);",
  "    if (dt > 0) printf \"cpu_percent=%.1f\\n\", (dt - di) * 100 / dt;",
  "  }",
  "}'",
  "awk -v n1=\"$n1\" -v n2=\"$n2\" 'BEGIN {",
  "  split(n1, a, \" \"); split(n2, b, \" \");",
  "  if (n1 != \"\" && n2 != \"\") {",
  "    rx = b[1] - a[1]; tx = b[2] - a[2];",
  "    if (rx < 0) rx = 0; if (tx < 0) tx = 0;",
  "    printf \"net_rx_bps=%d\\nnet_tx_bps=%d\\n\", rx, tx;",
  "  }",
  "}'",
  "if [ -r /proc/uptime ]; then awk '{ printf \"uptime_seconds=%d\\n\", $1 }' /proc/uptime; fi",
  "if [ -r /proc/loadavg ]; then awk '{ split($4, p, \"/\"); printf \"load1=%s\\nload5=%s\\nload15=%s\\nprocs_running=%d\\nprocs_total=%d\\n\", $1, $2, $3, p[1], p[2] }' /proc/loadavg; fi",
  "if [ -r /proc/cpuinfo ]; then awk '/^processor/ { n++ } END { if (n > 0) printf \"cpu_count=%d\\n\", n }' /proc/cpuinfo; fi",
  "if [ -r /proc/meminfo ]; then awk '/^MemTotal:/ { t = $2 } /^MemAvailable:/ { a = $2 } /^SwapTotal:/ { st = $2 } /^SwapFree:/ { sf = $2 } END { if (t != \"\") printf \"mem_total_bytes=%d\\n\", t * 1024; if (a != \"\") printf \"mem_available_bytes=%d\\n\", a * 1024; if (st != \"\") printf \"swap_total_bytes=%d\\n\", st * 1024; if (sf != \"\") printf \"swap_free_bytes=%d\\n\", sf * 1024 }' /proc/meminfo; fi",
  "df -B1 -P / 2>/dev/null | awk 'NR == 2 { printf \"disk_total_bytes=%s\\ndisk_used_bytes=%s\\n\", $2, $3 }'",
].join("\n");

export type Metrics = {
  uptimeSeconds: number | null;
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuPercent: number | null;
  cpuCount: number | null;
  memTotalBytes: number | null;
  memAvailableBytes: number | null;
  swapTotalBytes: number | null;
  swapFreeBytes: number | null;
  diskTotalBytes: number | null;
  diskUsedBytes: number | null;
  procsRunning: number | null;
  procsTotal: number | null;
  netRxBps: number | null;
  netTxBps: number | null;
};

const KEYS = [
  "uptime_seconds",
  "load1",
  "load5",
  "load15",
  "cpu_percent",
  "cpu_count",
  "mem_total_bytes",
  "mem_available_bytes",
  "swap_total_bytes",
  "swap_free_bytes",
  "disk_total_bytes",
  "disk_used_bytes",
  "procs_running",
  "procs_total",
  "net_rx_bps",
  "net_tx_bps",
] as const;

export function emptyMetrics(): Metrics {
  return {
    uptimeSeconds: null,
    load1: null,
    load5: null,
    load15: null,
    cpuPercent: null,
    cpuCount: null,
    memTotalBytes: null,
    memAvailableBytes: null,
    swapTotalBytes: null,
    swapFreeBytes: null,
    diskTotalBytes: null,
    diskUsedBytes: null,
    procsRunning: null,
    procsTotal: null,
    netRxBps: null,
    netTxBps: null,
  };
}

export function parseRemoteOutput(stdout: string): { metrics: Metrics; count: number } {
  const metrics = emptyMetrics();
  let count = 0;
  for (const line of stdout.split("\n")) {
    const match = /^([a-z][a-z0-9_]*)=([0-9]+(?:\.[0-9]+)?)$/.exec(line.trim());
    if (match === null) continue;
    const key = match[1];
    const value = Number(match[2]);
    if (!Number.isFinite(value) || !KEYS.includes(key as (typeof KEYS)[number])) continue;
    count += 1;
    assignMetric(metrics, key, value);
  }
  return { metrics, count };
}

function assignMetric(metrics: Metrics, key: string, value: number): void {
  const whole = Math.trunc(value);
  if (key === "uptime_seconds") metrics.uptimeSeconds = whole;
  if (key === "load1") metrics.load1 = value;
  if (key === "load5") metrics.load5 = value;
  if (key === "load15") metrics.load15 = value;
  if (key === "cpu_percent") metrics.cpuPercent = value;
  if (key === "cpu_count") metrics.cpuCount = whole;
  if (key === "mem_total_bytes") metrics.memTotalBytes = whole;
  if (key === "mem_available_bytes") metrics.memAvailableBytes = whole;
  if (key === "swap_total_bytes") metrics.swapTotalBytes = whole;
  if (key === "swap_free_bytes") metrics.swapFreeBytes = whole;
  if (key === "disk_total_bytes") metrics.diskTotalBytes = whole;
  if (key === "disk_used_bytes") metrics.diskUsedBytes = whole;
  if (key === "procs_running") metrics.procsRunning = whole;
  if (key === "procs_total") metrics.procsTotal = whole;
  if (key === "net_rx_bps") metrics.netRxBps = whole;
  if (key === "net_tx_bps") metrics.netTxBps = whole;
}
