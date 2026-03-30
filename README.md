# 🛡️ SENTINEL AI — Mobile Surveillance System

> A professional, portable AI-powered human detection & surveillance system.  
> Runs fully **offline** on Android via Termux. Flask dashboard. MJPEG stream.  
> Built by **AxeroAI · Kousik Debnath**

---

## 📸 Features

| Feature | Details |
|---|---|
| 🎯 Human Detection | OpenCV HOG (default) or YOLOv5/v8 (optional) |
| 🖥️ Live MJPEG Feed | Stream with tactical HUD overlay |
| 📍 GPS Logging | Simulated by default; real GPS via Termux API |
| 🌡️ Temperature | Simulated; real via `/sys/class/thermal/` |
| 🌐 Dual URL | Feed URL + Full dashboard URL |
| ⚠️ Alert Mode | Red overlay + pulsing alert on all panels |
| 📸 Snapshots | Saved to `snapshots/` folder |
| 📋 Detection Log | Timestamped records with confidence scores |
| 📴 Fully Offline | No internet required after install |

---

## 📱 Quick Start (Termux on Android)

### Step 1 — Install Termux
1. Install **Termux** from [F-Droid](https://f-droid.org/packages/com.termux/) (recommended over Play Store)
2. Open Termux

### Step 2 — Setup Environment

```bash
# Update packages
pkg update && pkg upgrade -y

# Install Python and dependencies
pkg install python python-pip git libopencv -y

# Install camera support (required for OpenCV VideoCapture)
pkg install termux-api -y
```

### Step 3 — Clone the Repository

```bash
git clone https://github.com/YOUR_USERNAME/sentinel-ai.git
cd sentinel-ai
```

### Step 4 — Install Python Dependencies

```bash
pip install -r requirements.txt
```

> ⏱️ This may take 2–5 minutes on mobile. OpenCV headless is ~20MB.

### Step 5 — Run the System

```bash
python main.py
```

---

## 🌐 Access the Dashboard

Once running, open your **mobile browser** and go to:

| URL | Purpose |
|---|---|
| `http://localhost:5000/` | 📡 Live camera feed only |
| `http://localhost:5000/dashboard` | 🖥️ Full command dashboard |

> To access from another device on the same Wi-Fi:  
> Use `http://<your-phone-IP>:5000/dashboard`  
> Find your IP with: `ifconfig` or `ip addr`

---

## 🔧 Configuration

Edit `main.py` → `CONFIG` block at the top:

```python
CONFIG = {
    "camera_index": 0,          # 0 = rear camera, 1 = front
    "frame_width": 640,         # Lower for better performance
    "frame_height": 480,
    "jpeg_quality": 70,         # 50-85 recommended on mobile
    "detection_interval": 3,    # Run AI every N frames
    "confidence_threshold": 0.45,
    "port": 5000,
}
```

---

## 🤖 Enabling YOLOv5 (Optional — Better Accuracy)

```bash
# Install PyTorch CPU-only (lighter)
pip install torch --index-url https://download.pytorch.org/whl/cpu

# Install ultralytics
pip install ultralytics
```

Then uncomment in `requirements.txt`:
```
ultralytics>=8.0.0
```

The first run will auto-download `yolov5su.pt` (~6MB). YOLO will automatically be used instead of HOG.

---

## 📍 Real GPS (Termux API)

1. Install **Termux:API** app from F-Droid
2. In Termux: `pkg install termux-api`
3. In `main.py`, replace the `GPSProvider.get()` method:

```python
import subprocess, json

def get(self):
    result = subprocess.run(
        ['termux-location', '-p', 'gps', '-r', 'once'],
        capture_output=True, text=True, timeout=10
    )
    d = json.loads(result.stdout)
    return d['latitude'], d['longitude']
```

---

## 🌡️ Real Temperature Sensor

Replace `get_temperature()` in `main.py`:

```python
def get_temperature():
    try:
        with open('/sys/class/thermal/thermal_zone0/temp') as f:
            return round(int(f.read()) / 1000, 1)
    except:
        return 28.0  # fallback
```

---

## 📁 Project Structure

```
sentinel-ai/
├── main.py                 # Core engine: Flask + OpenCV + detection
├── requirements.txt        # Python dependencies
├── README.md               # This file
├── templates/
│   ├── feed.html           # URL 1 — Live camera feed page
│   └── dashboard.html      # URL 2 — Full command dashboard
├── static/                 # (Empty — all CSS/JS inline)
└── snapshots/              # Auto-created; stores .jpg snapshots
```

---

## 🚀 Roadmap / Extensions

- [ ] Multi-camera support (USB OTG / IP cameras)
- [ ] Drone feed integration (RTSP stream)
- [ ] IoT sensor overlay (PIR, ultrasonic)
- [ ] Email/SMS alert via Termux notifications
- [ ] Night vision mode (IR filter toggle)
- [ ] Recording to `.mp4` file
- [ ] Cloud sync for detection logs

---

## ⚖️ License & Usage

This software is provided for **educational, research, and personal security** purposes only.  
Use responsibly and in compliance with local laws and privacy regulations.

---

*Built with ❤️ by AxeroAI — Kousik Debnath*
