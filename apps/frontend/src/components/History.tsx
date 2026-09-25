import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Clock, Droplets, Gauge, TrendingUp, ChevronLeft, ChevronRight, Activity } from "lucide-react";
import { Button } from "../ui/button";
import { toast } from "sonner";
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts";
import type { WateringHistory } from "../types";

interface SensorHistoryData {
  id: number;
  temperature: number | null;
  humidity: number | null;
  atmospheric_pressure: number | null;
  soil_moisture: number | null;
  timestamp: string;
}

export function History() {
  const [history, setHistory] = useState<WateringHistory[]>([]);
  const [sensorHistory, setSensorHistory] = useState<SensorHistoryData[]>([]);
  const [loading, setLoading] = useState(true);

  const [dayOffset, setDayOffset] = useState(0);
  const [visibleMetrics, setVisibleMetrics] = useState({
    temperature: true,
    humidity: true,
    soil_moisture: true,
    atmospheric_pressure: false,
    water_used: true
  });

  const loadData = async () => {
    try {
      const [historyRes, sensorRes] = await Promise.all([
        fetch('/api/history'),
        fetch('/api/sensors/history')
      ]);

      if (!historyRes.ok || !sensorRes.ok) throw new Error("Szerver hiba az adatok betöltésekor");
      
      const historyData = await historyRes.json();
      const sensorData = await sensorRes.json();
      
      const parsedHistory = historyData.map((item: any) => ({
        ...item,
        startTime: new Date(item.startTime) 
      }));

      setHistory(parsedHistory);
      setSensorHistory(sensorData);
    } catch (error) {
      console.error("[Frontend] Hiba:", error);
      toast.error("Nem sikerült betölteni az adatokat.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // --- Segédfüggvények a régi kártyákhoz és naplóhoz ---
  const getTypeBadge = (type: string) => {
    const styles = {
      manual: "bg-blue-600",
      scheduled: "bg-green-600",
      auto: "bg-purple-600",
    };
    return (
      <Badge className={styles[type as keyof typeof styles] || "bg-slate-600"}>
        {type}
      </Badge>
    );
  };

  const formatDate = (date: Date) => {
    return new Intl.DateTimeFormat("hu-HU", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  };

  const groupByDate = (entries: WateringHistory[]) => {
    const groups: { [key: string]: WateringHistory[] } = {};
    entries.forEach((entry) => {
      const dateKey = entry.startTime.toLocaleDateString("hu-HU");
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(entry);
    });
    return groups;
  };

  // --- Statisztikai számítások ---
  const groupedHistory = groupByDate(history);
  const totalWaterUsed = history.reduce((sum, h) => sum + (h.waterUsed || 0), 0);
  
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekWaterUsed = history
    .filter((h) => h.startTime > weekAgo)
    .reduce((sum, h) => sum + (h.waterUsed || 0), 0);

  // --- Grafikon adatszűrés ---
  const targetDate = new Date();
  targetDate.setDate(targetDate.getDate() - dayOffset);
  const targetDateString = targetDate.toLocaleDateString("hu-HU");

  const filteredSensors = sensorHistory.filter(reading => 
    new Date(reading.timestamp).toLocaleDateString("hu-HU") === targetDateString
  );

  const chartData = filteredSensors.map(sensor => {
    const sensorTime = new Date(sensor.timestamp).getTime();
    const wateringEvent = history.find(h => {
      const hTime = h.startTime.getTime();
      return hTime >= sensorTime && hTime < (sensorTime + 20 * 60 * 1000);
    });

    return {
      ...sensor,
      water_used: wateringEvent ? wateringEvent.waterUsed : 0
    };
  });

  const toggleMetric = (key: keyof typeof visibleMetrics) => {
    setVisibleMetrics(prev => ({ ...prev, [key]: !prev[key] }));
  };

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Adatok szinkronizálása...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">History & Trends</h2>
        <p className="text-slate-600 dark:text-slate-400">Interaktív adatelemzés és napló</p>
      </div>

      {/* 1. Szekció: Statisztikai kártyák */}
      {history.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Sessions</p>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                {history.length}
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Water Time</p>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                {history.reduce((sum, h) => sum + h.duration, 0)} min
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">Total Water Used</p>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                {totalWaterUsed.toFixed(1)}L
              </p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-6 text-center">
              <p className="text-sm text-slate-600 dark:text-slate-400">This Week</p>
              <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                {weekWaterUsed.toFixed(1)}L
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* 2. Szekció: Interaktív Grafikon */}
      <Card className="w-full">
        <CardHeader className="pb-2 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
            <CardTitle className="flex items-center gap-2">
              <Activity className="w-5 h-5 text-blue-500" />
              Napi Analitika
            </CardTitle>

            <div className="flex items-center gap-4 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg">
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setDayOffset(prev => Math.min(prev + 1, 6))}
                disabled={dayOffset === 6}
              >
                <ChevronLeft className="w-4 h-4" />
              </Button>
              <span className="text-sm font-medium w-24 text-center">
                {dayOffset === 0 ? "Ma" : dayOffset === 1 ? "Tegnap" : targetDateString}
              </span>
              <Button 
                variant="ghost" 
                size="sm" 
                onClick={() => setDayOffset(prev => Math.max(prev - 1, 0))}
                disabled={dayOffset === 0}
              >
                <ChevronRight className="w-4 h-4" />
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2 pt-4">
            <Badge 
              className={`cursor-pointer transition-all ${visibleMetrics.temperature ? 'bg-orange-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              onClick={() => toggleMetric('temperature')}
            >Hőmérséklet</Badge>
            <Badge 
              className={`cursor-pointer transition-all ${visibleMetrics.humidity ? 'bg-sky-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              onClick={() => toggleMetric('humidity')}
            >Páratartalom</Badge>
            <Badge 
              className={`cursor-pointer transition-all ${visibleMetrics.soil_moisture ? 'bg-emerald-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              onClick={() => toggleMetric('soil_moisture')}
            >Talajnedvesség</Badge>
            <Badge 
              className={`cursor-pointer transition-all ${visibleMetrics.atmospheric_pressure ? 'bg-purple-500' : 'bg-slate-300 dark:bg-slate-700'}`}
              onClick={() => toggleMetric('atmospheric_pressure')}
            >Légnyomás</Badge>
            <Badge 
              className={`cursor-pointer transition-all ${visibleMetrics.water_used ? 'bg-blue-600' : 'bg-slate-300 dark:bg-slate-700'}`}
              onClick={() => toggleMetric('water_used')}
            >Vízfogyasztás (L)</Badge>
          </div>
        </CardHeader>

        <CardContent>
          {chartData.length === 0 ? (
            <div className="h-[400px] w-full mt-4 flex flex-col items-center justify-center border-2 border-dashed border-slate-200 rounded-lg text-slate-500">
              <TrendingUp className="w-8 h-8 mb-2 opacity-50" />
              <p>Erre a napra nincsenek rögzített adatok.</p>
            </div>
          ) : (
            <div className="h-[400px] w-full mt-6">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 5, right: 0, bottom: 5, left: -20 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
                  <XAxis 
                    dataKey="timestamp" 
                    tickFormatter={(val) => new Date(val).toLocaleTimeString("hu-HU", { hour: '2-digit', minute: '2-digit' })}
                    tick={{ fontSize: 11, fill: '#64748b' }}
                  />
                  <YAxis yAxisId="left" orientation="left" tick={{ fontSize: 11, fill: '#64748b' }} />
                  <YAxis yAxisId="right" orientation="right" domain={[900, 1050]} tick={{ fontSize: 11, fill: '#64748b' }} hide={!visibleMetrics.atmospheric_pressure} />
                  <Tooltip 
                    labelFormatter={(label) => new Date(label as string).toLocaleString("hu-HU")}
                    contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="top" height={36} />
                  
                  {visibleMetrics.water_used && <Bar yAxisId="left" name="Elhasznált Víz (L)" dataKey="water_used" fill="#2563eb" barSize={20} />}
                  {visibleMetrics.temperature && <Line yAxisId="left" type="monotone" name="Hőmérséklet (°C)" dataKey="temperature" stroke="#f97316" strokeWidth={2} dot={false} />}
                  {visibleMetrics.humidity && <Line yAxisId="left" type="monotone" name="Pára (%)" dataKey="humidity" stroke="#0ea5e9" strokeWidth={2} dot={false} />}
                  {visibleMetrics.soil_moisture && <Line yAxisId="left" type="monotone" name="Talajnedvesség (%)" dataKey="soil_moisture" stroke="#10b981" strokeWidth={2} dot={false} />}
                  {visibleMetrics.atmospheric_pressure && <Line yAxisId="right" type="monotone" name="Légnyomás (hPa)" dataKey="atmospheric_pressure" stroke="#a855f7" strokeWidth={2} dot={false} />}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          )}
        </CardContent>
      </Card>

      {/* 3. Szekció: Activity Log */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
        </CardHeader>
        <CardContent>
          {history.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No watering history yet</p>
            </div>
          ) : (
            <div className="space-y-6">
              {Object.entries(groupedHistory).map(([date, entries]) => (
                <div key={date}>
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-3">{date}</h3>
                  <div className="space-y-2">
                    {entries.map((entry) => (
                      <div
                        key={entry.id}
                        className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                      >
                        <div className="flex items-start justify-between">
                          <div className="flex items-start gap-3">
                            <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center mt-0.5">
                              <Droplets className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div>
                              <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                                {entry.zoneName}
                              </h4>
                              <p className="text-sm text-slate-600 dark:text-slate-400">
                                {formatDate(entry.startTime)}
                              </p>
                              <div className="flex items-center gap-4 mt-1">
                                <p className="text-sm text-slate-600 dark:text-slate-400">
                                  Duration: {entry.duration} minutes
                                </p>
                                {entry.waterUsed !== undefined && (
                                  <p className="text-sm text-blue-600 dark:text-blue-400 flex items-center gap-1">
                                    <Gauge className="w-3 h-3" />
                                    {entry.waterUsed.toFixed(1)}L
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                          {getTypeBadge(entry.type)}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}