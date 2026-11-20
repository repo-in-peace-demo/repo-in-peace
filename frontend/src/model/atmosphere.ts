import { hash01 } from './hash';
import type { Rect } from './rect';

/**
 * The night: the numbers of the sky, the stars, the moon, the light and the fog, in one place (requirement 6). Pure.
 * Nothing here depends on a file's facts: the only thing taken from the data file is the size of the graveyard, to
 * scale the fog and the ground, and the stars come from a fixed seed, so the sky is the same for every graveyard.
 */

// ---- Colours ----

/** The sky: dark blue-black at the top, a little lighter and bluer at the horizon. */
export const SKY_TOP_COLOR = '#03050c';
export const SKY_HORIZON_COLOR = '#0c1628';

/** The fog is the colour of the sky at the horizon, so the far ground, the hills and the forest fade into the sky in a haze. */
export const FOG_COLOR = SKY_HORIZON_COLOR;

/** The ground, very dark. */
export const GROUND_BASE_COLOR = '#0a0e13';

/** The forest on the ridge: flat, unlit, darker than the sky at the horizon, so it reads as a silhouette against it. */
export const FOREST_COLOR = '#03050a';

/** The faint moonlit edge along the treetops, and the trees toward the moon most. */
export const FOREST_EDGE_COLOR = '#3a4660';

/** The pale haze at the far forest's foot, and the most of it there is. */
export const HAZE_COLOR = '#8796b0';
export const HAZE_MAX_ALPHA = 0.32;


export const MOON_COLOR = '#c4d2e6'; // pale blue-grey: not pure white, so it is not the brightest thing on the screen
export const MOONLIGHT_COLOR = '#b9c9ff';

/** The clouds that drift near the moon: a dark grey-blue, a little lighter than the sky, so they show as shapes against it. */
export const CLOUD_COLOR = '#1c2434';
export const HEMISPHERE_SKY_COLOR = '#2c3c6a';
export const HEMISPHERE_GROUND_COLOR = '#0a0d12';
export const STAR_COLOR = '#dbe6ff';

// ---- Light ----

/** Moonlight (a directional light from the moon's direction, no shadows) and the dim light of the sky. */
export const MOONLIGHT_INTENSITY = 1.6;
export const HEMISPHERE_INTENSITY = 0.95;

/**
 * Where the moonlight comes from: from high up in front of the opening camera and to the left (+z is toward the camera, which
 * looks toward -z), so that the faces of the stones that the opening view sees are lit and their moss, cracks and candles can be
 * read. The moon in the sky is drawn elsewhere (MOON_DIRECTION, behind the graveyard, where it is seen when looking along the
 * graveyard): the light is not exactly where the moon is, which nobody can tell, and a light from behind would leave every face
 * seen from the opening camera in shadow.
 */
export const MOONLIGHT_DIRECTION: Readonly<{ x: number; y: number; z: number }> = { x: -0.42, y: 0.78, z: 0.4639 };

// ---- Fog ----

/** `FogExp2` density = FOG_K / max(radius of the graveyard, FOG_MIN_RADIUS). */
export const FOG_K = 0.2;
export const FOG_MIN_RADIUS = 40;

export const fogDensity = (radius: number): number => FOG_K / Math.max(radius, FOG_MIN_RADIUS);

/** How much of a thing at this distance is left after the fog (1 clear, 0 gone), as three.js computes it for `FogExp2`. */
export const fogVisibility = (distance: number, density: number): number => Math.exp(-((density * distance) ** 2));

// ---- Ground ----

/** The ground plane's side: so large that its edge is hidden by the fog from any camera the limits allow. */
export const groundSize = (bounds: Rect): number => 16 * Math.max(bounds.w, bounds.d) + 1000;

// ---- The dome, the stars and the moon ----

/** Where the sky is drawn: a sphere around the camera. The camera's far plane is at least 1000. */
export const SKY_RADIUS = 700;

export const STAR_COUNT = 900;
export const STAR_SEED = 'repo-in-peace/stars';

/** The moon, a fixed direction low enough to be in view when the camera looks toward the horizon (21.7 degrees up), and its size in the sky. */
export const MOON_AZIMUTH_DEG = -22; // to the left of straight ahead, which is -z
export const MOON_ELEVATION_DEG = 8.5; // in the upper sky of the establishing shot, whose top edge is about 13 degrees above the horizon

/** A direction from an azimuth (0 straight ahead along -z, negative to the left) and an elevation above the horizon, in degrees. */
export function skyDirection(azimuthDeg: number, elevationDeg: number): { x: number; y: number; z: number } {
  const az = (azimuthDeg * Math.PI) / 180;
  const el = (elevationDeg * Math.PI) / 180;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

export const MOON_DIRECTION: Readonly<{ x: number; y: number; z: number }> = skyDirection(MOON_AZIMUTH_DEG, MOON_ELEVATION_DEG);

/** The moon is small, with a soft halo around it that ends at MOON_GLOW_ANGULAR_RADIUS_DEG (the sky's own glow ends there too), so the forest can keep clear of it. */
export const MOON_ANGULAR_RADIUS_DEG = 1.15; // drawn round in screen space (scene/Atmosphere.tsx), about 13 px across on a laptop screen
export const MOON_GLOW_ANGULAR_RADIUS_DEG = 3;

export interface StarDirection {
  x: number;
  y: number;
  z: number;
  /** 0.3 to 1: how bright this star is. */
  brightness: number;
  /** In radians, where in its twinkle it is. */
  phase: number;
}

/**
 * About 900 stars, as unit directions in the upper part of the sky, from `hash01` with a fixed seed: the same every time,
 * for every graveyard. They are uniform over the sphere above the horizon (a little above it: the fog and the ground hide the rest).
 */
export function starDirections(count: number = STAR_COUNT): StarDirection[] {
  const stars: StarDirection[] = [];
  for (let i = 0; i < count; i++) {
    const u = hash01(`${STAR_SEED}/${i}`, 'u');
    const v = hash01(`${STAR_SEED}/${i}`, 'v');
    const y = 0.02 + 0.98 * u; // uniform in height gives uniform on the sphere
    const around = 2 * Math.PI * v;
    const ring = Math.sqrt(1 - y * y);
    stars.push({
      x: ring * Math.cos(around),
      y,
      z: ring * Math.sin(around),
      brightness: 0.3 + 0.7 * hash01(`${STAR_SEED}/${i}`, 'b') ** 2,
      phase: 2 * Math.PI * hash01(`${STAR_SEED}/${i}`, 'p'),
    });
  }
  return stars;
}
