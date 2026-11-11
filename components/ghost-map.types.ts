/** Shared prop/type definitions for the Ghost Routes map module. */

/** A `[latitude, longitude]` pair. */
export type LatLngTuple = [number, number];

/** GeoJSON-style LineString geometry (`[longitude, latitude]` order, per the GeoJSON spec). */
export interface GhostRouteGeometry {
  type: "LineString";
  coordinates: [number, number][];
}

export interface GhostRoute {
  /** Stable key for the route. */
  id?: string;
  /** Human readable route name (used in the tooltip). */
  name?: string;
  /** Stroke colour. Defaults to the Ghost Routes cyan (#00f3ff). */
  color?: string;
  /**
   * Plain coordinate array in `[latitude, longitude]` order.
   * Use this when you already have a simple list of points.
   */
  coordinates?: LatLngTuple[];
  /**
   * Optional GeoJSON LineString. Takes precedence over `coordinates`
   * and is read in GeoJSON order (`[longitude, latitude]`).
   */
  geometry?: GhostRouteGeometry;
}

export interface GhostStop {
  id?: string;
  /** Stop name, shown as the marker tooltip. */
  name: string;
  latitude: number;
  longitude: number;
  /** Optional description, shown in the marker popup. */
  description?: string;
  /** Marker accent colour. Defaults to #00f3ff. */
  color?: string;
}

export interface GhostMapProps {
  /** Routes drawn as glowing polylines. */
  routes?: GhostRoute[];
  /** Stops drawn as custom SVG map pins. */
  stops?: GhostStop[];
  /** Initial map centre as `[latitude, longitude]`. Defaults to Bengaluru. */
  center?: LatLngTuple;
  /** Initial zoom level. Defaults to 13. */
  zoom?: number;
  /** Extra classes for the outer map wrapper. */
  className?: string;
}
