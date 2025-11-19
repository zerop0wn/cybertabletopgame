# PewPew Tabletop: Red vs Blue - Complete Project Layout

## 📋 Project Overview

An interactive cyber defense tabletop game with real-time multiplayer gameplay, featuring a big-screen "pew-pew" map, role-based workflows, and live scoring.

---

## 🏗️ Architecture

### **Tech Stack**
- **Frontend**: React 18 + TypeScript, Vite, TailwindCSS, Framer Motion, Zustand, Socket.IO
- **Backend**: FastAPI (Python 3.11+), Pydantic v2, Socket.IO, SQLite, Uvicorn
- **Deployment**: Docker Compose

---

## 📁 Project Structure

```
pewpew/
├── backend/                    # Python FastAPI Backend
│   ├── app/
│   │   ├── main.py            # FastAPI application entry point
│   │   ├── models.py          # Pydantic/SQLModel data models
│   │   ├── ws.py              # WebSocket server & broadcaster
│   │   ├── settings.py        # Configuration & feature flags
│   │   ├── database.py        # SQLite database setup
│   │   ├── store.py           # In-memory event store (for snapshots)
│   │   │
│   │   ├── routes/            # API Route Handlers
│   │   │   ├── game.py        # Game state management (start/pause/reset)
│   │   │   ├── scenarios.py   # Scenario CRUD operations
│   │   │   ├── attacks.py     # Attack launch & resolution
│   │   │   ├── actions.py     # Blue team action submission
│   │   │   ├── score.py       # Score retrieval & updates
│   │   │   └── timeline.py   # Timeline/SLA endpoints (feature-flagged)
│   │   │
│   │   ├── services/          # Business Logic
│   │   │   ├── seed.py        # Scenario seeding & YAML loading
│   │   │   ├── resolver.py    # Attack outcome resolution & scoring
│   │   │   ├── alerts.py      # Alert generation with noise/jitter
│   │   │   └── timer.py       # Game timer background task
│   │   │
│   │   └── tests/             # Pytest test suite
│   │       ├── test_alerts.py
│   │       └── test_resolver.py
│   │
│   ├── data/                  # SQLite database storage
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/                   # React TypeScript Frontend
│   ├── src/
│   │   ├── main.tsx           # React app entry point
│   │   ├── App.tsx            # Router & protected routes
│   │   │
│   │   ├── pages/             # Route Pages
│   │   │   ├── Lobby.tsx      # Role selection & game setup
│   │   │   ├── GM.tsx         # Game Manager control panel
│   │   │   ├── Red.tsx        # Red Team attack interface
│   │   │   ├── Blue.tsx       # Blue Team defense interface
│   │   │   └── Audience.tsx   # Spectator view with pew-pew map
│   │   │
│   │   ├── components/       # React Components
│   │   │   ├── GameClock.tsx          # 20-minute countdown timer
│   │   │   ├── TurnIndicator.tsx      # 3-minute turn timer
│   │   │   ├── ScorePanel.tsx         # Live score display
│   │   │   ├── TimelineStrip.tsx      # Event timeline
│   │   │   ├── AlertFeed.tsx          # Blue team alert feed
│   │   │   ├── ActionPalette.tsx      # Blue team action selector
│   │   │   ├── HintTray.tsx           # Training mode hints
│   │   │   ├── PewPewMap.tsx          # Network topology map
│   │   │   │
│   │   │   ├── audience/              # Audience-specific components
│   │   │   │   ├── PewPewMap.tsx      # Animated attack visualization
│   │   │   │   └── PewPewOverlay.tsx  # Telemetry overlay (removed)
│   │   │   │
│   │   │   ├── map/                   # Map system components
│   │   │   │   ├── MapBase.tsx        # Background map renderer
│   │   │   │   ├── MarkersCanvas.tsx  # Dynamic marker overlay
│   │   │   │   └── MapAnimationOverlay.tsx  # Animation API (pulse/radar/arc)
│   │   │   │
│   │   │   └── ui/                    # Reusable UI components
│   │   │       ├── CardFrame.tsx
│   │   │       └── StatusPill.tsx
│   │   │
│   │   ├── store/             # State Management
│   │   │   └── useGameStore.ts # Zustand store (gameState, events, alerts)
│   │   │
│   │   ├── hooks/              # Custom React Hooks
│   │   │   └── useWebSocket.ts # Socket.IO connection & event handling
│   │   │
│   │   ├── api/                # API Client
│   │   │   ├── client.ts       # Axios API client
│   │   │   └── types.ts         # TypeScript type definitions
│   │   │
│   │   └── lib/                # Utilities
│   │       ├── flags.ts        # Feature flag helpers
│   │       ├── geo.ts          # Geographic projection utilities
│   │       └── pewpew.ts       # Pew-pew event conversion
│   │
│   ├── public/
│   │   └── images/
│   │       └── background.png   # Custom 2:1 world map background
│   │
│   ├── Dockerfile
│   └── package.json
│
└── docker-compose.yml          # Docker orchestration
```

---

## 🎮 Game Features

### **Core Gameplay**

1. **Role-Based Views**
   - **Game Manager (GM)**: Control panel for starting/pausing/resetting games, scenario selection, mode toggles
   - **Red Team**: Attack interface with artifact browsing and attack launching
   - **Blue Team**: Defense interface with alert feed, action palette, and training hints
   - **Audience**: Spectator view with animated pew-pew map and live scores

2. **Game Flow**
   - Lobby → Role Selection
   - GM Setup → Scenario Selection → Start Round
   - Red Team → Launch Attacks
   - Blue Team → Receive Alerts → Submit Actions
   - Real-time Resolution → Score Updates → Event Timeline

3. **Scenarios** (2 pre-seeded)
   - **NH360 SharePoint — CVE-2025-53770**: RCE, SQLi, Bruteforce attacks
   - **Phishing to Endpoint — Macro Dropper**: Phishing, Lateral Move attacks

### **Scoring System**

**Red Team Points:**
- +10 successful exploit
- +3 privilege escalation
- +5 exfiltration

**Blue Team Points:**
- +8 blocked pre-detonation
- +5 contained < 5 minutes
- +2 correct attribution
- -5 excessive response
- -2 incorrect attribution
- -3 missed containment window

### **Timing & Turn Management**

- **Game Clock**: 20-minute scenario countdown (real-time updates)
- **Turn Timer**: 3-minute per-turn limit with auto-advancement
- **Turn-Based**: Red and Blue teams alternate turns

---

## 🎨 UI Components

### **Shared Components**
- `GameClock`: Countdown timer with progress bar and status indicators
- `TurnIndicator`: Current turn display with time remaining
- `ScorePanel`: Live score display with MTTD/MTTC metrics
- `TimelineStrip`: Chronological event timeline with filtering

### **Role-Specific Components**

**Blue Team:**
- `AlertFeed`: Real-time alert stream with severity indicators
- `ActionPalette`: Action selector (block, contain, investigate, etc.)
- `HintTray`: Training mode hints (time-gated)

**Red Team:**
- Attack launch interface with artifact browsing
- Attack history and status tracking

**Audience:**
- `PewPewMap`: Animated attack visualization with:
  - Great-circle arc animations
  - Shield animations (blocked attacks)
  - Explosion animations (hit attacks)
  - Dud/miss animations (incorrect attacks)
  - Custom background map with baked-in icons

**Map System:**
- `MapBase`: Responsive 2:1 background map renderer
- `MarkersCanvas`: Dynamic marker overlay with pulsing halos
- `MapAnimationOverlay`: Animation API (pulse, radar, arc) with normalized coordinates

---

## 🔌 Backend API

### **REST Endpoints**

**Game Management:**
- `GET /api/game/state` - Get current game state
- `POST /api/game/start` - Start a new round
- `POST /api/game/pause` - Pause the game
- `POST /api/game/resume` - Resume the game
- `POST /api/game/reset` - Reset the game
- `POST /api/game/toggle-audience` - Toggle audience mode
- `POST /api/game/toggle-training` - Toggle training mode

**Scenarios:**
- `GET /api/scenarios` - List all scenarios
- `GET /api/scenarios/{id}` - Get scenario details

**Attacks:**
- `POST /api/attacks/launch` - Launch an attack

**Actions:**
- `POST /api/actions` - Submit blue team action

**Score:**
- `GET /api/score` - Get current score

**Timeline (Feature-Flagged):**
- `GET /api/timeline` - Get timeline events
- `GET /api/timeline/since` - Get events since timestamp

### **WebSocket Events**

**Event Types:**
- `round_started` - New round begins
- `round_ended` - Round ends
- `attack_launched` - Red team launches attack
- `attack_resolved` - Attack outcome determined (hit/blocked/miss)
- `alert_emitted` - New alert generated (Blue/Audience only)
- `action_taken` - Blue team submits action
- `score_update` - Score changes
- `training_hint` - Training hint unlocked (Blue only, Training Mode)
- `gm_inject` - GM injects custom event
- `timer_update` - Timer updates
- `turn_changed` - Turn changes
- `turn_timeout` - Turn timeout

**WebSocket Rooms:**
- `gm` - Game Manager room
- `red` - Red Team room
- `blue` - Blue Team room
- `audience` - Audience room

---

## 🚀 Feature Flags

### **Backend Flags** (`backend/app/settings.py`)
- `FEATURE_TIMELINE_SLA` - Enhanced timing/causality model with SLA-weighted scoring
- `FEATURE_WS_SNAPSHOT` - WebSocket snapshot/resync support
- `FEATURE_ALERT_STORM` - Benign noise alerts for realism
- `FEATURE_TIME_DILATION` - GM tempo controls

### **Frontend Flags** (`frontend/src/lib/flags.ts`)
- `VITE_FEATURE_TIMELINE_SLA` - Timeline/SLA UI features
- `VITE_FEATURE_WS_SNAPSHOT` - Snapshot UI support
- `VITE_FEATURE_PEWPEW_AUDIENCE` - Pew-pew map for Audience view

---

## 🎯 Key Features Implemented

### **Game Mechanics**
- ✅ Attack correctness system (`is_correct_choice` flag)
- ✅ Miss outcome for incorrect attacks
- ✅ Real-time attack resolution
- ✅ Alert generation with noise/jitter
- ✅ Scoring system with MTTD/MTTC metrics
- ✅ Turn-based gameplay with time limits
- ✅ Game state persistence (localStorage)

### **UI/UX**
- ✅ Real-time countdown clocks (game & turn timers)
- ✅ Animated attack visualization (pew-pew map)
- ✅ Custom background map support
- ✅ Dynamic marker system with animations
- ✅ Responsive design (mobile-friendly)
- ✅ Dark theme (slate color scheme)
- ✅ Protected routes with role-based access

### **Technical**
- ✅ WebSocket real-time communication
- ✅ State management with Zustand
- ✅ Type-safe API client
- ✅ Feature flag system
- ✅ Docker Compose deployment
- ✅ Hot-reload development
- ✅ Error handling & logging

---

## 📊 Data Models

### **Backend Models** (`backend/app/models.py`)

**Core Entities:**
- `Scenario` - Game scenario with topology and attacks
- `Attack` - Attack definition with type, nodes, and correctness flag
- `Node` - Network node (Internet, WAF, Web, DB, etc.)
- `Link` - Network link between nodes
- `GameState` - Current game state (status, round, timer, turn)
- `Event` - Game event with timing/causality fields
- `Alert` - Alert with severity, source, and timestamp
- `BlueAction` - Blue team action with type, target, and note
- `Score` - Score with red/blue points and MTTD/MTTC

### **Frontend Types** (`frontend/src/api/types.ts`)
- TypeScript interfaces matching backend Pydantic models
- Event kind enums
- WebSocket payload types

---

## 🔧 Development Tools

### **Backend**
- FastAPI with automatic OpenAPI docs
- Pydantic v2 for validation
- SQLite for persistence (MVP)
- Pytest for testing
- Uvicorn for ASGI server

### **Frontend**
- Vite for fast HMR
- TypeScript for type safety
- TailwindCSS for styling
- ESLint for linting
- React Router for routing

### **Deployment**
- Docker Compose for orchestration
- Separate Dockerfiles for frontend/backend
- Environment variable configuration

---

## 🎨 Visual Features

### **Pew-Pew Map** (Audience View)
- Great-circle arc animations
- Shield animations (blocked)
- Explosion animations (hit)
- Dud/miss animations (incorrect attacks)
- Custom background map (2:1 aspect ratio)
- Dynamic marker system with pulsing halos
- Animation API (pulse, radar, arc)

### **Network Map** (All Views)
- SVG-based topology visualization
- Real-time attack indicators
- Node status colors (healthy/compromised)
- Link animations

---

## 📝 Current Status

### **Working Features**
- ✅ All role-based views functional
- ✅ Attack launch and resolution
- ✅ Blue team actions and scoring
- ✅ Real-time WebSocket updates
- ✅ Game clock and turn timers
- ✅ Pew-pew map animations
- ✅ Score tracking
- ✅ Event timeline
- ✅ Alert generation

### **Recent Fixes**
- ✅ Clock countdown (real-time updates)
- ✅ Refresh redirect (maintains current view)
- ✅ Attack correctness (miss outcome)
- ✅ Map marker system
- ✅ Background map support

---

## 🚧 Future Enhancements

- Replay slider
- Export reports (PDF)
- Auth + team codes
- Multiple concurrent games
- Cloud persistence (Postgres + Redis)
- Metrics dashboard
- Real artifact import (ZAP/Nmap)

---

## 📚 Documentation

- `README.md` - Project overview and quick start
- `PROJECT_LAYOUT.md` - This file (complete project structure)
- API docs available at `/docs` (FastAPI auto-generated)

---

## 🎮 How to Play

1. **Start the application**: `docker compose up --build`
2. **Open browser**: http://localhost:5173
3. **Select role** in the lobby
4. **GM starts game**: Pick scenario → Start Round
5. **Red Team**: Browse artifacts → Launch attack
6. **Blue Team**: Review alerts → Submit action
7. **Watch**: Audience view shows animated map and scores

---

*Last Updated: Current Development Session*


