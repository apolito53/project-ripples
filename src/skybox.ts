import * as THREE from "three";
import { debugEvent } from "./debugLog";

export type SkyboxId = "cyberpunk" | "aurora" | "orbital";

export type SkyboxOption = {
  readonly id: SkyboxId;
  readonly label: string;
  readonly textureUrl: string;
  readonly clearColor: number;
  readonly fogColor: number;
  readonly fogDensityMultiplier: number;
};

export const DEFAULT_SKYBOX_ID: SkyboxId = "cyberpunk";

export const SKYBOX_OPTIONS: readonly SkyboxOption[] = [
  {
    id: "cyberpunk",
    label: "Cyberpunk Skyline",
    textureUrl: "/skyboxes/cyberpunk-skyline.webp",
    clearColor: 0x02070f,
    fogColor: 0x03121e,
    fogDensityMultiplier: 0.92
  },
  {
    id: "aurora",
    label: "Aurora Observatory",
    textureUrl: "/skyboxes/aurora-observatory.webp",
    clearColor: 0x020817,
    fogColor: 0x061525,
    fogDensityMultiplier: 0.84
  },
  {
    id: "orbital",
    label: "Orbital Megastructure",
    textureUrl: "/skyboxes/orbital-megastructure.webp",
    clearColor: 0x05050d,
    fogColor: 0x0a0c17,
    fogDensityMultiplier: 0.9
  }
];

const SKYBOX_BY_ID = new Map(SKYBOX_OPTIONS.map((option) => [option.id, option]));

export class SkyboxManager {
  private readonly loader = new THREE.TextureLoader();
  private readonly textures = new Map<SkyboxId, THREE.Texture>();
  private activeOption = getSkyboxOption(DEFAULT_SKYBOX_ID);
  private loadToken = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer
  ) {}

  setSkybox(id: SkyboxId): SkyboxOption {
    const option = getSkyboxOption(id);
    this.activeOption = option;
    this.renderer.setClearColor(option.clearColor, 1);

    const cachedTexture = this.textures.get(option.id);
    if (cachedTexture) {
      this.scene.background = cachedTexture;
      return option;
    }

    // Use the theme clear color while the texture streams in. This avoids a
    // one-frame black flash when switching skyboxes from the pause menu.
    this.scene.background = new THREE.Color(option.clearColor);
    const token = ++this.loadToken;
    this.loader.load(
      option.textureUrl,
      (texture) => {
        configureSkyboxTexture(texture);
        this.textures.set(option.id, texture);
        if (token !== this.loadToken || this.activeOption.id !== option.id) return;
        this.scene.background = texture;
        debugEvent("skybox.load", "Skybox texture loaded", {
          skybox: option.id,
          label: option.label,
          textureUrl: option.textureUrl,
          width: texture.image?.width ?? 0,
          height: texture.image?.height ?? 0
        }, "info");
      },
      undefined,
      (error) => {
        if (token !== this.loadToken || this.activeOption.id !== option.id) return;
        this.scene.background = new THREE.Color(option.clearColor);
        debugEvent("skybox.error", "Skybox texture failed to load", {
          skybox: option.id,
          label: option.label,
          textureUrl: option.textureUrl,
          error: String(error)
        }, "warn");
      }
    );

    return option;
  }

  getActiveOption(): SkyboxOption {
    return this.activeOption;
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
  }
}

export function getSkyboxOption(id: SkyboxId): SkyboxOption {
  return SKYBOX_BY_ID.get(id) ?? SKYBOX_BY_ID.get(DEFAULT_SKYBOX_ID)!;
}

export function isSkyboxId(value: string): value is SkyboxId {
  return SKYBOX_BY_ID.has(value as SkyboxId);
}

function configureSkyboxTexture(texture: THREE.Texture): void {
  // The generated assets are panoramic equirectangular textures. Three can use
  // them directly as scene backgrounds once mapping and color space are explicit.
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
}
