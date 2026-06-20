import * as THREE from "three";
import { debugEvent } from "./debugLog";

export type SkyboxId = "cyberpunk" | "aurora" | "orbital" | "neonArena";

export type SkyboxOption = {
  readonly id: SkyboxId;
  readonly label: string;
  readonly textureUrl: string;
  readonly fallbackTextureUrl: string;
  readonly textureWidthPixels: number;
  readonly clearColor: number;
  readonly fogColor: number;
  readonly fogDensityMultiplier: number;
  readonly verticalRepeat: number;
  readonly verticalOffset: number;
};

export const DEFAULT_SKYBOX_ID: SkyboxId = "cyberpunk";

export const SKYBOX_OPTIONS: readonly SkyboxOption[] = [
  {
    id: "cyberpunk",
    label: "Cyberpunk Skyline",
    textureUrl: "/skyboxes/cyberpunk-skyline.webp",
    fallbackTextureUrl: "/skyboxes/cyberpunk-skyline-4k.webp",
    textureWidthPixels: 8192,
    clearColor: 0x02070f,
    fogColor: 0x03121e,
    fogDensityMultiplier: 0.92,
    verticalRepeat: 1,
    verticalOffset: 0
  },
  {
    id: "aurora",
    label: "Aurora Observatory",
    textureUrl: "/skyboxes/aurora-observatory.webp",
    fallbackTextureUrl: "/skyboxes/aurora-observatory-4k.webp",
    textureWidthPixels: 8192,
    clearColor: 0x020817,
    fogColor: 0x061525,
    fogDensityMultiplier: 0.84,
    verticalRepeat: 0.86,
    verticalOffset: -0.1
  },
  {
    id: "orbital",
    label: "Orbital Megastructure",
    textureUrl: "/skyboxes/orbital-megastructure.webp",
    fallbackTextureUrl: "/skyboxes/orbital-megastructure-4k.webp",
    textureWidthPixels: 8192,
    clearColor: 0x05050d,
    fogColor: 0x0a0c17,
    fogDensityMultiplier: 0.9,
    verticalRepeat: 0.9,
    verticalOffset: -0.12
  },
  {
    id: "neonArena",
    label: "Neon Arena Skyline",
    textureUrl: "/skyboxes/neon-arena-skyline.webp",
    fallbackTextureUrl: "/skyboxes/neon-arena-skyline-4k.webp",
    textureWidthPixels: 8192,
    clearColor: 0x020711,
    fogColor: 0x031526,
    fogDensityMultiplier: 0.82,
    verticalRepeat: 1,
    verticalOffset: 0
  }
];

const SKYBOX_BY_ID = new Map(SKYBOX_OPTIONS.map((option) => [option.id, option]));
const SKY_DOME_RADIUS = 430;
const SKY_DOME_WIDTH_SEGMENTS = 128;
const SKY_DOME_HEIGHT_SEGMENTS = 64;
const SKYBOX_MAX_ANISOTROPY = 8;

export class SkyboxManager {
  private readonly loader = new THREE.TextureLoader();
  private readonly textures = new Map<string, THREE.Texture>();
  private readonly skyMaterial = new THREE.MeshBasicMaterial({
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    fog: false,
    toneMapped: false
  });
  private readonly skyDome = new THREE.Mesh(
    new THREE.SphereGeometry(SKY_DOME_RADIUS, SKY_DOME_WIDTH_SEGMENTS, SKY_DOME_HEIGHT_SEGMENTS),
    this.skyMaterial
  );
  private activeOption = getSkyboxOption(DEFAULT_SKYBOX_ID);
  private loadToken = 0;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly renderer: THREE.WebGLRenderer
  ) {
    // These generated panoramas are concept-art skyboxes, not calibrated HDRIs.
    // A camera-following dome gives us UV framing controls and sharper texture
    // filtering while still behaving like an infinitely distant background.
    this.skyDome.renderOrder = -10000;
    this.skyDome.frustumCulled = false;
    this.skyDome.onBeforeRender = (_renderer, _scene, camera) => {
      this.skyDome.position.copy(camera.position);
    };
    this.scene.add(this.skyDome);
  }

  setSkybox(id: SkyboxId): SkyboxOption {
    const option = getSkyboxOption(id);
    const textureChoice = this.chooseTexture(option);
    this.activeOption = option;
    this.renderer.setClearColor(option.clearColor, 1);
    this.scene.background = new THREE.Color(option.clearColor);

    const cachedTexture = this.textures.get(textureChoice.url);
    if (cachedTexture) {
      this.applyTexture(option, cachedTexture);
      return option;
    }

    // Use the theme clear color on the dome while the texture streams in. This
    // avoids a one-frame black flash when switching skyboxes from the pause menu.
    this.clearDome(option);
    const token = ++this.loadToken;
    this.loadTexture(option, textureChoice.url, textureChoice.tier, textureChoice.reason, token);

    return option;
  }

  getActiveOption(): SkyboxOption {
    return this.activeOption;
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.skyDome.geometry.dispose();
    this.skyMaterial.dispose();
  }

  private chooseTexture(option: SkyboxOption): { url: string; tier: "8k" | "4k"; reason: string } {
    if (this.renderer.capabilities.maxTextureSize < option.textureWidthPixels) {
      return {
        url: option.fallbackTextureUrl,
        tier: "4k",
        reason: `maxTextureSize ${this.renderer.capabilities.maxTextureSize} < ${option.textureWidthPixels}`
      };
    }

    return {
      url: option.textureUrl,
      tier: "8k",
      reason: "high-res supported"
    };
  }

  private loadTexture(
    option: SkyboxOption,
    textureUrl: string,
    textureTier: "8k" | "4k",
    textureReason: string,
    token: number
  ): void {
    this.loader.load(
      textureUrl,
      (texture) => {
        configureSkyboxTexture(texture, this.renderer, option);
        this.textures.set(textureUrl, texture);
        if (token !== this.loadToken || this.activeOption.id !== option.id) return;
        this.applyTexture(option, texture);
        debugEvent("skybox.load", "Skybox texture loaded", {
          skybox: option.id,
          label: option.label,
          textureUrl,
          textureTier,
          textureReason,
          width: texture.image?.width ?? 0,
          height: texture.image?.height ?? 0,
          verticalRepeat: option.verticalRepeat,
          verticalOffset: option.verticalOffset
        }, "info");
      },
      undefined,
      (error) => {
        if (token !== this.loadToken || this.activeOption.id !== option.id) return;
        if (textureUrl !== option.fallbackTextureUrl) {
          debugEvent("skybox.fallback", "High-res skybox failed; loading fallback texture", {
            skybox: option.id,
            label: option.label,
            textureUrl,
            fallbackTextureUrl: option.fallbackTextureUrl,
            error: String(error)
          }, "warn");
          this.loadTexture(option, option.fallbackTextureUrl, "4k", "high-res load failed", token);
          return;
        }

        this.clearDome(option);
        debugEvent("skybox.error", "Skybox texture failed to load", {
          skybox: option.id,
          label: option.label,
          textureUrl,
          error: String(error)
        }, "warn");
      }
    );
  }

  private applyTexture(option: SkyboxOption, texture: THREE.Texture): void {
    texture.repeat.set(1, option.verticalRepeat);
    texture.offset.set(0, option.verticalOffset);
    this.skyMaterial.map = texture;
    this.skyMaterial.color.set(0xffffff);
    this.skyMaterial.needsUpdate = true;
  }

  private clearDome(option: SkyboxOption): void {
    this.skyMaterial.map = null;
    this.skyMaterial.color.setHex(option.clearColor);
    this.skyMaterial.needsUpdate = true;
  }
}

export function getSkyboxOption(id: SkyboxId): SkyboxOption {
  return SKYBOX_BY_ID.get(id) ?? SKYBOX_BY_ID.get(DEFAULT_SKYBOX_ID)!;
}

export function isSkyboxId(value: string): value is SkyboxId {
  return SKYBOX_BY_ID.has(value as SkyboxId);
}

function configureSkyboxTexture(
  texture: THREE.Texture,
  renderer: THREE.WebGLRenderer,
  option: SkyboxOption
): void {
  // These are visible art assets on a UV sphere, so keep the filtering friendly
  // for camera pans: mipmaps reduce shimmer and anisotropy helps low-angle
  // skyline detail stay less crunchy.
  texture.mapping = THREE.UVMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.anisotropy = Math.min(SKYBOX_MAX_ANISOTROPY, renderer.capabilities.getMaxAnisotropy());
  texture.repeat.set(1, option.verticalRepeat);
  texture.offset.set(0, option.verticalOffset);
  texture.needsUpdate = true;
}
