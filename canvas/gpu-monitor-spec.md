# GPU Monitor Card

## What

A card that displays real-time GPU utilization percentage and system memory usage percentage, polling nvidia-smi and /proc/meminfo for live data.

## Why

The user needs at-a-glance visibility into GPU health — how hard the GPU is working and how much system RAM is consumed. On DGX Spark, nvidia-smi does NOT report memory correctly (GB10 uses unified memory), so system memory from /proc/meminfo is the correct metric.

## Subproblems

### 1\. Poll nvidia\-smi for GPU metrics

* Run `nvidia-smi --query-gpu=index,name,utilization.gpu,temperature.gpu,power.draw --format=csv,noheader,nounits` at a 1-second interval.
* Parse CSV output: `utilization.gpu` (number), `temperature.gpu` (°C), `power.draw` (watts).
* GPU name as title.
* **No external library needed** — pure DOM manipulation + setInterval.

### 2\. Poll /proc/meminfo for system memory

* Read `/proc/meminfo` (or run `free -b`) at a 1-second interval.
* Parse: MemTotal, MemAvailable → used = total - available.
* Compute percentage: (used / total) \* 100.
* Display on 3 lines:
    * Line 1: percentage + raw usage, e.g., "42% used "
    * Line 2: 53 GB"
    * Line 3: total capacity, e.g., "128 GB total"

### 3\. Render time\-series graphs

* Display GPU name as title.
* Four time-series graphs: GPU Utilization %, Temperature, System Memory %, and Power Draw.
* Each graph shows a rolling window of \~60 seconds (60 data points at 1s intervals).
* Show current values as text below each graph:
    * **GPU Utilization**: e.g., "93% utilized"
    * **Temperature**: e.g., "49°C / 120.2°F" (each temp on their own line). Absolute values on graph
    * **System Memory**: "42% used / 53 GB" / "128 GB total" (3 lines)
    * **Power Draw**: e.g., "31.69 W". Watt units on Y axis (10W–110W fixed)
* Color coding (utilization and memory): green (<70%), yellow (70-90%), red (>90%) — applied to the current value dot.
* Color coding (temperature): green (<70°C), yellow (70-85°C), red (>85°C).
* Color coding (power draw): green (<50% of 10-110W range), yellow (50-75%), red (>75%).
* Graph axes:
    * Utilization: Y-axis 0-100%
    * Temperature: Y-axis 0-100°C
    * Memory: Y-axis 0-100%
    * Power Draw: Y-axis in watts (fixed 10W–110W scale)
    * X-axis shows time labels at \~10s intervals.
* Animation: a pulse (brief scale-up and fade) on the current sample dot at the right edge of each graph every cycle, indicating the graph is actively updating.
* Smooth lines: use monotone cubic (Fritsch-Carlson) spline interpolation with 24 sub-segments per data point for smooth curves — never overshoots, eliminating false spikes on sharp drops.

## Files

* `.mica/card-classes/gpu-monitor/metadata.json`
* `.mica/card-classes/gpu-monitor/card.html`
* `.mica/card-classes/gpu-monitor/card.js`
* `.mica/card-classes/gpu-monitor/card.css`
* Canvas instance: `canvas/gpu.gpu-monitor`

## Out of scope

* Multi-GPU support (this system has 1 GPU).
* Historical charts / graphs.
* Per-process GPU breakdown.
* CPU/disk monitoring.