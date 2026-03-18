import { useState, useEffect } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "../ui/card";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Label } from "../ui/label";
import { Switch } from "../ui/switch";
import { Slider } from "../ui/slider";
import { Separator } from "../ui/separator";
import { storage } from "../utils/storage";
import type { SystemSettings, WateringZone } from "../types";
import { toast } from "sonner";

export function Settings() {
  const [settings, setSettings] = useState<SystemSettings>(
    storage.getSettings(),
  );
  const [zones, setZones] = useState<WateringZone[]>(storage.getZones());

  const handleSettingChange = (key: keyof SystemSettings, value: any) => {
    const updated = { ...settings, [key]: value };
    setSettings(updated);
    storage.saveSettings(updated);
    toast.success("Settings saved");
  };

  const handleZoneUpdate = (zoneId: string, updates: Partial<WateringZone>) => {
    const updated = zones.map((z) =>
      z.id === zoneId ? { ...z, ...updates } : z,
    );
    setZones(updated);
    storage.saveZones(updated);
    toast.success("Zone updated");
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-slate-900 dark:text-slate-100">
          Settings
        </h2>
        <p className="text-slate-600 dark:text-slate-400">
          Configure system preferences
        </p>
      </div>

      {/* System Settings */}
      <Card>
        <CardHeader>
          <CardTitle>System Settings</CardTitle>
          <CardDescription>
            Configure automatic watering behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Auto Watering</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Automatically water zones when soil moisture is low
              </p>
            </div>
            <Switch
              checked={settings.autoWatering}
              onCheckedChange={(checked) =>
                handleSettingChange("autoWatering", checked)
              }
            />
          </div>

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label>Moisture Threshold: {settings.moistureThreshold}%</Label>
            </div>
            <Slider
              value={[settings.moistureThreshold]}
              onValueChange={(value) =>
                handleSettingChange("moistureThreshold", value[0])
              }
              min={0}
              max={100}
              step={5}
            />
            <p className="text-sm text-slate-600 dark:text-slate-400">
              Water automatically when moisture drops below this level
            </p>
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Rain Delay</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Skip watering when rain is forecasted
              </p>
            </div>
            <Switch
              checked={settings.rainDelay}
              onCheckedChange={(checked) =>
                handleSettingChange("rainDelay", checked)
              }
            />
          </div>

          {settings.rainDelay && (
            <div className="space-y-3 pl-4 border-l-2 border-slate-200 dark:border-slate-700">
              <div className="flex items-center justify-between">
                <Label>Rain Threshold: {settings.rainThreshold}mm</Label>
              </div>
              <Slider
                value={[settings.rainThreshold]}
                onValueChange={(value) =>
                  handleSettingChange("rainThreshold", value[0])
                }
                min={0}
                max={20}
                step={1}
              />
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Skip watering when forecasted rain exceeds this amount
              </p>
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Flow Sensor Enabled</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Enable flow sensor for water usage tracking
              </p>
            </div>
            <Switch
              checked={settings.flowSensorEnabled}
              onCheckedChange={(checked) =>
                handleSettingChange("flowSensorEnabled", checked)
              }
            />
          </div>

          {settings.flowSensorEnabled && (
            <div className="pl-4 border-l-2 border-slate-200 dark:border-slate-700">
              <Label htmlFor="default-flow-rate">
                Default Flow Rate (L/min)
              </Label>
              <Input
                id="default-flow-rate"
                type="number"
                min="0.1"
                max="20"
                step="0.1"
                value={settings.defaultFlowRate}
                onChange={(e) =>
                  handleSettingChange(
                    "defaultFlowRate",
                    parseFloat(e.target.value),
                  )
                }
                className="max-w-xs mt-2"
              />
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
                Used for zones without calibrated flow sensors
              </p>
            </div>
          )}

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Notifications</Label>
              <p className="text-sm text-slate-600 dark:text-slate-400">
                Receive notifications about watering activities
              </p>
            </div>
            <Switch
              checked={settings.notifications}
              onCheckedChange={(checked) =>
                handleSettingChange("notifications", checked)
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Zone Settings */}
      <Card>
        <CardHeader>
          <CardTitle>Zone Configuration</CardTitle>
          <CardDescription>
            Customize settings for each watering zone
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {zones.map((zone) => (
            <div
              key={zone.id}
              className="border border-slate-200 dark:border-slate-700 rounded-lg p-4"
            >
              <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">
                {zone.name}
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div>
                  <Label htmlFor={`zone-${zone.id}-name`}>Zone Name</Label>
                  <Input
                    id={`zone-${zone.id}-name`}
                    value={zone.name}
                    onChange={(e) =>
                      handleZoneUpdate(zone.id, { name: e.target.value })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`zone-${zone.id}-duration`}>
                    Default Duration (minutes)
                  </Label>
                  <Input
                    id={`zone-${zone.id}-duration`}
                    type="number"
                    min="1"
                    max="120"
                    value={zone.duration}
                    onChange={(e) =>
                      handleZoneUpdate(zone.id, {
                        duration: parseInt(e.target.value),
                      })
                    }
                  />
                </div>
                <div>
                  <Label htmlFor={`zone-${zone.id}-flow`}>
                    Flow Rate (L/min)
                  </Label>
                  <Input
                    id={`zone-${zone.id}-flow`}
                    type="number"
                    min="0.1"
                    max="20"
                    step="0.1"
                    value={zone.flowRate}
                    onChange={(e) =>
                      handleZoneUpdate(zone.id, {
                        flowRate: parseFloat(e.target.value),
                      })
                    }
                  />
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {/* Arduino Connection */}
      <Card>
        <CardHeader>
          <CardTitle>Arduino Connection</CardTitle>
          <CardDescription>
            Configure connection to your Arduino device
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Label htmlFor="arduino-ip">Arduino IP Address</Label>
            <Input
              id="arduino-ip"
              type="text"
              placeholder="192.168.1.100"
              defaultValue=""
            />
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-2">
              Enter the IP address or hostname of your Arduino device
            </p>
          </div>
          <div>
            <Label htmlFor="arduino-port">Port</Label>
            <Input
              id="arduino-port"
              type="number"
              placeholder="80"
              defaultValue="80"
            />
          </div>
          <Button>Test Connection</Button>
          <div className="bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg p-4 mt-4">
            <p className="text-sm text-slate-600 dark:text-slate-400">
              <strong>Note:</strong> Configure your Arduino to communicate via
              HTTP or WebSocket. Update the connection settings in{" "}
              <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">
                utils/arduino.ts
              </code>
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
