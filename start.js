/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  AXEROCAM v2.0 — AI SURVEILLANCE SERVER                     ║
 * ║  File: start.js                                              ║
 * ║  Stack: Express · Socket.io · AI Decision Engine            ║
 * ║  Author: AxeroAI · Kousik Debnath                           ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  URL 1: http://localhost:3000/          → Live camera feed  ║
 * ║  URL 2: http://localhost:3000/dashboard → Command center    ║
 * ╚══════════════════════════════════════════════════════════════╝
 */

'use strict';

const express    = require('express');
const http       = require('http');
const { Server } = require('socket.io');
const cors       = require('cors');
const path       = require('path');
const fs         = require('fs');
const crypto     = require('crypto');
const { v4: uuidv4 } = require('uuid');

// ── AI Agent modules ────────────────────────────────────────────
const { analyse, DecisionLog, probeOllama, OLLAMA_CONFIG } = require('./agent/decision-engine.js');
const { THREAT_LEVELS } = require('./agent/threat-model.js');

// ═══════════════════════════════════════════════════════════════
//  SERVER CONFIGURATION
// ═══════════════════════════════════════════════════════════════
const CONFIG = {
  port:              process.env.PORT  || 3000,
  host:              '0.0.0.0',
  snapshotDir:       path.join(__dirname, 'snapshots'),
  maxDetectionLog:   300,
  maxDecisionLog:    200,
  maxSnapshotLog:    50,
  maxSysLog:         150,
  frameRelayEnabled: true,
  agentEnabled:      true,          // AI agent toggle
  agentDebounceMs:   1200,          // Min ms between AI analyses (mobile CPU relief)
};

// ═══════════════════════════════════════════════════════════════
//  GLOBAL STATE
// ═══════════════════════════════════════════════════════════════
const decisionLog = new DecisionLog(CONFIG.maxDecisionLog);

const state = {
  cameraActive:       false,
  alertActive:        false,
  agentEnabled:       CONFIG.agentEnabled,
  connectedClients:   0,
  totalDetections:    0,
  fps:                0,
  detectorType:       'TF.js COCO-SSD',
  detectionLog:       [],
  snapshotLog:        [],
  sysLog:             [],
  lastFrame:          null,
  lastAgentCallMs:    0,          // debounce tracker
  ollamaStatus:       'UNKNOWN',  // 'ONLINE' | 'OFFLINE' | 'CHECKING'
  currentThreat:      'CLEAR',
};

// ═══════════════════════════════════════════════════════════════
//  SETUP
// ═══════════════════════════════════════════════════════════════
if (!fs.existsSync(CONFIG.snapshotDir)) {
  fs.mkdirSync(CONFIG.snapshotDir, { recursive: true });
}

const app    = express();
const server = http.createServer(app);
const io     = new Server(server, {
  cors:              { origin: '*' },
  maxHttpBufferSize: 6e6,   // 6MB — allow frame payloads
  pingInterval:      5000,
  pingTimeout:       12000,
});

app.use(cors());
app.use(express.json({ limit: '12mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/snapshots', express.static(CONFIG.snapshotDir));

// ─── Sys log helper ─────────────────────────────────────────────
function sysLog(level, msg) {
  const entry = { level, msg, ts: new Date().toISOString() };
  state.sysLog.unshift(entry);
  if (state.sysLog.length > CONFIG.maxSysLog) state.sysLog.pop();
  const icons = { ok: '✅', info: '💬', warn: '⚠️', alert: '🚨', error: '❌', agent: '🤖' };
  console.log(`[AXEROCAM ${icons[level] || '·'}] ${msg}`);
  io.to('dashboard').emit('sys_log', entry);
}

// ═══════════════════════════════════════════════════════════════
//  REST API
// ═══════════════════════════════════════════════════════════════

// ── GET /api/status ─────────────────────────────────────────────
app.get('/api/status', (req, res) => {
  res.json({
    cameraActive:     state.cameraActive,
    alertActive:      state.alertActive,
    agentEnabled:     state.agentEnabled,
    connectedClients: state.connectedClients,
    totalDetections:  state.totalDetections,
    fps:              state.fps,
    detectorType:     state.detectorType,
    currentThreat:    state.currentThreat,
    ollamaStatus:     state.ollamaStatus,
    ollamaModel:      OLLAMA_CONFIG.model,
    decisionStats:    decisionLog.getStats(),
    uptime:           Math.floor(process.uptime()),
    timestamp:        new Date().toISOString(),
    nodeVersion:      process.version,
  });
});

// ── GET /api/detections ─────────────────────────────────────────
app.get('/api/detections', (req, res) => {
  res.json(state.detectionLog.slice(0, parseInt(req.query.limit) || 50));
});

// ── GET /api/decisions ──────────────────────────────────────────
app.get('/api/decisions', (req, res) => {
  res.json({
    decisions: decisionLog.recent(parseInt(req.query.limit) || 50),
    stats:     decisionLog.getStats(),
  });
});

// ── GET /api/snapshots ──────────────────────────────────────────
app.get('/api/snapshots', (req, res) => {
  res.json(state.snapshotLog.slice(0, 20));
});

// ── POST /api/detections/clear ──────────────────────────────────
app.post('/api/detections/clear', (req, res) => {
  state.detectionLog  = [];
  state.totalDetections = 0;
  io.emit('detections_cleared');
  sysLog('warn', 'Detection log cleared by operator.');
  res.json({ status: 'cleared' });
});

// ── POST /api/decisions/clear ───────────────────────────────────
app.post('/api/decisions/clear', (req, res) => {
  decisionLog.clear();
  io.emit('decisions_cleared');
  sysLog('warn', 'AI decision log cleared by operator.');
  res.json({ status: 'cleared' });
});

// ── POST /api/alert ─────────────────────────────────────────────
app.post('/api/alert', (req, res) => {
  const { active } = req.body;
  state.alertActive = !!active;
  io.emit('alert_state', { active: state.alertActive });
  sysLog(state.alertActive ? 'alert' : 'info',
    state.alertActive
      ? '⚠ MANUAL ALERT triggered by operator.'
      : 'Manual alert cleared by operator.');
  res.json({ alertActive: state.alertActive });
});

// ── POST /api/agent/toggle ──────────────────────────────────────
app.post('/api/agent/toggle', (req, res) => {
  const { enabled } = req.body;
  state.agentEnabled = enabled !== undefined ? !!enabled : !state.agentEnabled;
  io.emit('agent_state', { enabled: state.agentEnabled });
  sysLog('agent', `AI Agent ${state.agentEnabled ? 'ENABLED' : 'DISABLED'} by operator.`);
  res.json({ agentEnabled: state.agentEnabled });
});

// ── POST /api/snapshot ──────────────────────────────────────────
app.post('/api/snapshot', (req, res) => {
  const { imageData, metadata } = req.body;
  if (!imageData) return res.status(400).json({ error: 'No image data' });

  try {
    const base64   = imageData.replace(/^data:image\/\w+;base64,/, '');
    const buffer   = Buffer.from(base64, 'base64');
    const ts       = new Date();
    const filename = `snap_${ts.toISOString().replace(/[:.]/g, '-')}_${uuidv4().slice(0,6)}.jpg`;
    const filepath = path.join(CONFIG.snapshotDir, filename);
    fs.writeFileSync(filepath, buffer);

    const entry = {
      filename,
      url:       `/snapshots/${filename}`,
      timestamp: ts.toISOString(),
      metadata:  metadata || {},
    };
    state.snapshotLog.unshift(entry);
    if (state.snapshotLog.length > CONFIG.maxSnapshotLog) state.snapshotLog.pop();
    io.emit('snapshot_saved', entry);
    sysLog('ok', `Snapshot saved → ${filename}`);
    res.json({ status: 'saved', ...entry });
  } catch (err) {
    sysLog('error', `Snapshot failed: ${err.message}`);
    res.status(500).json({ error: err.message });
  }
});

// ── GET / ── feed page ──────────────────────────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ── GET /dashboard ───────────────────────────────────────────────
app.get('/dashboard', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'dashboard.html'));
});

// ═══════════════════════════════════════════════════════════════
//  AI AGENT PIPELINE
//  Called when a detection event arrives from the browser.
//  Debounced to avoid hammering the LLM on every frame.
// ═══════════════════════════════════════════════════════════════
async function runAgentPipeline(payload, socket) {
  if (!state.agentEnabled) return;

  // Debounce: skip if called too recently
  const now = Date.now();
  if (now - state.lastAgentCallMs < CONFIG.agentDebounceMs) return;
  state.lastAgentCallMs = now;

  try {
    const decision = await analyse(payload);
    decisionLog.push(decision);

    state.currentThreat = decision.threatLevel;

    // ── Broadcast decision to all dashboard clients ─────────
    io.to('dashboard').emit('agent_decision', decision);
    io.emit('threat_level', {
      level: decision.threatLevel,
      color: decision.threatColor,
      score: decision.score,
    });

    // ── Auto-trigger alert on CRITICAL ──────────────────────
    if (decision.threatLevel === 'CRITICAL' && !state.alertActive) {
      state.alertActive = true;
      io.emit('alert_state', { active: true, auto: true, reason: 'CRITICAL threat' });
      sysLog('alert', `[AGENT] AUTO-ALERT: ${decision.narrative.slice(0, 80)}`);
    }

    sysLog('agent',
      `[${decision.agentMode}] ${decision.threatLevel} (${decision.score}/100) · ${decision.targetCount} target(s) · ${decision.simulatedActions}`
    );

  } catch (err) {
    sysLog('error', `Agent pipeline error: ${err.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════
//  SOCKET.IO EVENT HANDLERS
// ═══════════════════════════════════════════════════════════════
io.on('connection', (socket) => {
  state.connectedClients++;
  io.emit('client_count', state.connectedClients);
  sysLog('info', `Client [${socket.id.slice(0,8)}] connected · Total: ${state.connectedClients}`);

  // ── Room join ───────────────────────────────────────────────
  socket.on('join_room', (room) => {
    socket.join(room);
  });

  // ── Video frame relay (feed → dashboard) ───────────────────
  socket.on('frame', (data) => {
    state.lastFrame  = data.imageData;
    state.fps        = data.fps || 0;
    state.cameraActive = true;
    if (CONFIG.frameRelayEnabled) {
      socket.to('dashboard').emit('frame', data);
    }
  });

  // ── Camera started/stopped ─────────────────────────────────
  socket.on('camera_started', () => {
    state.cameraActive = true;
    io.emit('camera_state', { active: true });
    sysLog('ok', 'Camera feed started.');
  });

  socket.on('camera_stopped', () => {
    state.cameraActive = false;
    state.fps          = 0;
    state.lastFrame    = null;
    io.emit('camera_state', { active: false });
    sysLog('warn', 'Camera feed stopped.');
  });

  // ── Detection event → AI agent pipeline ────────────────────
  socket.on('detection_event', async (payload) => {
    const { detections, lat, lon, temp, timestamp } = payload;
    if (!detections) return;

    // ── Store detection records ──────────────────────────────
    detections.forEach((det) => {
      const record = {
        id:         state.detectionLog.length + 1,
        label:      det.label || 'HUMAN',
        confidence: Math.round((det.confidence || 0) * 100),
        bbox:       det.bbox,
        timestamp:  timestamp || new Date().toISOString(),
        lat, lon, temp,
      };
      state.detectionLog.unshift(record);
      state.totalDetections++;
      if (state.detectionLog.length > CONFIG.maxDetectionLog) state.detectionLog.pop();
      io.to('dashboard').emit('new_detection', record);
    });
    io.emit('detection_count', state.totalDetections);

    // ── Feed AI agent ─────────────────────────────────────────
    const agentPayload = {
      targets: detections.map(d => ({
        label:      d.label || 'HUMAN',
        confidence: d.confidence || 0,
        bbox:       d.bbox,
      })),
      lat, lon, temp, timestamp,
    };
    runAgentPipeline(agentPayload, socket);   // non-blocking
  });

  // ── Manual agent trigger from dashboard ────────────────────
  socket.on('trigger_agent_analysis', async (payload) => {
    sysLog('agent', 'Manual agent analysis triggered by operator.');
    const decision = await analyse(payload || { targets: [], timestamp: new Date().toISOString() });
    decisionLog.push(decision);
    io.to('dashboard').emit('agent_decision', decision);
    io.emit('threat_level', {
      level: decision.threatLevel,
      color: decision.threatColor,
      score: decision.score,
    });
  });

  // ── GPS update ──────────────────────────────────────────────
  socket.on('gps_update', (coords) => {
    io.emit('gps_update', coords);
  });

  // ── Detector type report ────────────────────────────────────
  socket.on('detector_type', (type) => {
    state.detectorType = type;
    io.emit('detector_type', type);
  });

  // ── Request full server state (dashboard on load) ───────────
  socket.on('request_state', () => {
    socket.emit('server_state', {
      cameraActive:     state.cameraActive,
      alertActive:      state.alertActive,
      agentEnabled:     state.agentEnabled,
      totalDetections:  state.totalDetections,
      detectionLog:     state.detectionLog.slice(0, 50),
      decisions:        decisionLog.recent(30),
      decisionStats:    decisionLog.getStats(),
      snapshotLog:      state.snapshotLog.slice(0, 10),
      sysLog:           state.sysLog.slice(0, 25),
      fps:              state.fps,
      detectorType:     state.detectorType,
      currentThreat:    state.currentThreat,
      ollamaStatus:     state.ollamaStatus,
      ollamaModel:      OLLAMA_CONFIG.model,
    });
  });

  // ── Disconnect ──────────────────────────────────────────────
  socket.on('disconnect', () => {
    state.connectedClients = Math.max(0, state.connectedClients - 1);
    io.emit('client_count', state.connectedClients);
  });
});

// ═══════════════════════════════════════════════════════════════
//  STARTUP SEQUENCE
// ═══════════════════════════════════════════════════════════════
async function startup() {
  // ── Check Ollama availability ───────────────────────────────
  state.ollamaStatus = 'CHECKING';
  const ollOk = await probeOllama();
  state.ollamaStatus = ollOk ? 'ONLINE' : 'OFFLINE';

  // ── Start server ─────────────────────────────────────────────
  server.listen(CONFIG.port, CONFIG.host, () => {
    const D = '═'.repeat(56);
    console.log(`\n╔${D}╗`);
    console.log(`║      AXEROCAM v2.0 — AI SURVEILLANCE SYSTEM          ║`);
    console.log(`╠${D}╣`);
    console.log(`║  📡  URL 1 (Feed)      → http://localhost:${CONFIG.port}/        ║`);
    console.log(`║  🖥   URL 2 (Dashboard) → http://localhost:${CONFIG.port}/dashboard ║`);
    console.log(`╠${D}╣`);
    console.log(`║  🤖  AI Agent    : ${state.agentEnabled ? 'ENABLED' : 'DISABLED'}                          ║`);
    console.log(`║  🧠  Ollama LLM  : ${state.ollamaStatus} (${OLLAMA_CONFIG.model})         ║`);
    console.log(`║  🔁  Fallback    : RULE-BASED ENGINE                  ║`);
    console.log(`╚${D}╝\n`);

    sysLog('ok', `AXEROCAM v2.0 started on port ${CONFIG.port}.`);
    sysLog('agent', `AI Agent: ${state.agentEnabled ? 'ACTIVE' : 'STANDBY'} · Ollama: ${state.ollamaStatus}`);
    if (state.ollamaStatus === 'ONLINE') {
      sysLog('agent', `LLM model: ${OLLAMA_CONFIG.model}`);
    } else {
      sysLog('warn', 'Ollama offline — rule-based decision engine active.');
    }
  });
}

startup().catch(console.error);

process.on('SIGINT', () => {
  console.log('\n[AXEROCAM] Shutting down gracefully…');
  server.close(() => process.exit(0));
});

process.on('uncaughtException', (err) => {
  console.error('[AXEROCAM ERROR]', err.message);
});
