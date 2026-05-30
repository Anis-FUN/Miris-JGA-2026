const STORAGE_KEY = "jga_progress_v3";

let map;
let userMarker;
let visibleTargetMarker;
let visibleLegLine;
let stationsData = null;
let routeTrack = [];
let legRanges = [];
let lastUserLatLng = null;

const startIcon = L.divIcon({
  className: "stationIcon startIcon",
  html: "S",
  iconSize: [32, 32],
  iconAnchor: [16, 16]
});

const targetIcon = L.divIcon({
  className: "stationIcon nextIcon",
  html: "★",
  iconSize: [34, 34],
  iconAnchor: [17, 17]
});

function loadProgress() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return { unlocked: 0 };

  try {
    const parsed = JSON.parse(raw);
    return {
      unlocked: Number.isInteger(parsed.unlocked) ? parsed.unlocked : 0
    };
  } catch {
    return { unlocked: 0 };
  }
}

function saveProgress(progress) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
}

function normalizeCode(value) {
  return (value || "")
    .trim()
    .replace(/\s+/g, " ")
    .toLocaleUpperCase("de-DE");
}

function haversineMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const toRad = (v) => (v * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);

  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLon / 2) ** 2;

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function fmtDistance(meters) {
  if (meters == null) return "—";
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

function setStatus(text) {
  document.getElementById("status").textContent = text;
}

function setFeedback(text, ok) {
  const el = document.getElementById("feedback");
  el.textContent = text;
  el.className = "feedback " + (ok ? "ok" : "bad");
}

function getCurrentChallenge(progress) {
  return stationsData.challenges[progress.unlocked] || null;
}

function getVisibleTarget(progress) {
  if (progress.unlocked <= 0) return null;
  return stationsData.waypoints[progress.unlocked] || null;
}

function getVisibleStartOfLeg(progress) {
  if (progress.unlocked <= 0) return null;
  return stationsData.waypoints[progress.unlocked - 1] || null;
}

function findClosestIndex(points, waypoint, startIndex = 0) {
  let bestIndex = startIndex;
  let bestDistance = Infinity;

  for (let i = startIndex; i < points.length; i++) {
    const p = points[i];
    const d = haversineMeters(p[0], p[1], waypoint.lat, waypoint.lon);

    if (d < bestDistance) {
      bestDistance = d;
      bestIndex = i;
    }
  }

  return bestIndex;
}

function buildLegRanges() {
  legRanges = [];

  if (!routeTrack.length || !stationsData?.waypoints?.length) return;

  let searchFrom = 0;

  for (let i = 1; i < stationsData.waypoints.length; i++) {
    const fromWp = stationsData.waypoints[i - 1];
    const toWp = stationsData.waypoints[i];

    const fromIndex = findClosestIndex(routeTrack, fromWp, searchFrom);
    const toIndex = findClosestIndex(routeTrack, toWp, fromIndex);

    legRanges[i] = {
      fromIndex,
      toIndex
    };

    searchFrom = toIndex;
  }
}

async function loadRouteTrackHidden() {
  try {
    const res = await fetch("route.gpx", { cache: "no-store" });
    if (!res.ok) throw new Error("route.gpx nicht gefunden");

    const gpxText = await res.text();
    const parser = new DOMParser();
    const xml = parser.parseFromString(gpxText, "application/xml");

    const trkpts = [...xml.getElementsByTagNameNS("*", "trkpt")];

    routeTrack = trkpts
      .map((pt) => [
        Number(pt.getAttribute("lat")),
        Number(pt.getAttribute("lon"))
      ])
      .filter(([lat, lon]) => Number.isFinite(lat) && Number.isFinite(lon));

    buildLegRanges();
    setStatus("Route geladen.");
  } catch (err) {
    console.warn(err);
    routeTrack = [];
    legRanges = [];
    setStatus("Route nicht gefunden. Direkte Linie aktiv.");
  }
}

function getRouteSegmentForUnlocked(unlocked) {
  const fromWp = stationsData.waypoints[unlocked - 1];
  const toWp = stationsData.waypoints[unlocked];

  if (!fromWp || !toWp) return [];

  const fallback = [
    [fromWp.lat, fromWp.lon],
    [toWp.lat, toWp.lon]
  ];

  const range = legRanges[unlocked];

  if (!routeTrack.length || !range) return fallback;

  const segment = routeTrack.slice(range.fromIndex, range.toIndex + 1);

  if (segment.length < 2) return fallback;

  return [
    [fromWp.lat, fromWp.lon],
    ...segment,
    [toWp.lat, toWp.lon]
  ];
}

function updateVisibleTarget(progress) {
  const target = getVisibleTarget(progress);

  if (!target) {
    if (visibleTargetMarker) {
      visibleTargetMarker.remove();
      visibleTargetMarker = null;
    }
    return;
  }

  const latLng = [target.lat, target.lon];

  if (!visibleTargetMarker) {
    visibleTargetMarker = L.marker(latLng, { icon: targetIcon })
      .addTo(map)
      .bindPopup(target.title);
  } else {
    visibleTargetMarker.setLatLng(latLng);
  }

  visibleTargetMarker.setPopupContent(`<strong>${target.title}</strong><br>${target.label || ""}`);
}

function updateVisibleLeg(progress) {
  if (visibleLegLine) {
    visibleLegLine.remove();
    visibleLegLine = null;
  }

  if (progress.unlocked <= 0) return;

  const points = getRouteSegmentForUnlocked(progress.unlocked);

  visibleLegLine = L.polyline(points, {
    className: "activeLeg"
  }).addTo(map);

  map.fitBounds(visibleLegLine.getBounds(), {
    padding: [30, 30]
  });
}

function updateDistance(progress) {
  const target = getVisibleTarget(progress);

  if (!target) {
    document.getElementById("distance").textContent = "—";
    return;
  }

  const from = lastUserLatLng || [getVisibleStartOfLeg(progress).lat, getVisibleStartOfLeg(progress).lon];

  const distance = haversineMeters(from[0], from[1], target.lat, target.lon);
  document.getElementById("distance").textContent = fmtDistance(distance);
}

function updateUI(progress) {
  const totalChallenges = stationsData.challenges.length;
  const challenge = getCurrentChallenge(progress);
  const visibleTarget = getVisibleTarget(progress);
  const visibleStart = getVisibleStartOfLeg(progress);

  document.getElementById("progress").textContent =
    `${Math.min(progress.unlocked, totalChallenges)} / ${totalChallenges}`;

  if (progress.unlocked === 0) {
    document.getElementById("taskTitle").textContent = "Start";
    document.getElementById("currentBox").textContent = stationsData.waypoints[0].title;
    document.getElementById("nextBox").textContent = "Noch kein Ziel freigeschaltet.";
    document.getElementById("riddle").textContent = challenge?.riddle || "—";
    document.getElementById("distance").textContent = "—";

    updateVisibleTarget(progress);
    updateVisibleLeg(progress);
    return;
  }

  if (!challenge && progress.unlocked >= totalChallenges) {
    document.getElementById("taskTitle").textContent = "Finale Strecke";
    document.getElementById("currentBox").textContent = visibleStart?.title || "—";
    document.getElementById("nextBox").textContent = visibleTarget?.title || "Ziel erreicht";
    document.getElementById("riddle").textContent = "🎉 Alle Rätsel gelöst. Folgt der letzten Route zurück zum Startpunkt.";
  } else {
    document.getElementById("taskTitle").textContent = challenge?.title || "Nächste Strecke";
    document.getElementById("currentBox").textContent = visibleStart?.title || "—";
    document.getElementById("nextBox").textContent = visibleTarget?.title || "—";
    document.getElementById("riddle").textContent = challenge?.riddle || "—";
  }

  updateVisibleTarget(progress);
  updateVisibleLeg(progress);
  updateDistance(progress);
}

function tryUnlock() {
  const progress = loadProgress();
  const challenge = getCurrentChallenge(progress);

  if (!challenge) {
    setFeedback("Schon fertig 🎉", true);
    return;
  }

  const entered = normalizeCode(document.getElementById("codeInput").value);
  const expected = normalizeCode(challenge.code);

  if (!entered) {
    setFeedback("Bitte ein Lösungswort eingeben.", false);
    return;
  }

  if (entered === expected) {
    progress.unlocked += 1;
    saveProgress(progress);

    document.getElementById("codeInput").value = "";
    setFeedback("✅ Richtig! Die nächste Strecke ist freigeschaltet.", true);

    updateUI(progress);
  } else {
    setFeedback("❌ Falsches Lösungswort.", false);
  }
}

async function init() {
  setStatus("Lade Stationen...");

  const res = await fetch("stations.json", { cache: "no-store" });
  stationsData = await res.json();

  const start = stationsData.waypoints[0];

  map = L.map("map").setView([start.lat, start.lon], 15);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  L.marker([start.lat, start.lon], { icon: startIcon })
    .addTo(map)
    .bindPopup(`<strong>Start/Ziel</strong><br>${start.label}`);

  if (stationsData.komootUrl) {
    const komootLink = document.getElementById("komootLink");
    if (komootLink) komootLink.href = stationsData.komootUrl;
  }

  await loadRouteTrackHidden();

  const progress = loadProgress();
  updateUI(progress);

  document.getElementById("codeBtn").addEventListener("click", tryUnlock);

  document.getElementById("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    setFeedback("Fortschritt zurückgesetzt.", true);
    window.location.reload();
  });

  if (!navigator.geolocation) {
    setStatus("GPS nicht verfügbar.");
    return;
  }

  setStatus("GPS aktiv...");

  navigator.geolocation.watchPosition(
    (pos) => {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      lastUserLatLng = [lat, lon];

      if (!userMarker) {
        userMarker = L.circleMarker(lastUserLatLng, {
          radius: 8
        })
          .addTo(map)
          .bindPopup("Ihr seid hier");
      } else {
        userMarker.setLatLng(lastUserLatLng);
      }

      updateDistance(loadProgress());
      setStatus(`GPS ok ±${Math.round(pos.coords.accuracy)} m`);
    },
    (err) => {
      setStatus("GPS Fehler: " + err.message);
    },
    {
      enableHighAccuracy: true,
      maximumAge: 5000,
      timeout: 15000
    }
  );
}

init().catch((e) => {
  console.error(e);
  setStatus("Fehler beim Laden.");
});