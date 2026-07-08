import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Badge } from "../ui/badge";
import { Clock, Droplets, Gauge } from "lucide-react";
import { toast } from "sonner";
import type { WateringHistory } from "../types";

export function History() {
  const [history, setHistory] = useState<WateringHistory[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    try {
      const res = await fetch('/api/history');
      if (!res.ok) throw new Error("Szerver hiba");
      
      const data = await res.json();
      
      // KRITIKUS: A JSON stringek visszakonvertálása Date objektummá
      const parsedData = data.map((item: any) => ({
        ...item,
        startTime: new Date(item.startTime) 
      }));

      setHistory(parsedData);
    } catch (error) {
      console.error("[Frontend] Hiba a történet betöltésekor:", error);
      toast.error("Nem sikerült betölteni a naplót.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

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
      // A magyar formátum szerint csoportosítunk
      const dateKey = entry.startTime.toLocaleDateString("hu-HU");
      if (!groups[dateKey]) {
        groups[dateKey] = [];
      }
      groups[dateKey].push(entry);
    });
    return groups;
  };

  const groupedHistory = groupByDate(history);
  
  const totalWaterUsed = history.reduce((sum, h) => sum + (h.waterUsed || 0), 0);
  const weekAgo = new Date();
  weekAgo.setDate(weekAgo.getDate() - 7);
  const weekWaterUsed = history
    .filter((h) => h.startTime > weekAgo)
    .reduce((sum, h) => sum + (h.waterUsed || 0), 0);

  if (loading) {
    return <div className="p-8 text-center text-slate-500">Előzmények szinkronizálása...</div>;
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Watering History</h2>
        <p className="text-slate-600 dark:text-slate-400">View past watering activities</p>
      </div>

      {/* Statistics */}
      {history.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">Total Sessions</p>
                <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {history.length}
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">Total Water Time</p>
                <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {history.reduce((sum, h) => sum + h.duration, 0)} min
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">Total Water Used</p>
                <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {totalWaterUsed.toFixed(1)}L
                </p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <p className="text-sm text-slate-600 dark:text-slate-400">This Week</p>
                <p className="text-3xl font-semibold text-slate-900 dark:text-slate-100 mt-1">
                  {weekWaterUsed.toFixed(1)}L
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

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