/**
 * Activity-specific rules — what each outdoor activity tolerates.
 *
 * Each activity defines:
 *   - idealTemp / tempMin / tempMax     (°C, apparent)
 *   - maxWindKph                         (sustained)
 *   - maxGustKph
 *   - maxPrecipProb                      (%)
 *   - maxPrecipMm                        (mm in that hour)
 *   - minVisibilityM
 *   - maxUvIndex                         (hard limit; else shade/SPF advice)
 *   - requiresDaylight                   (must be after sunrise, before sunset)
 *   - idealDaylight                      (preferred daylight)
 *   - maxAqiEuropean                      (0..100 European AQI)
 *   - minHumidity, maxHumidity           (% RH)
 *   - minGreenCount                       (geospatial preference: parks nearby)
 *   - maxArterialRoads                    (geospatial constraint)
 *   - maxIndustryCount
 *   - tags                               (must-have venue tags, e.g. sport=cricket)
 *   - advice                              (carry / watch for)
 *   - avoid                               (when to avoid)
 *   - personalAdjust                      (profile → tightened thresholds)
 */

import type { ActivityKind } from "@/lib/geo/overpass";

export interface PersonalProfile {
  hasAsthma?: boolean;
  isSenior?: boolean;
  isChild?: boolean;
  isPregnant?: boolean;
  notes?: string;
}

export interface ActivityRule {
  key: ActivityKind;
  label: string;
  description: string;
  tempMin: number;
  tempMax: number;
  idealTemp: [number, number];
  maxWindKph: number;
  maxGustKph: number;
  maxPrecipProb: number;
  maxPrecipMm: number;
  minVisibilityM: number;
  maxUvIndex: number;
  requiresDaylight: boolean;
  idealDaylight: boolean;
  maxAqiEuropean: number;
  minHumidity: number;
  maxHumidity: number;
  minGreenCount: number;
  maxArterialRoads: number;
  maxIndustryCount: number;
  advice: { carry: string[]; watch: string[] };
  avoid: string[];
}

export const ACTIVITY_RULES: Record<ActivityKind, ActivityRule> = {
  running: {
    key: "running",
    label: "Running / jogging",
    description: "Steady aerobic run on track, trail or quiet footpath.",
    tempMin: 8, tempMax: 34, idealTemp: [14, 22],
    maxWindKph: 28, maxGustKph: 40,
    maxPrecipProb: 35, maxPrecipMm: 0.5,
    minVisibilityM: 1500,
    maxUvIndex: 7,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 50,
    minHumidity: 30, maxHumidity: 85,
    minGreenCount: 1, maxArterialRoads: 2, maxIndustryCount: 0,
    advice: {
      carry: ["Water (500 ml+)", "Reflective band if low light", "Phone for safety"],
      watch: ["Traffic when crossing roads", "Uneven pavement", "Heat & humidity", "AQ near industry"],
    },
    avoid: ["UV > 7 around noon", "Wind > 28 kph", "AQI > 50 (asthma)"],
  },
  cycling: {
    key: "cycling",
    label: "Cycling (leisure or commute)",
    description: "Bike ride for fitness or to commute; tolerates cooler temps.",
    tempMin: 5, tempMax: 36, idealTemp: [12, 24],
    maxWindKph: 25, maxGustKph: 38,
    maxPrecipProb: 25, maxPrecipMm: 0.3,
    minVisibilityM: 2000,
    maxUvIndex: 7,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 60,
    minHumidity: 25, maxHumidity: 85,
    minGreenCount: 0, maxArterialRoads: 3, maxIndustryCount: 1,
    advice: {
      carry: ["Helmet", "Lights if dusk", "Tube/patch kit", "Water"],
      watch: ["Trucks & fast traffic", "Slippery when wet", "Crosswinds on bridges", "Roadworks"],
    },
    avoid: ["Wet roads (after rain)", "Strong crosswinds", "Heavy AQI in industry corridors"],
  },
  golf: {
    key: "golf",
    label: "Golf",
    description: "9- or 18-hole round on a golf course.",
    tempMin: 10, tempMax: 32, idealTemp: [16, 26],
    maxWindKph: 22, maxGustKph: 30,
    maxPrecipProb: 20, maxPrecipMm: 0.1,
    minVisibilityM: 3000,
    maxUvIndex: 8,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 60,
    minHumidity: 30, maxHumidity: 80,
    minGreenCount: 2, maxArterialRoads: 1, maxIndustryCount: 0,
    advice: {
      carry: ["Sun hat", "SPF 30+", "Water", "Towel", "Rain sleeve"],
      watch: ["Lightning (stop play)", "Slow play ahead", "Heat fatigue 14:00–16:00"],
    },
    avoid: ["Lightning within 10 km", "Wind > 22 kph", "Wet greens"],
  },
  cricket: {
    key: "cricket",
    label: "Cricket (recreational)",
    description: "Recreational match or practice on a cricket pitch.",
    tempMin: 10, tempMax: 34, idealTemp: [16, 28],
    maxWindKph: 22, maxGustKph: 30,
    maxPrecipProb: 15, maxPrecipMm: 0.0,
    minVisibilityM: 2000,
    maxUvIndex: 8,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 60,
    minHumidity: 30, maxHumidity: 80,
    minGreenCount: 1, maxArterialRoads: 1, maxIndustryCount: 0,
    advice: {
      carry: ["Sun hat", "Water 1 L", "SPF 30+", "First-aid kit", "Pads if hard ball"],
      watch: ["Wet pitch (slip hazard)", "Strong wind on bowling", "Heat in full sun"],
    },
    avoid: ["Any rain on pitch", "Lightning", "Wind > 22 kph (affects bowling)"],
  },
  football: {
    key: "football",
    label: "Football / five-a-side",
    description: "Outdoor football match on a pitch.",
    tempMin: 8, tempMax: 32, idealTemp: [14, 24],
    maxWindKph: 25, maxGustKph: 35,
    maxPrecipProb: 30, maxPrecipMm: 0.5,
    minVisibilityM: 1500,
    maxUvIndex: 8,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 60,
    minHumidity: 30, maxHumidity: 85,
    minGreenCount: 0, maxArterialRoads: 1, maxIndustryCount: 0,
    advice: {
      carry: ["Water", "Studs / astro trainers", "Sun cap (goalkeeper)"],
      watch: ["Wet ground (slip)", "Wind on long balls", "Heat exhaustion 14:00–16:00"],
    },
    avoid: ["Lightning", "Frozen ground", "Smoke / heavy AQI"],
  },
  tennis: {
    key: "tennis",
    label: "Outdoor tennis",
    description: "Singles or doubles on an outdoor hard / clay court.",
    tempMin: 8, tempMax: 32, idealTemp: [16, 26],
    maxWindKph: 20, maxGustKph: 28,
    maxPrecipProb: 10, maxPrecipMm: 0.0,
    minVisibilityM: 2000,
    maxUvIndex: 7,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 55,
    minHumidity: 30, maxHumidity: 75,
    minGreenCount: 0, maxArterialRoads: 1, maxIndustryCount: 0,
    advice: {
      carry: ["SPF 30+ (reapply)", "Water", "Cap / visor", "Spare balls"],
      watch: ["Wind on serve", "Wet court (slip)", "Sun in eyes on one side"],
    },
    avoid: ["Rain (court slippery)", "Wind > 20 kph (serve)", "Mid-day UV > 7"],
  },
  hiking: {
    key: "hiking",
    label: "Hiking / nature walk",
    description: "Trail walk or short hike on a path or nature reserve.",
    tempMin: 6, tempMax: 32, idealTemp: [12, 24],
    maxWindKph: 30, maxGustKph: 45,
    maxPrecipProb: 40, maxPrecipMm: 1.5,
    minVisibilityM: 1500,
    maxUvIndex: 8,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 60,
    minHumidity: 30, maxHumidity: 90,
    minGreenCount: 1, maxArterialRoads: 2, maxIndustryCount: 1,
    advice: {
      carry: ["Water 1–2 L", "Trail snack", "Phone + power bank", "First aid", "Light jacket"],
      watch: ["Slippery rocks after rain", "Sudden fog at elevation", "Trail closure signs", "Snake season"],
    },
    avoid: ["Thunderstorm", "Dense fog", "Heat wave > 32°C"],
  },
  picnic: {
    key: "picnic",
    label: "Picnic / park outing",
    description: "Relaxed outdoor meal in a park or garden.",
    tempMin: 12, tempMax: 34, idealTemp: [18, 28],
    maxWindKph: 20, maxGustKph: 28,
    maxPrecipProb: 15, maxPrecipMm: 0.0,
    minVisibilityM: 2000,
    maxUvIndex: 8,
    requiresDaylight: true, idealDaylight: true,
    maxAqiEuropean: 55,
    minHumidity: 30, maxHumidity: 75,
    minGreenCount: 2, maxArterialRoads: 1, maxIndustryCount: 0,
    advice: {
      carry: ["Mat / sheet", "Water", "Sun hat", "Insect repellent", "Trash bag"],
      watch: ["Ants & monkeys", "Sun exposure 12:00–14:00", "Wind toppling things"],
    },
    avoid: ["Rain", "Wind > 20 kph", "Industrial-smell zones"],
  },
  event: {
    key: "event",
    label: "Outdoor event / gathering",
    description: "Wedding, fair, birthday party or community gathering outdoors.",
    tempMin: 14, tempMax: 32, idealTemp: [18, 26],
    maxWindKph: 18, maxGustKph: 26,
    maxPrecipProb: 10, maxPrecipMm: 0.0,
    minVisibilityM: 2000,
    maxUvIndex: 7,
    requiresDaylight: false, idealDaylight: true,
    maxAqiEuropean: 55,
    minHumidity: 30, maxHumidity: 75,
    minGreenCount: 1, maxArterialRoads: 1, maxIndustryCount: 0,
    advice: {
      carry: ["Shade canopy / tent", "Water + electrolytes", "Sun hat", "Backup indoor venue"],
      watch: ["Sudden showers", "Wind on décor", "Power for AV"],
    },
    avoid: ["Rain probability > 10%", "Wind > 18 kph", "Industrial smell nearby"],
  },
  photography: {
    key: "photography",
    label: "Outdoor photography",
    description: "Sunset / landscape / street photography session.",
    tempMin: 6, tempMax: 36, idealTemp: [14, 28],
    maxWindKph: 30, maxGustKph: 40,
    maxPrecipProb: 40, maxPrecipMm: 1.0,
    minVisibilityM: 1000,
    maxUvIndex: 9,
    requiresDaylight: false, idealDaylight: false,
    maxAqiEuropean: 70,
    minHumidity: 25, maxHumidity: 90,
    minGreenCount: 1, maxArterialRoads: 3, maxIndustryCount: 1,
    advice: {
      carry: ["Tripod", "Microfibre cloth", "Spare battery", "Wide + tele lens", "Rain cover"],
      watch: ["Lens fog from humidity", "Spray near waterfalls", "Golden hour 30 min before sunset"],
    },
    avoid: ["Heavy rain (gear risk)", "Dust storm"],
  },
};

export const ACTIVITY_LIST = Object.values(ACTIVITY_RULES);

// Personal profile adjustments — tighten thresholds further.
export function adjustForProfile(
  rule: ActivityRule,
  profile: PersonalProfile
): ActivityRule {
  let r = { ...rule };
  if (profile.hasAsthma) {
    r.maxAqiEuropean = Math.min(r.maxAqiEuropean, 30);
    r.maxWindKph = Math.min(r.maxWindKph, 18);
    r.maxGustKph = Math.min(r.maxGustKph, 25);
    r.tempMin = Math.max(r.tempMin, 12);
    r.advice = {
      carry: [...r.advice.carry, "Inhaler", "Spacer"],
      watch: [...r.advice.watch, "Air quality near expressways & industry", "Cold dry air triggering bronchospasm"],
    };
    r.avoid = [...r.avoid, "AQI > 30 (asthma)", "Cold, dry, windy mornings"];
  }
  if (profile.isSenior) {
    r.tempMin = Math.max(r.tempMin, 12);
    r.tempMax = Math.min(r.tempMax, 30);
    r.maxUvIndex = Math.min(r.maxUvIndex, 6);
    r.maxWindKph = Math.min(r.maxWindKph, 20);
    r.maxAqiEuropean = Math.min(r.maxAqiEuropean, 50);
    r.advice = {
      carry: [...r.advice.carry, "Walking stick (if used)", "Medications + ID card"],
      watch: [...r.advice.watch, "Slip hazard on wet ground", "Heat stress for > 65s"],
    };
    r.avoid = [...r.avoid, "Mid-day heat > 30°C", "Icy patches"];
  }
  if (profile.isChild) {
    r.tempMin = Math.max(r.tempMin, 12);
    r.tempMax = Math.min(r.tempMax, 30);
    r.maxUvIndex = Math.min(r.maxUvIndex, 6);
    r.maxAqiEuropean = Math.min(r.maxAqiEuropean, 40);
    r.advice = {
      carry: [...r.advice.carry, "Sun hat", "Water + light snack", "Adult supervision"],
      watch: [...r.advice.watch, "Sun exposure 11:00–15:00", "Hot equipment in sun"],
    };
    r.avoid = [...r.avoid, "Mid-day sun", "Strong wind (> 20 kph)"];
  }
  if (profile.isPregnant) {
    r.tempMin = Math.max(r.tempMin, 12);
    r.tempMax = Math.min(r.tempMax, 28);
    r.maxUvIndex = Math.min(r.maxUvIndex, 6);
    r.maxAqiEuropean = Math.min(r.maxAqiEuropean, 45);
    r.advice = {
      carry: [...r.advice.carry, "Water 1 L+", "Snack", "Phone"],
      watch: [...r.advice.watch, "Heat & dehydration", "Dizziness, sit down"],
    };
    r.avoid = [...r.avoid, "Heat > 28°C", "High UV mid-day"];
  }
  return r;
}

// Synonyms used by the parser to map free-form text → ActivityKind.
export const ACTIVITY_SYNONYMS: Record<string, ActivityKind> = {
  running: "running", run: "running", jog: "running", jogging: "running", "morning walk": "running", walk: "hiking", runningtrack: "running", "jogging track": "running",
  cycling: "cycling", cycle: "cycling", bike: "cycling", bicycling: "cycling", "bike to work": "cycling", commute: "cycling",
  golf: "golf", golfing: "golf",
  cricket: "cricket", cricketing: "cricket", gully: "cricket",
  football: "football", soccer: "football", fives: "football", "five a side": "football", "5-a-side": "football",
  tennis: "tennis",
  hiking: "hiking", hike: "hiking", trail: "hiking", "nature walk": "hiking", ramble: "hiking", trek: "hiking",
  picnic: "picnic", outing: "picnic", "park outing": "picnic",
  event: "event", wedding: "event", fair: "event", party: "event", "birthday party": "event", gathering: "event",
  photography: "photography", photos: "photography", photo: "photography", "sunset photos": "photography", "sunrise photos": "photography", "landscape photo": "photography",
};
