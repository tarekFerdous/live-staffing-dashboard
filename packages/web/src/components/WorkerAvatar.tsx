// Stock portraits from Unsplash (Unsplash License), credited in the README. The names and details
// are made-up demo data; these are models, not the people named.
import amara from '../assets/workers/amara.webp'; // alex starnes
import liam from '../assets/workers/liam.webp'; // Hà Nguyễn
import sofia from '../assets/workers/sofia.webp'; // Jake Nackos
import { WorkerIcon } from './icons';

/** Bundled photos by worker id. Only the seeded workers have one; anyone else gets the icon. */
export const WORKER_PHOTOS: Readonly<Record<string, string>> = { amara, liam, sofia };

/**
 * A worker's face, filling the round badge it sits in (the card header's, or a bigger one), or the
 * person icon when there's no photo. Decorative: the name is always right next to it.
 */
export function WorkerAvatar({ workerId, iconSize }: { workerId: string; iconSize?: number }) {
  const src = WORKER_PHOTOS[workerId];
  return src ? (
    <img
      src={src}
      alt=""
      decoding="async"
      data-testid="worker-photo"
      className="h-full w-full rounded-full object-cover"
    />
  ) : (
    <WorkerIcon size={iconSize} />
  );
}
