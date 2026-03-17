import type { WateringZone, ScheduleEntry} from "../types";

const STORAGE_KEYS = {
  ZONES: "watering_zones",
  SCHEDULES: "watering_schedules",
};

export const storage = {
  getZones(): WateringZone[] {
    const data = localStorage.getItem(STORAGE_KEYS.ZONES);
    if (!data) {
      const defaultZones: WateringZone[] = [
        { id: "1", name: "Front Lawn", isActive: false, duration: 15, lastWatered: null, flowRate: 5 },
        { id: "2", name: "Back Garden", isActive: false, duration: 20, lastWatered: null, flowRate: 4.5 },
        { id: "3", name: "Vegetable Patch", isActive: false, duration: 10, lastWatered: null, flowRate: 3 },
        { id: "4", name: "Flower Beds", isActive: false,  duration: 12, lastWatered: null, flowRate: 3.5 },
      ];
      this.saveZones(defaultZones);
      return defaultZones;
    }
    
    return JSON.parse(data, (key, value) => {
      if (key === "lastWatered" && value) return new Date(value);
      return value;
    });
  },

  saveZones(zones: WateringZone[]) {
    localStorage.setItem(STORAGE_KEYS.ZONES, JSON.stringify(zones));
  },
  
  updateZone(zoneId: string, start: boolean) {
    const zones = this.getZones();
    
    const updatedZones = zones.map(zone => {
      if (zone.id === zoneId) {
        return {
          ...zone,
          isActive: start,
          lastWatered: start ? new Date() : zone.lastWatered
        };
      }
      return zone;
    });
    this.saveZones(updatedZones);
  },

  getSchedules(): ScheduleEntry[] {
    const data = localStorage.getItem(STORAGE_KEYS.SCHEDULES);
    if (!data) {
      const defaultSchedules: ScheduleEntry[] = [
        { id: "1", zoneId: "1", time: "06:00", duration: 15, days: [1, 3, 5], enabled: true },
        { id: "2", zoneId: "2", time: "06:15", duration: 20, days: [1, 3, 5], enabled: true },
        { id: "3", zoneId: "3", time: "07:00", duration: 10, days: [0, 2, 4, 6], enabled: true },
      ];
      this.saveSchedules(defaultSchedules);
      return defaultSchedules;
    }
    return JSON.parse(data);
  },
  saveSchedules(schedules: ScheduleEntry[]) {
    localStorage.setItem(STORAGE_KEYS.SCHEDULES, JSON.stringify(schedules));
  },

};