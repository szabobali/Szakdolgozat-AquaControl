import { useState, useEffect } from "react";
import {
  Play,
  Square,
  Droplets,
  Cloud,
  Gauge,
  ThermometerSun,
  Droplet,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

import { fetchWeather } from "../utils/weather";
import type { WateringZone } from "../types";
import { toast } from "sonner";

// 1. Típusdefiníció: Csak a szükséges adatokat várjuk el
interface SensorData {
  temperature: number | null;
  humidity: number | null;
}

export function Dashboard() {
  const [zones, setZones] = useState<WateringZone[]>([]);
  const [weather, setWeather] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // 2. Kezdeti állapot pontosan a típus alapján
  const [sensorData, setSensorData] = useState<SensorData>({
    temperature: null,
    humidity: null,
  });

  const loadData = async () => {
    try {
      const res = await fetch("/api/zones");
      if (res.ok) {
        const data = await res.json();
        setZones(data);
      } else {
        throw new Error("Backend nem válaszol");
      }

      const weatherData = await fetchWeather();
      setWeather(weatherData);

      // Hidegindítás: Szenzorok lekérése
      const sensorRes = await fetch("/api/sensors/latest");
      if (sensorRes.ok) {
        const sData = await sensorRes.json();
        setSensorData({
          temperature: sData.temperature ?? null,
          humidity: sData.humidity ?? null,
        });
      }
    } catch (error) {
      console.error("Adatszinkronizációs hiba:", error);
      toast.error(
        "Nem sikerült betölteni a kezdeti adatokat. Ellenőrizd a backendet!"
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
    console.log("[Frontend] SSE kapcsolat inicializálása...");
    
    const eventSource = new EventSource("/api/stream/system-status");

    eventSource.onopen = () => {
      console.log("🟢 [Frontend] Real-time SSE adatfolyam sikeresen megnyitva");
    };

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        console.log("📩 [Frontend] SSE aszinkron állapotcsomag érkezett:", data);

        // Demultiplexálás (Esemény-alapú szétválasztás)
        if (data.type === "ZONE_STATUS_CHANGE") {
          setZones((prevZones) =>
            prevZones.map((zone) =>
              zone.id === data.zoneId.toString()
                ? { ...zone, isActive: data.isActive }
                : zone
            )
          );
        } else if (data.type === "SENSOR_UPDATE") {
          setSensorData({
            temperature: data.data.temperature ?? null,
            humidity: data.data.humidity ?? null,
          });
        }
      } catch (err) {
        console.error("[Frontend] SSE hiba:", err);
      }
    };

    eventSource.onerror = (err) => {
      console.error("🔴 [Frontend] SSE megszakadt:", err);
    };

    return () => {
      eventSource.close();
    };
  }, []); 

  const handleStartWatering = async (
    zoneId: string,
    durationMinutes: number = 15
  ) => {
    try {
      console.log(`[Frontend] Öntözés indítása: Zóna ${zoneId}, ${durationMinutes} perc`);
      const response = await fetch(`/api/zones/${zoneId}/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ duration: durationMinutes }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to start watering");
      }
      toast.success("Indítási parancs elküldve a backendnek");
    } catch (error: any) {
      console.error("[Frontend] Hiba az indítási parancs küldésekor:", error);
      toast.error(error.message);
    }
  };

  const handleStopWatering = async (zoneId: string) => {
    try {
      console.log(`[Frontend] Öntözés leállítása: Zóna ${zoneId}`);
      const response = await fetch(`/api/zones/${zoneId}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to stop watering");
      }
      toast.success("Leállítási parancs elküldve a backendnek");
    } catch (error: any) {
      console.error("[Frontend] Hiba a leállítási parancs küldésekor:", error);
      toast.error(error.message);
    }
  };

  if (loading) {
    return (
      <div className="p-8 text-center">
        Szinkronizálás a vezérlővel és az időjárás-állomásokkal...
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      {/* Szenzor Overview - Csak a hőmérséklet és a páratartalom maradt */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Temperature
                </p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {sensorData.temperature !== null ? `${sensorData.temperature.toFixed(1)}°C` : '--'}
                </p>
              </div>
              <ThermometerSun className="w-8 h-8 text-orange-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Humidity
                </p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {sensorData.humidity !== null ? `${sensorData.humidity.toFixed(1)}%` : '--'}
                </p>
              </div>
              <Cloud className="w-8 h-8 text-sky-500" />
            </div>
          </CardContent>
        </Card>

        {/* Eredeti statikus kártyák (Water Usage, Status) */}
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Water Usage
                </p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  12.5L
                </p>
              </div>
              <Gauge className="w-8 h-8 text-cyan-500" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-slate-600 dark:text-slate-400">
                  Status
                </p>
                <p className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
                  {zones.some((z) => z.isActive) ? "Active" : "Idle"}
                </p>
              </div>
              {zones.some((z) => z.isActive) ? (
                <Droplet className="w-8 h-8 text-blue-500" />
              ) : (
                <Cloud className="w-8 h-8 text-sky-500" />
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 5-Day Forecast Szekció */}
      {weather.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>5-Day Forecast</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
              {weather.map((day, index) => (
                <div
                  key={index}
                  className="text-center p-4 bg-slate-100 dark:bg-slate-800 rounded-lg flex flex-col items-center"
                >
                  <p className="font-medium text-slate-900 dark:text-slate-100 uppercase text-xs">
                    {day.date.toLocaleDateString("en-EN", { weekday: "short" })}
                  </p>
                  <div className="my-3">
                    <day.icon className="w-8 h-8 text-blue-500" />
                  </div>
                  <p className="text-lg font-bold text-slate-900 dark:text-slate-100">
                    {day.tempMax}/{day.tempMin}°C
                  </p>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-1 uppercase tracking-tighter leading-none">
                    {day.label}
                  </p>
                  {day.rainSum > 0 && (
                    <p className="text-xs text-blue-600 dark:text-blue-400 mt-2 flex items-center gap-1 font-medium">
                      <Droplets className="w-3 h-3" /> {day.rainSum.toFixed(1)} mm
                    </p>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Watering Zones Szekció */}
      <Card>
        <CardHeader>
          <CardTitle>Watering Zones</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-4">
            {zones.map((zone) => (
              <div
                key={zone.id}
                className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-all"
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                      <Droplets className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                        {zone.name}
                      </h3>
                      {zone.lastWatered && (
                        <p className="text-xs text-slate-500">
                          Last: {new Date(zone.lastWatered).toLocaleString("hu-HU")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {zone.isActive && (
                      <Badge className="bg-green-600 animate-pulse">
                        Active
                      </Badge>
                    )}
                    <Button
                      size="sm"
                      variant={zone.isActive ? "destructive" : "default"}
                      onClick={() =>
                        zone.isActive
                          ? handleStopWatering(zone.id.toString())
                          : handleStartWatering(
                              zone.id.toString(),
                              zone.duration
                            )
                      }
                    >
                      {zone.isActive ? (
                        <>
                          <Square className="w-4 h-4 mr-1" /> Stop
                        </>
                      ) : (
                        <>
                          <Play className="w-4 h-4 mr-1" /> Start
                        </>
                      )}
                    </Button>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-100 dark:border-slate-800 mt-2">
                  <div className="text-sm">
                    <span className="text-slate-500">Duration:</span>
                    <span className="ml-2 font-mono font-medium text-slate-500">
                      {zone.duration} min
                    </span>
                  </div>
                  <div className="text-sm">
                    <span className="text-slate-500">Flow:</span>
                    <span className="ml-2 font-mono font-medium text-slate-500">
                      {zone.flowRate || 15} L/min
                    </span>
                  </div>
                </div>
              </div>
            ))}
            {zones.length === 0 && (
              <div className="text-center py-6 text-slate-500">
                No zones loaded. Húzz fel zónákat az adatbázisban!
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
