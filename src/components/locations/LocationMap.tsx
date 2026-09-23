import { useEffect, useMemo, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  useMap,
  useMapEvents,
} from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { DEFAULT_MAP_CENTER } from "@/lib/geofence";
import { cn } from "@/lib/utils";

const DefaultIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});
L.Marker.prototype.options.icon = DefaultIcon;

function MapClickHandler({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

function MapViewSync({
  center,
  zoom,
}: {
  center: { lat: number; lng: number };
  zoom: number;
}) {
  const map = useMap();
  useEffect(() => {
    map.setView([center.lat, center.lng], zoom, { animate: true });
  }, [center.lat, center.lng, zoom, map]);

  // Leaflet sometimes renders blank until a resize after container layout.
  useEffect(() => {
    const id = window.setTimeout(() => map.invalidateSize(), 80);
    return () => window.clearTimeout(id);
  }, [map, center.lat, center.lng]);

  return null;
}

export type LocationMapProps = {
  latitude: number | null;
  longitude: number | null;
  radiusMeters: number;
  onPick: (lat: number, lng: number) => void;
  className?: string;
};

export function LocationMap({
  latitude,
  longitude,
  radiusMeters,
  onPick,
  className,
}: LocationMapProps) {
  const [baseLayer, setBaseLayer] = useState<"map" | "satellite">("map");
  const hasPoint = latitude != null && longitude != null;
  const center = useMemo(
    () =>
      hasPoint
        ? { lat: latitude!, lng: longitude! }
        : { lat: DEFAULT_MAP_CENTER.lat, lng: DEFAULT_MAP_CENTER.lng },
    [hasPoint, latitude, longitude],
  );

  const zoom = hasPoint ? (radiusMeters > 1000 ? 14 : 16) : 13;

  return (
    <div
      className={cn(
        "relative h-full w-full min-h-[320px] rounded-xl overflow-hidden",
        className,
      )}
    >
      <div className="absolute left-3 bottom-3 z-[1000] flex overflow-hidden rounded-md border border-gray-300 bg-white shadow text-xs font-semibold">
        <button
          type="button"
          onClick={() => setBaseLayer("map")}
          className={cn(
            "px-3 py-1.5 transition-colors",
            baseLayer === "map"
              ? "bg-[#2563EB] text-white"
              : "bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          Map
        </button>
        <button
          type="button"
          onClick={() => setBaseLayer("satellite")}
          className={cn(
            "px-3 py-1.5 transition-colors border-l border-gray-200",
            baseLayer === "satellite"
              ? "bg-[#2563EB] text-white"
              : "bg-white text-gray-700 hover:bg-gray-50",
          )}
        >
          Satellite
        </button>
      </div>

      <MapContainer
        center={[center.lat, center.lng]}
        zoom={zoom}
        className="h-full w-full z-0"
        scrollWheelZoom
      >
        {baseLayer === "map" ? (
          <TileLayer
            key="osm"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            maxZoom={19}
          />
        ) : (
          <TileLayer
            key="satellite"
            attribution="Tiles &copy; Esri"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={19}
          />
        )}
        <MapClickHandler onPick={onPick} />
        <MapViewSync center={center} zoom={zoom} />
        {hasPoint ? (
          <>
            <Marker position={[latitude!, longitude!]} />
            <Circle
              center={[latitude!, longitude!]}
              radius={radiusMeters}
              pathOptions={{
                color: "#2563EB",
                fillColor: "#3B82F6",
                fillOpacity: 0.18,
                weight: 2,
              }}
            />
          </>
        ) : null}
      </MapContainer>
    </div>
  );
}
