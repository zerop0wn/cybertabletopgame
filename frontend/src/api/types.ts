/** TypeScript types matching backend Pydantic models. */

export enum NodeType {
  INTERNET = "internet",
  FIREWALL = "firewall",
  WAF = "waf",
  WEB = "web",
  APP = "app",
  DB = "db",
  AD = "ad",
  ENDPOINT = "endpoint",
  CLOUD = "cloud",
}

export enum AttackType {
  RCE = "RCE",
  SQLI = "SQLi",
  BRUTEFORCE = "Bruteforce",
  PHISHING = "Phishing",
  LATERALMOVE = "LateralMove",
  EXFIL = "Exfil",
}

export enum ScanToolType {
  OWASP_ZAP = "OWASP ZAP",
  NMAP = "Nmap",
  SQLMAP = "SQLMap",
  NIKTO = "Nikto",
  HAVEIBEENPWNED = "HaveIBeenPwned",
}

export enum BlueActionType {
  ISOLATE_HOST = "isolate_host",
  BLOCK_IP = "block_ip",
  BLOCK_DOMAIN = "block_domain",
  UPDATE_WAF = "update_waf",
  DISABLE_ACCOUNT = "disable_account",
  RESET_PASSWORD = "reset_password",
  OPEN_TICKET = "open_ticket",
}

export enum GameStatus {
  LOBBY = "lobby",
  RUNNING = "running",
  PAUSED = "paused",
  FINISHED = "finished",
}

export enum EventKind {
  ROUND_STARTED = "round_started",
  ROUND_ENDED = "round_ended",
  ATTACK_LAUNCHED = "attack_launched",
  ATTACK_RESOLVED = "attack_resolved",
  ALERT_EMITTED = "alert_emitted",
  ACTION_TAKEN = "action_taken",
  SCORE_UPDATE = "score_update",
  TRAINING_HINT = "training_hint",
  GM_INJECT = "gm_inject",
  TIMER_UPDATE = "timer_update",
  TURN_CHANGED = "turn_changed",
  TURN_TIMEOUT = "turn_timeout",
  SCAN_COMPLETED = "scan_completed",
  VULNERABILITY_IDENTIFIED = "vulnerability_identified",
  IP_IDENTIFIED = "ip_identified",
  ACTION_IDENTIFIED = "action_identified",
  INVESTIGATION_COMPLETED = "investigation_completed",
  PIVOT_STRATEGY_SELECTED = "pivot_strategy_selected",
  ATTACK_SELECTED = "attack_selected",
  CHAT_MESSAGE = "chat_message",
  ACTIVITY_EVENT = "activity_event",
  PRESENCE_UPDATE = "presence_update",
  VOTE_UPDATE = "vote_update",
}

export interface Coord {
  x: number;
  y: number;
}

export interface Node {
  id: string;
  type: NodeType;
  label: string;
  coords: Coord;
  metadata: Record<string, any>;
}

export interface Link {
  from_id: string;
  to_id: string;
  metadata: Record<string, any>;
}

export interface Topology {
  nodes: Node[];
  links: Link[];
}

export interface Attack {
  id: string;
  attack_type: AttackType;
  from_node: string;
  to_node: string;
  preconditions: string[];
  success_prob_modifiers: Record<string, number>;
  effects: Record<string, any>;
  requires_scan?: boolean;
  required_scan_tool?: ScanToolType;
}

export interface Alert {
  id: string;
  timestamp: string;
  source: string;
  severity: string;
  summary: string;
  details: string;
  ioc: Record<string, any>;
  confidence: number;
  hint_ref?: string;
}

export interface BlueAction {
  id: string;
  actor: string;
  type: BlueActionType;
  target: string;
  note: string;
  timestamp: string;
  player_name?: string;
  
  // Optional v2 fields (only present if FEATURE_TIMELINE_SLA is enabled)
  targets?: string[];
  action_cost_seconds?: number;
  cooldown_seconds?: number;
  effectiveness?: number;
  confidence?: number;
  correlation_id?: string;
}

export interface Hint {
  step: number;
  text: string;
  unlock_at: number;
}

export interface Scenario {
  id: string;
  name: string;
  description: string;
  topology: Topology;
  initial_posture: Record<string, any>;
  artifacts: Record<string, string>;
  attacks: Attack[];
  hint_deck: Hint[];
  required_scan_tool?: ScanToolType;
  scan_artifacts?: Record<string, Record<string, string>>;
  red_briefing?: {
    cyrillicText?: string;
    englishText: string;
    targetInfo?: string;
    objectives?: string[];
  };
  blue_briefing?: {
    alertLevel?: 'URGENT' | 'CRITICAL' | 'CLASSIFIED';
    threatSummary: string;
    initialIndicators?: string[];
    recommendedActions?: string[];
    context?: string;
  };
}

export interface ScanRequest {
  tool: ScanToolType;
  target_node: string;
  scenario_id: string;
  player_name?: string;
}

export interface ScanResult {
  scan_id: string;
  tool: ScanToolType;
  target_node: string;
  success: boolean;
  results: Record<string, string>;
  timestamp: string;
  message: string;
  player_name?: string;
}

export interface Score {
  red: number;
  blue: number;
  mttd?: number;
  mttc?: number;
  round_breakdown: Array<Record<string, any>>;
}

export interface GameState {
  id: string;
  status: GameStatus;
  round: number;
  timer?: number;  // Elapsed seconds
  start_time?: string;  // When the round started (ISO string)
  current_scenario_id?: string;
  mode: "standard" | "training";
  audience_enabled: boolean;
  current_turn?: "red" | "blue";  // Whose turn it is
  turn_start_time?: string;  // When current turn started (ISO string)
  turn_time_limit?: number;  // Turn time limit in seconds (default: 180)
  red_turn_count?: number;  // Current turn number for Red (0-indexed)
  blue_turn_count?: number;  // Current turn number for Blue (0-indexed)
  max_turns_per_side?: number;  // Maximum turns per side (None = unlimited)
  red_scan_completed?: boolean;  // Whether Red team has completed a scan
  red_scan_tool?: ScanToolType;  // Which scan tool was used (deprecated, use red_scan_results)
  red_scan_success?: boolean;  // Whether the correct scan tool was used (deprecated, use red_scan_results)
  red_scan_results?: Array<{
    scan_id: string;
    tool: string;
    target_node: string;
    success: boolean;
    results: Record<string, string>;
    timestamp: string;
    message: string;
    player_name?: string;
    source_ip?: string;  // Source IP address used for this scan
  }>;  // All scan results for this turn
  red_vulnerability_identified?: boolean;  // Whether team has identified the correct vulnerability
  red_vulnerability_votes?: Record<string, string>;  // player_name -> scan_tool (which tool they voted for)
  blue_ip_identified?: boolean;  // Whether Blue team has identified the correct scan IP
  blue_ip_votes?: Record<string, string>;  // player_name -> ip_address (which IP they voted for)
  blue_action_identified?: boolean;  // Whether Blue team has identified the correct action to take
  blue_action_votes?: Record<string, string>;  // player_name -> action_type (which action they voted for)
  blue_investigation_completed?: boolean;  // Whether Blue team has completed attack investigation
  blue_investigation_votes?: Record<string, string>;  // player_name -> "succeeded" or "blocked"
  red_pivot_strategy_selected?: boolean;  // Whether Red team has selected pivot strategy
  red_pivot_votes?: Record<string, string>;  // player_name -> pivot_strategy ("lateral", "alternative", "persistence")
  red_attack_selected?: boolean;  // Whether Red team has selected an attack via voting
  red_attack_votes?: Record<string, string>;  // player_name -> attack_id (which attack they voted for)
  red_scan_ips?: string[];  // IP addresses used for scanning
  blocked_ips?: string[];  // IP addresses blocked by Blue team
  red_briefing_dismissed?: boolean;  // Whether Red team has dismissed the briefing (timer starts after this)
  red_scan_this_turn?: boolean;  // Whether Red team has scanned this turn
  red_attack_this_turn?: boolean;  // Whether Red team has attacked this turn
  blue_action_this_turn?: boolean;  // Whether Blue team has acted this turn
}

export interface Event {
  id: string;
  kind: EventKind | string;  // Allow string for flexibility with type narrowing
  ts: string;
  payload: Record<string, any>;
  
  // Optional v2 timing/causality fields (only present if FEATURE_TIMELINE_SLA is enabled)
  server_ts?: string;
  client_ts?: string;
  correlation_id?: string;
  caused_by?: string;
  deadline_at?: string;
  latency_ms?: number;
}

export type Role = "gm" | "red" | "blue" | "audience";

export interface AttackInstance {
  attack_id: string;
  scenario_id: string;
  attack_type: AttackType;
  from_node: string;
  to_node: string;
  launched_at: string;
  impact_at?: string;
  first_alert_at?: string;
  first_seen_by_blue_at?: string;
  contained_at?: string;
  resolved_at?: string;
  sla_seconds_detection: number;
  sla_seconds_containment: number;
  affected_nodes: string[];
  status: "launched" | "detected" | "contained" | "resolved" | "hit";
  attack_succeeded?: boolean;  // True if exploit has executed and succeeded
  success_determined_at?: string;  // When we determined success
  success_indicators?: string[];  // Which alerts indicate success
}

export interface ActionEvaluation {
  action_id: string;
  action_type: BlueActionType;
  target: string;
  effectiveness: "optimal" | "effective" | "partial" | "ineffective" | "wrong_target";
  points: number;
  reason: string;
  result: "successful_block" | "successful_mitigation" | "unsuccessful_block" | "unsuccessful_mitigation";
}

// WebSocket event payload (v2 with optional fields)
export interface WebSocketEventPayload {
  type: "game_event" | "snapshot_state";
  v?: "2";
  event?: Event;
  game_state?: GameState;
  events?: Event[];
  server_ts?: string;
}

// ============================================================================
// Auth & Session Types (only used if FEATURE_AUTH_GM or FEATURE_JOIN_CODES)
// ============================================================================

export interface LoginRequest {
  username: string;
  password: string;
}

export interface TokenResponse {
  access_token: string;
  token_type: string;
  exp: number;
}

export interface SessionCreateResponse {
  id: string;
  red_code: string;
  blue_code: string;
  audience_code: string;
  state: string;
}

export interface JoinRequest {
  code: string;
}

export interface JoinResponse {
  access_token: string;
  token_type: string;
  role: "RED" | "BLUE" | "AUDIENCE";
  session_id: string;
  exp: number;
}

export interface GameSession {
  id: string;
  state: string;
  red_code: string;
  blue_code: string;
  audience_code: string;
  created_at: string;
  created_by: string;
  expires_at?: string;
}

// ============================================================================
// Request Types
// ============================================================================

export interface ActionRequest {
  type: BlueActionType;
  target: string;
  note: string;
  player_name?: string;
}

export interface AttackLaunchRequest {
  attack_id: string;
  from_node: string;
  to_node: string;
  player_name?: string;
}

// ============================================================================
// Voting Types
// ============================================================================

export interface VoteRequest {
  voter_name: string;
  target_player_name: string;
  role: "red" | "blue";
}

export interface VoteResponse {
  success: boolean;
  message: string;
}

export interface PlayerChoice {
  player_name: string;
  role: "red" | "blue";
  scan_tool?: ScanToolType;
  attack_id?: string;
  attack_type?: AttackType;
  action_type?: BlueActionType;
  action_target?: string;
  timestamp: string;
}

export interface VotingStatus {
  role: "red" | "blue";
  player_choices: PlayerChoice[];
  votes: Record<string, string[]>; // target_player_name -> list of voter_names
  turn_number?: number;
}

// ============================================================================
// Chat Types
// ============================================================================

export interface ChatMessage {
  id: string;
  player_name: string;
  role: "red" | "blue" | "gm" | "audience";
  message: string;
  timestamp: string;
  session_id?: string;
}

export interface ChatRequest {
  message: string;
  player_name: string;
  role: "red" | "blue" | "gm" | "audience";
}

// ============================================================================
// Activity Types
// ============================================================================

export interface ActivityEvent {
  id: string;
  player_name: string;
  role: "red" | "blue" | "gm" | "audience";
  activity_type: string;
  description: string;
  timestamp: string;
  metadata: Record<string, any>;
}

export interface ActivityRequest {
  player_name: string;
  role: "red" | "blue" | "gm" | "audience";
  activity_type: string;
  description: string;
  metadata?: Record<string, any>;
}

// ============================================================================
// Presence Types
// ============================================================================

export interface PlayerPresence {
  player_name: string;
  role: "red" | "blue" | "gm" | "audience";
  is_online: boolean;
  last_seen: string;
  current_activity?: string;
  session_id?: string;
}

export interface PresenceStatus {
  role: "red" | "blue" | "gm" | "audience";
  players: PlayerPresence[];
}

