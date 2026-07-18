const SKYBOX_IDS = Object.freeze(["cyberpunk", "aurora", "orbital", "neonArena"]);
const SKYBOX_VIEWS = Object.freeze(["yaw-0", "yaw-90", "yaw-180", "yaw-270", "below-horizon"]);

const BASELINE_SCENES = Object.freeze([
  Object.freeze({
    id: "arena-pretty",
    suite: "baseline",
    driver: "pulse-lifecycle",
    mode: "arena",
    benchmarkScenario: "pretty-arena",
    benchmarkTier: 0,
    captureTick: 180,
    states: Object.freeze(["settled", "pulse-early", "pulse-middle", "pulse-late", "pulse-expired"])
  }),
  Object.freeze({
    id: "track-showoff",
    suite: "baseline",
    driver: "pulse-lifecycle",
    mode: "track",
    benchmarkScenario: "showoff-track-motion",
    benchmarkTier: 0,
    captureTick: 180,
    states: Object.freeze(["settled", "pulse-early", "pulse-middle", "pulse-late", "pulse-expired"])
  }),
  Object.freeze({
    id: "training-pretty",
    suite: "baseline",
    driver: "pulse-lifecycle",
    mode: "training",
    benchmarkScenario: "pretty-arena",
    benchmarkTier: 0,
    captureTick: 60,
    states: Object.freeze(["settled"])
  })
]);

const CLOSURE_SCENES = Object.freeze([
  Object.freeze({
    id: "arena-clean-events",
    suite: "closure",
    driver: "clean-events",
    mode: "arena",
    qualityId: "clean",
    states: Object.freeze(["echo-nearby", "jump-takeoff", "jump-airborne", "jump-landed", "echo-collected"])
  }),
  Object.freeze({
    id: "training-lifecycle",
    suite: "closure",
    driver: "training-lifecycle",
    mode: "training",
    qualityId: "pretty",
    states: Object.freeze(["initial", "advanced", "complete"])
  }),
  Object.freeze({
    id: "meltdown-tier-0-grazing",
    suite: "closure",
    driver: "meltdown-grazing",
    mode: "arena",
    qualityId: "meltdown",
    voxelSizeMeters: 1,
    states: Object.freeze(["grazing"])
  }),
  Object.freeze({
    id: "meltdown-tier-4-grazing",
    suite: "closure",
    driver: "meltdown-grazing",
    mode: "arena",
    qualityId: "meltdown",
    voxelSizeMeters: 0.35,
    states: Object.freeze(["grazing"])
  }),
  ...SKYBOX_IDS.map((skyboxId) => Object.freeze({
    id: `skybox-${skyboxId}`,
    suite: "closure",
    driver: "skybox-views",
    mode: "arena",
    qualityId: "pretty",
    skyboxId,
    states: SKYBOX_VIEWS
  })),
  Object.freeze({
    id: "track-wake-persistence",
    suite: "closure",
    driver: "track-wake",
    mode: "track",
    qualityId: "showoff",
    states: Object.freeze(["boost", "coast", "stop", "settled"])
  })
]);

export function getRendererParityScenes(suite) {
  if (suite === "baseline") return BASELINE_SCENES;
  if (suite === "closure") return CLOSURE_SCENES;
  throw new Error(`Unsupported renderer parity suite ${JSON.stringify(suite)}.`);
}
