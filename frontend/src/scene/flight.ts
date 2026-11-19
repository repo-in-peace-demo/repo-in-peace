import { interpolatePose, type CameraPose } from '../model/camera-pose';

/**
 * A flight of the camera from one pose to another. A small state machine with no clock of its own: the caller says
 * what time it is, so the timing can be tested exactly. (The camera rig reads `performance.now()` once a frame.)
 */

/** How long a flight takes, in milliseconds. */
export const FLIGHT_DURATION_MS = 1000;

export type FlightState =
  | { readonly phase: 'idle' }
  | { readonly phase: 'flying'; readonly from: CameraPose; readonly to: CameraPose; readonly startedAt: number };

export const IDLE: FlightState = { phase: 'idle' };

/** Starts a flight at time `now`, replacing any flight that is still going. */
export function startFlight(from: CameraPose, to: CameraPose, now: number): FlightState {
  return { phase: 'flying', from, to, startedAt: now };
}

/** Ends a flight where it is: the camera stays wherever it was last put. */
export function cancelFlight(): FlightState {
  return IDLE;
}

export interface FlightStep {
  state: FlightState;
  /** Where the camera should be now, or `undefined` when there is no flight. */
  pose: CameraPose | undefined;
}

/**
 * The state and the camera pose at time `now`. A flight is over, and goes back to idle, in the step that reaches
 * the end pose, which is exactly the pose it was asked to fly to. A clock that has gone backwards counts as the start.
 */
export function stepFlight(state: FlightState, now: number): FlightStep {
  if (state.phase === 'idle') return { state, pose: undefined };

  const elapsed = Math.max(0, now - state.startedAt);
  if (elapsed >= FLIGHT_DURATION_MS) return { state: IDLE, pose: state.to };
  return { state, pose: interpolatePose(state.from, state.to, elapsed / FLIGHT_DURATION_MS) };
}
