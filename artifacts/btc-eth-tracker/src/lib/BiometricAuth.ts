import { registerPlugin } from "@capacitor/core";

export interface BiometricAuthPlugin {
  setBiometricEnabled(options: { enabled: boolean }): Promise<void>;
  isBiometricEnabled(): Promise<{ enabled: boolean }>;
}

const BiometricAuth = registerPlugin<BiometricAuthPlugin>("BiometricAuth");

export { BiometricAuth };
