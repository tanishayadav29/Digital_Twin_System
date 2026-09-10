# UAV Engine Digital Twin — Dashboard

React + Vite frontend.

- **Tab 1 — Live telemetry:** live gauges for all 10 engine sensors, a 2-minute strip chart
  under each gauge, and the anomaly alert panel (with a manual test trigger until the
  Isolation Forest is wired in).
- **Tab 2 — Engine trends:** a live line chart per parameter (2 / 5 / 15 min window, hover
  one chart to read all of them at that moment, pause) and relationship charts — CHT vs RPM,
  EGT vs RPM, Vibration vs RPM, Oil pressure vs RPM and CHT vs EGT — each showing the normal
  operating envelope, the latest reading's trail and a correlation score. A readings table
  sits underneath.
- Tabs 3–4 are placeholders.

## How the data flows

```
sensor_simulator.py ──POST /sensor-data──▶ FastAPI (main.py) ──▶ Postgres
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
`sensor_simulator.py`, with the same values and fault odds.

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
| Fault types in the test trigger | `src/config/faults.js` |
| Relationship chart pairs, titles and hints | `src/config/relationships.js` |
| Tab names | `src/App.jsx` (`TABS`) |
| Colours | `src/styles.css` (tokens at the top), `src/tabs/EngineTrends.css` (chart ink) |
| Stream timings, history length, trend time ranges | `src/config/app.js` |

## Wiring in the Isolation Forest later

1. In the backend, when a window is flagged, broadcast on the same socket:

   ```python
   # from sync code such as receive_sensor_data:
   anyio.from_thread.run(broadcaster.broadcast, {
       "type": "anomaly",
       "timestamp": data.timestamp.isoformat(),
       "fault_type": "OVERHEATING",        # or "ANOMALY" if the model can't tell
       "severity": "HIGH",                  # MEDIUM | HIGH | CRITICAL
       "confidence": 0.93,
       "description": "CHT trending abnormally high",
       "sensors": ["cht", "egt"],           # these gauges get a FLAGGED tag
   })
   # from async code: await broadcaster.broadcast({...})
   ```

2. Set `ALERTS_FROM_BACKEND = true` in `src/config/app.js`.
