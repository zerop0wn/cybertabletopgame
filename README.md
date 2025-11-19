# PewPew Tabletop: Red vs Blue

An interactive cyber defense tabletop game with a big-screen "pew-pew" map, Red/Blue team workflows, a Game Manager (GM) control panel, **Audience Mode** (spectator view), and **Training Mode** (guided hints/playbooks for Blue).

## Features

- 🎯 **Multi-role Gameplay**: Game Manager, Red Team, Blue Team, and Audience views
- 🗺️ **Interactive Map**: Real-time animated attack visualization with SVG
- 📊 **Live Scoring**: Real-time score updates with MTTD/MTTC metrics
- 🔔 **Alert System**: Alert generation with noise and jitter
- 🎓 **Training Mode**: Time-gated hints for Blue team
- 👥 **Audience Mode**: Read-only spectator view without spoilers
- ⚡ **Real-time Updates**: WebSocket-based event streaming
- 🎨 **Modern UI**: TailwindCSS with Framer Motion animations

### Experimental Features (Feature Flags)

Advanced features are available behind feature flags for safe rollout:

- **Timeline/SLA Tracking** (`FEATURE_TIMELINE_SLA`): Enhanced timing/causality model with SLA-weighted scoring
- **WebSocket Snapshots** (`FEATURE_WS_SNAPSHOT`): Fast reconnection with state snapshots
- **Alert Storm Simulation** (`FEATURE_ALERT_STORM`): Benign noise alerts for realism
- **Time Dilation** (`FEATURE_TIME_DILATION`): GM tempo controls

See [Feature Flags & Safe Rollout](#feature-flags--safe-rollout) section below.

## Tech Stack

### Frontend
- React 18 + TypeScript
- Vite
- TailwindCSS
- Framer Motion
- Zustand (state management)
- Socket.IO Client
- React Router

### Backend
- FastAPI (Python 3.11+)
- Pydantic v2
- Socket.IO (python-socketio)
- SQLite (MVP)
- Uvicorn

## Quick Start

### Using Docker Compose (Recommended)

```bash
docker compose up --build
```

Frontend: http://localhost:5173  
Backend: http://localhost:8000  
API Docs: http://localhost:8000/docs

### Manual Setup

#### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt

# Create data directory
mkdir -p data

# Run server
uvicorn app.main:app --reload
```

#### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Usage

1. **Start the servers** (via Docker Compose or manually)
2. **Open the frontend** at http://localhost:5173
3. **Game Manager Login**:
   - Click "Game Manager" on the lobby page
   - Login with default credentials:
     - **Username**: `admin`
     - **Password**: `admin`
   - ⚠️ **Change these in production!** Set `GM_ADMIN_PASSWORD_HASH` environment variable
4. **Create Game Session** (GM only):
   - After logging in, click "Create Game Session"
   - You'll receive three join codes:
     - **Red Team Code**: e.g., `R7D92Q`
     - **Blue Team Code**: e.g., `BL2E8K`
     - **Audience Code**: e.g., `AUDZ9M`
   - Share these codes with your teams
5. **Players Join**:
   - Players select their role (Red/Blue/Audience) on the lobby
   - Enter the corresponding join code
   - They'll be automatically routed to their role page
6. **GM starts a game**: Select a scenario and click "Start"
7. **Red Team launches attacks**: Browse artifacts, select an attack, launch
8. **Blue Team responds**: Review alerts, submit actions with justification
9. **Watch the score**: Real-time updates as actions resolve

## Game Flow

1. **Lobby**: GM logs in, creates session, gets join codes
2. **Players Join**: Players enter join codes to access their role pages
3. **GM Setup**: GM picks scenario, toggles Audience/Training modes
4. **Round Start**: GM clicks "Start Round"
5. **Red Team**: Views recon artifacts, selects and launches attack
6. **Backend**: Generates alerts (with noise), evaluates attack
7. **Blue Team**: Receives alerts, investigates, submits actions
8. **Resolution**: Backend evaluates outcome, updates scores
9. **Events**: All actions stream via WebSocket to relevant roles

## Security & Authentication

### Default Credentials

- **GM Username**: `admin`
- **GM Password**: `admin`

⚠️ **IMPORTANT**: Change these in production! Set the `GM_ADMIN_PASSWORD_HASH` environment variable with a bcrypt hash of your desired password.

### Room Code System

- Each game session has unique join codes for Red Team, Blue Team, and Audience
- Codes are 6-8 characters (alphanumeric, excluding confusing characters)
- Codes can be rotated by the GM if needed
- Sessions expire after 24 hours

## Scenarios

Two pre-seeded scenarios:

1. **NH360 SharePoint — CVE-2025-53770**
   - Attack vectors: RCE, SQLi, Bruteforce
   - Nodes: Internet → WAF → SharePoint → DB

2. **Phishing to Endpoint — Macro Dropper**
   - Attack vectors: Phishing, Lateral Move
   - Nodes: Internet → Mail GW → Endpoint → AD

## API Endpoints

- `GET /api/scenarios` - List scenarios
- `GET /api/scenarios/{id}` - Get scenario details
- `GET /api/game/state` - Get game state
- `POST /api/game/start` - Start a round
- `POST /api/game/pause|resume|reset` - Game controls
- `POST /api/game/toggle-audience` - Toggle audience mode
- `POST /api/game/toggle-training` - Toggle training mode
- `POST /api/attacks/launch` - Launch an attack
- `POST /api/actions` - Submit blue team action
- `GET /api/score` - Get current score
- `POST /api/seed` - Seed database (dev only)

## WebSocket Events

Events are broadcast to role-specific rooms:

- `round_started` - New round begins
- `round_ended` - Round ends
- `attack_launched` - Red team launches attack
- `attack_resolved` - Attack outcome determined
- `alert_emitted` - New alert generated (Blue/Audience only)
- `action_taken` - Blue team submits action
- `score_update` - Score changes
- `training_hint` - Training hint unlocked (Blue only, Training Mode)
- `gm_inject` - GM injects custom event

## Scoring Rules

### Red Team
- +10 successful exploit
- +3 privilege escalation
- +5 exfiltration

### Blue Team
- +8 blocked pre-detonation
- +5 contained < 5 minutes
- +2 correct attribution
- -5 excessive response (nuclear option)
- -2 incorrect attribution
- -3 missed containment window

## Testing

### Backend Tests

```bash
cd backend
pytest -q
```

### Frontend Tests

```bash
cd frontend
npm test
```

## Development

### Project Structure

```
pewpew/
  frontend/
    src/
      components/     # React components
      pages/          # Route pages
      store/          # Zustand store
      api/            # API client & types
      hooks/          # React hooks
  backend/
    app/
      main.py         # FastAPI app
      models.py       # Pydantic models
      routes/         # API routes
      services/       # Business logic
      ws.py           # WebSocket server
      tests/          # Pytest tests
  docker-compose.yml
```

### Adding New Scenarios

Edit `backend/app/services/seed.py` and add scenario definitions to `create_default_scenarios()`.

### Adding New Attack Types

1. Add enum value to `AttackType` in `backend/app/models.py`
2. Add alert templates in `backend/app/services/alerts.py`
3. Update resolver logic in `backend/app/services/resolver.py`

## License

MIT

## Contributing

This is an MVP. Future enhancements:
- Replay slider
- Export reports (PDF)
- Auth + team codes
- Multiple concurrent games
- Cloud persistence (Postgres + Redis)
- Metrics dashboard
- Real artifact import (ZAP/Nmap)

