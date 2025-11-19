/** Feature flags helper. */

// Cache flag values to avoid repeated env lookups
let _authOn: boolean | null = null;
let _codesOn: boolean | null = null;
let _pewPewAudience: boolean | null = null;
let _advScenarios: boolean | null = null;

// Initialize flags once on module load
if (typeof window !== 'undefined') {
  _authOn = (import.meta.env.VITE_FEATURE_AUTH_GM ?? 'false') === 'true';
  _codesOn = (import.meta.env.VITE_FEATURE_JOIN_CODES ?? 'false') === 'true';
  _pewPewAudience = (import.meta.env.VITE_FEATURE_PEWPEW_AUDIENCE ?? 'false') === 'true';
  _advScenarios = (import.meta.env.VITE_FEATURE_ADV_SCENARIOS ?? 'false') === 'true';
}

export const isPewPewAudienceEnabled = (): boolean => {
  if (_pewPewAudience === null) {
    _pewPewAudience = (import.meta.env.VITE_FEATURE_PEWPEW_AUDIENCE ?? 'false') === 'true';
  }
  return _pewPewAudience;
};

export const authOn = (): boolean => {
  if (_authOn === null) {
    _authOn = (import.meta.env.VITE_FEATURE_AUTH_GM ?? 'false') === 'true';
  }
  return _authOn;
};

export const codesOn = (): boolean => {
  if (_codesOn === null) {
    _codesOn = (import.meta.env.VITE_FEATURE_JOIN_CODES ?? 'false') === 'true';
  }
  return _codesOn;
};

export const advScenarioOn = (): boolean => {
  if (_advScenarios === null) {
    _advScenarios = (import.meta.env.VITE_FEATURE_ADV_SCENARIOS ?? 'false') === 'true';
  }
  return _advScenarios;
};

