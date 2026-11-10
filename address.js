// Address autocomplete + verification for the catering form.
//
// Customers pick their event address from real, geocoded suggestions
// (so typos and made-up addresses don't get through). Provider:
//   - Google Places (best accuracy) when GOOGLE_MAPS_API_KEY is set, else
//   - Photon (OpenStreetMap data, free, no key) as the default.
// Both are called from the SERVER so no key is ever exposed to browsers.
// Results are biased to the Cleveland area.

const CLEVELAND = { lat: 41.4993, lon: -81.6944 };

const STATES = {
  Alabama: "AL", Alaska: "AK", Arizona: "AZ", Arkansas: "AR", California: "CA", Colorado: "CO", Connecticut: "CT",
  Delaware: "DE", Florida: "FL", Georgia: "GA", Hawaii: "HI", Idaho: "ID", Illinois: "IL", Indiana: "IN", Iowa: "IA",
  Kansas: "KS", Kentucky: "KY", Louisiana: "LA", Maine: "ME", Maryland: "MD", Massachusetts: "MA", Michigan: "MI",
  Minnesota: "MN", Mississippi: "MS", Missouri: "MO", Montana: "MT", Nebraska: "NE", Nevada: "NV", "New Hampshire": "NH",
  "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", Ohio: "OH",
  Oklahoma: "OK", Oregon: "OR", Pennsylvania: "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD",
  Tennessee: "TN", Texas: "TX", Utah: "UT", Vermont: "VT", Virginia: "VA", Washington: "WA", "West Virginia": "WV",
  Wisconsin: "WI", Wyoming: "WY", "District of Columbia": "DC",
};

const PHOTON_URL = process.env.PHOTON_URL || "https://photon.komoot.io/api/";

async function suggestPhoton(q) {
  const params = new URLSearchParams({ q, limit: "10", lang: "en", lat: String(CLEVELAND.lat), lon: String(CLEVELAND.lon) });
  const res = await fetch(`${PHOTON_URL}?${params}`, { headers: { "User-Agent": "CleSmashBurgers/1.0 (catering address lookup)" } });
  if (!res.ok) throw new Error(`Photon HTTP ${res.status}`);
  const data = await res.json();
  const seen = new Set();
  const out = [];
  for (const f of data.features || []) {
    const p = f.properties || {};
    if (p.countrycode !== "US" || !p.housenumber || !p.street || !p.city) continue; // street-address level only
    const state = STATES[p.state] || p.state || "";
    const label = `${p.housenumber} ${p.street}, ${p.city}, ${state}${p.postcode ? " " + p.postcode : ""}`;
    if (seen.has(label)) continue;
    seen.add(label);
    out.push({ label });
    if (out.length >= 6) break;
  }
  return out;
}

async function suggestGoogle(q) {
  const res = await fetch("https://places.googleapis.com/v1/places:autocomplete", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Goog-Api-Key": process.env.GOOGLE_MAPS_API_KEY },
    body: JSON.stringify({
      input: q,
      includedRegionCodes: ["us"],
      includedPrimaryTypes: ["street_address", "subpremise", "premise"],
      locationBias: { circle: { center: { latitude: CLEVELAND.lat, longitude: CLEVELAND.lon }, radius: 50000 } },
    }),
  });
  if (!res.ok) throw new Error(`Google HTTP ${res.status}`);
  const data = await res.json();
  return (data.suggestions || [])
    .map((s) => s.placePrediction)
    .filter(Boolean)
    .slice(0, 6)
    .map((p) => ({ label: String(p.text && p.text.text || "").replace(/, USA$/, ""), placeId: p.placeId }));
}

async function suggest(q) {
  const query = String(q || "").trim().slice(0, 120);
  if (query.length < 4) return { suggestions: [] };
  const suggestions = process.env.GOOGLE_MAPS_API_KEY ? await suggestGoogle(query) : await suggestPhoton(query);
  return { suggestions };
}

module.exports = { suggest };
