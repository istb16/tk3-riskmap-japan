export type RiskType = 'weather' | 'earthquake' | 'heat' | 'air';

export interface RegionRisk {
	id: string;
	name: string;
	lat: number;
	lng: number;
	riskScore: number;
	riskTypes: RiskType[];
	reasons: string[];
	updatedAt: number;
	details: {
		weather?: WeatherData;
		earthquake?: EarthquakeData;
		air?: AirData;
	};
}

export interface WeatherData {
	temperature: number;
	weatherCode: number;
	precipitation: number;
	windSpeed: number;
	alertLevel: 'none' | 'advisory' | 'warning' | 'special';
}

export interface EarthquakeData {
	magnitude: number | null;
	place: string | null;
	time: number | null;
	depth: number | null;
}

export interface AirData {
	pm25: number | null;
	aqi: number | null;
}

export interface Region {
	id: string;
	name: string;
	lat: number;
	lng: number;
	city: string;
}
