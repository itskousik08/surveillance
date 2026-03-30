"""
╔══════════════════════════════════════════════════════════════╗
║         SENTINEL AI — MOBILE SURVEILLANCE SYSTEM            ║
║         Built for Termux / Android / Offline Use            ║
║         Author: AxeroAI · Kousik Debnath                    ║
╚══════════════════════════════════════════════════════════════╝

Endpoints:
  http://localhost:5000/         → Live camera feed (URL 1)
  http://localhost:5000/dashboard → Full dashboard + controls (URL 2)
"""

import cv2
import threading
import time
import datetime
import random
import base64
import json
import os
import logging
from flask import Flask, Response, render_template, jsonify, request, send_from_directory

# ─── Suppress noisy logs ──────────────────────────────────────
log = logging.getLogger("werkzeug")
log.setLevel(logging.ERROR)

# ─── Try importing ultralytics (YOLOv5/v8); fall back to HOG ──
YOLO_AVAILABLE = False
try:
    from ultralytics import YOLO
    YOLO_AVAILABLE = True
    print("[SENTINEL] ✅ YOLOv5/v8 (ultralytics) loaded.")
except ImportError:
    print("[SENTINEL] ⚠️  ultralytics not found — using OpenCV HOG detector.")

# ═══════════════════════════════════════════════════════════════
#  CONFIGURATION
# ═══════════════════════════════════════════════════════════════
CONFIG = {
    "host": "0.0.0.0",
    "port": 5000,
    "camera_index": 0,          # 0 = rear camera; 1 = front (device-dependent)
    "frame_width": 640,
    "frame_height": 480,
    "jpeg_quality": 70,         # Lower = faster on mobile
    "detection_interval": 3,    # Run detection every N frames (saves CPU)
    "confidence_threshold": 0.45,
    "max_detection_records": 100,
    "snapshot_dir": "snapshots",
    "model_path": "yolov5su.pt", # Will auto-download on first run if YOLO available
}

os.makedirs(CONFIG["snapshot_dir"], exist_ok=True)

# ═══════════════════════════════════════════════════════════════
#  GLOBAL STATE
# ═══════════════════════════════════════════════════════════════
state = {
    "camera_active": False,
    "alert_active": False,
    "total_detections": 0,
    "fps": 0.0,
    "current_frame_b64": None,
    "detection_records": [],    # list of dicts
    "last_snapshot_path": None,
}

frame_lock   = threading.Lock()
camera_lock  = threading.Lock()
camera_thread_ref = None

# ═══════════════════════════════════════════════════════════════
#  GPS MOCK  (replace with gpsd / termux-location in production)
# ═══════════════════════════════════════════════════════════════
class GPSProvider:
    """
    Simulates GPS jitter around a fixed base coordinate.
    To use real GPS in Termux:
      termux-location | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['latitude'], d['longitude'])"
    """
    def __init__(self):
        self.base_lat  = 28.6139   # Default: New Delhi
        self.base_lon  = 77.2090
        self._lat = self.base_lat
        self._lon = self.base_lon

    def get(self):
        # Add tiny drift to simulate movement
        self._lat += random.uniform(-0.00005, 0.00005)
        self._lon += random.uniform(-0.00005, 0.00005)
        return round(self._lat, 6), round(self._lon, 6)

gps = GPSProvider()

# ═══════════════════════════════════════════════════════════════
#  TEMPERATURE MOCK
# ═══════════════════════════════════════════════════════════════
def get_temperature():
    """
    Simulated ambient temperature with realistic variation.
    Replace with: open('/sys/class/thermal/thermal_zone0/temp').read()
    """
    return round(28.0 + random.uniform(-3, 5), 1)

# ═══════════════════════════════════════════════════════════════
#  HUMAN DETECTOR
# ═══════════════════════════════════════════════════════════════
class HumanDetector:
    def __init__(self):
        self.model = None
        self.hog   = None
        self._init_detector()

    def _init_detector(self):
        if YOLO_AVAILABLE:
            try:
                self.model = YOLO(CONFIG["model_path"])
                print(f"[SENTINEL] ✅ YOLO model ready: {CONFIG['model_path']}")
            except Exception as e:
                print(f"[SENTINEL] ⚠️  YOLO load error ({e}). Falling back to HOG.")
                self._init_hog()
        else:
            self._init_hog()

    def _init_hog(self):
        self.hog = cv2.HOGDescriptor()
        self.hog.setSVMDetector(cv2.HOGDescriptor_getDefaultPeopleDetector())
        print("[SENTINEL] ✅ OpenCV HOG people detector ready.")

    def detect(self, frame):
        """
        Returns: list of (x1, y1, x2, y2, confidence, label)
        """
        detections = []

        if self.model is not None:
            # ── YOLO inference ──────────────────────────────
            results = self.model(frame, verbose=False, conf=CONFIG["confidence_threshold"])
            for r in results:
                for box in r.boxes:
                    cls  = int(box.cls[0])
                    name = r.names[cls]
                    if name == "person":
                        conf = float(box.conf[0])
                        x1, y1, x2, y2 = map(int, box.xyxy[0])
                        detections.append((x1, y1, x2, y2, conf, "HUMAN"))

        elif self.hog is not None:
            # ── HOG inference ───────────────────────────────
            gray    = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            rects, weights = self.hog.detectMultiScale(
                gray, winStride=(8, 8), padding=(4, 4), scale=1.05
            )
            for i, (x, y, w, h) in enumerate(rects):
                conf = float(weights[i]) if i < len(weights) else 0.6
                if conf >= CONFIG["confidence_threshold"]:
                    detections.append((x, y, x + w, y + h, min(conf, 1.0), "HUMAN"))

        return detections


detector = HumanDetector()

# ═══════════════════════════════════════════════════════════════
#  FRAME OVERLAYER
# ═══════════════════════════════════════════════════════════════
def draw_overlay(frame, detections, fps, temp, lat, lon):
    """Draw all tactical overlay elements onto the frame."""
    h, w = frame.shape[:2]
    now  = datetime.datetime.now()

    # ── Semi-transparent HUD background bars ────────────────
    overlay = frame.copy()
    cv2.rectangle(overlay, (0, 0), (w, 36), (0, 0, 0), -1)
    cv2.rectangle(overlay, (0, h - 36), (w, h), (0, 0, 0), -1)
    cv2.addWeighted(overlay, 0.55, frame, 0.45, 0, frame)

    # ── Corner brackets (tactical look) ─────────────────────
    br_len, br_t = 22, 2
    color_bracket = (0, 230, 120)
    # Top-left
    cv2.line(frame, (10, 10), (10 + br_len, 10), color_bracket, br_t)
    cv2.line(frame, (10, 10), (10, 10 + br_len), color_bracket, br_t)
    # Top-right
    cv2.line(frame, (w - 10, 10), (w - 10 - br_len, 10), color_bracket, br_t)
    cv2.line(frame, (w - 10, 10), (w - 10, 10 + br_len), color_bracket, br_t)
    # Bottom-left
    cv2.line(frame, (10, h - 10), (10 + br_len, h - 10), color_bracket, br_t)
    cv2.line(frame, (10, h - 10), (10, h - 10 - br_len), color_bracket, br_t)
    # Bottom-right
    cv2.line(frame, (w - 10, h - 10), (w - 10 - br_len, h - 10), color_bracket, br_t)
    cv2.line(frame, (w - 10, h - 10), (w - 10, h - 10 - br_len), color_bracket, br_t)

    # ── Top bar: SENTINEL label + timestamp ─────────────────
    ts_str = now.strftime("%Y-%m-%d  %H:%M:%S")
    cv2.putText(frame, "● SENTINEL AI", (14, 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 230, 120), 1, cv2.LINE_AA)
    cv2.putText(frame, ts_str, (w // 2 - 90, 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, (200, 200, 200), 1, cv2.LINE_AA)
    cv2.putText(frame, f"FPS:{fps:.1f}", (w - 80, 24),
                cv2.FONT_HERSHEY_SIMPLEX, 0.50, (180, 180, 180), 1, cv2.LINE_AA)

    # ── Bottom bar: GPS + temp + status ─────────────────────
    gps_str  = f"GPS {lat:.5f}, {lon:.5f}"
    temp_str = f"{temp}°C"
    det_str  = f"TARGETS:{len(detections)}"
    cv2.putText(frame, gps_str, (14, h - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (100, 210, 255), 1, cv2.LINE_AA)
    cv2.putText(frame, temp_str, (w // 2 - 28, h - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, (100, 210, 255), 1, cv2.LINE_AA)
    status_color = (0, 80, 255) if len(detections) > 0 else (0, 200, 60)
    cv2.putText(frame, det_str, (w - 95, h - 12),
                cv2.FONT_HERSHEY_SIMPLEX, 0.42, status_color, 1, cv2.LINE_AA)

    # ── Detection bounding boxes ─────────────────────────────
    for idx, (x1, y1, x2, y2, conf, label) in enumerate(detections):
        # Box color: red when alert, else green
        box_color = (0, 50, 255) if state["alert_active"] else (0, 220, 80)

        # Outer box
        cv2.rectangle(frame, (x1, y1), (x2, y2), box_color, 2)

        # Corner accents on box
        ca = 10
        cv2.line(frame, (x1, y1), (x1 + ca, y1), (255, 255, 255), 2)
        cv2.line(frame, (x1, y1), (x1, y1 + ca), (255, 255, 255), 2)
        cv2.line(frame, (x2, y1), (x2 - ca, y1), (255, 255, 255), 2)
        cv2.line(frame, (x2, y1), (x2, y1 + ca), (255, 255, 255), 2)
        cv2.line(frame, (x1, y2), (x1 + ca, y2), (255, 255, 255), 2)
        cv2.line(frame, (x1, y2), (x1, y2 - ca), (255, 255, 255), 2)
        cv2.line(frame, (x2, y2), (x2 - ca, y2), (255, 255, 255), 2)
        cv2.line(frame, (x2, y2), (x2, y2 - ca), (255, 255, 255), 2)

        # Label pill
        label_text = f"{label} {conf:.0%}"
        (lw, lh), _ = cv2.getTextSize(label_text, cv2.FONT_HERSHEY_SIMPLEX, 0.50, 1)
        pill_y = max(y1 - 4, lh + 6)
        cv2.rectangle(frame, (x1, pill_y - lh - 6), (x1 + lw + 10, pill_y + 2), box_color, -1)
        cv2.putText(frame, label_text, (x1 + 5, pill_y - 3),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.50, (255, 255, 255), 1, cv2.LINE_AA)

        # ID badge
        cv2.putText(frame, f"T{idx+1:02d}", (x1 + 4, y2 - 6),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.38, (200, 200, 200), 1, cv2.LINE_AA)

    # ── Alert overlay flash ─────────────────────────────────
    if state["alert_active"]:
        alert_overlay = frame.copy()
        cv2.rectangle(alert_overlay, (0, 0), (w, h), (0, 0, 180), -1)
        cv2.addWeighted(alert_overlay, 0.08, frame, 0.92, 0, frame)
        cv2.putText(frame, "⚠ ALERT ACTIVE", (w // 2 - 95, h // 2),
                    cv2.FONT_HERSHEY_SIMPLEX, 0.85, (0, 50, 255), 2, cv2.LINE_AA)

    return frame

# ═══════════════════════════════════════════════════════════════
#  CAMERA CAPTURE LOOP
# ═══════════════════════════════════════════════════════════════
def camera_loop():
    """Runs in a background thread. Captures, detects, encodes frames."""
    cap = cv2.VideoCapture(CONFIG["camera_index"])
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,  CONFIG["frame_width"])
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT, CONFIG["frame_height"])
    cap.set(cv2.CAP_PROP_FPS, 15)

    if not cap.isOpened():
        print("[SENTINEL] ❌ Could not open camera. Is it connected?")
        state["camera_active"] = False
        return

    print(f"[SENTINEL] 📷 Camera opened (index={CONFIG['camera_index']})")

    frame_count = 0
    fps_timer   = time.time()
    cached_detections = []

    while state["camera_active"]:
        ret, frame = cap.read()
        if not ret:
            print("[SENTINEL] ⚠️  Frame read failed — retrying...")
            time.sleep(0.1)
            continue

        frame_count += 1

        # ── FPS calculation ──────────────────────────────────
        elapsed = time.time() - fps_timer
        if elapsed >= 1.0:
            state["fps"] = frame_count / elapsed
            frame_count  = 0
            fps_timer    = time.time()

        # ── Run detection every N frames to save CPU ─────────
        if frame_count % CONFIG["detection_interval"] == 0:
            cached_detections = detector.detect(frame)
            if cached_detections:
                state["total_detections"] += len(cached_detections)
                lat, lon = gps.get()
                temp = get_temperature()
                now  = datetime.datetime.now().isoformat()
                for det in cached_detections:
                    record = {
                        "id": len(state["detection_records"]) + 1,
                        "label": det[5],
                        "confidence": round(det[4] * 100, 1),
                        "timestamp": now,
                        "lat": lat,
                        "lon": lon,
                        "temp": temp,
                    }
                    state["detection_records"].insert(0, record)
                    # Cap the log
                    if len(state["detection_records"]) > CONFIG["max_detection_records"]:
                        state["detection_records"].pop()

        # ── Draw overlay ─────────────────────────────────────
        lat, lon = gps.get()
        temp = get_temperature()
        frame = draw_overlay(frame, cached_detections, state["fps"], temp, lat, lon)

        # ── Encode to JPEG ───────────────────────────────────
        encode_param = [int(cv2.IMWRITE_JPEG_QUALITY), CONFIG["jpeg_quality"]]
        ret2, buffer = cv2.imencode(".jpg", frame, encode_param)
        if ret2:
            with frame_lock:
                state["current_frame_b64"] = base64.b64encode(buffer).decode("utf-8")

        time.sleep(0.001)   # yield

    cap.release()
    print("[SENTINEL] 📷 Camera released.")

# ═══════════════════════════════════════════════════════════════
#  FLASK APP
# ═══════════════════════════════════════════════════════════════
app = Flask(__name__, template_folder="templates", static_folder="static")

def gen_mjpeg():
    """MJPEG generator for /video_feed streaming endpoint."""
    while state["camera_active"]:
        with frame_lock:
            b64 = state.get("current_frame_b64")
        if b64:
            frame_bytes = base64.b64decode(b64)
            yield (
                b"--frame\r\n"
                b"Content-Type: image/jpeg\r\n\r\n" + frame_bytes + b"\r\n"
            )
        time.sleep(0.04)   # ~25 fps max on stream


# ── URL 1: Live camera feed page ────────────────────────────
@app.route("/")
def feed_page():
    return render_template("feed.html")

# ── URL 2: Full dashboard ────────────────────────────────────
@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")

# ── MJPEG stream endpoint ────────────────────────────────────
@app.route("/video_feed")
def video_feed():
    return Response(
        gen_mjpeg(),
        mimetype="multipart/x-mixed-replace; boundary=frame"
    )

# ── API: System status ───────────────────────────────────────
@app.route("/api/status")
def api_status():
    lat, lon = gps.get()
    return jsonify({
        "camera_active":    state["camera_active"],
        "alert_active":     state["alert_active"],
        "fps":              round(state["fps"], 1),
        "total_detections": state["total_detections"],
        "temperature":      get_temperature(),
        "lat":              lat,
        "lon":              lon,
        "timestamp":        datetime.datetime.now().isoformat(),
        "detector_type":    "YOLO" if YOLO_AVAILABLE and detector.model else "HOG",
    })

# ── API: Detection records ───────────────────────────────────
@app.route("/api/detections")
def api_detections():
    return jsonify(state["detection_records"][:50])

# ── API: Control — camera start/stop ────────────────────────
@app.route("/api/control/camera", methods=["POST"])
def control_camera():
    global camera_thread_ref
    action = request.json.get("action")

    if action == "start" and not state["camera_active"]:
        state["camera_active"] = True
        camera_thread_ref = threading.Thread(target=camera_loop, daemon=True)
        camera_thread_ref.start()
        return jsonify({"status": "started"})

    elif action == "stop" and state["camera_active"]:
        state["camera_active"] = False
        return jsonify({"status": "stopped"})

    return jsonify({"status": "no_change"})

# ── API: Control — alert toggle ──────────────────────────────
@app.route("/api/control/alert", methods=["POST"])
def control_alert():
    action = request.json.get("action")
    if action == "on":
        state["alert_active"] = True
    elif action == "off":
        state["alert_active"] = False
    return jsonify({"alert_active": state["alert_active"]})

# ── API: Snapshot ────────────────────────────────────────────
@app.route("/api/snapshot", methods=["POST"])
def take_snapshot():
    with frame_lock:
        b64 = state.get("current_frame_b64")

    if not b64:
        return jsonify({"error": "No frame available"}), 400

    filename  = f"snapshot_{datetime.datetime.now().strftime('%Y%m%d_%H%M%S')}.jpg"
    filepath  = os.path.join(CONFIG["snapshot_dir"], filename)
    img_bytes = base64.b64decode(b64)
    with open(filepath, "wb") as f:
        f.write(img_bytes)

    state["last_snapshot_path"] = filepath
    print(f"[SENTINEL] 📸 Snapshot saved: {filepath}")
    return jsonify({"status": "saved", "file": filename})

# ── API: Clear detection log ─────────────────────────────────
@app.route("/api/detections/clear", methods=["POST"])
def clear_detections():
    state["detection_records"].clear()
    state["total_detections"] = 0
    return jsonify({"status": "cleared"})

# ── Serve snapshots ──────────────────────────────────────────
@app.route("/snapshots/<filename>")
def serve_snapshot(filename):
    return send_from_directory(CONFIG["snapshot_dir"], filename)

# ═══════════════════════════════════════════════════════════════
#  ENTRY POINT
# ═══════════════════════════════════════════════════════════════
if __name__ == "__main__":
    print("""
╔══════════════════════════════════════════════════════╗
║        SENTINEL AI — SURVEILLANCE SYSTEM             ║
╠══════════════════════════════════════════════════════╣
║  📡  URL 1 (Feed)     → http://localhost:5000/       ║
║  🖥   URL 2 (Dashboard)→ http://localhost:5000/dashboard ║
╚══════════════════════════════════════════════════════╝
    """)

    # Auto-start camera on launch
    state["camera_active"] = True
    camera_thread_ref = threading.Thread(target=camera_loop, daemon=True)
    camera_thread_ref.start()

    app.run(
        host=CONFIG["host"],
        port=CONFIG["port"],
        debug=False,
        threaded=True,
        use_reloader=False,
    )
