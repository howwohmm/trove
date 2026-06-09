// aesthetic vocabulary: embedded once with CLIP text tower, cached in kv.
// facet centroid · word vector = which words describe a taste cluster.
// drives unsplash retrieval (facet → keywords → search) and facet labels —
// zero llm cost (v1 lane-3 learning).

export const VOCAB: string[] = [
  // photography styles
  "film photography", "black and white photography", "analog photography",
  "street photography", "documentary photography", "editorial photography",
  "long exposure", "double exposure", "soft focus", "grainy photo",
  "polaroid", "cinematic still", "35mm film", "infrared photography",
  // architecture + space
  "brutalist architecture", "minimal architecture", "japanese architecture",
  "mid century modern interior", "concrete building", "spiral staircase",
  "empty room", "abandoned building", "cathedral interior", "tokyo street",
  "narrow alley", "rooftop view", "scandinavian interior", "courtyard",
  // nature + landscape
  "fog mountains", "misty forest", "alpine lake", "desert dunes",
  "ocean waves", "moody seascape", "rolling hills", "volcanic landscape",
  "snowfield", "glacier", "wildflower meadow", "palm trees",
  "rainforest canopy", "river delta aerial", "salt flats", "northern lights",
  // light + mood
  "golden hour light", "blue hour", "harsh shadows", "chiaroscuro",
  "neon glow", "candlelight", "overcast mood", "sun rays through window",
  "silhouette", "backlit portrait", "night city lights", "moonlight",
  // color worlds
  "monochrome", "muted earth tones", "pastel colors", "high contrast",
  "warm amber tones", "cool blue tones", "sepia", "vivid saturated color",
  "dark moody tones", "cream and beige", "forest green palette", "terracotta",
  // subjects
  "portrait of a stranger", "hands working", "solitary figure", "crowd from above",
  "old man portrait", "dancer in motion", "musician on stage", "market vendor",
  "fisherman at dawn", "monk in robes", "child playing", "elderly couple",
  // texture + detail
  "weathered wood", "rusted metal", "cracked paint", "marble texture",
  "linen fabric", "water droplets", "smoke swirl", "ink in water",
  "dried flowers", "paper texture", "ceramic glaze", "woven pattern",
  // urban + objects
  "vintage car", "bicycle against wall", "neon sign", "laundromat",
  "diner interior", "gas station at night", "subway platform", "telephone booth",
  "bookshop", "record store", "barbershop", "fire escape stairs",
  // graphic + abstract
  "geometric abstraction", "minimalist composition", "negative space",
  "symmetry", "repeating pattern", "aerial geometry", "shadow play",
  "reflection in glass", "motion blur", "bokeh", "color field", "grid pattern",
  // craft + still life
  "still life with fruit", "coffee on table", "fresh bread", "pottery studio",
  "botanical illustration", "open notebook", "tailor workshop", "darkroom prints",
  // animals
  "horse in fog", "birds in flight", "stray cat", "whale underwater",
  "mountain goat", "swan on lake",
  // seasons + weather
  "first snow", "autumn leaves", "summer haze", "spring blossom",
  "rainstorm window", "frost pattern", "heat shimmer", "morning dew",
];
