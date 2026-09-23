import { useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router";
import { motion } from "framer-motion";
import {
  Archive,
  Loader2,
  MapPin,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/providers/trpc";
import { useAuth } from "@/hooks/useAuth";
import { canManageAttendance } from "@/lib/leave-policy";
import {
  DEFAULT_LOCATION_RADIUS_M,
  LOCATION_RADIUS_OPTIONS,
} from "@/lib/geofence";
import { LocationMap } from "@/components/locations/LocationMap";
import { cn } from "@/lib/utils";

function reverseGeocodeLabel(lat: number, lng: number) {
  return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export default function LocationsPage() {
  const { user } = useAuth();
  const allowed = canManageAttendance(user);
  const utils = trpc.useUtils();

  const [placeQuery, setPlaceQuery] = useState("");
  const [listQuery, setListQuery] = useState("");
  const [debouncedPlaceQuery, setDebouncedPlaceQuery] = useState("");
  const [showArchived, setShowArchived] = useState(false);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [draftName, setDraftName] = useState("");
  const [draftAddress, setDraftAddress] = useState<string | null>(null);
  const [draftLat, setDraftLat] = useState<number | null>(null);
  const [draftLng, setDraftLng] = useState<number | null>(null);
  const [draftRadius, setDraftRadius] = useState(DEFAULT_LOCATION_RADIUS_M);
  const [isNew, setIsNew] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const { data: locations = [], isLoading } = trpc.location.list.useQuery(
    { includeArchived: showArchived },
    { enabled: allowed },
  );

  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedPlaceQuery(placeQuery.trim());
    }, 350);
    return () => window.clearTimeout(t);
  }, [placeQuery]);

  const {
    data: placeHits = [],
    isFetching: searchingPlaces,
    isError: placeSearchError,
  } = trpc.location.searchPlaces.useQuery(
    { query: debouncedPlaceQuery },
    {
      enabled: allowed && debouncedPlaceQuery.length >= 2,
      staleTime: 60_000,
    },
  );

  useEffect(() => {
    if (placeSearchError) {
      toast.error("Could not search places. Check your connection and try again.");
    }
  }, [placeSearchError]);

  const createMutation = trpc.location.create.useMutation({
    onSuccess: async (created) => {
      await Promise.all([
        utils.location.list.invalidate(),
        utils.location.listActiveForClockIn.invalidate(),
        utils.location.clockInPolicy.invalidate(),
      ]);
      toast.success("Location saved");
      setIsNew(false);
      setSelectedId(created.id);
    },
    onError: (err) => toast.error(err.message || "Could not save location"),
  });

  const updateMutation = trpc.location.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.location.list.invalidate(),
        utils.location.listActiveForClockIn.invalidate(),
        utils.location.clockInPolicy.invalidate(),
      ]);
      toast.success("Location updated");
    },
    onError: (err) => toast.error(err.message || "Could not update location"),
  });

  const archiveMutation = trpc.location.setArchived.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.location.list.invalidate(),
        utils.location.listActiveForClockIn.invalidate(),
        utils.location.clockInPolicy.invalidate(),
      ]);
      toast.success(showArchived ? "Location restored" : "Location archived");
    },
    onError: (err) => toast.error(err.message || "Could not update location"),
  });

  const deleteMutation = trpc.location.delete.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.location.list.invalidate(),
        utils.location.listActiveForClockIn.invalidate(),
        utils.location.clockInPolicy.invalidate(),
      ]);
      toast.success("Location deleted");
      setSelectedId(null);
      setIsNew(false);
      resetDraft();
    },
    onError: (err) => toast.error(err.message || "Could not delete location"),
  });

  const activeLocations = useMemo(
    () => locations.filter((l) => !l.archived),
    [locations],
  );

  const filtered = useMemo(() => {
    const q = listQuery.trim().toLowerCase();
    const list = showArchived ? locations.filter((l) => l.archived) : activeLocations;
    if (!q) return list;
    return list.filter(
      (l) =>
        l.name.toLowerCase().includes(q) ||
        (l.address ?? "").toLowerCase().includes(q),
    );
  }, [locations, activeLocations, listQuery, showArchived]);

  const selected = locations.find((l) => l.id === selectedId) ?? null;

  useEffect(() => {
    if (isNew) return;
    if (selected) {
      setDraftName(selected.name);
      setDraftAddress(selected.address);
      setDraftLat(selected.latitude);
      setDraftLng(selected.longitude);
      setDraftRadius(selected.radiusMeters);
      return;
    }
    if (!selectedId && activeLocations[0]) {
      setSelectedId(activeLocations[0].id);
    }
  }, [selected, selectedId, activeLocations, isNew]);

  function resetDraft() {
    setDraftName("");
    setDraftAddress(null);
    setDraftLat(null);
    setDraftLng(null);
    setDraftRadius(DEFAULT_LOCATION_RADIUS_M);
  }

  function startNew(preservePin = false) {
    const keepLat = preservePin ? draftLat : null;
    const keepLng = preservePin ? draftLng : null;
    const keepAddress = preservePin ? draftAddress : null;
    const keepName =
      preservePin && draftName && draftName !== "New location"
        ? draftName
        : "New location";
    const keepRadius = draftRadius;

    setIsNew(true);
    setSelectedId(null);
    setShowArchived(false);
    setDraftName(keepName);
    setDraftAddress(keepAddress);
    setDraftLat(keepLat);
    setDraftLng(keepLng);
    setDraftRadius(keepRadius);
  }

  async function reverseFillAddress(lat: number, lng: number) {
    try {
      const data = await utils.location.reverseGeocode.fetch({
        latitude: lat,
        longitude: lng,
      });
      if (data.address) setDraftAddress(data.address);
      if (data.shortName) {
        setDraftName((prev) =>
          !prev || prev === "New location" ? data.shortName! : prev,
        );
      }
    } catch {
      // Coordinates still work without a label.
    }
  }

  function handleMapPick(lat: number, lng: number) {
    if (!isNew && !selectedId) {
      setIsNew(true);
      setDraftName("New location");
    }
    setDraftLat(lat);
    setDraftLng(lng);
    setDraftAddress(reverseGeocodeLabel(lat, lng));
    void reverseFillAddress(lat, lng);
  }

  function applySearchHit(hit: {
    id: string;
    label: string;
    latitude: number;
    longitude: number;
  }) {
    if (!Number.isFinite(hit.latitude) || !Number.isFinite(hit.longitude)) return;
    const short = hit.label.split(",")[0]?.trim() || "New location";

    // Selecting a place always prepares a new location draft (does not wipe pin).
    setIsNew(true);
    setSelectedId(null);
    setShowArchived(false);
    setDraftName(short);
    setDraftAddress(hit.label);
    setDraftLat(hit.latitude);
    setDraftLng(hit.longitude);
    setPlaceQuery("");
    setSuggestionsOpen(false);
    toast.message(`Pinned “${short}”. Adjust radius and click Save.`);
  }

  function handleSave() {
    if (!draftName.trim()) {
      toast.error("Enter a location name");
      return;
    }
    if (draftLat == null || draftLng == null) {
      toast.error("Pick a point on the map or search for an address");
      return;
    }

    const payload = {
      name: draftName.trim(),
      address: draftAddress,
      latitude: draftLat,
      longitude: draftLng,
      radiusMeters: draftRadius,
    };

    if (isNew || !selectedId) {
      createMutation.mutate(payload);
      return;
    }
    updateMutation.mutate({ id: selectedId, ...payload });
  }

  const saving = createMutation.isPending || updateMutation.isPending;
  const showSuggestions =
    suggestionsOpen &&
    debouncedPlaceQuery.length >= 2 &&
    (searchingPlaces || placeHits.length > 0);

  if (!allowed) {
    return <Navigate to="/" replace />;
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      className="space-y-4 h-[calc(100vh-7rem)] flex flex-col"
    >
      <div>
        <div className="flex items-center gap-2 mb-1">
          <MapPin size={22} className="text-[#2563EB]" />
          <h1 className="text-2xl font-bold text-[#1F2937]">Locations</h1>
        </div>
        <p className="text-sm text-gray-500">
          Organize locations to be used as geofences for employee clock-in.
        </p>
      </div>

      <div
        className="flex gap-2 items-center flex-wrap"
      >
        <div className="relative flex-1 min-w-0 max-w-md">
          <Search
            size={15}
            className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
          />
          <input
            type="search"
            value={placeQuery}
            onChange={(e) => {
              setPlaceQuery(e.target.value);
              setSuggestionsOpen(true);
            }}
            onFocus={() => setSuggestionsOpen(true)}
            onBlur={() => {
              // Allow click on suggestion before closing.
              window.setTimeout(() => setSuggestionsOpen(false), 150);
            }}
            placeholder="Search places (e.g. Iscon Emporio, Ahmedabad)"
            className="w-full h-10 pl-9 pr-9 rounded-lg border border-gray-200 bg-white text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 focus:border-[#2563EB]"
            autoComplete="off"
          />
          {searchingPlaces ? (
            <Loader2
              size={14}
              className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-gray-400"
            />
          ) : null}
          {showSuggestions ? (
            <ul className="absolute z-30 mt-1 w-full rounded-lg border border-gray-200 bg-white shadow-lg max-h-64 overflow-y-auto">
              {searchingPlaces && placeHits.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-gray-400">Searching…</li>
              ) : placeHits.length === 0 ? (
                <li className="px-3 py-2.5 text-sm text-gray-400">No places found</li>
              ) : (
                placeHits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => applySearchHit(hit)}
                      className="w-full text-left px-3 py-2.5 text-sm hover:bg-gray-50 border-b border-gray-50 last:border-0"
                    >
                      {hit.label}
                    </button>
                  </li>
                ))
              )}
            </ul>
          ) : null}
        </div>

        <label className="flex items-center gap-2 h-10 px-3 rounded-lg border border-gray-200 bg-white text-sm text-gray-700 shrink-0">
          Radius
          <select
            value={draftRadius}
            onChange={(e) => setDraftRadius(Number(e.target.value))}
            className="bg-transparent font-medium text-[#1F2937] focus:outline-none"
          >
            {LOCATION_RADIUS_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          onClick={() => startNew(Boolean(draftLat && draftLng && isNew))}
          className="h-10 px-3 rounded-lg bg-[#2563EB] text-white text-sm font-semibold inline-flex items-center gap-1.5 hover:bg-[#1D4ED8] shrink-0"
        >
          <Plus size={16} /> Add location
        </button>
      </div>

      <div
        className="flex-1 min-h-0 grid gap-4 grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)]"
      >
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col max-h-[420px] lg:max-h-none">
          <div className="px-4 py-3 border-b border-gray-100 space-y-2">
            <p className="text-xs text-gray-500">
              Organize locations to be used as geofences or for reporting.
            </p>
            <div className="relative">
              <Search
                size={14}
                className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none"
              />
              <input
                type="search"
                value={listQuery}
                onChange={(e) => setListQuery(e.target.value)}
                placeholder="Filter saved locations"
                className="w-full h-8 pl-8 pr-2 rounded-md border border-gray-200 bg-gray-50 text-xs focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
              />
            </div>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {isLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-gray-400" size={22} />
              </div>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-10 px-4">
                {showArchived
                  ? "No archived locations."
                  : "No locations yet. Search a place or click the map, then Save."}
              </p>
            ) : (
              filtered.map((loc) => (
                <button
                  key={loc.id}
                  type="button"
                  onClick={() => {
                    setIsNew(false);
                    setSelectedId(loc.id);
                  }}
                  className={cn(
                    "w-full text-left px-4 py-3.5 hover:bg-gray-50 transition-colors",
                    !isNew && selectedId === loc.id && "bg-blue-50/70",
                  )}
                >
                  <div className="text-sm font-semibold text-[#1F2937]">{loc.name}</div>
                  {loc.address ? (
                    <div className="text-xs text-gray-500 mt-0.5 line-clamp-2">
                      {loc.address}
                    </div>
                  ) : null}
                  <div className="text-[11px] text-gray-400 mt-1">
                    {loc.radiusMeters} m radius
                  </div>
                </button>
              ))
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setShowArchived((v) => !v);
              setIsNew(false);
              setSelectedId(null);
            }}
            className="flex items-center gap-2 px-4 py-3 border-t border-gray-100 text-sm text-gray-600 hover:bg-gray-50"
          >
            <Archive size={16} />
            {showArchived ? "Active locations" : "Archived locations"}
          </button>
        </div>

        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden flex flex-col min-h-[360px]">
          <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap items-end gap-3">
            <div className="flex-1 min-w-[140px]">
              <label className="block text-xs font-medium text-gray-500 mb-1">
                Location name
              </label>
              <input
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                className="w-full h-9 px-3 rounded-lg border border-gray-200 text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
                placeholder="Office name"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="h-9 px-4 rounded-lg bg-[#2563EB] text-white text-sm font-semibold hover:bg-[#1D4ED8] disabled:opacity-60 inline-flex items-center gap-1.5"
              >
                {saving ? <Loader2 size={14} className="animate-spin" /> : null}
                Save
              </button>
              {selected && !isNew ? (
                <>
                  <button
                    type="button"
                    onClick={() =>
                      archiveMutation.mutate({
                        id: selected.id,
                        archived: !selected.archived,
                      })
                    }
                    className="h-9 px-3 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50"
                  >
                    {selected.archived ? "Restore" : "Archive"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!window.confirm("Delete this location permanently?")) return;
                      deleteMutation.mutate({ id: selected.id });
                    }}
                    className="h-9 w-9 inline-flex items-center justify-center rounded-lg border border-gray-200 text-red-500 hover:bg-red-50"
                    aria-label="Delete location"
                  >
                    <Trash2 size={15} />
                  </button>
                </>
              ) : null}
            </div>
          </div>

          {draftAddress ? (
            <p className="px-4 py-2 text-xs text-gray-500 border-b border-gray-50 line-clamp-2">
              {draftAddress}
            </p>
          ) : (
            <p className="px-4 py-2 text-xs text-gray-400 border-b border-gray-50">
              Search a place or click the map to set the pin, then Save.
            </p>
          )}

          <div className="flex-1 min-h-[280px]">
            <LocationMap
              latitude={draftLat}
              longitude={draftLng}
              radiusMeters={draftRadius}
              onPick={handleMapPick}
              className="h-full w-full"
            />
          </div>
        </div>
      </div>
    </motion.div>
  );
}
