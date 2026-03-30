/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║  AXEROCAM · THREAT MODEL ENGINE                             ║
 * ║  File: agent/threat-model.js                                ║
 * ║  Purpose: Threat scoring, classification, and action rules  ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * This module provides the deterministic threat-scoring backbone
 * used both as standalone logic and as context for the LLM agent.
 * ALL decisions are SIMULATED — no real-world actions are taken.
 */

'use strict';

// ═══════════════════════════════════════════════════════════════
//  THREAT LEVEL CONSTANTS
// ═══════════════════════════════════════════════════════════════
const THREAT_LEVELS = {
  CRITICAL: { code: 5, label: 'CRITICAL', color: '#ff0033', priority: 'IMMEDIATE' },
  HIGH:     { code: 4, label: 'HIGH',     color: '#ff6600', priority: 'URGENT'    },
  MEDIUM:   { code: 3, label: 'MEDIUM',   color: '#ffcc00', priority: 'ELEVATED'  },
  LOW:      { code: 2, label: 'LOW',      color: '#88ff44', priority: 'MONITOR'   },
  CLEAR:    { code: 1, label: 'CLEAR',    color: '#00e5ff', priority: 'NONE'      },
};

// ═══════════════════════════════════════════════════════════════
//  SIMULATED ACTION CATALOGUE
//  (No real-world effects — all simulation/logging only)
// ═══════════════════════════════════════════════════════════════
const SIMULATED_ACTIONS = {
  CRITICAL: [
    '[SIM] Transmit PRIORITY ALERT to base station.',
    '[SIM] Lock sector perimeter — grid reference logged.',
    '[SIM] Activate secondary surveillance units.',
    '[SIM] Dispatch rapid-response notification to command.',
    '[SIM] Initiate full-spectrum recording protocol.',
  ],
  HIGH: [
    '[SIM] Escalate watch status to HIGH ALERT.',
    '[SIM] Flag anomaly for immediate operator review.',
    '[SIM] Begin extended motion capture window.',
    '[SIM] Synchronize event data with base log.',
  ],
  MEDIUM: [
    '[SIM] Continue enhanced monitoring.',
    '[SIM] Tag location for subsequent patrol review.',
    '[SIM] Increase detection sensitivity by 15%.',
  ],
  LOW: [
    '[SIM] Log event. Continue passive watch.',
    '[SIM] Append to daily activity summary.',
  ],
  CLEAR: [
    '[SIM] Area assessed CLEAR. Standby mode active.',
  ],
};

// ═══════════════════════════════════════════════════════════════
//  DECISION NARRATIVE TEMPLATES
//  Used when Ollama LLM is unavailable (rule-based fallback)
// ═══════════════════════════════════════════════════════════════
const NARRATIVES = {
  CRITICAL: [
    'Multiple high-confidence personnel detected. Threat assessment: CRITICAL. Immediate escalation protocols initiated.',
    'Dense target cluster confirmed. Behavior pattern suggests coordinated movement. Threat elevated to CRITICAL.',
    'High-velocity target acquisition. Confidence exceeds operational threshold. CRITICAL threat designation applied.',
  ],
  HIGH: [
    'Single high-confidence target detected in restricted observation zone. Initiating elevated monitoring.',
    'Persistent target detected over multiple consecutive frames. Pattern classified HIGH threat.',
    'Target confidence exceeds 85%. Location logged. HIGH threat status assigned pending operator confirmation.',
  ],
  MEDIUM: [
    'Target detected with moderate confidence. Classification: MEDIUM threat. Extended monitoring initiated.',
    'Intermittent target signature observed. Insufficient data for HIGH classification. Tagging for review.',
    'Low-density target acquisition. Environmental factors noted. MEDIUM threat assessment recorded.',
  ],
  LOW: [
    'Target detected below confidence threshold for escalation. LOW threat logged. Passive watch continues.',
    'Transient target signature. Duration insufficient for pattern analysis. LOW priority entry added.',
  ],
  CLEAR: [
    'No targets detected within observation field. Area status: CLEAR. System in passive standby.',
    'Frame analysis complete. Zero anomalies identified. Confidence in CLEAR status: HIGH.',
  ],
};

// ═══════════════════════════════════════════════════════════════
//  SCORING ENGINE
// ═══════════════════════════════════════════════════════════════

/**
 * Compute a raw threat score (0-100) from a detection payload.
 *
 * Factors:
 *   - Person count (0-40 pts): more targets = higher score
 *   - Max confidence (0-30 pts): high-confidence detection scores more
 *   - Avg confidence (0-15 pts): weighted average of all detections
 *   - Time-of-day penalty (0-10 pts): night-time boosts score
 *   - Detection persistence (0-5 pts): target appearing in consecutive frames
 *
 * @param {Object} payload - { targets, consecutiveFrameCount, timestamp }
 * @returns {number} score 0-100
 */
function computeThreatScore(payload) {
  const { targets = [], consecutiveFrameCount = 0, timestamp } = payload;

  if (!targets.length) return 0;

  // ── Person count factor ─────────────────────────────────────
  const personCount = targets.filter(t =>
    t.label === 'HUMAN' || t.class === 'person'
  ).length;
  const countScore = Math.min(personCount * 12, 40);

  // ── Max confidence factor ───────────────────────────────────
  const confidences = targets.map(t => t.confidence || 0);
  const maxConf     = Math.max(...confidences);
  const maxConfScore = maxConf * 30;

  // ── Average confidence factor ───────────────────────────────
  const avgConf     = confidences.reduce((a, b) => a + b, 0) / confidences.length;
  const avgConfScore = avgConf * 15;

  // ── Time-of-day factor ──────────────────────────────────────
  const ts   = timestamp ? new Date(timestamp) : new Date();
  const hour = ts.getHours();
  // Night hours (22:00–05:00) add up to 10 points
  const isNight  = hour >= 22 || hour <= 5;
  const timeScore = isNight ? 10 : hour >= 18 ? 5 : 0;

  // ── Persistence factor ──────────────────────────────────────
  const persistScore = Math.min(consecutiveFrameCount * 1.5, 5);

  const raw = countScore + maxConfScore + avgConfScore + timeScore + persistScore;
  return Math.min(Math.round(raw), 100);
}

/**
 * Map a numeric score to a threat level key.
 *
 * @param {number} score 0-100
 * @returns {string} key from THREAT_LEVELS
 */
function scoreToLevel(score) {
  if (score >= 80) return 'CRITICAL';
  if (score >= 60) return 'HIGH';
  if (score >= 35) return 'MEDIUM';
  if (score >= 10) return 'LOW';
  return 'CLEAR';
}

/**
 * Pick a random element from an array (for varied narrative output).
 */
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Build a full rule-based decision object without an LLM.
 *
 * @param {Object} payload
 * @returns {Object} decision
 */
function buildRuleBasedDecision(payload) {
  const score    = computeThreatScore(payload);
  const levelKey = scoreToLevel(score);
  const level    = THREAT_LEVELS[levelKey];
  const targets  = payload.targets || [];
  const count    = targets.length;
  const maxConf  = count ? Math.round(Math.max(...targets.map(t => t.confidence || 0)) * 100) : 0;

  return {
    threatLevel:      levelKey,
    threatCode:       level.code,
    threatColor:      level.color,
    priority:         level.priority,
    score,
    targetCount:      count,
    maxConfidence:    maxConf,
    narrative:        pick(NARRATIVES[levelKey] || NARRATIVES.CLEAR),
    simulatedActions: pick(SIMULATED_ACTIONS[levelKey] || SIMULATED_ACTIONS.CLEAR),
    agentMode:        'RULE-BASED',
    timestamp:        new Date().toISOString(),
  };
}

// ═══════════════════════════════════════════════════════════════
//  EXPORTS
// ═══════════════════════════════════════════════════════════════
module.exports = {
  THREAT_LEVELS,
  SIMULATED_ACTIONS,
  NARRATIVES,
  computeThreatScore,
  scoreToLevel,
  buildRuleBasedDecision,
  pick,
};
