/**
 * Map, Geocoding, and Routing Provider Abstraction
 */

import { calculateDistanceMeters, DEFAULT_SHOP_COORDINATES } from "../delivery";

export interface Coordinates {
  lat: number;
  lng: number;
}

export interface GeocodeResult {
  formattedAddress: string;
  locality: string;
  city: string;
  postalCode?: string;
  coordinates: Coordinates;
}

export interface IMapProvider {
  reverseGeocode(coords: Coordinates): Promise<GeocodeResult>;
  calculateDistance(from: Coordinates, to: Coordinates): Promise<number>;
}

interface MulbagalZone {
  locality: string;
  landmark: string;
  lat: number;
  lng: number;
  postalCode: string;
}

const MULBAGAL_ZONES: MulbagalZone[] = [
  {
    locality: "Srinivaspur Road",
    landmark: "Near Srinivaspur Road Main Cross, Mulbagal",
    lat: 13.1682,
    lng: 78.3935,
    postalCode: "563131",
  },
  {
    locality: "Mulbagal Bus Stand",
    landmark: "Near KSRTC Bus Stand Road, Mulbagal",
    lat: 13.1652,
    lng: 78.3948,
    postalCode: "563131",
  },
  {
    locality: "Someshwara Palya",
    landmark: "Someshwara Palya Main Road, Mulbagal",
    lat: 13.1628,
    lng: 78.3912,
    postalCode: "563131",
  },
  {
    locality: "Muthyalpete",
    landmark: "Muthyalpete Bazaar Street, Mulbagal",
    lat: 13.1665,
    lng: 78.3978,
    postalCode: "563131",
  },
  {
    locality: "Anjani Extension",
    landmark: "Near Anjaneya Swamy Temple Road, Mulbagal",
    lat: 13.1704,
    lng: 78.3962,
    postalCode: "563131",
  },
  {
    locality: "Kolar Road",
    landmark: "NH-75 Kolar Bypass Junction, Mulbagal",
    lat: 13.1615,
    lng: 78.3865,
    postalCode: "563131",
  },
  {
    locality: "Nuggalabande",
    landmark: "Nuggalabande Extension, Mulbagal",
    lat: 13.1721,
    lng: 78.3905,
    postalCode: "563131",
  },
];

function resolveNearestMulbagalZone(coords: Coordinates): GeocodeResult {
  let nearest = MULBAGAL_ZONES[0];
  let minDistance = Number.POSITIVE_INFINITY;

  for (const zone of MULBAGAL_ZONES) {
    const dist = calculateDistanceMeters(coords.lat, coords.lng, zone.lat, zone.lng);
    if (dist < minDistance) {
      minDistance = dist;
      nearest = zone;
    }
  }

  return {
    formattedAddress: `${nearest.landmark}, Karnataka (${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)})`,
    locality: nearest.locality,
    city: "Mulbagal",
    postalCode: nearest.postalCode,
    coordinates: coords,
  };
}

export class ModularMapProvider implements IMapProvider {
  async reverseGeocode(coords: Coordinates): Promise<GeocodeResult> {
    const fallback = resolveNearestMulbagalZone(coords);

    if (typeof fetch !== "function") {
      return fallback;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3500);

    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(
        coords.lat
      )}&lon=${encodeURIComponent(coords.lng)}&zoom=18&addressdetails=1`;

      const res = await fetch(url, {
        headers: {
          Accept: "application/json",
          "User-Agent": "homemart4u-mulbagal-ecommerce/1.0",
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        return fallback;
      }

      const data = await res.json();
      const addr = data?.address || {};
      const locality =
        addr.suburb ||
        addr.neighbourhood ||
        addr.road ||
        addr.residential ||
        addr.quarter ||
        addr.village ||
        fallback.locality;
      const city =
        addr.town ||
        addr.city ||
        addr.municipality ||
        addr.county ||
        "Mulbagal";
      const postalCode = addr.postcode || fallback.postalCode;
      const formattedAddress =
        typeof data?.display_name === "string" && data.display_name.trim().length > 0
          ? data.display_name
          : fallback.formattedAddress;

      return {
        formattedAddress,
        locality,
        city,
        postalCode,
        coordinates: coords,
      };
    } catch {
      return fallback;
    } finally {
      clearTimeout(timeout);
    }
  }

  async calculateDistance(from: Coordinates, to: Coordinates): Promise<number> {
    // Accurate Haversine distance in meters
    return calculateDistanceMeters(from.lat, from.lng, to.lat, to.lng);
  }
}

export const mapProvider = new ModularMapProvider();
export { DEFAULT_SHOP_COORDINATES };
