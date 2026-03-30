/**
 * AXEROCAM v2.0 — Detection Engine (public/js/detection.js)
 *
 * Runs in browser. Handles:
 *   - Camera access (getUserMedia)
 *   - TF.js COCO-SSD inference (person detection)
 *   - Canvas HUD overlay (classified terminal style)
 *   - Frame + detection event emission to server via Socket.io
 *   - GPS via Geolocation API
 */

'use strict';

class AxeroCamEngine {
  constructor(opts = {}) {
    this.opts = {
      videoEl:           opts.videoEl,
      canvasEl:          opts.canvasEl,
      onDetection:       opts.onDetection   || (() => {}),
      onFrame:           opts.onFrame       || (() => {}),
      onStatus:          opts.onStatus      || (() => {}),
      onLog:             opts.onLog         || (() => {}),
      detectionInterval: opts.detectionInterval || 5,
      confidence:        opts.confidence        || 0.42,
      jpegQuality:       opts.jpegQuality        || 0.68,
    };

    this.model          = null;
    this.running        = false;
    this.stream         = null;
    this.animFrame      = null;
    this.frameCount     = 0;
    this.fps            = 0;
    this._fpsFrames     = 0;
    this._fpsTimer      = Date.now();
    this.lastDetections = [];
    this.gps            = { lat: null, lon: null };
    this.temp           = this._fakeTemp();
    this.tempTimer      = 0;
    this.detectorType   = 'TF.js COCO-SSD';
    this.currentThreat  = 'CLEAR';
    this.threatColor    = '#00e5ff';
  }

  _fakeTemp() {
    return (27 + Math.random() * 10 - 2).toFixed(1);
  }

  _log(level, msg) {
    console.log(`[AXEROCAM:${level.toUpperCase()}] ${msg}`);
    this.opts.onLog(level, msg);
  }

  // ── GPS ─────────────────────────────────────────────────────
  _initGPS() {
    if (!navigator.geolocation) {
      this._simGPS();
      return;
    }
    navigator.geolocation.watchPosition(
      (p) => {
        this.gps = {
          lat: parseFloat(p.coords.latitude.toFixed(6)),
          lon: parseFloat(p.coords.longitude.toFixed(6)),
        };
        this._log('ok', `GPS: ${this.gps.lat}, ${this.gps.lon}`);
      },
      () => this._simGPS(),
      { enableHighAccuracy: true, maximumAge: 6000, timeout: 8000 }
    );
  }

  _simGPS() {
    this.gps = { lat: 28.6139, lon: 77.2090 };
    this._log('warn', 'GPS unavailable — simulated position active.');
    setInterval(() => {
      this.gps.lat += (Math.random() - 0.5) * 0.00008;
      this.gps.lon += (Math.random() - 0.5) * 0.00008;
    }, 4000);
  }

  // ── Load TF.js model ────────────────────────────────────────
  async _loadModel() {
    this.opts.onStatus('LOADING COCO-SSD…');
    this._log('info', 'Loading TF.js COCO-SSD (lite_mobilenet_v2)…');
    try {
      if (typeof cocoSsd === 'undefined') throw new Error('cocoSsd not available');
      this.model = await cocoSsd.load({ base: 'lite_mobilenet_v2' });
      this.detectorType = 'TF.js COCO-SSD';
      this._log('ok', 'Model loaded.');
      this.opts.onStatus('MODEL READY');
    } catch (err) {
      this._log('warn', `COCO-SSD failed (${err.message}) — fallback mode.`);
      this.model = null;
      this.detectorType = 'PASSIVE (no model)';
      this.opts.onStatus('PASSIVE MODE');
    }
  }

  // ── Open camera ─────────────────────────────────────────────
  async _openCamera() {
    this.opts.onStatus('OPENING CAMERA…');
    this.stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' }, width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 15 } },
      audio: false,
    });
    this.opts.videoEl.srcObject = this.stream;
    await this.opts.videoEl.play();
    this._log('ok', 'Camera open.');
    this.opts.onStatus('LIVE');
  }

  // ── Inference ───────────────────────────────────────────────
  async _detect() {
    if (!this.model || !this.opts.videoEl || this.opts.videoEl.readyState < 2) return [];
    try {
      const preds = await this.model.detect(this.opts.videoEl);
      return preds
        .filter(p => p.class === 'person' && p.score >= this.opts.confidence)
        .map(p => ({ label: 'HUMAN', confidence: p.score, bbox: p.bbox }));
    } catch { return []; }
  }

  // ── Update threat color from server broadcast ────────────────
  setThreat(level, color) {
    this.currentThreat = level;
    this.threatColor   = color || '#00e5ff';
  }

  // ── HUD overlay ─────────────────────────────────────────────
  _drawHUD(ctx, dets, w, h) {
    ctx.clearRect(0, 0, w, h);

    const now = new Date();
    const ts  = now.toLocaleString('en-GB', { hour12: false }).replace(',', ' ·');
    const lat = this.gps.lat ? this.gps.lat.toFixed(5) : 'SIM';
    const lon = this.gps.lon ? this.gps.lon.toFixed(5) : 'SIM';

    // ── Bars ────────────────────────────────────────────────
    ctx.fillStyle = 'rgba(3,5,8,0.65)';
    ctx.fillRect(0, 0, w, 36);
    ctx.fillRect(0, h - 32, w, 32);

    // ── Threat border (color-coded) ─────────────────────────
    ctx.strokeStyle = this.threatColor;
    ctx.lineWidth   = 1.5;
    ctx.globalAlpha = dets.length > 0 ? 0.7 : 0.2;
    ctx.strokeRect(1, 1, w - 2, h - 2);
    ctx.globalAlpha = 1;

    // ── Corner brackets ─────────────────────────────────────
    const drawBracket = (ox, oy, flipX, flipY) => {
      const sz = 18;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(flipX, flipY);
      ctx.strokeStyle = this.threatColor;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(0, sz); ctx.lineTo(0, 0); ctx.lineTo(sz, 0);
      ctx.stroke();
      ctx.restore();
    };
    drawBracket(6, 6, 1, 1);
    drawBracket(w - 6, 6, -1, 1);
    drawBracket(6, h - 6, 1, -1);
    drawBracket(w - 6, h - 6, -1, -1);

    // ── Top bar ─────────────────────────────────────────────
    ctx.shadowColor = this.threatColor;
    ctx.shadowBlur  = 6;
    ctx.font        = '700 13px "VT323", monospace';
    ctx.fillStyle   = this.threatColor;
    ctx.textAlign   = 'left';
    ctx.fillText(`▲ AXEROCAM · ${this.currentThreat}`, 12, 23);

    ctx.shadowBlur  = 0;
    ctx.font        = '10px "IBM Plex Mono", monospace';
    ctx.fillStyle   = '#336688';
    ctx.textAlign   = 'center';
    ctx.fillText(ts, w / 2, 23);

    ctx.textAlign   = 'right';
    ctx.fillStyle   = '#224455';
    ctx.fillText(`FPS:${this.fps.toFixed(1)}`, w - 10, 23);

    // ── Bottom bar ───────────────────────────────────────────
    ctx.font        = '9px "IBM Plex Mono", monospace';
    ctx.fillStyle   = '#00b8cc';
    ctx.textAlign   = 'left';
    ctx.fillText(`LAT:${lat}  LON:${lon}`, 10, h - 10);

    ctx.textAlign   = 'right';
    const tColor    = dets.length > 0 ? '#ff4466' : '#33aa55';
    ctx.fillStyle   = tColor;
    ctx.fillText(`TGT:${dets.length}  ${this.temp}°C`, w - 10, h - 10);

    // ── Detection boxes ──────────────────────────────────────
    dets.forEach((det, i) => {
      const [bx, by, bw, bh] = det.bbox;
      const conf = Math.round(det.confidence * 100);

      // Outer box
      ctx.strokeStyle = conf >= 80 ? '#ff1744' : conf >= 60 ? '#ff6d00' : '#ffd600';
      ctx.lineWidth   = 1.5;
      ctx.shadowColor = ctx.strokeStyle;
      ctx.shadowBlur  = 6;
      ctx.strokeRect(bx, by, bw, bh);
      ctx.shadowBlur  = 0;

      // Corner accents
      const ca = 10;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth   = 2;
      [[bx, by, 1, 1], [bx+bw, by, -1, 1], [bx, by+bh, 1, -1], [bx+bw, by+bh, -1, -1]]
        .forEach(([cx, cy, dx, dy]) => {
          ctx.beginPath();
          ctx.moveTo(cx + dx*ca, cy); ctx.lineTo(cx, cy); ctx.lineTo(cx, cy + dy*ca);
          ctx.stroke();
        });

      // Label bar
      const lbl = `T${String(i+1).padStart(2,'0')} · HUMAN · ${conf}%`;
      ctx.font = '700 11px "VT323", monospace';
      const tw  = ctx.measureText(lbl).width;
      const py  = Math.max(by - 3, 15);
      ctx.fillStyle = conf >= 80 ? 'rgba(200,0,30,0.88)' : 'rgba(140,50,0,0.85)';
      ctx.fillRect(bx, py - 13, tw + 10, 16);
      ctx.fillStyle   = '#ffffff';
      ctx.textAlign   = 'left';
      ctx.fillText(lbl, bx + 5, py);

      // Crosshair dot
      ctx.fillStyle   = '#ff4444';
      ctx.beginPath();
      ctx.arc(bx + bw/2, by + bh/2, 3, 0, Math.PI*2);
      ctx.fill();
    });

    // ── Alert flash vignette ─────────────────────────────────
    if (window._axAlert) {
      ctx.strokeStyle = 'rgba(255,23,68,0.7)';
      ctx.lineWidth   = 3;
      ctx.strokeRect(2, 2, w-4, h-4);
      ctx.fillStyle   = 'rgba(255,0,30,0.05)';
      ctx.fillRect(0, 0, w, h);
    }
  }

  // ── Render loop ─────────────────────────────────────────────
  _loop() {
    if (!this.running) return;

    const video  = this.opts.videoEl;
    const canvas = this.opts.canvasEl;
    const ctx    = canvas.getContext('2d');
    const W      = canvas.width  = video.videoWidth  || 640;
    const H      = canvas.height = video.videoHeight || 480;

    ctx.drawImage(video, 0, 0, W, H);

    this.frameCount++;
    this._fpsFrames++;

    // FPS counter
    const now = Date.now();
    if (now - this._fpsTimer >= 1000) {
      this.fps         = this._fpsFrames / ((now - this._fpsTimer) / 1000);
      this._fpsFrames  = 0;
      this._fpsTimer   = now;
      this.temp        = this._fakeTemp();
    }

    // Inference every N frames
    if (this.frameCount % this.opts.detectionInterval === 0) {
      this._detect().then((dets) => {
        this.lastDetections = dets;
        if (dets.length > 0) {
          this.opts.onDetection({
            detections: dets,
            lat:        this.gps.lat,
            lon:        this.gps.lon,
            temp:       this.temp,
            timestamp:  new Date().toISOString(),
          });
        }
      });
    }

    this._drawHUD(ctx, this.lastDetections, W, H);

    // Relay frame to server every 6 frames
    if (this.frameCount % 6 === 0) {
      try {
        this.opts.onFrame({
          imageData: canvas.toDataURL('image/jpeg', this.opts.jpegQuality),
          fps:       this.fps,
        });
      } catch (e) {}
    }

    this.animFrame = requestAnimationFrame(() => this._loop());
  }

  async start() {
    if (this.running) return;
    this._initGPS();
    await this._loadModel();
    await this._openCamera();
    this.running    = true;
    this.frameCount = 0;
    this._loop();
  }

  stop() {
    this.running = false;
    if (this.animFrame) cancelAnimationFrame(this.animFrame);
    if (this.stream) { this.stream.getTracks().forEach(t => t.stop()); this.stream = null; }
    const ctx = this.opts.canvasEl.getContext('2d');
    ctx.clearRect(0, 0, this.opts.canvasEl.width, this.opts.canvasEl.height);
  }
}

window.AxeroCamEngine = AxeroCamEngine;
