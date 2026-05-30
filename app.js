const STORAGE_KEY = "jga_progress_v2";

let map;
let userMarker;
let nextMarker;
let currentMarker;
let activeLegLine;
let fallbackRouteLine;
let gpxRouteLayer;
let stationsData = null;
let lastUserLatLng = null;

const unlockedIcon = L.divIcon({
  className: "stationIcon unlockedIcon",
  html: "✓",
  iconSize: [26, 26],
  iconAnchor: [13, 13]
});

const currentIcon = L.divIcon({
  className: "stationIcon currentIcon",
  html: "●",
  iconSize: [30, 30],
  iconAnchor: [15, 15]
});

const nextIcon = L.divIcon({
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

function getCurrentWaypoint(progress) {
  return stationsData.waypoints[progress.unlocked];
}

function getNextWaypoint(progress) {
  return stationsData.waypoints[progress.unlocked + 1] || null;
}

function getCurrentChallenge(progress) {
  return stationsData.challenges[progress.unlocked] || null;
}

function clearLayer(layer) {
  if (layer) layer.remove();
}

function drawFallbackRoute() {
  const points = stationsData.waypoints.map((wp) => [wp.lat, wp.lon]);

  fallbackRouteLine = L.polyline(points, {
    className: "fallbackRoute"
  }).addTo(map);
}

function drawWaypointMarkers(progress) {
  stationsData.waypoints.forEach((wp, index) => {
    if (index === 0) return;

    if (index <= progress.unlocked) {
      L.marker([wp.lat, wp.lon], { icon: unlockedIcon })
        .addTo(map)
        .bindPopup(`Freigeschaltet: ${wp.title}`);
    }
  });
}

function updateActiveMarkers(progress) {
  const current = getCurrentWaypoint(progress);
  const next = getNextWaypoint(progress);

  if (current) {
    const currentLatLng = [current.lat, current.lon];

    if (!currentMarker) {
      currentMarker = L.marker(currentLatLng, { icon: currentIcon })
        .addTo(map)
        .bindPopup("Aktueller Punkt");
    } else {
      currentMarker.setLatLng(currentLatLng);
    }

    currentMarker.setPopupContent(`Aktueller Punkt:<br><strong>${current.title}</strong>`);
  }

  if (next) {
    const nextLatLng = [next.lat, next.lon];

    if (!nextMarker) {
      nextMarker = L.marker(nextLatLng, { icon: nextIcon })
        .addTo(map)
        .bindPopup("Nächster Punkt");
    } else {
      nextMarker.setLatLng(nextLatLng);
    }

    nextMarker.setPopupContent(`Nächster Punkt:<br><strong>${next.title}</strong>`);
  } else {
    clearLayer(nextMarker);
    nextMarker = null;
  }
}

function updateActiveLeg(progress, userLatLng = null) {
  const next = getNextWaypoint(progress);

  if (!next) {
    clearLayer(activeLegLine);
    activeLegLine = null;
    document.getElementById("distance").textContent = "—";
    return;
  }

  const from = userLatLng || [getCurrentWaypoint(progress).lat, getCurrentWaypoint(progress).lon];
  const to = [next.lat, next.lon];

  const points = [from, to];

  if (!activeLegLine) {
    activeLegLine = L.polyline(points, {
      className: "activeLeg"
    }).addTo(map);
  } else {
    activeLegLine.setLatLngs(points);
  }

  const distance = haversineMeters(from[0], from[1], next.lat, next.lon);
  document.getElementById("distance").textContent = fmtDistance(distance);
}

function updateUI(progress, userLatLng = lastUserLatLng) {
  const totalChallenges = stationsData.challenges.length;
  const current = getCurrentWaypoint(progress);
  const next = getNextWaypoint(progress);
  const challenge = getCurrentChallenge(progress);

  document.getElementById("progress").textContent =
    `${Math.min(progress.unlocked, totalChallenges)} / ${totalChallenges}`;

  if (!challenge || !next) {
    document.getElementById("taskTitle").textContent = "Geschafft!";
    document.getElementById("currentBox").textContent = current?.title || "Ziel erreicht";
    document.getElementById("nextBox").textContent = "🎉 Alle Stationen gelöst.";
    document.getElementById("riddle").textContent = "Ihr habt die komplette JGA-Wanderung geschafft!";
    document.getElementById("distance").textContent = "—";

    clearLayer(nextMarker);
    nextMarker = null;
    clearLayer(activeLegLine);
    activeLegLine = null;

    return;
  }

  document.getElementById("taskTitle").textContent = challenge.title;
  document.getElementById("currentBox").textContent = current.title;
  document.getElementById("nextBox").textContent = next.title;
  document.getElementById("riddle").textContent = challenge.riddle || "—";

  updateActiveMarkers(progress);
  updateActiveLeg(progress, userLatLng);
}

function refreshMapAfterUnlock(progress) {
  clearLayer(currentMarker);
  clearLayer(nextMarker);
  currentMarker = null;
  nextMarker = null;

  map.eachLayer((layer) => {
    if (
      layer instanceof L.Marker &&
      layer.options.icon &&
      layer.options.icon.options &&
      layer.options.icon.options.className &&
      layer.options.icon.options.className.includes("unlockedIcon")
    ) {
      map.removeLayer(layer);
    }
  });

  drawWaypointMarkers(progress);
  updateUI(progress, lastUserLatLng);
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
    setFeedback("✅ Richtig! Der nächste Punkt ist freigeschaltet.", true);

    refreshMapAfterUnlock(progress);

    const next = getNextWaypoint(progress);
    if (next) {
      map.setView([next.lat, next.lon], 15);
    }
  } else {
    setFeedback("❌ Falsches Lösungswort.", false);
  }
}

function loadKomootGpxIfAvailable() {
  fetch("route.gpx", { cache: "no-store" })
    .then((res) => {
      if (!res.ok) throw new Error("Keine route.gpx gefunden.");

      gpxRouteLayer = new L.GPX("route.gpx", {
        async: true,
        marker_options: {
          startIconUrl: "",
          endIconUrl: "",
          shadowUrl: ""
        },
        polyline_options: {
          className: "komootRoute"
        }
      })
        .on("loaded", () => {
          setStatus("Route geladen.");
        })
        .on("error", () => {
          setStatus("Route konnte nicht geladen werden. Fallback aktiv.");
        })
        .addTo(map);
    })
    .catch(() => {
      drawFallbackRoute();
      setStatus("Fallback-Route aktiv.");
    });
}

async function init() {
  setStatus("Lade Stationen...");

  const res = await fetch("stations.json", { cache: "no-store" });
  stationsData = await res.json();

  const start = stationsData.waypoints[0];

  map = L.map("map").setView([start.lat, start.lon], 14);

  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "&copy; OpenStreetMap"
  }).addTo(map);

  if (stationsData.komootUrl) {
    const komootLink = document.getElementById("komootLink");
    komootLink.href = stationsData.komootUrl;
  }

  L.marker([start.lat, start.lon])
    .addTo(map)
    .bindPopup(`<strong>Start/Ziel</strong><br>${start.label}`);

  loadKomootGpxIfAvailable();

  const progress = loadProgress();
  drawWaypointMarkers(progress);
  updateUI(progress);

  document.getElementById("codeBtn").addEventListener("click", tryUnlock);

  document.getElementById("codeInput").addEventListener("keydown", (e) => {
    if (e.key === "Enter") tryUnlock();
  });

  document.getElementById("resetBtn").addEventListener("click", () => {
    localStorage.removeItem(STORAGE_KEY);
    setFeedback("Fortschritt zurückgesetzt.", true);

    clearLayer(currentMarker);
    clearLayer(nextMarker);
    clearLayer(activeLegLine);

    currentMarker = null;
    nextMarker = null;
    activeLegLine = null;

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

      updateUI(loadProgress(), lastUserLatLng);
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