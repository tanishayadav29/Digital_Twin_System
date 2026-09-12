# UAV Engine Digital Twin — Dashboard

React + Vite frontend.

- **Tab 1 — Live telemetry:** live gauges for all 10 engine sensors, a 2-minute strip chart
  under each gauge, and the anomaly alert panel fed by the backend's Isolation Forest detector
  (plus a manual test trigger).
- **Tab 2 — Engine trends:** a live line chart per parameter (2 / 5 / 15 min window, hover
  one chart to read all of them at that moment, pause) and relationship charts — CHT vs RPM,
  EGT vs RPM, Vibration vs RPM, Oil pressure vs RPM and CHT vs EGT — each showing the normal
  operating envelope, the latest reading's trail and a correlation score. A readings table
  sits underneath.
- **Tab 3 — Engine simulation:** a blueprint-style cutaway of the engine. Every part is labelled
  with a health percentage worked out from its sensors, how far they sit from the value the model
  expects, and any active fault; parts turn amber or red as they degrade, and clicking one shows the
  readings behind it.
- **Tab 4 — Maintenance advisory:** one advisory per fault the engine has raised — what causes it,
  what to do while it is happening, what to inspect on the ground, and preventive tasks with
  intervals. Built from `GET /fault-summary` (every recorded fault event) plus this session's alerts,
  and ending with a combined preventive schedule. Advisories can be marked as actioned.

## How the data flows

```
sensor_simulator.py ──POST /sensor-data──▶ FastAPI (main.py) ──▶ Postgres
                                              │
                                     ML/fault_detector.py
                                              │
                                              └─ broadcast ──▶ WS /ws/telemetry
                                                                   │
                         browser ◀── Vite dev server proxy (/ws, /api) ◀┘
```

- The dashboard opens **one WebSocket** (`/ws/telemetry`) and every reading the simulator posts
  is pushed to it instantly.
- On load it also fetches up to 500 recent readings from `GET /sensor-history`, so the trend
  charts start with history instead of an empty screen. The browser keeps the last 15 minutes.
- If the WebSocket drops, it **falls back to polling** `GET /latest-sensor-data` every second
  and keeps retrying the socket every 5 s, so the gauges don't freeze.
- The Vite dev server proxies `/ws/*` and `/api/*` to `http://127.0.0.1:8000`, so the backend
  needs no CORS setup.

## Quick look without the backend

```bash
cd uav_digital_twin/frontend
npm install
npm run dev
```

Open http://localhost:5173 and click **Simulated** (top right). It runs a browser copy of
`sensor_simulator.py` (`src/lib/simulator.js`) with the same engine model and fault episodes.
There's no ML detector in this mode, so no alerts.

## Run it with the backend

You need Node 20.19+ (or 22.12+), Python 3 and PostgreSQL.

### One-time setup

1. Create the database (Windows path shown; on macOS just use `psql`):

   ```powershell
   & "C:\Program Files\PostgreSQL\18\bin\psql.exe" -U postgres -c "CREATE DATABASE uav_digital_twin;"
   ```

2. Create `uav_digital_twin/.env` (it's git-ignored):

   ```
   DATABASE_URL=postgresql+psycopg2://postgres:YOUR_PASSWORD@localhost:5432/uav_digital_twin
   ```

3. Create a Python environment and the tables. The `venv/` folder committed to the repo was
   built on macOS and won't run on Windows, so make a fresh `.venv`:

   ```powershell
   cd uav_digital_twin
   python -m venv .venv
   .\.venv\Scripts\Activate.ps1        # macOS/Linux: source .venv/bin/activate
   pip install -r requirements.txt
   python -c "from database import engine; from models import Base; Base.metadata.create_all(engine)"
   ```

   If PowerShell refuses to run `Activate.ps1`, run
   `Set-ExecutionPolicy -Scope Process Bypass` first.

### Every time: three terminals

| # | Where | Command |
|---|-------|---------|
| 1 — backend | `uav_digital_twin` (venv active) | `uvicorn main:app --reload --port 8000` |
| 2 — engine simulator | `uav_digital_twin` (venv active) | `python sensor_simulator.py` |
| 3 — dashboard | `uav_digital_twin/frontend` | `npm run dev` |

Open http://localhost:5173 with **Backend** selected. The badge at the top right should read
**Live · WebSocket stream** and the needles should move once a second.

### What the simulator does

`sensor_simulator.py` behaves like a running engine rather than random numbers:

- **Sensors move together.** Fuel flow, EGT, CHT, oil temperature and oil pressure follow RPM,
  and CHT / oil temperature heat up and cool down gradually.
- **Faults develop over minutes**, one at a time: *developing* (2.5–4 min) → *active* (1–2 min)
  → *recovering*, then a healthy gap of 3–6 min. Detector thresholds are crossed part-way
  through, so the gauges trend before any alert fires.
- **The terminal shows the ground truth next to the ML result**, e.g.
  `Truth: OVERHEATING developing 59% | ML: UNKNOWN_ANOMALY`. The truth is never sent to the
  backend.

Useful options (`python sensor_simulator.py --help` for all):

| Option | Effect |
|--------|--------|
| `--fault overheating` | Only this fault (repeat the flag for several) |
| `--fault-after 30` | First fault after 30 s instead of 120 s |
| `--speed 5` | Simulated time runs 5× faster — a whole episode in ~1.5 min |
| `--no-faults` | Healthy engine only |
| `--profile mission` | Takeoff, climb, cruise, loiter, descent. The current Isolation Forest was trained on cruise only, so it flags every non-cruise phase as `UNKNOWN_ANOMALY` |
| `--log run.csv` | Also save readings, ground truth and ML result to CSV |
| `--offline --duration 7200 --log normal.csv` | Generate 2 h of data instantly without the backend (e.g. for training) |

For a demo: `python sensor_simulator.py --fault overheating --fault-after 20 --speed 5`.

### What the connection badge means

| Badge | Meaning | Fix |
|-------|---------|-----|
| Live · WebSocket stream | Everything working | — |
| Live · REST polling fallback | Backend up but WebSocket not connecting | Restart uvicorn; check `main.py` has `/ws/telemetry` |
| No data | Backend reachable, no new readings | Start `sensor_simulator.py` |
| Backend offline | Nothing answering on port 8000 | Start uvicorn (terminal 1) |
| Simulated | Using the in-browser generator | Click **Backend** |

### Backend on another laptop

Create `frontend/.env` containing `BACKEND_URL=http://<their-ip>:8000`, then restart
`npm run dev`. The backend must listen on the network, so start it with
`uvicorn main:app --host 0.0.0.0 --port 8000`.

## Where to change things

| What | File |
|------|------|
| Gauge ranges, caution/alert limits, units | `src/config/sensors.js` |
| Fault type titles, descriptions, test trigger list | `src/config/faults.js` |
| Engine parts, their sensors and faults | `src/config/engineParts.js` |
| Maintenance advice and preventive intervals | `src/config/maintenance.js` |
| Relationship chart pairs, titles and hints | `src/config/relationships.js` |
| Tab names | `src/App.jsx` (`TABS`) |
| Colours | `src/styles.css` (tokens at the top), `src/tabs/EngineTrends.css` (chart ink) |
| Stream timings, history length, trend time ranges | `src/config/app.js` |

## How anomalies reach the dashboard

`POST /sensor-data` runs every reading through `ML/fault_detector.py` (Isolation Forest plus
fault rules). When the result is an anomaly, the backend broadcasts this on the same socket,
right after the reading itself:

```json
{
  "type": "anomaly",
  "engine_id": "ENGINE_001",
  "timestamp": "2026-09-11T10:00:00Z",
  "fault_type": "OVERHEATING",
  "severity": "HIGH",
  "anomaly_score": -0.03,
  "model_prediction": "ANOMALY",
  "sensors": ["cht", "egt", "oil_temperature"]
}
```

- `fault_type` is one of the types in `src/config/faults.js`, which supplies the title and
  description.
- `sensors` are the readings furthest from normal; those gauges get a FLAGGED tag.
- `anomaly_score` is the Isolation Forest decision score (below 0 = anomalous).
- `model_prediction` says whether the model itself flagged the reading (`ML` chip) or only a
  fault rule matched (`Rule` chip).

The backend reports a fault on every reading while it lasts. The dashboard groups repeats: the
same fault type again within 15 s updates the open alert ("42 readings · last 10:14:03")
instead of adding a new alert and toast. Once you acknowledge it, a repeat raises a fresh one.

Alerts only arrive over the WebSocket, so the REST polling fallback and the **Simulated**
source show none. Set `ALERTS_FROM_BACKEND = false` in `src/config/app.js` to ignore them.
