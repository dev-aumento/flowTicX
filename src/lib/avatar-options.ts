export const AVATAR_PRESET_SEEDS = [
  "Alex",
  "Sarah",
  "Emily",
  "Jordan",
  "Taylor",
  "Morgan",
  "Casey",
  "Riley",
  "Avery",
  "Quinn",
  "Blake",
  "Dakota",
] as const;

export function avatarPresetUrl(seed: string) {
  return `https://api.dicebear.com/7.x/avataaars/svg?seed=${encodeURIComponent(seed)}`;
}

export const AVATAR_PRESETS = AVATAR_PRESET_SEEDS.map((seed) => ({
  seed,
  url: avatarPresetUrl(seed),
}));

export const MAX_AVATAR_UPLOAD_BYTES = 10 * 1024 * 1024;
