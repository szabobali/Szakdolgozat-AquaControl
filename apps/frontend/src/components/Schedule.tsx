import { useState, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "../ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../ui/select";
import { Plus, Trash2, Clock } from "lucide-react";
import type { ScheduleEntry, WateringZone } from "../types";
import { toast } from "sonner";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function Schedule() {
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [zones, setZones] = useState<WateringZone[]>([]);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleEntry | null>(null);

  const loadData = async () => {
    try {
      // Promise.all: Párhuzamosan indítjuk a két független hálózati kérést az I/O maximalizálása érdekében
      const [schedulesRes, zonesRes] = await Promise.all([
        fetch('/api/schedules'),
        fetch('/api/zones')
      ]);

      if (!schedulesRes.ok || !zonesRes.ok) throw new Error("Hiba az adatok szinkronizálásakor");

      const schedulesData = await schedulesRes.json();
      const zonesData = await zonesRes.json();

      setSchedules(schedulesData);
      setZones(zonesData);
    } catch (error: any) {
      console.error("[Frontend] Betöltési hiba:", error);
      toast.error("Nem sikerült betölteni az ütemezéseket a szerverről.");
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleToggleSchedule = async (id: string) => {
    const targetSchedule = schedules.find((s) => s.id === id);
    if (!targetSchedule) return;

    const previousSchedules = [...schedules];
    const newStatus = !targetSchedule.enabled;

    // 1. Állapot azonnali módosítása a memóriában
    setSchedules(schedules.map((s) => s.id === id ? { ...s, enabled: newStatus } : s));

    try {
      // 2. Szinkronizálás a backenddel
      const res = await fetch(`/api/schedules/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newStatus })
      });

      if (!res.ok) throw new Error("Backend visszautasította a kérést");
      toast.success(newStatus ? "Ütemezés bekapcsolva" : "Ütemezés kikapcsolva");
    } catch (error) {
      console.error("[Frontend] Toggle hiba:", error);
      // 3. Rollback (visszagörgetés) hiba esetén
      setSchedules(previousSchedules);
      toast.error("Hálózati hiba: Az állapotot nem sikerült elmenteni.");
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm("Biztosan törölni szeretnéd ezt az ütemezést?")) return;

    try {
      const res = await fetch(`/api/schedules/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error("Törlés sikertelen");

      setSchedules(schedules.filter((s) => s.id !== id));
      toast.success("Ütemezés véglegesen törölve");
    } catch (error) {
      console.error("[Frontend] Törlési hiba:", error);
      toast.error("Hiba történt a törlés során.");
    }
  };

  const handleSaveSchedule = async (scheduleData: Partial<ScheduleEntry>) => {
    try {
      if (editingSchedule) {
        // Módosítás (PUT)
        const res = await fetch(`/api/schedules/${editingSchedule.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduleData)
        });

        if (!res.ok) throw new Error("Nem sikerült módosítani");
        const updatedRecord = await res.json();
        
        setSchedules(schedules.map((s) => s.id === editingSchedule.id ? updatedRecord : s));
        toast.success("Ütemezés sikeresen módosítva");
      } else {
        // Létrehozás (POST)
        const res = await fetch('/api/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(scheduleData)
        });

        if (!res.ok) throw new Error("Nem sikerült létrehozni");
        const createdRecord = await res.json();
        
        setSchedules([...schedules, createdRecord]);
        toast.success("Új ütemezés elmentve az adatbázisba");
      }

      setIsDialogOpen(false);
      setEditingSchedule(null);
    } catch (error: any) {
      console.error("[Frontend] Mentési hiba:", error);
      toast.error(error.message);
    }
  };

  const getZoneName = (zoneId: string) => {
    return zones.find((z) => z.id === zoneId)?.name || "Unknown";
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Watering Schedule</h2>
          <p className="text-slate-600 dark:text-slate-400">Manage automatic watering schedules</p>
        </div>
        <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
          <DialogTrigger asChild>
            <Button onClick={() => setEditingSchedule(null)}>
              <Plus className="w-4 h-4 mr-2" />
              Add Schedule
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {editingSchedule ? "Edit Schedule" : "Add Schedule"}
              </DialogTitle>
            </DialogHeader>
            <ScheduleForm
              schedule={editingSchedule}
              zones={zones}
              onSave={handleSaveSchedule}
            />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Active Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {schedules.length === 0 ? (
            <div className="text-center py-8 text-slate-500">
              <Clock className="w-12 h-12 mx-auto mb-3 opacity-50" />
              <p>No schedules configured yet</p>
            </div>
          ) : (
            <div className="space-y-3">
              {schedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className="border border-slate-200 dark:border-slate-700 rounded-lg p-4 hover:border-slate-300 dark:hover:border-slate-600 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-3 mb-2">
                        <h3 className="font-semibold text-slate-900 dark:text-slate-100">
                          {getZoneName(schedule.zoneId)}
                        </h3>
                        <span className="text-lg font-medium text-blue-600 dark:text-blue-400">
                          {schedule.time}
                        </span>
                      </div>
                      <div className="flex items-center gap-4 text-sm text-slate-600 dark:text-slate-400">
                        <span>Duration: {schedule.duration} min</span>
                        <span>•</span>
                        <div className="flex gap-1">
                          {DAYS.map((day, index) => (
                            <span
                              key={day}
                              className={`px-2 py-1 rounded text-xs ${
                                schedule.days.includes(index)
                                  ? "bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300 font-medium"
                                  : "bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500"
                              }`}
                            >
                              {day}
                            </span>
                          ))}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={schedule.enabled}
                        onCheckedChange={() => handleToggleSchedule(schedule.id)}
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setEditingSchedule(schedule);
                          setIsDialogOpen(true);
                        }}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteSchedule(schedule.id)}
                      >
                        <Trash2 className="w-4 h-4 text-red-600" />
                      </Button>
                    </div>
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

function ScheduleForm({
  schedule,
  zones,
  onSave,
}: {
  schedule: ScheduleEntry | null;
  zones: WateringZone[];
  onSave: (schedule: Partial<ScheduleEntry>) => void;
}) {
  const [formData, setFormData] = useState<Partial<ScheduleEntry>>(
    schedule || {
      zoneId: zones.length > 0 ? zones[0].id.toString() : "",
      time: "06:00",
      duration: zones.length > 0 && zones[0].duration ? zones[0].duration : 15,
      days: [1, 3, 5],
    }
  );

  useEffect(() => {
    if (!schedule && !formData.zoneId && zones.length > 0) {
      setFormData((prev) => ({
        ...prev,
        zoneId: zones[0].id.toString(),
        duration: zones[0].duration || 15, // Beemeljük a DB-s alapértelmezett időt
      }));
    }
  }, [zones, schedule, formData.zoneId]);

  const handleZoneChange = (newZoneId: string) => {
    const selectedZone = zones.find((z) => z.id.toString() === newZoneId);
    setFormData({
      ...formData,
      zoneId: newZoneId,
      // Automatikusan átvesszük a DB-ben tárolt alapértelmezett időt az új zónához
      duration: selectedZone?.duration || formData.duration,
    });
  };

  const handleDayToggle = (dayIndex: number) => {
    const days = formData.days || [];
    if (days.includes(dayIndex)) {
      setFormData({ ...formData, days: days.filter((d) => d !== dayIndex) });
    } else {
      setFormData({ ...formData, days: [...days, dayIndex].sort() });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.days || formData.days.length === 0) {
      toast.error("Válassz ki legalább egy napot!");
      return;
    }
    if (!formData.zoneId) {
      toast.error("Kérlek, várj, amíg a zónák betöltődnek, vagy válassz egyet!");
      return;
    }
    onSave(formData);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <Label>Zone</Label>
        <Select
          value={formData.zoneId}
          onValueChange={handleZoneChange}
        >
          <SelectTrigger>
            <SelectValue placeholder="Válassz zónát..."/>
          </SelectTrigger>
          <SelectContent>
            {zones.map((zone) => (
              <SelectItem key={zone.id} value={zone.id.toString()}>
                {zone.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div>
        <Label>Start Time</Label>
        <Input
          type="time"
          value={formData.time}
          onChange={(e) => setFormData({ ...formData, time: e.target.value })}
        />
      </div>

      <div>
        <Label>Duration (minutes)</Label>
        <Input
          type="number"
          min="1"
          max="120"
          value={formData.duration}
          onChange={(e) =>
            setFormData({ ...formData, duration: parseInt(e.target.value) || 15 })
          }
        />
      </div>

      <div>
        <Label>Days</Label>
        <div className="flex gap-2 mt-2">
          {DAYS.map((day, index) => (
            <button
              key={day}
              type="button"
              onClick={() => handleDayToggle(index)}
              className={`px-3 py-2 rounded text-sm font-medium transition-colors ${
                formData.days?.includes(index)
                  ? "bg-blue-600 text-white"
                  : "bg-slate-100 text-slate-600 hover:bg-slate-200"
              }`}
            >
              {day}
            </button>
          ))}
        </div>
      </div>

      <div className="flex justify-end gap-2 pt-4">
        <Button type="submit">Save Schedule</Button>
      </div>
    </form>
  );
}