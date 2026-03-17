import { 
  Sun, 
  CloudSun, 
  Cloud, 
  CloudFog, 
  CloudDrizzle, 
  CloudRain, 
  CloudSnow, 
  CloudLightning,
  HelpCircle,
} from 'lucide-react';
import type {LucideIcon} from 'lucide-react';
import { fetchWeatherApi } from "openmeteo";

export interface WeatherForecastDay {
  date: Date;
  tempMax: number;
  tempMin: number;
  weatherCode: number;
  rainSum: number;
  label: string;
  icon: LucideIcon;
}

interface WeatherMetadata {
  label: string;
  icon: LucideIcon;
}

const WMO_METADATA: Record<number, WeatherMetadata> = {
  0:  { label: 'Clear sky', icon: Sun },
  1:  { label: 'Mainly clear', icon: CloudSun },
  2:  { label: 'Partly cloudy', icon: CloudSun },
  3:  { label: 'Overcast', icon: Cloud },
  45: { label: 'Foggy', icon: CloudFog },
  48: { label: 'Depositing rime fog', icon: CloudFog },
  51: { label: 'Light drizzle', icon: CloudDrizzle },
  53: { label: 'Moderate drizzle', icon: CloudDrizzle },
  55: { label: 'Dense drizzle', icon: CloudDrizzle },
  61: { label: 'Slight rain', icon: CloudRain },
  63: { label: 'Moderate rain', icon: CloudRain },
  65: { label: 'Heavy rain', icon: CloudRain },
  71: { label: 'Slight snow fall', icon: CloudSnow },
  73: { label: 'Moderate snow fall', icon: CloudSnow },
  75: { label: 'Heavy snow fall', icon: CloudSnow },
  80: { label: 'Slight rain showers', icon: CloudRain },
  81: { label: 'Moderate rain showers', icon: CloudRain },
  82: { label: 'Violent rain showers', icon: CloudRain },
  95: { label: 'Thunderstorm', icon: CloudLightning },
  96: { label: 'Thunderstorm with slight hail', icon: CloudLightning },
  99: { label: 'Thunderstorm with heavy hail', icon: CloudLightning },
};

const params = {
	latitude: 47.35333,
	longitude: 18.27312,
	daily: ["temperature_2m_max", "temperature_2m_min", "weather_code", "rain_sum"],
	timezone: "auto",
	past_days: 1,
	forecast_days: 4,
};

const DEFAULT_METADATA: WeatherMetadata = {
  label: 'Unknown',
  icon: HelpCircle
};

export const getWeatherMetadata = (code: number): WeatherMetadata => {
  return WMO_METADATA[code] ?? DEFAULT_METADATA;
};

const URL = "https://api.open-meteo.com/v1/forecast";
const PARAMS = {
  latitude: 47.35333,
  longitude: 18.27312,
  daily: ["temperature_2m_max", "temperature_2m_min", "weather_code", "rain_sum"],
  timezone: "auto",
  forecast_days: 5,
};

export async function fetchWeather(): Promise<WeatherForecastDay[]> {
  const responses = await fetchWeatherApi(URL, PARAMS);
  const response = responses[0];
  const daily = response.daily()!;
  const utcOffsetSeconds = response.utcOffsetSeconds();
  const times = Array.from({ length: 5 }, (_, i) => 
    new Date((Number(daily.time()) + i * daily.interval() + utcOffsetSeconds) * 1000)
  );

  const maxTemps = daily.variables(0)!.valuesArray()!;
  const minTemps = daily.variables(1)!.valuesArray()!;
  const codes = daily.variables(2)!.valuesArray()!;
  const rains = daily.variables(3)!.valuesArray()!;

  return times.map((date, i) => {
    const meta = getWeatherMetadata(Math.round(codes[i]));
    return {
      date,
      tempMax: Math.round(maxTemps[i]),
      tempMin: Math.round(minTemps[i]),
      weatherCode: codes[i],
      rainSum: rains[i],
      label: meta.label,
      icon: meta.icon
    };
  });
}