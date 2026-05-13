// DOM elements
const gpuNameEl = container.querySelector('#gpu-name');
const gpuCanvas = container.querySelector('#gpu-graph');
const memCanvas = container.querySelector('#mem-graph');
const tempCanvas = container.querySelector('#temp-graph');
const powerCanvas = container.querySelector('#power-graph');
const gpuValueEl = container.querySelector('#gpu-value');
const memValueEl = container.querySelector('#mem-value');
const tempValueEl = container.querySelector('#temp-value');
const powerValueEl = container.querySelector('#power-value');

// Canvas 2D contexts
const gpuCtx = gpuCanvas.getContext('2d');
const memCtx = memCanvas.getContext('2d');
const tempCtx = tempCanvas.getContext('2d');
const powerCtx = powerCanvas.getContext('2d');

// Time-series data (rolling window, ~60 points = 60 seconds at 1s intervals)
const MAX_POINTS = 60;
const gpuHistory = [];
const memHistory = [];
const tempHistory = [];
const powerHistory = [];

// Process channel
const ch = mica.openChannel("session");

// Resize canvases to match container width
function resizeCanvas(canvas) {
  const rect = canvas.parentElement.getBoundingClientRect();
  const w = Math.floor(rect.width - 32); // account for padding
  canvas.width = Math.max(w, 200);
  canvas.height = 120;
}

// Color helper: green (<70%), yellow (70-90%), red (>90%)
function getColor(pct) {
  if (pct < 70) return '#4caf50';
  if (pct < 90) return '#ffb74d';
  return '#f44336';
}

// Color helper for temperature: green (<70°C), yellow (70-85°C), red (>85°C)
function getTempColor(temp) {
  if (temp < 70) return '#4caf50';
  if (temp < 85) return '#ffb74d';
  return '#f44336';
}

// Color helper for power draw (fixed 10-110W scale)
function getPowerColor(power) {
  const minW = 10, maxW = 110;
  const pct = (power - minW) / (maxW - minW);
  if (pct < 0.5) return '#4caf50';
  if (pct < 0.75) return '#ffb74d';
  return '#f44336';
}

// Draw placeholder text on canvas
function drawPlaceholder(ctx, canvas, text) {
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = '#888';
  ctx.font = '13px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2);
}

// Parse temperature from nvidia-smi (handles 'N/A', empty, numeric)
function parseTemp(val) {
  if (val == null || val === 'N/A' || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// Parse power draw from nvidia-smi (handles 'N/A', empty, numeric)
function parsePower(val) {
  if (val == null || val === 'N/A' || val === '') return null;
  const n = parseFloat(val);
  return isNaN(n) ? null : n;
}

// Monotone cubic (Fritsch-Carlson) spline interpolation — never overshoots.
// Preserves smoothness while clamping control points so curves can't swing
// past the actual data values, eliminating false spikes on sharp drops/rises.
function monotoneCubic(points, numSegments) {
  numSegments = numSegments || 24;
  if (points.length < 2) return points.slice();
  const n = points.length - 1;
  // Compute spacing
  const dx = [], dy = [];
  for (let i = 0; i < n; i++) {
    dx[i] = points[i + 1].x - points[i].x;
    dy[i] = points[i + 1].y - points[i].y;
  }
  // Slopes between consecutive points
  const m = [];
  for (let i = 0; i < n; i++) {
    m[i] = dx[i] !== 0 ? dy[i] / dx[i] : 0;
  }
  // Compute tangents via weighted average of adjacent slopes
  const t = [];
  for (let i = 0; i < n; i++) {
    const wi = dx[i + 1] || 0;
    const wj = dx[i] || 0;
    if (m[i] * m[i + 1] <= 0) {
      // Sign change — zero tangent to avoid overshoot
      t[i] = 0;
      t[i + 1] = 0;
    } else {
      // Weighted harmonic mean (Fritsch-Carlson)
      const wSum = wi + wj;
      if (wSum === 0) {
        t[i] = m[i];
        t[i + 1] = m[i + 1];
      } else {
        t[i] = (3 * wSum) / (wi / m[i] + wj / m[i + 1] + wSum);
        t[i + 1] = t[i]; // symmetric for equal spacing
      }
    }
  }
  // Clamp tangents: scale down so the Hermite curve stays within the
  // bounding box of its endpoints (prevents overshoot).
  for (let i = 0; i < n; i++) {
    const alpha = t[i] / (m[i] || 1);
    const beta = t[i + 1] / (m[i + 1] || 1);
    const a2 = alpha * alpha, b2 = beta * beta;
    const s = Math.sqrt(a2 + b2);
    if (s > 3) {
      const scale = 3 / s;
      t[i] *= scale;
      t[i + 1] *= scale;
    }
  }
  // Hermite interpolation with clamped tangents
  const result = [];
  for (let i = 0; i < n; i++) {
    const p0 = points[i], p1 = points[i + 1];
    const h = dx[i] || 1;
    for (let s = 0; s < numSegments; s++) {
      const u = s / numSegments;
      const u2 = u * u;
      const u3 = u2 * u;
      // Hermite basis functions
      const h00 = 2 * u3 - 3 * u2 + 1;
      const h10 = u3 - 2 * u2 + u;
      const h01 = -2 * u3 + 3 * u2;
      const h11 = u3 - u2;
      const x = h00 * p0.x + h10 * h * t[i] + h01 * p1.x + h11 * h * t[i + 1];
      const y = h00 * p0.y + h10 * t[i] + h01 * p1.y + h11 * t[i + 1];
      result.push({ x, y });
    }
  }
  result.push(points[points.length - 1]);
  return result;
}

// Pulse animation state per graph
const pulseState = { gpu: 0, mem: 0, temp: 0, power: 0 };

// Draw a time-series line graph on canvas
function drawGraph(ctx, canvas, data, color, opts) {
  opts = opts || {};
  const minVal = opts.minVal != null ? opts.minVal : 0;
  const maxVal = opts.maxVal != null ? opts.maxVal : 100;
  const labelFn = opts.labelFn || function(v) { return v.toFixed(0) + '%'; };
  const yTicks = opts.yTicks || [0, 0.25, 0.5, 0.75, 1.0];
  const graphId = opts.graphId || '';

  const w = canvas.width;
  const h = canvas.height;
  const pad = { top: 16, right: 12, bottom: 20, left: 40 };
  const graphW = w - pad.left - pad.right;
  const graphH = h - pad.top - pad.bottom;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Background
  ctx.fillStyle = '#1a1a1a';
  ctx.fillRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = '#2a2a2a';
  ctx.lineWidth = 1;
  yTicks.forEach(level => {
    const y = pad.top + graphH * (1 - level);
    ctx.beginPath();
    ctx.moveTo(pad.left, y);
    ctx.lineTo(w - pad.right, y);
    ctx.stroke();

    // Y-axis labels
    ctx.fillStyle = '#666';
    ctx.font = '10px system-ui';
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(labelFn(minVal + level * (maxVal - minVal)), pad.left - 6, y);
  });

  if (data.length < 2) {
    // Not enough data yet — show placeholder
    ctx.fillStyle = '#555';
    ctx.font = '12px system-ui';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('waiting for data...', w / 2, h / 2);
    return;
  }

  // Convert data to {x, y} points
  const points = data.map((val, i) => {
    const x = pad.left + (i / (data.length - 1)) * graphW;
    const clampedVal = Math.max(0, Math.min(val, maxVal));
    const y = pad.top + graphH * (1 - (clampedVal - minVal) / (maxVal - minVal));
    return { x, y };
  });

  // Draw filled area under the monotone cubic curve
  const curvePoints = monotoneCubic(points, 24);
  const gradient = ctx.createLinearGradient(0, pad.top, 0, pad.top + graphH);
  gradient.addColorStop(0, color + '40');
  gradient.addColorStop(1, color + '05');
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.moveTo(pad.left, pad.top + graphH);
  ctx.lineTo(curvePoints[0].x, curvePoints[0].y);
  for (let i = 1; i < curvePoints.length; i++) {
    ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
  }
  ctx.lineTo(pad.left + graphW, pad.top + graphH);
  ctx.closePath();
  ctx.fill();

  // Draw the monotone cubic curve
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(curvePoints[0].x, curvePoints[0].y);
  for (let i = 1; i < curvePoints.length; i++) {
    ctx.lineTo(curvePoints[i].x, curvePoints[i].y);
  }
  ctx.stroke();

  // Draw current value dot with pulse animation
  const lastVal = data[data.length - 1];
  const clampedLast = Math.max(0, Math.min(lastVal, maxVal));
  const dotX = pad.left + graphW;
  const dotY = pad.top + graphH * (1 - (clampedLast - minVal) / (maxVal - minVal));

  // Pulse: scale up and fade the dot each cycle
  const pulseKey = graphId || 'default';
  const pulseScale = 1 + pulseState[pulseKey] * 0.5;
  const pulseAlpha = 1 - pulseState[pulseKey] * 0.6;

  // Outer glow ring
  ctx.beginPath();
  ctx.arc(dotX, dotY, 8 * pulseScale, 0, Math.PI * 2);
  ctx.fillStyle = color + Math.round(pulseAlpha * 40).toString(16).padStart(2, '0');
  ctx.fill();

  // Main dot
  ctx.beginPath();
  ctx.arc(dotX, dotY, 4 * pulseScale, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Decay pulse over time
  if (pulseState[pulseKey] > 0) {
    pulseState[pulseKey] = Math.max(0, pulseState[pulseKey] - 0.05);
  }

  // Time labels on X-axis
  ctx.fillStyle = '#555';
  ctx.font = '9px system-ui';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';
  const labelCount = Math.min(5, data.length);
  const step = Math.max(1, Math.floor(data.length / (labelCount - 1 || 1)));
  for (let i = 0; i < data.length; i += step) {
    const x = pad.left + (i / (data.length - 1)) * graphW;
    const secondsAgo = (data.length - 1 - i) * 1;
    ctx.fillText(secondsAgo === 0 ? 'now' : '-' + secondsAgo + 's', x, pad.top + graphH + 6);
  }
}

// Update UI from JSON data
function updateUI(data) {
  const gpuUtil = parseFloat(data.gpu_util) || 0;
  const memPct = parseFloat(data.mem_pct) || 0;
  const memUsedMB = parseInt(data.mem_used) || 0;
  const memTotalMB = parseInt(data.mem_total) || 0;
  const temperature = parseTemp(data.temperature);
  const powerDraw = parsePower(data.power_draw);

  // Push to history (roll off old points)
  gpuHistory.push(gpuUtil);
  memHistory.push(memPct);
  if (gpuHistory.length > MAX_POINTS) gpuHistory.shift();
  if (memHistory.length > MAX_POINTS) memHistory.shift();
  if (temperature != null) {
    tempHistory.push(temperature);
    if (tempHistory.length > MAX_POINTS) tempHistory.shift();
  }
  if (powerDraw != null) {
    powerHistory.push(powerDraw);
    if (powerHistory.length > MAX_POINTS) powerHistory.shift();
  }

  const gpuColor = getColor(gpuUtil);
  const memColor = getColor(memPct);

  // Resize canvases to fit container
  resizeCanvas(gpuCanvas);
  resizeCanvas(memCanvas);
  resizeCanvas(tempCanvas);
  resizeCanvas(powerCanvas);

  // Trigger pulse animation on each graph
  pulseState.gpu = 1;
  pulseState.mem = 1;
  pulseState.temp = 1;
  pulseState.power = 1;

  // Draw graphs
  drawGraph(gpuCtx, gpuCanvas, gpuHistory, gpuColor, { graphId: 'gpu' });
  drawGraph(memCtx, memCanvas, memHistory, memColor, { graphId: 'mem' });
  if (temperature != null && tempHistory.length >= 2) {
    const tempColor = getTempColor(temperature);
    drawGraph(tempCtx, tempCanvas, tempHistory, tempColor, {
      minVal: 0,
      maxVal: 100,
      labelFn: function(v) { return v.toFixed(0) + '°C'; },
      graphId: 'temp',
    });
  } else {
    drawPlaceholder(tempCtx, tempCanvas, 'N/A');
  }

  const tempColor = temperature != null ? getTempColor(temperature) : '#555';
  if (powerDraw != null && powerHistory.length >= 2) {
    const powerColor = getPowerColor(powerDraw);
    drawGraph(powerCtx, powerCanvas, powerHistory, powerColor, {
      minVal: 10,
      maxVal: 110,
      labelFn: function(v) { return v.toFixed(0) + ' W'; },
      graphId: 'power',
    });
  } else {
    drawPlaceholder(powerCtx, powerCanvas, 'N/A');
  }

  // Current value text (small, next to label)
  gpuValueEl.textContent = gpuUtil.toFixed(0) + '%';
  gpuValueEl.style.color = gpuColor;

  const memUsedGB = (memUsedMB / 1024 / 1024).toFixed(0);
  const memTotalGB = (memTotalMB / 1024 / 1024).toFixed(0);
  memValueEl.innerHTML = memPct.toFixed(0) + '% used <br>' + memUsedGB + ' GB<br>' + memTotalGB + ' GB total';
  memValueEl.style.color = memColor;

  if (temperature != null) {
    const tempF = (temperature * 9 / 5 + 32).toFixed(1);
    tempValueEl.innerHTML = temperature.toFixed(0) + '°C<br>' + tempF + '°F';
    tempValueEl.style.color = tempColor;
  } else {
    tempValueEl.innerHTML = '—';
    tempValueEl.style.color = '#555';
  }

  const powerColor = powerDraw != null ? getPowerColor(powerDraw) : '#555';
  if (powerDraw != null) {
    powerValueEl.textContent = powerDraw.toFixed(2) + ' W';
    powerValueEl.style.color = powerColor;
  } else {
    powerValueEl.textContent = '—';
    powerValueEl.style.color = '#555';
  }

  // GPU name
  if (data.gpu_name) {
    gpuNameEl.textContent = data.gpu_name;
  }
}

// Handle process messages
ch.onData((msg) => {
  if (msg.type === "idle") {
    gpuValueEl.textContent = '—';
    memValueEl.textContent = '—';
  }
  if (msg.type === "started") {
    // Process started, wait for data
  }
  if (msg.type === "stdout") {
    try {
      const data = JSON.parse(msg.data.trim());
      updateUI(data);
    } catch (e) {
      // Ignore parse errors
    }
  }
  if (msg.type === "exit") {
    gpuValueEl.textContent = 'Exited';
    memValueEl.textContent = 'Exited';
  }
  if (msg.type === "error") {
    gpuValueEl.textContent = 'Error';
    memValueEl.textContent = 'Error';
  }
});

// Start the monitoring process (after onData is registered)
ch.send({
  type: "start",
  command: "/usr/bin/bash",
  args: ["-c", "while true; do gpu_info=$(nvidia-smi --query-gpu=utilization.gpu,name,temperature.gpu,power.draw --format=csv,noheader,nounits 2>/dev/null); gpu_util=$(echo \"$gpu_info\" | cut -d',' -f1 | tr -d ' '); gpu_name=$(echo \"$gpu_info\" | cut -d',' -f2 | tr -d ' '); temperature=$(echo \"$gpu_info\" | cut -d',' -f3 | tr -d ' '); power_draw=$(echo \"$gpu_info\" | cut -d',' -f4 | tr -d ' '); mem_total=$(awk '/MemTotal/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); mem_avail=$(awk '/MemAvailable/ {print $2}' /proc/meminfo 2>/dev/null || echo 0); mem_used=$((mem_total - mem_avail)); mem_pct=0; if [ \"$mem_total\" -gt 0 ] 2>/dev/null; then mem_pct=$((mem_used * 100 / mem_total)); fi; echo \"{\\\"gpu_util\\\":$gpu_util,\\\"gpu_name\\\":\\\"$gpu_name\\\",\\\"temperature\\\":\\\"$temperature\\\",\\\"power_draw\\\":\\\"$power_draw\\\",\\\"mem_pct\\\":$mem_pct,\\\"mem_used\\\":$mem_used,\\\"mem_total\\\":$mem_total}\"; sleep 1; done"],
});

// Cleanup
mica.onDestroy(() => {
  try { ch.close(); } catch {}
});