import React, { useCallback, useEffect, useMemo, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { AppState, View, Text, TextInput, Pressable, Alert, StyleSheet } from "react-native";
import { useForm, Controller } from "react-hook-form";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import MapView, { Marker } from "react-native-maps";
import NetInfo from "@react-native-community/netinfo";
import axios, { AxiosError } from "axios";
import { api } from "../services/api";
import { useQueueStore } from "../store/queue-store";
import { useAuthStore } from "../store/auth-store";
import { uploadLeadDocument } from "../services/document-upload";
import { ensurePersistentLeadAttachmentFile } from "../services/upload-persistence";
import {
  AppButton,
  AppScreen,
  Card,
  SectionTitle,
  useAppPalette,
  useTextInputStyle
} from "../ui/primitives";
import { spacing } from "../ui/theme";

type FormValues = {
  districtId: string;
  source: string;
  fullName: string;
  phone: string;
  address: string;
};

type District = {
  id: string;
  name: string;
  state: string;
};

type DistrictResolution = {
  districtId: string | null;
  reason: "empty" | "ambiguous" | "not_found" | null;
};

type PublicDistrictsResponse = {
  success?: boolean;
  data?: {
    districts?: District[];
  };
};

type ApiLeadPayload = {
  districtId: string;
  source: string;
  customer: {
    fullName: string;
    phone: string;
    email?: string;
    address: string;
  };
  location?: {
    latitude: number;
    longitude: number;
  };
};

type Attachment = {
  uri: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
};

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;
const LEAD_CREATE_DRAFT_KEY_PREFIX = "lead_create_draft:v1";
const ALLOWED_UPLOAD_MIME_TYPES = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png"
]);

const defaultFormValues: FormValues = {
  districtId: "",
  source: "Mobile",
  fullName: "",
  phone: "",
  address: ""
};

type LeadCreateDraft = {
  values?: Partial<FormValues>;
  coord?: {
    latitude: number;
    longitude: number;
  };
  attachments?: Attachment[];
};

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value.trim()
  );
}

function normalizeDistrictSearch(value: string) {
  return value.trim().toLowerCase();
}

function districtLabel(district: District) {
  return `${district.name}, ${district.state}`;
}

function resolveDistrictId(inputValue: string, districts: District[]): DistrictResolution {
  const trimmed = inputValue.trim();
  if (!trimmed) return { districtId: null, reason: "empty" };
  if (isUuid(trimmed)) return { districtId: trimmed, reason: null };

  const normalizedInput = normalizeDistrictSearch(trimmed);
  const exactMatches = districts.filter((district) => {
    const name = normalizeDistrictSearch(district.name);
    const label = normalizeDistrictSearch(districtLabel(district));
    return name === normalizedInput || label === normalizedInput;
  });

  if (exactMatches.length === 1) {
    return { districtId: exactMatches[0].id, reason: null };
  }
  if (exactMatches.length > 1) {
    return { districtId: null, reason: "ambiguous" };
  }

  return { districtId: null, reason: "not_found" };
}

function getApiErrorMessage(error: AxiosError<unknown>) {
  const responseData = error.response?.data as
    | {
        message?: unknown;
        error?: { details?: { issues?: Array<{ message?: unknown }> } };
      }
    | undefined;

  if (typeof responseData?.message === "string" && responseData.message.trim()) {
    return responseData.message;
  }

  const issueMessage = responseData?.error?.details?.issues?.[0]?.message;
  if (typeof issueMessage === "string" && issueMessage.trim()) {
    return issueMessage;
  }

  return "Submission failed. Please check form values and try again.";
}

async function shouldQueueSubmission(error: unknown) {
  if (!axios.isAxiosError(error)) {
    return true;
  }

  if (!error.response) {
    const net = await NetInfo.fetch();
    const connected = Boolean(net.isConnected) && net.isInternetReachable !== false;
    if (!connected) {
      return true;
    }
    return false;
  }

  const status = error.response.status;
  return status === 429 || status === 408;
}

function shouldFallbackToPublicLead(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  const status = error.response?.status;
  if (!status) return false;
  return status === 403 || status === 404 || status >= 500;
}

function isInsufficientRoleError(error: unknown) {
  if (!axios.isAxiosError(error)) return false;
  if (error.response?.status !== 403) return false;

  const message = getApiErrorMessage(error).toLowerCase();
  return message.includes("insufficient role") || message.includes("forbidden");
}

function toPublicLeadPayload(payload: ApiLeadPayload) {
  return {
    name: payload.customer.fullName,
    phone: payload.customer.phone,
    email: payload.customer.email,
    districtId: payload.districtId,
    installationType: payload.source,
    message: payload.customer.address
  };
}

function inferMimeType(fileName: string, fallback?: string | null) {
  if (fallback && fallback !== "application/octet-stream") {
    const normalized = fallback.toLowerCase();
    if (normalized === "image/jpg") return "image/jpeg";
    return normalized;
  }
  const name = fileName.toLowerCase();
  if (name.endsWith(".pdf")) return "application/pdf";
  if (name.endsWith(".png")) return "image/png";
  return "image/jpeg";
}

function validateAttachment(file: Attachment) {
  if (!ALLOWED_UPLOAD_MIME_TYPES.has(file.mimeType)) {
    return "Only JPEG, PNG, and PDF files are allowed.";
  }
  if (file.sizeBytes > 0 && file.sizeBytes > MAX_UPLOAD_SIZE_BYTES) {
    return "Each file must be 10 MB or smaller.";
  }
  return null;
}

async function createLeadWithRoleFallback(payload: ApiLeadPayload) {
  try {
    const leadResp = await api.post("/api/leads", payload);
    return leadResp.data?.data?.id as string;
  } catch (error) {
    if (!isInsufficientRoleError(error) && !shouldFallbackToPublicLead(error)) {
      throw error;
    }

    const leadResp = await api.post("/public/leads", toPublicLeadPayload(payload));
    return leadResp.data?.data?.id as string;
  }
}

export function LeadCreateScreen() {
  const colors = useAppPalette();
  const textInputStyle = useTextInputStyle();
  const enqueue = useQueueStore((s) => s.enqueue);
  const user = useAuthStore((s) => s.user);
  const [coord, setCoord] = useState({ latitude: 12.9716, longitude: 77.5946 });
  const [districts, setDistricts] = useState<District[]>([]);
  const [districtsLoading, setDistrictsLoading] = useState(false);
  const [districtFetchError, setDistrictFetchError] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [isDraftHydrated, setIsDraftHydrated] = useState(false);
  const draftKey = useMemo(
    () => (user?.id ? `${LEAD_CREATE_DRAFT_KEY_PREFIX}:${user.id}` : null),
    [user?.id]
  );
  const { control, handleSubmit, reset, watch, setValue } = useForm<FormValues>({
    defaultValues: defaultFormValues
  });
  const watchedFormValues = watch();

  useEffect(() => {
    let active = true;
    const loadDistricts = async () => {
      setDistrictsLoading(true);
      setDistrictFetchError(null);
      try {
        const response = await api.get<PublicDistrictsResponse>("/public/districts");
        const list = response.data?.data?.districts;
        if (active && Array.isArray(list)) {
          setDistricts(
            list.filter((item): item is District => Boolean(item?.id && item?.name && item?.state))
          );
        }
      } catch {
        if (active) {
          setDistrictFetchError("Could not load district list. Use district UUID instead.");
        }
      } finally {
        if (active) {
          setDistrictsLoading(false);
        }
      }
    };

    void loadDistricts();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setIsDraftHydrated(false);

    const hydrateDraft = async () => {
      if (!draftKey) {
        if (active) {
          setIsDraftHydrated(true);
        }
        return;
      }

      try {
        const raw = await AsyncStorage.getItem(draftKey);
        if (!raw) {
          if (active) {
            reset(defaultFormValues);
            setAttachments([]);
          }
          return;
        }

        const parsed = JSON.parse(raw) as LeadCreateDraft;
        const safeValues =
          parsed?.values && typeof parsed.values === "object"
            ? {
                districtId: typeof parsed.values.districtId === "string" ? parsed.values.districtId : "",
                source: typeof parsed.values.source === "string" ? parsed.values.source : "Mobile",
                fullName: typeof parsed.values.fullName === "string" ? parsed.values.fullName : "",
                phone: typeof parsed.values.phone === "string" ? parsed.values.phone : "",
                address: typeof parsed.values.address === "string" ? parsed.values.address : ""
              }
            : defaultFormValues;
        const safeCoord = parsed?.coord;
        const restoredAttachments = Array.isArray(parsed?.attachments)
          ? parsed.attachments.filter(
              (file): file is Attachment =>
                Boolean(file?.uri) &&
                typeof file.fileName === "string" &&
                typeof file.mimeType === "string" &&
                typeof file.sizeBytes === "number"
            )
          : [];

        if (!active) return;

        reset(safeValues);
        if (
          safeCoord &&
          Number.isFinite(safeCoord.latitude) &&
          Number.isFinite(safeCoord.longitude)
        ) {
          setCoord({
            latitude: safeCoord.latitude,
            longitude: safeCoord.longitude
          });
        }
        setAttachments(restoredAttachments);
      } catch {
        if (active) {
          reset(defaultFormValues);
          setAttachments([]);
        }
      } finally {
        if (active) {
          setIsDraftHydrated(true);
        }
      }
    };

    void hydrateDraft();
    return () => {
      active = false;
    };
  }, [draftKey, reset]);

  const persistDraftNow = useCallback(async () => {
    if (!draftKey || !isDraftHydrated) return;
    await AsyncStorage.setItem(
      draftKey,
      JSON.stringify({
        values: watchedFormValues,
        coord,
        attachments,
        updatedAt: new Date().toISOString()
      })
    );
  }, [attachments, coord, draftKey, isDraftHydrated, watchedFormValues]);

  useEffect(() => {
    if (!draftKey || !isDraftHydrated) return;
    const timer = setTimeout(() => {
      void persistDraftNow();
    }, 200);
    return () => clearTimeout(timer);
  }, [draftKey, isDraftHydrated, persistDraftNow, watchedFormValues, coord, attachments]);

  useEffect(() => {
    const appStateSub = AppState.addEventListener("change", (nextState) => {
      if (nextState === "background" || nextState === "inactive") {
        void persistDraftNow();
      }
    });

    return () => {
      appStateSub.remove();
    };
  }, [persistDraftNow]);

  const pickFiles = async () => {
    const docs = await DocumentPicker.getDocumentAsync({
      multiple: true,
      copyToCacheDirectory: true,
      type: ["application/pdf", "image/jpeg", "image/png"]
    });
    const images = await ImagePicker.launchImageLibraryAsync({
      allowsMultipleSelection: true,
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.85
    });

    const next: Attachment[] = [];
    if (docs.assets?.length) {
      for (const d of docs.assets) {
        const fileName = d.name ?? `doc-${Date.now()}`;
        next.push({
          uri: d.uri,
          fileName,
          mimeType: inferMimeType(fileName, d.mimeType),
          sizeBytes: d.size ?? 0
        });
      }
    }
    if (images.assets?.length) {
      for (const img of images.assets) {
        const fileName = img.fileName ?? `image-${Date.now()}.jpg`;
        next.push({
          uri: img.uri,
          fileName,
          mimeType: inferMimeType(fileName, img.mimeType),
          sizeBytes: img.fileSize ?? 0
        });
      }
    }
    const valid: Attachment[] = [];
    const skipped: string[] = [];
    for (const file of next) {
      const reason = validateAttachment(file);
      if (reason) {
        skipped.push(`${file.fileName}: ${reason}`);
      } else {
        valid.push(file);
      }
    }
    if (skipped.length > 0) {
      Alert.alert(
        "Some files were skipped",
        skipped.slice(0, 3).join("\n") + (skipped.length > 3 ? `\n+${skipped.length - 3} more` : "")
      );
    }
    const persistentFiles: Attachment[] = [];
    for (const file of valid) {
      const persistentFile = await ensurePersistentLeadAttachmentFile(file);
      persistentFiles.push(persistentFile);
    }

    setAttachments(persistentFiles);
  };

  const onSubmit = handleSubmit(async (values) => {
    const districtResolution = resolveDistrictId(values.districtId, districts);
    if (!districtResolution.districtId) {
      if (districtResolution.reason === "empty") {
        Alert.alert("Invalid district", "Please enter district name/state or district UUID.");
      } else if (districtResolution.reason === "ambiguous") {
        Alert.alert("Ambiguous district", "Please enter district as 'Name, State' or use UUID.");
      } else {
        Alert.alert("District not found", "Use a valid district name from backend mapping or UUID.");
      }
      return;
    }

    const payload: ApiLeadPayload = {
      districtId: districtResolution.districtId,
      source: values.source,
      customer: {
        fullName: values.fullName,
        phone: values.phone,
        address: values.address
      },
      location: coord
    };

    const net = await NetInfo.fetch();
    if (!net.isConnected) {
      await enqueue(
        {
          id: `${Date.now()}-offline`,
          kind: "CREATE_LEAD_WITH_ATTACHMENTS",
          payload: {
            lead: payload,
            attachments
          }
        },
        {
          ownerUserId: user?.id
        }
      );
      Alert.alert("Saved offline", "Lead will sync when internet is back.");
      reset();
      setAttachments([]);
      if (draftKey) {
        await AsyncStorage.removeItem(draftKey);
      }
      return;
    }

    try {
      const leadId = await createLeadWithRoleFallback(payload);
      if (!leadId) {
        throw new Error("Lead id missing from create response");
      }

      let uploadedCount = 0;
      let queuedCount = 0;
      let failedCount = 0;

      for (const file of attachments) {
        try {
          await uploadLeadDocument({
            leadId,
            category: "lead_attachment",
            file: {
              uri: file.uri,
              fileName: file.fileName,
              fileType: file.mimeType,
              fileSize: file.sizeBytes
            },
            maxAttempts: 2
          });
          uploadedCount += 1;
        } catch (uploadError) {
          if (await shouldQueueSubmission(uploadError)) {
            await enqueue(
              {
                id: `${Date.now()}-upload-${Math.random().toString(16).slice(2)}`,
                kind: "UPLOAD_LEAD_DOCUMENT",
                payload: {
                  leadId,
                  category: "lead_attachment",
                  file: {
                    uri: file.uri,
                    fileName: file.fileName,
                    fileType: file.mimeType,
                    fileSize: file.sizeBytes
                  }
                }
              },
              {
                ownerUserId: user?.id,
                dedupeKey: `upload:${leadId}:lead_attachment:${file.fileName}:${file.sizeBytes}`
              }
            );
            queuedCount += 1;
          } else {
            failedCount += 1;
          }
        }
      }

      if (attachments.length === 0) {
        Alert.alert("Success", "Lead submitted.");
      } else if (failedCount === 0 && queuedCount === 0) {
        Alert.alert("Success", `Lead submitted with ${uploadedCount} attachment(s).`);
      } else if (failedCount === 0) {
        Alert.alert(
          "Lead created",
          `${uploadedCount} attachment(s) uploaded and ${queuedCount} queued for sync.`
        );
      } else {
        Alert.alert(
          "Lead created with warnings",
          `${uploadedCount} uploaded, ${queuedCount} queued, ${failedCount} failed.`
        );
      }
      reset();
      setAttachments([]);
      if (draftKey) {
        await AsyncStorage.removeItem(draftKey);
      }
    } catch (error) {
      if (await shouldQueueSubmission(error)) {
        await enqueue(
          {
            id: `${Date.now()}-retry`,
            kind: "CREATE_LEAD_WITH_ATTACHMENTS",
            payload: {
              lead: payload,
              attachments
            }
          },
          {
            ownerUserId: user?.id
          }
        );
        Alert.alert("Queued", "Submission queued due to server/network issue.");
        return;
      }

      if (axios.isAxiosError(error)) {
        const message = getApiErrorMessage(error);
        const statusSuffix = error.response?.status ? ` (HTTP ${error.response.status})` : "";
        Alert.alert("Submission failed", `${message}${statusSuffix}`);
        return;
      }

      Alert.alert("Submission failed", "Something went wrong while submitting lead.");
    }
  });

  const districtInput = watch("districtId");

  const districtSuggestions = useMemo(() => {
    if (!districts.length) return [];
    const normalized = normalizeDistrictSearch(districtInput ?? "");
    if (!normalized || normalized.length < 2 || isUuid(normalized)) return [];

    return districts
      .filter((district) => {
        const name = normalizeDistrictSearch(district.name);
        const label = normalizeDistrictSearch(districtLabel(district));
        return name.includes(normalized) || label.includes(normalized);
      })
      .slice(0, 6);
  }, [districts, districtInput]);

  return (
    <AppScreen scroll contentContainerStyle={{ paddingBottom: 32 }}>
      <Card>
        <SectionTitle
          title="Create Lead"
          subtitle="Capture customer details and assign by district"
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={[styles.label, { color: colors.text }]}>District</Text>
        <Controller
          control={control}
          name="districtId"
          render={({ field: { onChange, value } }) => (
            <TextInput
              placeholder="District (Name, State or UUID)"
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={onChange}
              style={textInputStyle}
            />
          )}
        />
        {districtsLoading ? <Text style={[styles.helper, { color: colors.textMuted }]}>Loading districts...</Text> : null}
        {districtFetchError ? <Text style={[styles.error, { color: colors.danger }]}>{districtFetchError}</Text> : null}
        {!districtsLoading && !districtFetchError && districts.length === 0 ? (
          <Text style={[styles.error, { color: colors.danger }]}>
            No active districts available. Ask admin to create/activate districts first.
          </Text>
        ) : null}
        {districtSuggestions.length > 0 ? (
          <View style={[styles.suggestionBox, { borderColor: colors.border, backgroundColor: colors.surface }]}>
            {districtSuggestions.map((district) => (
              <Pressable
                key={district.id}
                onPress={() => {
                  setValue("districtId", districtLabel(district), { shouldDirty: true });
                }}
                style={[styles.suggestionRow, { borderBottomColor: colors.border }]}
              >
                <Text style={[styles.suggestionText, { color: colors.text }]}>{districtLabel(district)}</Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={[styles.label, { color: colors.text }]}>Customer Name</Text>
        <Controller
          control={control}
          name="fullName"
          render={({ field: { onChange, value } }) => (
            <TextInput
              placeholder="Customer Name"
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={onChange}
              style={textInputStyle}
            />
          )}
        />

        <Text style={[styles.label, { color: colors.text }]}>Phone</Text>
        <Controller
          control={control}
          name="phone"
          render={({ field: { onChange, value } }) => (
            <TextInput
              placeholder="Phone"
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={onChange}
              keyboardType="phone-pad"
              style={textInputStyle}
            />
          )}
        />

        <Text style={[styles.label, { color: colors.text }]}>Address</Text>
        <Controller
          control={control}
          name="address"
          render={({ field: { onChange, value } }) => (
            <TextInput
              placeholder="Address"
              placeholderTextColor={colors.textMuted}
              value={value}
              onChangeText={onChange}
              multiline
              style={[textInputStyle, { minHeight: 72, textAlignVertical: "top" }]}
            />
          )}
        />
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <Text style={[styles.label, { color: colors.text }]}>Location Pin</Text>
        <MapView
          style={{ height: 190, borderRadius: 12 }}
          initialRegion={{
            latitude: coord.latitude,
            longitude: coord.longitude,
            latitudeDelta: 0.01,
            longitudeDelta: 0.01
          }}
          onPress={(e) => setCoord(e.nativeEvent.coordinate)}
        >
          <Marker coordinate={coord} />
        </MapView>
        <Text style={[styles.helper, { color: colors.textMuted }]}>
          Tap map to set site coordinates for installation visit.
        </Text>
      </Card>

      <Card style={{ gap: spacing.sm }}>
        <AppButton
          kind="ghost"
          title={`Select docs/photos (${attachments.length})`}
          onPress={() => void pickFiles()}
        />
        <AppButton title="Submit Lead" onPress={() => void onSubmit()} />
      </Card>
    </AppScreen>
  );
}

const styles = StyleSheet.create({
  label: {
    fontWeight: "700"
  },
  helper: {
    fontSize: 12
  },
  error: {
    fontSize: 12
  },
  suggestionBox: {
    borderWidth: 1,
    borderRadius: 12,
    overflow: "hidden"
  },
  suggestionRow: {
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderBottomWidth: 1
  },
  suggestionText: {}
});
