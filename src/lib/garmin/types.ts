export type OAuth1Token = { key: string; secret: string };

export type GarminTokens = {
  oauth1: OAuth1Token;
  accessToken: string;
  /** Epoch ms when the bearer token stops working. */
  expiresAt: number;
};

export type GarminSession = GarminTokens & {
  /** Display name for the signed-in account, shown in the header. */
  displayName: string;
};

export type GarminActivity = {
  activityId: number;
  activityName: string;
  startTimeLocal: string;
  startTimeGMT: string;
  activityType: { typeKey: string };
  distance: number;
  duration: number;
  elapsedDuration: number;
  averageHR?: number;
  maxHR?: number;
  calories?: number;
  elevationGain?: number;
  elevationLoss?: number;
  averageSpeed?: number;
  maxSpeed?: number;
  hasPolyline?: boolean;
};
