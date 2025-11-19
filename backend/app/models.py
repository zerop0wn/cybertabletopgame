"""Pydantic models for PewPew Tabletop game."""
from typing import Optional, Literal, List, Dict, Any, Union
from datetime import datetime
from pydantic import BaseModel, Field
from enum import Enum


class NodeType(str, Enum):
    INTERNET = "internet"
    FIREWALL = "firewall"
    WAF = "waf"
    WEB = "web"
    APP = "app"
    DB = "db"
    AD = "ad"
    ENDPOINT = "endpoint"
    CLOUD = "cloud"


class AttackType(str, Enum):
    RCE = "RCE"
    SQLI = "SQLi"
    BRUTEFORCE = "Bruteforce"
    PHISHING = "Phishing"
    LATERALMOVE = "LateralMove"
    EXFIL = "Exfil"


class ScanToolType(str, Enum):
    OWASP_ZAP = "OWASP ZAP"
    NMAP = "Nmap"
    SQLMAP = "SQLMap"
    NIKTO = "Nikto"
    HAVEIBEENPWNED = "HaveIBeenPwned"


class BlueActionType(str, Enum):
    ISOLATE_HOST = "isolate_host"
    BLOCK_IP = "block_ip"
    BLOCK_DOMAIN = "block_domain"
    UPDATE_WAF = "update_waf"
    DISABLE_ACCOUNT = "disable_account"
    RESET_PASSWORD = "reset_password"
    OPEN_TICKET = "open_ticket"


class GameStatus(str, Enum):
    LOBBY = "lobby"
    RUNNING = "running"
    PAUSED = "paused"
    FINISHED = "finished"


class Coord(BaseModel):
    x: float
    y: float


class Node(BaseModel):
    id: str
    type: NodeType
    label: str
    coords: Coord
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Link(BaseModel):
    from_id: str
    to_id: str
    metadata: Dict[str, Any] = Field(default_factory=dict)


class Topology(BaseModel):
    nodes: List[Node]
    links: List[Link]


class Attack(BaseModel):
    id: str
    attack_type: AttackType
    from_node: str
    to_node: str
    preconditions: List[str] = Field(default_factory=list)
    success_prob_modifiers: Dict[str, float] = Field(default_factory=dict)
    effects: Dict[str, Any] = Field(default_factory=dict)
    is_correct_choice: bool = False  # True if this is the "correct" attack for the scenario
    requires_scan: bool = False  # If True, requires successful scan first
    required_scan_tool: Optional[ScanToolType] = None  # Which scan unlocks this attack


class ScanRequest(BaseModel):
    tool: ScanToolType
    target_node: str
    scenario_id: str
    player_name: Optional[str] = None


class ScanResult(BaseModel):
    scan_id: str
    tool: ScanToolType
    target_node: str
    success: bool  # True if correct tool for scenario
    results: Dict[str, str]  # Scan results/artifacts revealed
    timestamp: datetime
    message: str  # User-friendly message about scan results
    player_name: Optional[str] = None


class Alert(BaseModel):
    id: str
    timestamp: datetime
    source: str  # IDS, EDR, Proxy, WAF, DB
    severity: str  # low, medium, high, critical
    summary: str
    details: str
    ioc: Dict[str, Any] = Field(default_factory=dict)
    confidence: float = 1.0
    hint_ref: Optional[str] = None


class BlueAction(BaseModel):
    id: str
    actor: str = "blue"
    type: BlueActionType
    target: str
    note: str
    timestamp: datetime
    player_name: Optional[str] = None
    
    # Optional v2 fields (only present if FEATURE_TIMELINE_SLA is True)
    targets: Optional[List[str]] = None  # Multiple targets
    action_cost_seconds: Optional[int] = None
    cooldown_seconds: Optional[int] = None
    effectiveness: Optional[float] = None  # 0.0-1.0
    confidence: Optional[float] = None  # 0.0-1.0
    correlation_id: Optional[str] = None


class Hint(BaseModel):
    step: int
    text: str
    unlock_at: int  # seconds into round


class Scenario(BaseModel):
    id: str
    name: str
    description: str
    topology: Topology
    initial_posture: Dict[str, Any] = Field(default_factory=dict)
    artifacts: Dict[str, str] = Field(default_factory=dict)  # nmap, zap, etc.
    attacks: List[Attack] = Field(default_factory=list)
    hint_deck: List[Hint] = Field(default_factory=list)
    required_scan_tool: Optional[ScanToolType] = None  # Correct scan tool for this scenario
    scan_artifacts: Dict[str, Dict[str, str]] = Field(default_factory=dict)  # Artifacts per scan tool
    red_briefing: Optional[Dict[str, Any]] = None  # Red team briefing (terminal style)
    blue_briefing: Optional[Dict[str, Any]] = None  # Blue team briefing (FBI alert style)


class Score(BaseModel):
    red: int = 0
    blue: int = 0
    mttd: Optional[float] = None  # Mean Time To Detection (seconds)
    mttc: Optional[float] = None  # Mean Time To Containment (seconds)
    round_breakdown: List[Dict[str, Any]] = Field(default_factory=list)


class GameState(BaseModel):
    id: str = "default"
    status: GameStatus = GameStatus.LOBBY
    round: int = 0
    timer: Optional[int] = None  # Elapsed seconds
    start_time: Optional[datetime] = None  # When the round started
    current_scenario_id: Optional[str] = None
    mode: Literal["standard", "training"] = "standard"
    audience_enabled: bool = False
    current_turn: Optional[Literal["red", "blue"]] = None  # Whose turn it is
    turn_start_time: Optional[datetime] = None  # When current turn started
    turn_time_limit: int = 300  # 5 minutes per turn (configurable)
    red_scan_completed: bool = False  # Whether Red team has completed a scan
    red_scan_tool: Optional[ScanToolType] = None  # Which scan tool was used
    red_scan_success: bool = False  # Whether the correct scan tool was used
    red_briefing_dismissed: bool = False  # Whether Red team has dismissed the briefing (timer starts after this)
    # Per-turn action limits
    red_scan_this_turn: bool = False  # Whether Red team has scanned this turn
    red_attack_this_turn: bool = False  # Whether Red team has attacked this turn
    blue_action_this_turn: bool = False  # Whether Blue team has acted this turn


class EventKind(str, Enum):
    ROUND_STARTED = "round_started"
    ROUND_ENDED = "round_ended"
    ATTACK_LAUNCHED = "attack_launched"
    ATTACK_RESOLVED = "attack_resolved"
    ALERT_EMITTED = "alert_emitted"
    ACTION_TAKEN = "action_taken"
    SCORE_UPDATE = "score_update"
    TRAINING_HINT = "training_hint"
    GM_INJECT = "gm_inject"
    TIMER_UPDATE = "timer_update"
    TURN_CHANGED = "turn_changed"
    TURN_TIMEOUT = "turn_timeout"
    SCAN_COMPLETED = "scan_completed"
    CHAT_MESSAGE = "chat_message"
    ACTIVITY_EVENT = "activity_event"
    PRESENCE_UPDATE = "presence_update"
    VOTE_UPDATE = "vote_update"


class Event(BaseModel):
    id: str
    kind: EventKind
    ts: datetime = Field(default_factory=datetime.utcnow)
    payload: Dict[str, Any] = Field(default_factory=dict)
    
    # Optional v2 timing/causality fields (only present if FEATURE_TIMELINE_SLA is True)
    server_ts: Optional[datetime] = None
    client_ts: Optional[datetime] = None
    correlation_id: Optional[str] = None
    caused_by: Optional[str] = None  # ID of event that caused this
    deadline_at: Optional[datetime] = None
    latency_ms: Optional[float] = None


class AttackLaunchRequest(BaseModel):
    attack_id: str
    from_node: str
    to_node: str
    player_name: Optional[str] = None


class ActionRequest(BaseModel):
    type: BlueActionType
    target: str
    note: str
    player_name: Optional[str] = None


class GameStartRequest(BaseModel):
    scenario_id: str


class AttackInstance(BaseModel):
    """Tracks attack lifecycle with timing (only used if FEATURE_TIMELINE_SLA is True)."""
    attack_id: str
    scenario_id: str
    attack_type: AttackType
    from_node: str
    to_node: str
    launched_at: datetime
    impact_at: Optional[datetime] = None
    first_alert_at: Optional[datetime] = None
    first_seen_by_blue_at: Optional[datetime] = None
    contained_at: Optional[datetime] = None
    resolved_at: Optional[datetime] = None
    sla_seconds_detection: int = 300  # 5 minutes default
    sla_seconds_containment: int = 600  # 10 minutes default
    affected_nodes: List[str] = Field(default_factory=list)
    status: Literal["launched", "detected", "contained", "resolved", "hit"] = "launched"
    attack_succeeded: bool = False  # True if exploit has executed and succeeded
    success_determined_at: Optional[datetime] = None  # When we determined success
    success_indicators: List[str] = Field(default_factory=list)  # Which alerts indicate success


class ActionEvaluation(BaseModel):
    """Evaluation of a single Blue team action."""
    action_id: str
    action_type: BlueActionType
    target: str
    effectiveness: Literal["optimal", "effective", "partial", "ineffective", "wrong_target"]
    points: int
    reason: str
    result: Literal["successful_block", "successful_mitigation", "unsuccessful_block", "unsuccessful_mitigation"]


# ============================================================================
# Auth & Session Models (only used if FEATURE_AUTH_GM or FEATURE_JOIN_CODES)
# ============================================================================

class LoginRequest(BaseModel):
    """GM login request."""
    username: str
    password: str


class TokenResponse(BaseModel):
    """JWT token response."""
    access_token: str
    token_type: str = "bearer"
    exp: int  # Expiration timestamp


class AuthToken(BaseModel):
    """JWT token payload."""
    sub: str  # Subject (username)
    role: Literal["GM", "RED", "BLUE", "AUDIENCE"]
    session_id: Optional[str] = None  # Only set for player roles
    exp: int  # Expiration timestamp


class GameSession(BaseModel):
    """Game session with join codes (only used if FEATURE_JOIN_CODES is True)."""
    id: str
    state: str = "lobby"  # lobby|running|paused|ended
    red_code: str
    blue_code: str
    audience_code: str
    created_at: datetime
    created_by: str  # GM username
    expires_at: Optional[datetime] = None


class SessionCreateResponse(BaseModel):
    """Response when creating a session."""
    id: str
    red_code: str
    blue_code: str
    audience_code: str
    state: str


class JoinRequest(BaseModel):
    """Join request with access code."""
    code: str


class JoinResponse(BaseModel):
    """Response when joining with code."""
    access_token: str
    token_type: str = "bearer"
    role: Literal["RED", "BLUE", "AUDIENCE"]
    session_id: str
    exp: int


# ============================================================================
# Voting Models
# ============================================================================

class VoteRequest(BaseModel):
    """Vote request."""
    voter_name: str
    target_player_name: str
    role: Literal["red", "blue"]


class VoteResponse(BaseModel):
    """Vote response."""
    success: bool
    message: str


class PlayerChoice(BaseModel):
    """Player's choice for the current turn."""
    player_name: str
    role: Literal["red", "blue"]
    # For Red team
    scan_tool: Optional[ScanToolType] = None
    attack_id: Optional[str] = None
    attack_type: Optional[AttackType] = None
    # For Blue team
    action_type: Optional[BlueActionType] = None
    action_target: Optional[str] = None
    timestamp: datetime


class VotingStatus(BaseModel):
    """Current voting status for a turn."""
    role: Literal["red", "blue"]
    player_choices: List[PlayerChoice]
    votes: Dict[str, List[str]]  # target_player_name -> list of voter_names
    turn_number: Optional[int] = None


# ============================================================================
# Chat Models
# ============================================================================

class ChatMessage(BaseModel):
    """Chat message model."""
    id: str
    player_name: str
    role: Literal["red", "blue", "gm", "audience"]
    message: str
    timestamp: datetime
    session_id: Optional[str] = None  # Only for session-scoped chats


class ChatRequest(BaseModel):
    """Chat message request."""
    message: str
    player_name: str
    role: Literal["red", "blue", "gm", "audience"]


# ============================================================================
# Activity Models
# ============================================================================

class ActivityEvent(BaseModel):
    """Player activity event."""
    id: str
    player_name: str
    role: Literal["red", "blue", "gm", "audience"]
    activity_type: str  # e.g., "viewing_artifact", "preparing_attack", "analyzing_alert"
    description: str
    timestamp: datetime
    metadata: Dict[str, Any] = Field(default_factory=dict)


class ActivityRequest(BaseModel):
    """Activity tracking request."""
    player_name: str
    role: Literal["red", "blue", "gm", "audience"]
    activity_type: str
    description: str
    metadata: Optional[Dict[str, Any]] = None


# ============================================================================
# Presence Models
# ============================================================================

class PlayerPresence(BaseModel):
    """Player presence information."""
    player_name: str
    role: Literal["red", "blue", "gm", "audience"]
    is_online: bool
    last_seen: datetime
    current_activity: Optional[str] = None  # What they're currently doing
    session_id: Optional[str] = None


class PresenceStatus(BaseModel):
    """Presence status for a team."""
    role: Literal["red", "blue", "gm", "audience"]
    players: List[PlayerPresence]


# ============================================================================
# Advanced Scenario Models (only used if FEATURE_ADV_SCENARIOS is True)
# ============================================================================

class ThreatActor(BaseModel):
    """Threat actor profile."""
    name: str
    synopsis: str
    tags: List[str] = Field(default_factory=list)  # e.g., ["FIN7", "Initial Access: Phish", "C2: HTTP2"]


class Inject(BaseModel):
    """Interactive inject (artifact, prompt, alert, evidence)."""
    id: str
    kind: Literal["artifact", "prompt", "alert", "evidence"]
    label: str
    content: Dict[str, Any]  # Shape depends on kind
    trigger: Literal["time", "gm", "step_enter"]  # When inject is shown


class AttackStep(BaseModel):
    """Multi-step attack playbook step."""
    id: str
    name: str
    description: str
    preconditions: List[str] = Field(default_factory=list)  # Required previous steps
    actions: List[str] = Field(default_factory=list)  # Attacker actions
    countermeasures: List[str] = Field(default_factory=list)  # Expected blue actions
    artifacts: List[Dict[str, Any]] = Field(default_factory=list)  # e.g., nmap, zap, headers
    injects: List[Inject] = Field(default_factory=list)
    detection_sla_sec: int = 300  # 5 minutes default
    contain_sla_sec: int = 600  # 10 minutes default
    score_weights: Dict[str, int] = Field(default_factory=lambda: {"detect": 4, "contain": 6, "attr": 2})
    on_success: Optional[str] = None  # Next step ID on success
    on_failure: Optional[str] = None  # Next step ID on failure


class ScenarioV2(BaseModel):
    """Advanced scenario with multi-step playbook (only used if FEATURE_ADV_SCENARIOS is True)."""
    id: str
    title: str
    threat_actor: ThreatActor
    steps: List[AttackStep]
    entry_step: str  # First step ID

