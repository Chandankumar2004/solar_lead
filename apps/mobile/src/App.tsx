import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, AppState, Pressable, Text, View } from "react-native";
import {
  NavigationContainer,
  DefaultTheme as NavigationDefaultTheme,
  NavigatorScreenParams,
  createNavigationContainerRef
} from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import NetInfo from "@react-native-community/netinfo";
import { LoginScreen } from "./screens/LoginScreen";
import { LeadListScreen } from "./screens/LeadListScreen";
import { LeadCreateScreen } from "./screens/LeadCreateScreen";
import { LeadDetailScreen } from "./screens/LeadDetailScreen";
import { CustomerDetailsScreen } from "./screens/CustomerDetailsScreen";
import { HomeScreen } from "./screens/HomeScreen";
import { NotificationsScreen } from "./screens/NotificationsScreen";
import { ProfileScreen } from "./screens/ProfileScreen";
import { BiometricUnlockScreen } from "./screens/BiometricUnlockScreen";
import { useAuthStore } from "./store/auth-store";
import { useQueueStore } from "./store/queue-store";
import { usePreferencesStore } from "./store/preferences-store";
import { useNotificationStore } from "./store/notification-store";
import { AppPalette, getPalette, radius } from "./ui/theme";
import {
  initializePushNotifications,
  unregisterCurrentPushToken,
  type PushNotificationPayload
} from "./services/push-notifications";

type AuthStackParamList = {
  Login: undefined;
};

type LeadsStackParamList = {
  LeadList: undefined;
  LeadCreate: undefined;
  LeadDetail: { leadId: string };
  CustomerDetails: { leadId: string; leadName?: string };
};

type RootTabParamList = {
  Home: undefined;
  Leads: NavigatorScreenParams<LeadsStackParamList>;
  Notifications: undefined;
  Profile: undefined;
};

const AuthStack = createNativeStackNavigator<AuthStackParamList>();
const LeadsStack = createNativeStackNavigator<LeadsStackParamList>();
const Tab = createBottomTabNavigator<RootTabParamList>();
const navigationRef = createNavigationContainerRef<RootTabParamList>();

function LeadsNavigator({ colors }: { colors: AppPalette }) {
  return (
    <LeadsStack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" }
      }}
    >
      <LeadsStack.Screen
        name="LeadList"
        component={LeadListScreen}
        options={({ navigation }) => ({
          title: "Leads",
          headerRight: () => (
            <Pressable onPress={() => navigation.navigate("LeadCreate")}>
              <Text style={{ color: colors.primary, fontWeight: "700" }}>New</Text>
            </Pressable>
          )
        })}
      />
      <LeadsStack.Screen name="LeadCreate" component={LeadCreateScreen} options={{ title: "Create Lead" }} />
      <LeadsStack.Screen name="LeadDetail" component={LeadDetailScreen} options={{ title: "Lead Detail" }} />
      <LeadsStack.Screen
        name="CustomerDetails"
        component={CustomerDetailsScreen}
        options={{ title: "Customer Details" }}
      />
    </LeadsStack.Navigator>
  );
}

function MainTabs({ colors }: { colors: AppPalette }) {
  const unreadCount = useNotificationStore((s) => s.unreadCount);
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.surface },
        headerTintColor: colors.text,
        headerTitleStyle: { fontWeight: "700" },
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarStyle: {
          borderTopColor: colors.border,
          backgroundColor: colors.surface,
          height: 62,
          paddingTop: 6,
          paddingBottom: 8
        },
        tabBarIcon: ({ focused, color, size }) => {
          const iconName =
            route.name === "Home"
              ? focused
                ? "home"
                : "home-outline"
              : route.name === "Leads"
                ? focused
                  ? "list"
                  : "list-outline"
                : route.name === "Notifications"
                  ? focused
                    ? "notifications"
                    : "notifications-outline"
                  : focused
                    ? "person"
                    : "person-outline";
          return <Ionicons name={iconName} size={size} color={color} />;
        }
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Leads" options={{ headerShown: false }}>
        {() => <LeadsNavigator colors={colors} />}
      </Tab.Screen>
      <Tab.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined
        }}
      />
      <Tab.Screen name="Profile" component={ProfileScreen} />
    </Tab.Navigator>
  );
}

function AuthNavigator() {
  return (
    <AuthStack.Navigator screenOptions={{ headerShown: false }}>
      <AuthStack.Screen name="Login" component={LoginScreen} />
    </AuthStack.Navigator>
  );
}

function BootScreen({ colors }: { colors: AppPalette }) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 12,
        backgroundColor: colors.background
      }}
    >
      <View
        style={{
          backgroundColor: colors.surface,
          borderRadius: radius.lg,
          borderWidth: 1,
          borderColor: colors.border,
          padding: 20,
          alignItems: "center",
          minWidth: 220
        }}
      >
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ marginTop: 10, color: colors.text }}>Loading session...</Text>
      </View>
    </View>
  );
}

export default function App() {
  const themeMode = usePreferencesStore((s) => s.themeMode);
  const prefsHydrated = usePreferencesStore((s) => s.hydrated);
  const hydratePreferences = usePreferencesStore((s) => s.hydrate);

  const user = useAuthStore((s) => s.user);
  const isBootstrapping = useAuthStore((s) => s.isBootstrapping);
  const biometricEnabled = useAuthStore((s) => s.biometricEnabled);
  const isBiometricUnlocked = useAuthStore((s) => s.isBiometricUnlocked);
  const bootstrap = useAuthStore((s) => s.bootstrap);
  const unlockWithBiometric = useAuthStore((s) => s.unlockWithBiometric);
  const lockBiometric = useAuthStore((s) => s.lockBiometric);
  const logout = useAuthStore((s) => s.logout);

  const hydrate = useQueueStore((s) => s.hydrate);
  const flush = useQueueStore((s) => s.flush);
  const queueItems = useQueueStore((s) => s.items);
  const [isOffline, setIsOffline] = useState(false);
  const [pushNotice, setPushNotice] = useState<string | null>(null);
  const pendingLeadIdFromPushRef = useRef<string | null>(null);
  const backgroundAtRef = useRef<number | null>(null);
  const hydrateNotifications = useNotificationStore((s) => s.hydrate);
  const addForegroundNotification = useNotificationStore((s) => s.addForegroundNotification);
  const addOpenedNotification = useNotificationStore((s) => s.addOpenedNotification);

  const colors = useMemo(() => getPalette(themeMode), [themeMode]);
  const navTheme = useMemo(
    () => ({
      ...NavigationDefaultTheme,
      colors: {
        ...NavigationDefaultTheme.colors,
        background: colors.background,
        card: colors.surface,
        text: colors.text,
        border: colors.border,
        primary: colors.primary
      }
    }),
    [colors]
  );
  const linking = useMemo(
    () => ({
      prefixes: ["solarleadmobile://"],
      config: {
        screens: {
          Home: "home",
          Leads: {
            screens: {
              LeadList: "leads",
              LeadCreate: "leads/new",
              LeadDetail: "leads/:leadId",
              CustomerDetails: "leads/:leadId/customer-details"
            }
          },
          Notifications: "notifications",
          Profile: "profile"
        }
      }
    }),
    []
  );

  const openLeadFromPush = useCallback((payload: PushNotificationPayload) => {
    if (!payload.leadId) {
      return;
    }

    if (navigationRef.isReady()) {
      navigationRef.navigate("Leads", {
        screen: "LeadDetail",
        params: { leadId: payload.leadId }
      });
      return;
    }

    pendingLeadIdFromPushRef.current = payload.leadId;
  }, []);

  useEffect(() => {
    void hydratePreferences();
    void hydrateNotifications();
    void bootstrap();
    void hydrate();

    void NetInfo.fetch().then((state) => {
      const connected = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setIsOffline(!connected);
      if (connected && user?.id) {
        void flush(user.id);
      }
    });

    const netUnsub = NetInfo.addEventListener((state) => {
      const connected = Boolean(state.isConnected) && state.isInternetReachable !== false;
      setIsOffline(!connected);

      if (connected && user?.id) {
        void flush(user.id);
      }
    });

    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background") {
        backgroundAtRef.current = Date.now();
        return;
      }

      if (nextState === "active") {
        const lastBackgroundAt = backgroundAtRef.current;
        backgroundAtRef.current = null;

        if (lastBackgroundAt) {
          const elapsed = Date.now() - lastBackgroundAt;
          const graceMs = 30000;
          if (elapsed >= graceMs) {
            lockBiometric();
          }
        }
      }
    });

    return () => {
      netUnsub();
      appStateSub.remove();
    };
  }, [bootstrap, flush, hydrate, hydrateNotifications, hydratePreferences, lockBiometric, user?.id]);

  useEffect(() => {
    let mounted = true;
    let teardown = () => {};

    const run = async () => {
      if (!user?.id) {
        await unregisterCurrentPushToken();
        if (mounted) {
          setPushNotice(null);
        }
        return;
      }

      const initialized = await initializePushNotifications({
        onForegroundMessage: (payload) => {
          void addForegroundNotification(payload);
        },
        onNotificationTap: (payload) => {
          void addOpenedNotification(payload);
          openLeadFromPush(payload);
        }
      });
      teardown = initialized.teardown;

      if (!mounted) {
        return;
      }

      if (!initialized.result.available) {
        setPushNotice("Push is unavailable in this runtime. Use a native dev build, not Expo Go.");
        return;
      }

      if (initialized.result.permission === "denied") {
        setPushNotice("Push permission denied. Enable notifications in device settings.");
        return;
      }

      if (!initialized.result.tokenRegistered) {
        setPushNotice("Push token not registered yet. Notifications may be delayed.");
        return;
      }

      setPushNotice(null);
    };

    void run();

    return () => {
      mounted = false;
      teardown();
    };
  }, [openLeadFromPush, user?.id]);

  const pendingQueueCount = useMemo(() => {
    if (!user?.id) return 0;
    return queueItems.filter((item) => item.ownerUserId === user.id || !item.ownerUserId).length;
  }, [queueItems, user?.id]);

  if (isBootstrapping || !prefsHydrated) {
    return <BootScreen colors={colors} />;
  }

  if (user && biometricEnabled && !isBiometricUnlocked) {
    return <BiometricUnlockScreen onUnlock={unlockWithBiometric} onLogout={logout} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {isOffline ? (
        <View
          style={{
            backgroundColor: colors.warning,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.border
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>
            Offline mode{pendingQueueCount > 0 ? ` | Pending sync: ${pendingQueueCount}` : ""}
          </Text>
        </View>
      ) : null}
      {pushNotice ? (
        <View
          style={{
            backgroundColor: colors.info,
            paddingVertical: 8,
            paddingHorizontal: 12,
            borderBottomWidth: 1,
            borderBottomColor: colors.border
          }}
        >
          <Text style={{ color: "#fff", fontWeight: "700" }}>{pushNotice}</Text>
        </View>
      ) : null}

      <NavigationContainer
        ref={navigationRef}
        theme={navTheme}
        linking={linking}
        onReady={() => {
          const pendingLeadId = pendingLeadIdFromPushRef.current;
          if (!pendingLeadId || !navigationRef.isReady()) {
            return;
          }
          pendingLeadIdFromPushRef.current = null;
          navigationRef.navigate("Leads", {
            screen: "LeadDetail",
            params: { leadId: pendingLeadId }
          });
        }}
      >
        {user ? <MainTabs colors={colors} /> : <AuthNavigator />}
      </NavigationContainer>
    </View>
  );
}
