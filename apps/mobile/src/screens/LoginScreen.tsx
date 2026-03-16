import React, { useCallback, useEffect, useRef, useState } from "react";
import { Alert, StyleSheet, Text, TextInput, View } from "react-native";
import * as LocalAuthentication from "expo-local-authentication";
import axios from "axios";
import { useForm, Controller } from "react-hook-form";
import { z } from "zod";
import { zodResolver } from "@hookform/resolvers/zod";
import { useAuthStore } from "../store/auth-store";
import { resolvedApiBaseUrl } from "../services/api";
import {
  recaptchaBypassEnabled,
  recaptchaBypassToken,
  recaptchaLoginAction,
  recaptchaSiteKey
} from "../services/recaptcha";
import {
  AppButton,
  AppScreen,
  Badge,
  Card,
  SectionTitle,
  useAppPalette,
  useTextInputStyle
} from "../ui/primitives";
import { spacing } from "../ui/theme";

const RecaptchaComponent = recaptchaBypassEnabled
  ? null
  : (require("../components/RecaptchaV3") as typeof import("../components/RecaptchaV3"))
      .RecaptchaV3;

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8)
});

type LoginValues = z.infer<typeof loginSchema>;

function getLoginErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const code = error.response?.data?.code;
    const apiMessage = error.response?.data?.message;
    if (typeof apiMessage === "string" && apiMessage.trim()) {
      if (code === "RECAPTCHA_TOKEN_REQUIRED") {
        return "reCAPTCHA token is required. Configure the mobile site key and retry.";
      }
      if (code === "RECAPTCHA_TOKEN_INVALID") {
        return "reCAPTCHA verification failed. Ensure the mobile site key is valid.";
      }
      return apiMessage;
    }
    if (!error.response) {
      return `Cannot connect to API (${resolvedApiBaseUrl}). Check EXPO_PUBLIC_API_BASE_URL and API server status.`;
    }
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return "Login failed. Check credentials or account status.";
}

export function LoginScreen() {
  const colors = useAppPalette();
  const textInputStyle = useTextInputStyle();
  const login = useAuthStore((s) => s.login);
  const authNotice = useAuthStore((s) => s.authNotice);
  const clearAuthNotice = useAuthStore((s) => s.clearAuthNotice);
  const hasLoggedInOnce = useAuthStore((s) => s.hasLoggedInOnce);
  const setBiometricEnabled = useAuthStore((s) => s.setBiometricEnabled);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [recaptchaRequestId, setRecaptchaRequestId] = useState<number | null>(null);
  const recaptchaResolveRef = useRef<((token: string | null) => void) | null>(null);
  const recaptchaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    control,
    handleSubmit,
    formState: { errors }
  } = useForm<LoginValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: ""
    }
  });

  const cancelRecaptcha = useCallback(() => {
    if (recaptchaTimerRef.current) {
      clearTimeout(recaptchaTimerRef.current);
      recaptchaTimerRef.current = null;
    }
    recaptchaResolveRef.current = null;
    setRecaptchaRequestId(null);
  }, []);

  useEffect(() => {
    return () => {
      cancelRecaptcha();
    };
  }, [cancelRecaptcha]);

  const requestRecaptchaToken = useCallback(async () => {
    if (recaptchaBypassEnabled) {
      return recaptchaBypassToken;
    }
    if (!recaptchaSiteKey) {
      return null;
    }

    return new Promise<string | null>((resolve) => {
      recaptchaResolveRef.current = resolve;
      setRecaptchaRequestId(Date.now());
      recaptchaTimerRef.current = setTimeout(() => {
        if (recaptchaResolveRef.current) {
          recaptchaResolveRef.current(null);
        }
        cancelRecaptcha();
      }, 12000);
    });
  }, [cancelRecaptcha]);

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    setIsSubmitting(true);

    const isFirstSuccessfulLogin = !hasLoggedInOnce;

    try {
      let recaptchaToken: string | null = null;
      if (recaptchaSiteKey) {
        recaptchaToken = await requestRecaptchaToken();
        if (!recaptchaToken) {
          throw new Error("Unable to obtain reCAPTCHA token. Check mobile site key configuration.");
        }
      }

      await login(values.email, values.password, {
        recaptchaToken,
        recaptchaAction: recaptchaLoginAction
      });

      if (isFirstSuccessfulLogin) {
        const [hasHardware, isEnrolled] = await Promise.all([
          LocalAuthentication.hasHardwareAsync(),
          LocalAuthentication.isEnrolledAsync()
        ]);

        if (hasHardware && isEnrolled) {
          Alert.alert(
            "Enable biometric unlock?",
            "Use your fingerprint or face unlock on next app open.",
            [
              { text: "Not now", style: "cancel" },
              {
                text: "Enable",
                onPress: () => {
                  void setBiometricEnabled(true);
                }
              }
            ]
          );
        }
      }
    } catch (error) {
      setError(getLoginErrorMessage(error));
    } finally {
      setIsSubmitting(false);
    }
  });

  return (
    <AppScreen contentContainerStyle={styles.container}>
      {RecaptchaComponent && !recaptchaBypassEnabled && recaptchaSiteKey && recaptchaRequestId !== null ? (
        <RecaptchaComponent
          siteKey={recaptchaSiteKey}
          action={recaptchaLoginAction}
          requestId={recaptchaRequestId}
          onToken={(token) => {
            if (recaptchaResolveRef.current) {
              recaptchaResolveRef.current(token);
            }
            cancelRecaptcha();
          }}
          onError={(message) => {
            if (recaptchaResolveRef.current) {
              recaptchaResolveRef.current(null);
            }
            cancelRecaptcha();
            setError(message);
          }}
        />
      ) : null}
      <Card style={styles.headerCard}>
        <SectionTitle title="Field Login" subtitle="Solar Lead Management" />
        <Badge label="Secure Cookie Session" tone="success" />
      </Card>

      <Card style={styles.formCard}>
        {authNotice ? <Text style={[styles.notice, { color: colors.warning }]}>{authNotice}</Text> : null}

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.text }]}>Email</Text>
          <Controller
            control={control}
            name="email"
            render={({ field: { onChange, value } }) => (
              <TextInput
                placeholder="you@company.com"
                placeholderTextColor={colors.textMuted}
                autoCapitalize="none"
                keyboardType="email-address"
                value={value}
                onChangeText={onChange}
                style={textInputStyle}
              />
            )}
          />
          {errors.email ? <Text style={[styles.error, { color: colors.danger }]}>{errors.email.message}</Text> : null}
        </View>

        <View style={styles.field}>
          <Text style={[styles.label, { color: colors.text }]}>Password</Text>
          <Controller
            control={control}
            name="password"
            render={({ field: { onChange, value } }) => (
              <TextInput
                placeholder="Minimum 8 characters"
                placeholderTextColor={colors.textMuted}
                secureTextEntry
                value={value}
                onChangeText={onChange}
                style={textInputStyle}
              />
            )}
          />
          {errors.password ? <Text style={[styles.error, { color: colors.danger }]}>{errors.password.message}</Text> : null}
        </View>

        {error ? <Text style={[styles.error, { color: colors.danger }]}>{error}</Text> : null}

        <AppButton
          title={isSubmitting ? "Signing in..." : "Login"}
          onPress={() => void onSubmit()}
          busy={isSubmitting}
        />

        {authNotice ? (
          <AppButton
            title="Dismiss Message"
            kind="ghost"
            onPress={() => {
              void clearAuthNotice();
            }}
          />
        ) : null}
      </Card>

      <Text style={[styles.meta, { color: colors.textMuted }]}>API: {resolvedApiBaseUrl}</Text>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  container: {
    justifyContent: "center"
  },
  headerCard: {
    gap: spacing.sm
  },
  formCard: {
    gap: spacing.md
  },
  field: {
    gap: spacing.xs
  },
  label: {
    fontWeight: "700"
  },
  error: {
    fontSize: 12
  },
  notice: {
    fontSize: 13,
    fontWeight: "700"
  },
  meta: {
    marginTop: 4,
    fontSize: 12,
    textAlign: "center"
  }
});
