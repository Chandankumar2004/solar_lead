import React, { useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { AppButton, AppScreen, Card, SectionTitle, useAppPalette } from "../ui/primitives";

type BiometricUnlockScreenProps = {
  onUnlock: () => Promise<boolean>;
  onLogout: () => Promise<void>;
};

export function BiometricUnlockScreen({ onUnlock, onLogout }: BiometricUnlockScreenProps) {
  const colors = useAppPalette();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleUnlock = async () => {
    setError(null);
    setBusy(true);
    try {
      const unlocked = await onUnlock();
      if (!unlocked) {
        setError("Biometric authentication failed.");
      }
    } catch {
      setError("Unable to perform biometric authentication.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <AppScreen contentContainerStyle={styles.container}>
      <Card style={styles.card}>
        <View
          style={[
            styles.iconWrap,
            {
              backgroundColor: colors.accent,
              borderColor: colors.border
            }
          ]}
        >
          <Ionicons name="finger-print" size={40} color={colors.primary} />
        </View>
        <SectionTitle
          title="Unlock Solar Lead"
          subtitle="Use biometric verification to continue"
        />

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        <AppButton
          title="Unlock"
          onPress={() => void handleUnlock()}
          busy={busy}
        />
        <AppButton title="Logout" kind="ghost" onPress={() => void onLogout()} />
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center"
  },
  card: {
    gap: 12,
    alignItems: "center"
  },
  iconWrap: {
    width: 86,
    height: 86,
    borderRadius: 43,
    borderWidth: 1,
    alignItems: "center",
    justifyContent: "center"
  },
  error: {
    textAlign: "center"
  }
});
