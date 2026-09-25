/**
 * Image Slideshow's image sets: the stock photo libraries the Images popup
 * offers, each seeded from Pexels and Pixabay (see convex/imageSets.ts).
 *
 * `pexels` / `pixabay` are the search each source is seeded from -- Pexels
 * reads a descriptive phrase well, Pixabay matches on tags, so they differ.
 * `style` is the text style (lib/imageSlideshowTemplates.ts) a deck on this
 * set is written and laid out in: dark numbered tips over gym shots, a warm
 * lowercase story over lifestyle photos. Everything stays restylable in the
 * editor.
 *
 * Plain data, imported by both the browser and the server.
 */

export interface ImageSet {
  id: string;
  name: string;
  pexels: string;
  pixabay: string;
  /** Pixabay's own colour filter, for the sets defined by a colour treatment. */
  pixabayColors?: string;
  style: string;
}

const set = (
  name: string,
  pexels: string,
  pixabay: string,
  style: string,
  extra: Partial<ImageSet> = {},
): ImageSet => ({
  id: name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, ""),
  name,
  pexels,
  pixabay,
  style,
  ...extra,
});

export const IMAGE_SETS: ImageSet[] = [
  set("Airport Aesthetic", "airport aesthetic travel", "airport terminal", "honest-story"),
  set("Animals", "wild animals wildlife", "animals wildlife", "honest-story"),
  set("Art", "art painting studio", "art painting", "quiet-editorial"),
  set("Artificial Intelligence", "artificial intelligence technology", "artificial intelligence", "rules-boxes"),
  set("Athletic", "athlete training", "athlete", "dark-tips"),
  set("Beauty", "beauty skincare makeup", "beauty makeup", "honest-story"),
  set("Black and White", "black and white photography", "black and white", "quiet-editorial", {
    pixabayColors: "grayscale",
  }),
  set("Cars", "sports car aesthetic", "sports car", "dark-tips"),
  set("Christmas", "christmas aesthetic cozy", "christmas", "honest-story"),
  set("Coding/Developer", "programmer coding laptop", "programming code", "rules-boxes"),
  set("College/University", "college campus students", "university students", "snap-pov"),
  set("Concerts", "concert crowd lights", "concert", "snap-pov"),
  set("Crypto", "cryptocurrency bitcoin", "bitcoin cryptocurrency", "dark-tips"),
  set("Discipline/Habits", "early morning routine discipline", "morning routine", "dark-tips"),
  set("Dogs", "dog", "dog", "honest-story"),
  set("Entrepreneur/Hustle", "entrepreneur working late laptop", "entrepreneur", "rules-boxes"),
  set("Faceless Selfies", "mirror selfie phone covering face", "mirror selfie", "snap-pov"),
  set("Fashion", "street fashion outfit", "fashion", "honest-story"),
  set("Female Aesthetics", "aesthetic woman lifestyle", "woman aesthetic", "honest-story"),
  set("Female Selfies", "woman selfie", "woman selfie", "snap-pov"),
  set("Food/Cooking", "cooking food kitchen", "cooking", "honest-story"),
  set("Friendship/Community", "friends together laughing", "friends", "honest-story"),
  set("Gaming", "gaming setup", "gaming", "snap-pov"),
  set("General Aesthetics", "aesthetic", "aesthetic", "honest-story"),
  set("Generic Lifestyle", "lifestyle everyday life", "lifestyle", "honest-story"),
  set("Golf", "golf course golfer", "golf", "loud-listicle"),
  set("Gym", "gym workout", "gym", "dark-tips"),
  set("Home/Interior Design/Decor", "interior design living room", "interior design", "quiet-editorial"),
  set("Journaling", "journaling notebook coffee", "journal writing", "honest-story"),
  set("Low Exposure Aesthetics", "dark moody night aesthetic", "dark moody", "dark-tips"),
  set("Luxury", "luxury lifestyle", "luxury", "dark-tips"),
  set("Male Aesthetics", "man aesthetic moody", "man fashion", "dark-tips"),
  set("Male Selfies", "man selfie", "man selfie", "snap-pov"),
  set("Music/Instruments", "musical instruments guitar piano", "musical instrument", "honest-story"),
  set("Nature", "nature landscape", "nature landscape", "quiet-editorial"),
  set("Nutrition", "healthy food meal prep", "healthy food", "rules-boxes"),
  set("Parenting/Family", "parents children family", "family children", "honest-story"),
  set("Philosophy", "ancient statue sculpture", "statue sculpture", "quiet-editorial"),
  set("Reading/Books", "reading books cozy", "books reading", "quiet-editorial"),
  set("Relationship/Couples", "couple romantic", "couple love", "honest-story"),
  set("Running", "running runner", "running", "dark-tips"),
  set("Self Care/Wellness", "self care wellness spa", "wellness", "honest-story"),
  set("Spirituality", "meditation spiritual", "meditation", "quiet-editorial"),
  set("Sports/Fitness", "sports fitness", "sports", "loud-listicle"),
  set("Study/Productivity", "study desk productivity", "studying", "rules-boxes"),
  set("Sunsets", "sunset", "sunset", "quiet-editorial"),
  set("Surrealist Art", "surreal art", "surreal", "quiet-editorial"),
  set("Travel Scenery", "travel scenery destination", "travel landscape", "honest-story"),
  set("Wealth", "money wealth", "money", "dark-tips"),
  set("Work/Career", "office work career", "office work", "rules-boxes"),
  set("Ad Only Pins", "product flat lay minimal", "product mockup", "loud-listicle"),
];

/**
 * How the popup groups the sets: one heading per category, in this order,
 * and a chip for each above them. Every set belongs to exactly one.
 */
export const SET_CATEGORIES: { id: string; name: string; sets: string[] }[] = [
  {
    id: "aesthetics",
    name: "Aesthetics",
    sets: [
      "general-aesthetics",
      "female-aesthetics",
      "male-aesthetics",
      "low-exposure-aesthetics",
      "black-and-white",
      "airport-aesthetic",
      "luxury",
    ],
  },
  {
    id: "people",
    name: "People & selfies",
    sets: [
      "female-selfies",
      "male-selfies",
      "faceless-selfies",
      "fashion",
      "beauty",
      "relationship-couples",
      "friendship-community",
      "parenting-family",
    ],
  },
  {
    id: "fitness",
    name: "Fitness & sport",
    sets: ["gym", "athletic", "running", "sports-fitness", "golf", "discipline-habits"],
  },
  {
    id: "business",
    name: "Work & business",
    sets: [
      "work-career",
      "entrepreneur-hustle",
      "wealth",
      "crypto",
      "coding-developer",
      "artificial-intelligence",
      "study-productivity",
      "college-university",
      "ad-only-pins",
    ],
  },
  {
    id: "mind",
    name: "Mind & wellness",
    sets: ["self-care-wellness", "spirituality", "philosophy", "journaling", "reading-books", "nutrition"],
  },
  {
    id: "home",
    name: "Home & everyday",
    sets: ["generic-lifestyle", "home-interior-design-decor", "food-cooking", "christmas"],
  },
  {
    id: "outdoors",
    name: "Nature & animals",
    sets: ["travel-scenery", "nature", "sunsets", "animals", "dogs"],
  },
  {
    id: "culture",
    name: "Art & entertainment",
    sets: ["art", "surrealist-art", "music-instruments", "concerts", "gaming", "cars"],
  },
];

export const DEFAULT_IMAGE_SET = "general-aesthetics";
export const MAX_UPLOADED_IMAGES = 20;

const BY_ID = new Map(IMAGE_SETS.map((s) => [s.id, s]));

export function imageSetById(id: string): ImageSet | undefined {
  return BY_ID.get(id);
}

/**
 * The Images field's value, parsed. It is a string so the config snapshot
 * stays flat and readable: `set:gym`, or `uploads:<assetId>,<assetId>,...`
 * in the order the client picked them.
 */
export type ImageSource = { kind: "set"; set: ImageSet } | { kind: "uploads"; assetIds: string[] };

const ASSET_ID = /^[a-z0-9]{10,64}$/;

export function parseImageSource(value: unknown): ImageSource {
  const v = typeof value === "string" ? value : "";
  if (v.startsWith("uploads:")) {
    const assetIds = [...new Set(v.slice(8).split(","))]
      .filter((id) => ASSET_ID.test(id))
      .slice(0, MAX_UPLOADED_IMAGES);
    if (assetIds.length) return { kind: "uploads", assetIds };
  }
  const set = v.startsWith("set:") ? imageSetById(v.slice(4)) : undefined;
  return { kind: "set", set: set ?? BY_ID.get(DEFAULT_IMAGE_SET)! };
}

export function setValue(id: string): string {
  return `set:${id}`;
}

export function uploadsValue(assetIds: string[]): string {
  return `uploads:${assetIds.slice(0, MAX_UPLOADED_IMAGES).join(",")}`;
}

/** The text style a deck on this source is written in. Your own photos get the story style. */
export function styleFor(source: ImageSource): string {
  return source.kind === "set" ? source.set.style : "honest-story";
}

/** How many slides a deck runs to: the style's own count, or one per uploaded photo (3-12). */
export function slideCountFor(source: ImageSource, styleCount: number): number {
  return source.kind === "uploads" ? Math.min(12, Math.max(3, source.assetIds.length)) : styleCount;
}
