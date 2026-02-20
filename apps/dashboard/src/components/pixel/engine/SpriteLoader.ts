export interface SpriteFrame {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface SpriteAtlas {
  image: HTMLImageElement;
  frames: Record<string, SpriteFrame>;
  animations: Record<string, string[]>;
}

/** Load a sprite sheet PNG + JSON atlas. Returns null if loading fails. */
export async function loadSpriteAtlas(
  pngUrl: string,
  jsonUrl: string,
): Promise<SpriteAtlas | null> {
  try {
    const [img, atlasRes] = await Promise.all([
      loadImage(pngUrl),
      fetch(jsonUrl),
    ]);

    if (!atlasRes.ok) return null;

    const data = await atlasRes.json();
    return {
      image: img,
      frames: data.frames ?? {},
      animations: data.animations ?? {},
    };
  } catch {
    return null;
  }
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

/** Draw a single sprite frame from an atlas. */
export function drawSprite(
  ctx: CanvasRenderingContext2D,
  atlas: SpriteAtlas,
  frameName: string,
  dx: number,
  dy: number,
  dw?: number,
  dh?: number,
): boolean {
  const frame = atlas.frames[frameName];
  if (!frame) return false;
  ctx.drawImage(
    atlas.image,
    frame.x, frame.y, frame.w, frame.h,
    dx, dy,
    dw ?? frame.w, dh ?? frame.h,
  );
  return true;
}

/** Get animation frame name for a given animation at a specific frame index. */
export function getAnimFrame(atlas: SpriteAtlas, animName: string, frameIndex: number): string | null {
  const anim = atlas.animations[animName];
  if (!anim || anim.length === 0) return null;
  return anim[frameIndex % anim.length];
}
