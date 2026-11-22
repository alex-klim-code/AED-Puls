export type Coordinates = { latitude: number; longitude: number };
export function hasCoordinates<T extends{latitude:number|null;longitude:number|null}>(value:T):value is T&Coordinates{
  return typeof value.latitude==="number"&&typeof value.longitude==="number"
    &&Number.isFinite(value.latitude)&&Number.isFinite(value.longitude);
}

/** Distance in a straight line, not a walking route. */
export function distanceMeters(a: Coordinates, b: Coordinates): number {
  const rad = (v: number) => v * Math.PI / 180;
  const lat = rad(b.latitude - a.latitude);
  const lng = rad(b.longitude - a.longitude);
  const h = Math.sin(lat / 2) ** 2 + Math.cos(rad(a.latitude)) * Math.cos(rad(b.latitude)) * Math.sin(lng / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function distanceLabel(meters: number) {
  return meters < 1000 ? `${Math.round(meters)} m` : `${(meters / 1000).toFixed(1)} km`;
}
