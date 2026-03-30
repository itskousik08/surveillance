# 🛡️ AXEROCAM v2.0 — AI Autonomous Surveillance System

> Mobile-first AI surveillance with autonomous decision-making.  
> TF.js human detection → AI threat assessment → real-time decision logs.  
> **Fully offline capable.** Built for Termux / Android.  
> Built by **AxeroAI · Kousik Debnath**

---

## 🧠 System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  BROWSER (Mobile Chrome)                 │
│  📷 getUserMedia → Camera Feed                          │
│  🤖 TF.js COCO-SSD → Human Detection                   │
│  🎨 Canvas HUD → Threat-colored tactical overlay        │
│  📍 Geolocation API → Real GPS coordinates              │
└─────────────────┬───────────────────────────────────────┘
                  │  Socket.io (frames + detection events)
┌─────────────────▼───────────────────────────────────────┐
│               NODE.JS SERVER (Termux)                    │
│  🚦 Socket.io → Frame relay to dashboard                │
│  🧠 AI Decision Engine → Threat scoring + decisions     │
│  🔗 Ollama LLM → Natural language threat assessment     │
│  📋 Rule-based fallback → Deterministic decisions       │
│  📸 Snapshot storage → /snapshots/*.jpg                  │
│  🌐 REST API → /api/status, /api/decisions, etc.        │
└─────────────────────────────────────────────────────────┘
```

---

## ⚠️ Simulation Disclaimer

All threat assessments, alerts, and simulated actions are **purely for educational/testing purposes**.  
No real-world actions, weapons, or external communications are issued.  
This system is designed for training simulations and research only.

---

## ✨ Features

| Feature | Details |
|---|---|
| 🎯 Human Detection | TF.js COCO-SSD `lite_mobilenet_v2` — filters `person` class |
| 🧠 AI Agent | Ollama LLM (phi3:mini / tinyllama) OR rule-based engine |
| 📊 Threat Levels | CLEAR → LOW → MEDIUM → HIGH → CRITICAL (5-tier scoring) |
| 📋 Decision Logs | Timestamped AI decisions with narrative + simulated action |
| ⚡ Auto-Alert | Agent auto-triggers CRITICAL alert when score ≥ threshold |
| 📡 Dual URL | URL 1: Camera feed · URL 2: Full AI command dashboard |
| 🌐 Socket.io Relay | Live frame relay from feed → dashboard in real-time |
| 📍 GPS | Real via browser Geolocation API (sim fallback) |
| 📸 Snapshots | Canvas frame → saved JPEG with metadata |
| 🔁 Manual Sim | "RUN AGENT" button to test AI decisions without camera |
| 📴 Offline | Works offline after first TF.js model cache |

---

## 📱 Quick Start — Termux on Android

### Step 1 — Install Termux
Download **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/)  
*(Do NOT use Play Store — outdated version)*

### Step 2 — Install Node.js
```bash
pkg update && pkg upgrade -y
pkg install nodejs git -y
node --version   # should be v18+
```

### Step 3 — Clone the Repository
```bash
git clone https://github.com/YOUR_USERNAME/axerocam.git
cd axerocam
```

### Step 4 — Install Dependencies
```bash
npm install
```

### Step 5 — Start the System
```bash
node start
```

### Step 6 — Open in Browser
Open **Chrome** on your Android phone:

| URL | Page |
|---|---|
| `http://localhost:3000/` | 📡 Live camera feed |
| `http://localhost:3000/dashboard` | 🖥️ AI Command Center |

---

## 🧠 Enable Ollama LLM (Optional — Better AI Decisions)

By default the system uses a fast rule-based decision engine.  
For richer, natural-language threat assessments, install Ollama:

### On Desktop/Laptop (easier):
```bash
# Install Ollama
curl -fsSL https://ollama.com/install.sh | sh

# Pull a lightweight model
ollama pull phi3:mini     # ~2.2GB — recommended
# or
ollama pull tinyllama     # ~637MB — lightest

# Start Ollama server
ollama serve
```

### On Termux (experimental):
```bash
pkg install ollama -y
ollama pull tinyllama
ollama serve
```

### Connect AXEROCAM to Ollama:
```bash
# Default: connects to http://localhost:11434
node start

# Custom URL:
OLLAMA_URL=http://192.168.x.x:11434 node start

# Custom model:
OLLAMA_MODEL=tinyllama node start
```

When Ollama is online, the dashboard shows:
```
🧠 OLLAMA LLM STATUS  ● ONLINE
Model: phi3:mini
MODE: LLM (phi3:mini)
```

---

## 📁 Project Structure

```
axerocam/
├── start.js                   # ← Main server (Express + Socket.io + AI pipeline)
├── package.json
├── README.md
├── .gitignore
│
├── agent/
│   ├── decision-engine.js     # ← AI agent: Ollama LLM + rule-based fallback
│   └── threat-model.js        # ← Threat scoring, levels, action catalogue
│
├── public/
│   ├── index.html             # ← URL 1: Camera feed + HUD overlay
│   ├── dashboard.html         # ← URL 2: AI command center
│   ├── css/
│   │   └── axerocam.css       # ← Classified terminal aesthetic
│   └── js/
│       └── detection.js       # ← TF.js COCO-SSD engine + canvas HUD
│
└── snapshots/                 # ← Auto-created; JPEG snapshots saved here
```

---

## 🔧 Configuration

### Server (`start.js` → `CONFIG`):
```javascript
const CONFIG = {
  port:              3000,
  agentEnabled:      true,         // Enable/disable AI agent
  agentDebounceMs:   1200,         // Min ms between AI analyses (CPU relief)
  frameRelayEnabled: true,         // Relay frames to dashboard
};
```

### Detection (`public/js/detection.js` → constructor):
```javascript
this.opts = {
  detectionInterval: 5,    // Run AI every N frames (lower = more CPU)
  confidence:        0.42, // Detection threshold (0.0–1.0)
  jpegQuality:       0.68, // Frame relay quality
};
```

### Ollama (environment variables):
```bash
OLLAMA_URL=http://localhost:11434   # Ollama endpoint
OLLAMA_MODEL=phi3:mini              # Model to use
PORT=3000                           # Server port
```

---

## 🌐 LAN Access

```bash
# Find your phone's IP
ip addr show wlan0

# Access from any device on same Wi-Fi:
http://192.168.x.x:3000/dashboard
```

---

## 🤖 AI Decision Format

Each decision object produced by the agent:

```json
{
  "id":               "A3F1B2",
  "threatLevel":      "HIGH",
  "threatCode":       4,
  "threatColor":      "#ff6d00",
  "priority":         "URGENT",
  "score":            72,
  "targetCount":      2,
  "maxConfidence":    88,
  "narrative":        "Two high-confidence targets detected in observation zone. Persistent presence over multiple frames. HIGH threat classification applied.",
  "simulatedActions": "[SIM] Escalate watch status to HIGH ALERT.",
  "agentMode":        "LLM (phi3:mini)",
  "timestamp":        "2025-01-15T14:32:11.000Z",
  "location": { "lat": 28.6139, "lon": 77.2090, "temp": "31.2" }
}
```

---

## 🚀 Roadmap

- [ ] SQLite persistent detection + decision log
- [ ] Multi-camera socket namespace support
- [ ] Drone RTSP stream integration
- [ ] Termux push notification on CRITICAL alert
- [ ] IoT sensor overlay (PIR motion, IR)
- [ ] Custom threat zone polygons
- [ ] Whisper.cpp voice command integration

---

## ⬆️ Push to GitHub

```bash
git init
git add .
git commit -m "feat: AXEROCAM v2.0 — AI agent integration"
git remote add origin https://github.com/YOUR_USERNAME/axerocam.git
git push -u origin main
```

---

*Built with ⚡ by AxeroAI — Kousik Debnath · For educational simulation use only.*
