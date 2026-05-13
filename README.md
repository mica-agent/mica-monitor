# Meter

A Mica canvas project for local GPU monitoring on DGX Spark.

## Overview

This project runs the [Mica](https://github.com/agentfree-dom/canvas) canvas framework on a DGX Spark system, providing real-time GPU and system resource visibility through interactive dashboard cards.

### Template: `dgx-spark-local`

Configured for a local DGX Spark environment with local LLM inference (vLLM on ports 8012/8013).

## Canvas Cards

| Card | Type | Description |
|---|---|---|
| **GPU Monitor** | `gpu-monitor` | Real-time GPU utilization, temperature, power draw, and system memory usage with 60-second rolling time-series graphs. |
| **Chat** | `chat` | AI assistant for conversation and project interaction. |
| **Terminal** | `terminal` | Interactive terminal for shell commands. |
| **Git Repo** | `gitrepo` | Git repository information and operations. |

## GPU Monitor Card

The primary dashboard card, displaying:

- **GPU Utilization %** — polled from `nvidia-smi` at 1-second intervals
- **System Memory Usage** — read from `/proc/meminfo` (correct for GB10 unified memory)
- **GPU Temperature** — in °C and °F
- **Power Draw** — in watts

Each metric renders as a smooth time-series graph with color-coded thresholds (green/yellow/red) and a pulse animation on the current data point.

### Technical Details

- Pure DOM/CSS/JS — no external libraries
- Monotone cubic (Fritsch-Carlson) spline interpolation for smooth curves
- 60-point rolling window (~60 seconds) per graph
- Color thresholds: utilization/memory <70% green, 70–90% yellow, >90% red

## Project Structure

```
.
├── canvas/                  # Canvas card instances
│   ├── gpu.gpu-monitor
│   ├── qwen.chat
│   ├── terminal-*.terminal
│   └── gitrepo.gitrepo
├── .mica/                   # Mica internal state (layout, config)
│   ├── card-classes/        # Card class definitions
│   │   └── gpu-monitor/     # GPU monitor card class
│   │       ├── metadata.json
│   │       ├── card.html
│   │       ├── card.js
│   │       └── card.css
│   ├── config.json
│   └── layout.json
├── .qwen/                   # Qwen Code configuration
└── README.md
```

## Running

1. Start the Mica canvas framework (see Mica documentation).
2. Open the canvas in your browser (port 5173).
3. The GPU Monitor card begins polling immediately on load.

## Mica Framework

This project uses the Mica canvas framework — a card-based, visual workspace for local AI-assisted development. Cards are self-contained UI components (HTML/CSS/JS) that render on a shared canvas with drag-and-drop layout.
