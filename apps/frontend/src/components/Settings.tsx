import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Slider } from "../ui/slider";
import { Separator } from "../ui/separator";
import { Plus, Trash2, Save } from "lucide-react";
import type { SystemSettings, WateringZone } from "../types";
import { toast } from "sonner";

export function Settings() {
  const [settings, setSettings] = useState<SystemSettings>({
    autoWatering: false,
    moistureThreshold: 30,
    rainDelay: false,
    rainThreshold: 5,
    flowSensorEnabled: false,
    defaultFlowRate: 15,
    notifications: true
  });
  
  const [zones, setZones] = useState<WateringZone[]>([]);
  const [loading, setLoading] = useState(true);

  // Zónák betöltése a szerverről
  const loadData = async () => {
    try {
      const [zonesRes, settingsRes] = await Promise.all([
        fetch('/api/zones'),
        fetch('/api/settings')
      ]);

      if (!zonesRes.ok || !settingsRes.ok) throw new Error("Hálózati hiba");
      
      const zonesData = await zonesRes.json();
      const settingsData = await settingsRes.json();
      
      setZones(zonesData);
      setSettings(settingsData);
    } catch (error) {
      toast.error("Nem sikerült betölteni az adatokat az adatbázisból.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleSettingChange = async (key: keyof SystemSettings, value: any) => {
    // 1. Optimista UI frissítés (hogy a kapcsoló azonnal átbillenjen a felhasználónak)
    const previousSettings = { ...settings };
    const newSettings = { ...settings, [key]: value };
    setSettings(newSettings);

    try {
      // 2. Szinkronizálás a backenddel
      const res = await fetch('/api/settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ [key]: value })
      });

      if (!res.ok) throw new Error();
      toast.success("Beállítás perzisztálva!");
    } catch (error) {
      // 3. Rollback hiba esetén
      setSettings(previousSettings);
      toast.error("Hálózati hiba: Nem sikerült elmenteni az állapotot.");
    }
  };

  // ==========================================
  // ZÓNA CRUD MŰVELETEK
  // ==========================================

  // Új zóna (Create)
  const handleAddZone = async () => {
    try {
      const res = await fetch('/api/zones', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: "Új Zóna", duration: 15 })
      });
      if (!res.ok) throw new Error();
      const newZone = await res.json();
      setZones([...zones, newZone]);
      toast.success("Új zóna létrehozva az adatbázisban");
    } catch (error) {
      toast.error("Hiba a zóna létrehozásakor");
    }
  };

  // Helyi állapot frissítése gépelés közben (nem küldjük rögtön a szerverre)
  const handleZoneLocalChange = (zoneId: string, field: keyof WateringZone, value: any) => {
    setZones(zones.map(z => z.id.toString() === zoneId ? { ...z, [field]: value } : z));
  };

  // Mentés a szerverre (Update)
  const handleSaveZone = async (zone: WateringZone) => {
    try {
      const res = await fetch(`/api/zones/${zone.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: zone.name,
          duration: zone.duration,
          mqttTopicCmd: zone.mqttTopicCmd,
          mqttTopicStatus: zone.mqttTopicStatus
        })
      });
      if (!res.ok) throw new Error();
      toast.success(`A(z) ${zone.name} adatai elmentve!`);
    } catch (error) {
      toast.error("Hiba a mentés során.");
      loadData(); // Visszaállítjuk a szerver állapotára
    }
  };

  // Törlés (Delete)
  const handleDeleteZone = async (zoneId: string) => {
    if (!confirm("Biztosan törölni szeretnéd ezt a zónát? Minden történeti és ütemezési adat elvész!")) return;
    
    try {
      const res = await fetch(`/api/zones/${zoneId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error();
      setZones(zones.filter(z => z.id.toString() !== zoneId));
      toast.success("Zóna véglegesen törölve");
    } catch (error) {
      toast.error("Hiba a törlés során.");
    }
  };

  if (loading) return <div className="p-8 text-center">Beállítások szinkronizálása...</div>;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">Beállítások</h2>
        <p className="text-slate-600 dark:text-slate-400">Rendszer és Zóna konfiguráció</p>
      </div>

      {/* Rendszer beállítások */}
      <Card>
        <CardHeader>
          <CardTitle>Automatizálási paraméterek</CardTitle>
          <CardDescription>Okos öntözés és prediktív szabályozás</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          
          {/* Talajnedvesség */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Reaktív Vezérlés (Talajnedvesség)</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">Automatikus öntözés, ha a talaj kiszárad</p>
            </div>
            <Switch
              checked={settings.autoWatering}
              onCheckedChange={(checked) => handleSettingChange("autoWatering", checked)}
            />
          </div>

          {/* Progresszív felfedés: Csak akkor látszik, ha aktív */}
          {settings.autoWatering && (
            <div className="space-y-3 pl-4 border-l-2 border-blue-500 dark:border-blue-700">
              <div className="flex items-center justify-between">
                <Label>Nedvesség küszöbérték: {settings.moistureThreshold}%</Label>
              </div>
              <Slider
                value={[settings.moistureThreshold]}
                // Húzás közben csak a memóriát frissítjük (UI reszponzivitás)
                onValueChange={(val) => setSettings({ ...settings, moistureThreshold: val[0] })}
                // Elengedéskor küldjük a hálózati kérést
                onValueCommit={(val) => handleSettingChange("moistureThreshold", val[0])}
                min={0}
                max={100}
                step={5}
              />
            </div>
          )}

          <Separator />

          {/* Esőnapolás */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Prediktív Vezérlés (Esőnapolás)</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">Öntözés kihagyása várható csapadék esetén</p>
            </div>
            <Switch
              checked={settings.rainDelay}
              onCheckedChange={(checked) => handleSettingChange("rainDelay", checked)}
            />
          </div>

          {settings.rainDelay && (
            <div className="space-y-3 pl-4 border-l-2 border-blue-500 dark:border-blue-700">
              <div className="flex items-center justify-between">
                <Label>Csapadék küszöbérték: {settings.rainThreshold} mm</Label>
              </div>
              <Slider
                value={[settings.rainThreshold]}
                onValueChange={(val) => setSettings({ ...settings, rainThreshold: val[0] })}
                onValueCommit={(val) => handleSettingChange("rainThreshold", val[0])}
                min={0}
                max={20}
                step={1}
              />
            </div>
          )}

          <Separator />

          {/* Telemetria */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Telemetria (Áramlásmérő)</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">Vízfogyasztás mérése és becslése</p>
            </div>
            <Switch
              checked={settings.flowSensorEnabled}
              onCheckedChange={(checked) => handleSettingChange("flowSensorEnabled", checked)}
            />
          </div>

          {settings.flowSensorEnabled && (
            <div className="pl-4 border-l-2 border-blue-500 dark:border-blue-700">
              <Label htmlFor="default-flow-rate">Alapértelmezett átfolyás (L/perc)</Label>
              <Input
                id="default-flow-rate"
                type="number"
                min="0.1"
                max="50"
                step="0.1"
                value={settings.defaultFlowRate}
                onChange={(e) => setSettings({ ...settings, defaultFlowRate: parseFloat(e.target.value) || 15 })}
                // Szintén optimalizáció: Csak akkor mentünk, ha a felhasználó kikattint a mezőből
                onBlur={(e) => handleSettingChange("defaultFlowRate", parseFloat(e.target.value) || 15)}
                className="max-w-xs mt-2"
              />
            </div>
          )}

          <Separator />

          {/* Értesítések */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Rendszeresemények (Értesítések)</Label>
            </div>
            <Switch
              checked={settings.notifications}
              onCheckedChange={(checked) => handleSettingChange("notifications", checked)}
            />
          </div>

        </CardContent>
      </Card>

      {/* ZÓNA KONFIGURÁCIÓ (Itt van a módosítás magja) */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Zóna Konfiguráció és Hardver Illesztés</CardTitle>
            <CardDescription>Szelepek MQTT topicjainak beállítása</CardDescription>
          </div>
          <Button onClick={handleAddZone} size="sm" className="flex items-center gap-2">
            <Plus className="w-4 h-4" /> Új Zóna
          </Button>
        </CardHeader>
        <CardContent className="space-y-6">
          {zones.map((zone) => (
            <div key={zone.id} className="border border-slate-200 dark:border-slate-700 rounded-lg p-5 bg-slate-50 dark:bg-slate-800/50">
              <div className="flex items-center justify-between mb-4 border-b border-slate-200 dark:border-slate-700 pb-3">
                <h3 className="font-semibold text-lg text-slate-900 dark:text-slate-100">{zone.name}</h3>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleSaveZone(zone)}>
                    <Save className="w-4 h-4 mr-2" /> Mentés
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDeleteZone(zone.id.toString())}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Alap adatok */}
                <div className="space-y-4">
                  <div>
                    <Label>Zóna Megnevezése</Label>
                    <Input
                      value={zone.name}
                      onChange={(e) => handleZoneLocalChange(zone.id.toString(), "name", e.target.value)}
                    />
                  </div>
                  <div>
                    <Label>Alapértelmezett Időtartam (perc)</Label>
                    <Input
                      type="number"
                      min="1"
                      value={zone.duration}
                      onChange={(e) => handleZoneLocalChange(zone.id.toString(), "duration", parseInt(e.target.value) || 15)}
                    />
                  </div>
                </div>

                {/* Hardver Integráció (MQTT) */}
                <div className="space-y-4 bg-slate-100 dark:bg-slate-900 p-4 rounded-md">
                  <div className="flex items-center justify-between">
                    <Label className="text-blue-600 dark:text-blue-400 font-bold">MQTT Parancs Topic (CMD)</Label>
                    <span className="text-[10px] text-slate-500 uppercase">Raspberry Pi hallgatja</span>
                  </div>
                  <Input
                    className="font-mono text-sm"
                    value={zone.mqttTopicCmd || ""}
                    onChange={(e) => handleZoneLocalChange(zone.id.toString(), "mqttTopicCmd", e.target.value)}
                  />

                  <div className="flex items-center justify-between mt-4">
                    <Label className="text-green-600 dark:text-green-400 font-bold">MQTT Státusz Topic (STATUS)</Label>
                    <span className="text-[10px] text-slate-500 uppercase">Raspberry Pi ide ír</span>
                  </div>
                  <Input
                    className="font-mono text-sm"
                    value={zone.mqttTopicStatus || ""}
                    onChange={(e) => handleZoneLocalChange(zone.id.toString(), "mqttTopicStatus", e.target.value)}
                  />
                </div>
              </div>
            </div>
          ))}
          {zones.length === 0 && (
            <div className="text-center py-8 text-slate-500">
              Nincsenek zónák az adatbázisban. Hozz létre egyet!
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}