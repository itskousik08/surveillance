/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  AXEROCAM · AI DECISION ENGINE                              ║
 * ║  File: agent/decision-engine.js                             ║
 * ║  Purpose: Autonomous AI agent — Ollama LLM + fallback       ║
 * ╠══════════════════════════════════════════════════════════════╣
 * ║  SIMULATION DISCLAIMER                                       ║
 * ║  All decisions, alerts, and actions are purely simulated.   ║
 * ║  No real-world actions, weapons, or commands are issued.    ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * Decision flow:
 *  1. Receive detection payload from Socket.io
 *  2. computeThreatScore()  → raw score 0-100
 *  3. scoreToLevel()        → CLEAR / LOW / MEDIUM / HIGH / CRITICAL
 *  4. If Ollama available   → buildLLMDecision() (natural language reasoning)
 *     Else                  → buildRuleBasedDecision() (deterministic fallback)
 *  5. Return structured decision object to server
 *  6. Server broadcasts decision to all connected dashboards
 */

'use strict';

const {
  THREAT_LEVELS,
  SIMULATED_ACTIONS,
  computeThreatScore,
  scoreToLevel,
  buildRuleBasedDecision,
  pick,
} = require('./threat-model.js');

// ═══════════════════════════════════════════════════════════════
//  OLLAMA CONFIGURATION
//  Ollama runs locally on port 11434 by default.
//  Install: https://ollama.com/  |  Termux: pkg install ollama
//  Recommended models (small, mobile-friendly):
//    - phi3:mini    (~2.2GB) — best balance
//    - tinyllama    (~637MB) — lightest
//    - mistral:7b   (~4.1GB) — most capable
// ═══════════════════════════════════════════════════════════════
const OLLAMA_CONFIG = {
  baseUrl:    process.env.OLLAMA_URL  || 'http://localhost:11434',
  model:      process.env.OLLAMA_MODEL || 'phi3:mini',
  timeout:    8000,    // ms — fall back if LLM takes too long
  enabled:    true,    // will be set false if connection fails
};

// ── Track whether Ollama was confirmed reachable ────────────────
let ollamaReady    = false;
let ollamaChecked  = false;
let consecutiveFrameCounter = {}; // targetId → count

// ═══════════════════════════════════════════════════════════════
//  OLLAMA PROBE  — checks if local Ollama is running
// ═══════════════════════════════════════════════════════════════
async function probeOllama() {
  if (ollamaChecked) return ollamaReady;
  ollamaChecked = true;

  try {
    // Dynamic import for node-fetch (ESM compat)
    const { default: fetch } = await import('node-fetch');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 3000);

    const res = await fetch(`${OLLAMA_CONFIG.baseUrl}/api/tags`, {
      signal: ctrl.signal,
    });
    clearTimeout(timer);

    if (res.ok) {
      const data = await res.json();
      const models = (data.models || []).map(m => m.name);
      console.log(`[AGENT] ✅ Ollama reachable. Models: ${models.join(', ') || 'none pulled'}`);

      // Check if our target model exists
      const modelAvailable = models.some(m => m.includes(OLLAMA_CONFIG.model.split(':')[0]));
      if (!modelAvailable && models.length > 0) {
        // Use the first available model instead
        OLLAMA_CONFIG.model = models[0];
        console.log(`[AGENT] ℹ️  Using available model: ${OLLAMA_CONFIG.model}`);
      }
      ollamaReady = modelAvailable || models.length > 0;
    } else {
      ollamaReady = false;
    }
  } catch {
    console.log('[AGENT] ⚠️  Ollama not reachable — using rule-based decision engine.');
    ollamaReady = false;
  }
  return ollamaReady;
}

// ═══════════════════════════════════════════════════════════════
//  SYSTEM PROMPT  — sets the agent persona for the LLM
// ═══════════════════════════════════════════════════════════════
const SYSTEM_PROMPT = `You are AXEROCAM-AGENT, an autonomous AI surveillance analyst.
You receive structured sensor data from a mobile camera system.
Your job is to analyze the data and produce a concise operational decision.

RULES:
- This is a SIMULATION. All actions you describe are purely for training/testing.
- Never describe real weapons, violence, or illegal actions.
- Keep responses under 60 words, clinical and direct.
- Format: [THREAT: LEVEL] [ACTION: ONE SENTENCE] [REASON: ONE SENTENCE]
- THREAT levels: CRITICAL, HIGH, MEDIUM, LOW, CLEAR
- Be consistent with the threat score provided.`;

// ═══════════════════════════════════════════════════════════════
//  LLM DECISION BUILDER  — calls Ollama API
// ═══════════════════════════════════════════════════════════════
async function buildLLMDecision(payload, score, levelKey) {
  const { default: fetch } = await import('node-fetch');
  const { targets = [], lat, lon, temp, timestamp } = payload;

  const count   = targets.length;
  const maxConf = count
    ? Math.round(Math.max(...targets.map(t => t.confidence || 0)) * 100)
    : 0;
  const hour = new Date(timestamp || Date.now()).getHours();

  // ── Build the user prompt ───────────────────────────────────
  const userPrompt = `SENSOR REPORT:
- Timestamp: ${timestamp || new Date().toISOString()}
- Location: ${lat ? `${lat.toFixed(4)}, ${lon.toFixed(4)}` : 'GPS unavailable'}
- Temperature: ${temp || 'N/A'}°C
- Targets detected: ${count}
- Max detection confidence: ${maxConf}%
- Hour of day: ${hour}:00
- Computed threat score: ${score}/100
- Preliminary threat level: ${levelKey}
- Target labels: ${targets.map(t => t.label || 'HUMAN').join(', ') || 'none'}

Provide your operational assessment.`;

  const ctrl  = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), OLLAMA_CONFIG.timeout);

  try {
    const res = await fetch(`${OLLAMA_CONFIG.baseUrl}/api/generate`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      signal:  ctrl.signal,
      body: JSON.stringify({
        model:  OLLAMA_CONFIG.model,
        prompt: userPrompt,
        system: SYSTEM_PROMPT,
        stream: false,
        options: { temperature: 0.3, num_predict: 120 },
      }),
    });
    clearTimeout(timer);

    if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);

    const data = await res.json();
    return (data.response || '').trim();

  } catch (err) {
    clearTimeout(timer);
    // LLM timed out or errored — return null to trigger fallback
    console.log(`[AGENT] ⚠️  LLM call failed (${err.message}) — using rule-based decision.`);
    return null;
  }
}

// ═══════════════════════════════════════════════════════════════
//  MAIN DECISION ENTRY POINT
// ═══════════════════════════════════════════════════════════════
/**
 * Analyse a detection payload and return an AI decision object.
 *
 * @param {Object} payload
 *   - targets: [{label, confidence, bbox}]
 *   - lat, lon, temp, timestamp
 *   - sessionId: unique camera session ID
 * @returns {Promise<Object>} decision
 */
async function analyse(payload) {
  // ── Compute threat score + level ───────────────────────────
  const targets    = payload.targets || [];
  const score      = computeThreatScore({ ...payload, consecutiveFrameCount: 1 });
  const levelKey   = scoreToLevel(score);
  const level      = THREAT_LEVELS[levelKey];
  const count      = targets.length;
  const maxConf    = count
    ? Math.round(Math.max(...targets.map(t => t.confidence || 0)) * 100)
    : 0;

  // ── Base decision object ────────────────────────────────────
  const base = {
    id:               require('crypto').randomBytes(4).toString('hex').toUpperCase(),
    threatLevel:      levelKey,
    threatCode:       level.code,
    threatColor:      level.color,
    priority:         level.priority,
    score,
    targetCount:      count,
    maxConfidence:    maxConf,
    simulatedActions: pick(SIMULATED_ACTIONS[levelKey] || SIMULATED_ACTIONS.CLEAR),
    timestamp:        payload.timestamp || new Date().toISOString(),
    location: {
      lat:  payload.lat  || null,
      lon:  payload.lon  || null,
      temp: payload.temp || null,
    },
  };

  // ── Try Ollama LLM ─────────────────────────────────────────
  const useOllama = await probeOllama();

  if (useOllama && OLLAMA_CONFIG.enabled) {
    const llmText = await buildLLMDecision(payload, score, levelKey);
    if (llmText) {
      return {
        ...base,
        narrative:  llmText,
        agentMode:  `LLM (${OLLAMA_CONFIG.model})`,
      };
    }
    // LLM failed mid-session — disable for this session to save time
    OLLAMA_CONFIG.enabled = false;
    console.log('[AGENT] LLM disabled for this session. Rule-based fallback active.');
  }

  // ── Rule-based fallback ─────────────────────────────────────
  const fallback = buildRuleBasedDecision(payload);
  return { ...base, narrative: fallback.narrative, agentMode: 'RULE-BASED' };
}

// ═══════════════════════════════════════════════════════════════
//  DECISION LOG MANAGER
// ═══════════════════════════════════════════════════════════════
class DecisionLog {
  constructor(maxEntries = 200) {
    this.log      = [];
    this.maxEntries = maxEntries;
    this.stats    = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, CLEAR: 0, total: 0 };
  }

  push(decision) {
    this.log.unshift(decision);
    if (this.log.length > this.maxEntries) this.log.pop();
    this.stats[decision.threatLevel] = (this.stats[decision.threatLevel] || 0) + 1;
    this.stats.total++;
    return decision;
  }

  recent(n = 50) {
    return this.log.slice(0, n);
  }

  clear() {
    this.log   = [];
    this.stats = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0, CLEAR: 0, total: 0 };
  }

  getStats() {
    return { ...this.stats };
  }
}

// ═══════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = { analyse, DecisionLog, probeOllama, OLLAMA_CONFIG };
