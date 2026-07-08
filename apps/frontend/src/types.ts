export interface WateringZone {
  mqttTopicStatus: any;
  mqttTopicCmd: any;
  id: string;
  name: string;
  isActive: boolean;
  duration: number; // minutes
  lastWatered: Date | null;
  flowRate: number; // liters per minute
}

export interface ScheduleEntry {
  id: string;
  zoneId: string;
  time: string; // HH:MM format
  duration: number; // minutes
  days: number[]; // 0-6, Sunday-Saturday
  enabled: boolean;
}

export interface WateringHistory {
  id: string;
  zoneId: string;
  zoneName: string;
  startTime: Date;
  duration: number;
  type: "manual" | "scheduled" | "auto";
  waterUsed: number; // liters
}

export interface WeatherData {
  temperature: number;
  humidity: number;
  precipitation: number;
  //soil humidity
  forecast: {
    day: string;
    temp: number;
    condition: string;
    rain: number;
  }[];
}

export interface SystemSettings {
  autoWatering: boolean;
  moistureThreshold: number;
  rainDelay: boolean;
  rainThreshold: number;
  notifications: boolean;
  flowSensorEnabled: boolean;
  defaultFlowRate: number; // liters per minute
}

export interface FlowSensorData {
  flowRate: number; // current flow rate in L/min
  totalVolume: number; // total volume in liters
  timestamp: Date;
}
