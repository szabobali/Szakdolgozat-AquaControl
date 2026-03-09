import { useState, useEffect } from "react";
import {
  Play,
  Square,
  Droplets,
  Cloud,
  ThermometerSun,
  CloudRain,
  Gauge,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { storage } from "../utils/storage";
import type { WateringZone, WeatherData } from "../types";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

export function Dashboard() {
  const [zones, setZones] = useState<WateringZone[]>([]);
  const [weather, setWeather] = useState<WeatherData | null>(null);
  const [waterUsageToday, setWaterUsageToday] = useState(0);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, []);

  const loadData = async () => {
    setZones(storage.getZones());
    const weatherData = "";
  };

  const handleStartWatering = async () => {};

  const handleStopWatering = async () => {};

  return (
    //watering zones
    <Card>
      <CardHeader>
        <CardTitle>Watering Zones</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                    <Droplets className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                      {zone.name}
                    </h3>
                    {zone.lastWatered && (
                      <p className="text-xs text-slate-500 dark:text-slate-400">
                        Last watered: {zone.lastWatered.toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {zone.isActive && (
                    <Badge variant="default" className="bg-green-600">
                      Active
                    </Badge>
                  )}
                  {zone.isActive ? (
                    <Button
                      size="sm"
                      variant="destructive"
                      onClick={() => handleStopWatering(/*zone*/)}
                    >
                      <Square className="w-4 h-4 mr-1" />
                      Stop
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      onClick={() => handleStartWatering(/*zone*/)}
                    >
                      <Play className="w-4 h-4 mr-1" />
                      Start
                    </Button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4 pt-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400">
                      Duration
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {zone.duration} min
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-600 dark:text-slate-400">
                      Flow Rate
                    </span>
                    <span className="font-medium text-slate-900 dark:text-slate-100">
                      {zone.flowRate} L/min
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
