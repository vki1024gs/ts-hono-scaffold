export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export type JsonObject = { [key: string]: JsonValue };

/** Portable, versioned user settings. Startup environment is intentionally excluded. */
export type SettingsDocument<T extends JsonObject = JsonObject> = {
  schemaVersion: number;
  applicationId: string;
  documentType: string;
  data: T;
};
