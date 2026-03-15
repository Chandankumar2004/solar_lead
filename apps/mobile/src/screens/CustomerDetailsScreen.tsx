import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  Text,
  TextInput,
  View
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import NetInfo from "@react-native-community/netinfo";
import { NativeStackScreenProps } from "@react-navigation/native-stack";
import { Controller, useForm, useWatch } from "react-hook-form";
import { api } from "../services/api";
import { uploadLeadDocument } from "../services/document-upload";
import { useQueueStore } from "../store/queue-store";
import { useAuthStore } from "../store/auth-store";
import { readOfflineCache, writeOfflineCache } from "../services/offline-cache";
import {
  AppButton,
  AppScreen,
  Card,
  SectionTitle,
  useAppPalette,
  useTextInputStyle
} from "../ui/primitives";

type LeadsStackParamList = {
  LeadList: undefined;
  LeadCreate: undefined;
  LeadDetail: { leadId: string };
  CustomerDetails: { leadId: string; leadName?: string };
};

type CustomerDetailsScreenProps = NativeStackScreenProps<
  LeadsStackParamList,
  "CustomerDetails"
>;

type ApiCustomerDetail = {
  fullName?: string | null;
  dateOfBirth?: string | null;
  gender?: string | null;
  fatherHusbandName?: string | null;
  aadhaarMasked?: string | null;
  panNumber?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  villageLocality?: string | null;
  pincode?: string | null;
  alternatePhone?: string | null;
  propertyOwnership?: string | null;
  roofArea?: number | null;
  recommendedCapacity?: number | null;
  shadowFreeArea?: number | null;
  roofType?: string | null;
  verifiedMonthlyBill?: number | null;
  connectionType?: string | null;
  consumerNumber?: string | null;
  discomName?: string | null;
  bankAccountMasked?: string | null;
  bankName?: string | null;
  ifscCode?: string | null;
  accountHolderName?: string | null;
  loanRequired?: boolean | null;
  loanAmountRequired?: number | null;
  preferredLender?: string | null;
};

type ApiCustomerDetailsResponse = {
  leadId: string;
  currentStatus?: {
    id: string;
    name: string;
    isTerminal: boolean;
  };
  isEditable: boolean;
  leadPrefill?: {
    districtId?: string | null;
    districtName?: string | null;
    state?: string | null;
    installationType?: string | null;
  };
  sitePhotographs?: {
    count: number;
    minRequired: number;
    maxAllowed: number;
  };
  customerDetail: ApiCustomerDetail | null;
};

type FormValues = {
  fullName: string;
  dateOfBirth: string;
  gender: string;
  fatherHusbandName: string;
  aadhaarNumber: string;
  panNumber: string;
  addressLine1: string;
  addressLine2: string;
  villageLocality: string;
  pincode: string;
  alternatePhone: string;
  installationType: string;
  propertyOwnership: string;
  roofArea: string;
  recommendedCapacity: string;
  shadowFreeArea: string;
  roofType: string;
  verifiedMonthlyBill: string;
  connectionType: string;
  consumerNumber: string;
  discomName: string;
  bankAccountNumber: string;
  bankName: string;
  ifscCode: string;
  accountHolderName: string;
  loanRequired: boolean;
  loanAmountRequired: string;
  preferredLender: string;
};

type IfscLookupResponse = {
  BANK?: string;
  BRANCH?: string;
  CITY?: string;
  STATE?: string;
};

const AADHAAR_REGEX = /^\d{12}$/;
const PAN_REGEX = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const IFSC_REGEX = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DRAFT_KEY_PREFIX = "customer_details_draft:";
const CUSTOMER_DETAILS_CACHE_PREFIX = "customer-details";
const ALLOWED_INSTALLATION_TYPES = ["Residential", "Industrial", "Agricultural", "Other"] as const;
const ALLOWED_GENDERS = ["Male", "Female", "Other"] as const;
const ALLOWED_PROPERTY_OWNERSHIP = ["Owned", "Rented", "Leased"] as const;
const ALLOWED_SHADOW_FREE = ["Yes", "Partial", "No"] as const;
const ALLOWED_ROOF_TYPE = ["RCC", "Tin", "Other"] as const;
const ALLOWED_CONNECTION_TYPE = ["Single Phase", "Three Phase"] as const;
const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

const defaultFormValues: FormValues = {
  fullName: "",
  dateOfBirth: "",
  gender: "",
  fatherHusbandName: "",
  aadhaarNumber: "",
  panNumber: "",
  addressLine1: "",
  addressLine2: "",
  villageLocality: "",
  pincode: "",
  alternatePhone: "",
  installationType: "",
  propertyOwnership: "",
  roofArea: "",
  recommendedCapacity: "",
  shadowFreeArea: "",
  roofType: "",
  verifiedMonthlyBill: "",
  connectionType: "",
  consumerNumber: "",
  discomName: "",
  bankAccountNumber: "",
  bankName: "",
  ifscCode: "",
  accountHolderName: "",
  loanRequired: false,
  loanAmountRequired: "",
  preferredLender: ""
};

function normalizeText(input: string) {
  const trimmed = input.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toPositiveNumber(input: string) {
  const normalized = normalizeText(input);
  if (!normalized) return undefined;
  const value = Number(normalized);
  if (Number.isNaN(value) || value <= 0) return undefined;
  return value;
}

function sanitizePan(input: string) {
  return input.toUpperCase().replace(/\s/g, "").slice(0, 10);
}

function sanitizeIfsc(input: string) {
  return input.toUpperCase().replace(/\s/g, "").slice(0, 11);
}

function sanitizeAadhaar(input: string) {
  return input.replace(/\D/g, "").slice(0, 12);
}

function normalizeCaseInsensitiveOption(
  input: string,
  allowed: readonly string[]
) {
  const normalized = normalizeText(input);
  if (!normalized) return "";
  const matched = allowed.find((item) => item.toLowerCase() === normalized.toLowerCase());
  return matched ?? normalized;
}

function shadowOptionFromStored(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "";
  const numeric = Number(value);
  if (!Number.isNaN(numeric)) {
    if (numeric <= 0) return "No";
    if (numeric < 1) return "Partial";
    return "Yes";
  }
  const normalized = String(value).trim().toLowerCase();
  if (normalized === "yes") return "Yes";
  if (normalized === "partial") return "Partial";
  if (normalized === "no") return "No";
  return "";
}

function shadowNumericFromOption(input: string) {
  const normalized = normalizeText(input)?.toLowerCase();
  if (!normalized) return undefined;
  if (normalized === "yes") return 1;
  if (normalized === "partial") return 0.5;
  if (normalized === "no") return 0;
  return undefined;
}

function maskLast4(value: string) {
  if (!value) return "";
  if (value.length <= 4) return value;
  return `${"*".repeat(value.length - 4)}${value.slice(-4)}`;
}

function toInputString(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  return String(value);
}

function extractErrorMessage(error: unknown, fallback: string) {
  const value = error as {
    response?: { data?: { message?: string } };
    message?: string;
  };
  return value?.response?.data?.message || value?.message || fallback;
}

function mapCustomerDetailToForm(detail: ApiCustomerDetail | null): FormValues {
  if (!detail) return { ...defaultFormValues };

  return {
    ...defaultFormValues,
    fullName: toInputString(detail.fullName),
    dateOfBirth: toInputString(detail.dateOfBirth),
    gender: normalizeCaseInsensitiveOption(toInputString(detail.gender), ALLOWED_GENDERS),
    fatherHusbandName: toInputString(detail.fatherHusbandName),
    panNumber: toInputString(detail.panNumber).toUpperCase(),
    addressLine1: toInputString(detail.addressLine1),
    addressLine2: toInputString(detail.addressLine2),
    villageLocality: toInputString(detail.villageLocality),
    pincode: toInputString(detail.pincode),
    alternatePhone: toInputString(detail.alternatePhone),
    installationType: "",
    propertyOwnership: normalizeCaseInsensitiveOption(
      toInputString(detail.propertyOwnership),
      ALLOWED_PROPERTY_OWNERSHIP
    ),
    roofArea: toInputString(detail.roofArea),
    recommendedCapacity: toInputString(detail.recommendedCapacity),
    shadowFreeArea: shadowOptionFromStored(detail.shadowFreeArea),
    roofType: normalizeCaseInsensitiveOption(toInputString(detail.roofType), ALLOWED_ROOF_TYPE),
    verifiedMonthlyBill: toInputString(detail.verifiedMonthlyBill),
    connectionType: normalizeCaseInsensitiveOption(
      toInputString(detail.connectionType),
      ALLOWED_CONNECTION_TYPE
    ),
    consumerNumber: toInputString(detail.consumerNumber),
    discomName: toInputString(detail.discomName),
    bankName: toInputString(detail.bankName),
    ifscCode: toInputString(detail.ifscCode).toUpperCase(),
    accountHolderName: toInputString(detail.accountHolderName),
    loanRequired: Boolean(detail.loanRequired),
    loanAmountRequired: toInputString(detail.loanAmountRequired),
    preferredLender: toInputString(detail.preferredLender),
    aadhaarNumber: "",
    bankAccountNumber: ""
  };
}

function buildCustomerDetailsPayload(
  values: FormValues,
  leadPrefill?: ApiCustomerDetailsResponse["leadPrefill"]
) {
  const payload: Record<string, unknown> = {
    loanRequired: values.loanRequired
  };

  const fullName = normalizeText(values.fullName);
  if (fullName) payload.fullName = fullName;

  const dateOfBirth = normalizeText(values.dateOfBirth);
  if (dateOfBirth) payload.dateOfBirth = dateOfBirth;

  const gender = normalizeText(values.gender);
  if (gender) payload.gender = gender;

  const fatherHusbandName = normalizeText(values.fatherHusbandName);
  if (fatherHusbandName) payload.fatherHusbandName = fatherHusbandName;

  const aadhaarNumber = sanitizeAadhaar(values.aadhaarNumber);
  if (aadhaarNumber) payload.aadhaarNumber = aadhaarNumber;

  const panNumber = sanitizePan(values.panNumber);
  if (panNumber) payload.panNumber = panNumber;

  const addressLine1 = normalizeText(values.addressLine1);
  if (addressLine1) payload.addressLine1 = addressLine1;

  const addressLine2 = normalizeText(values.addressLine2);
  if (addressLine2) payload.addressLine2 = addressLine2;

  const villageLocality = normalizeText(values.villageLocality);
  if (villageLocality) payload.villageLocality = villageLocality;

  const pincode = normalizeText(values.pincode);
  if (pincode) payload.pincode = pincode;

  const alternatePhone = normalizeText(values.alternatePhone);
  if (alternatePhone) payload.alternatePhone = alternatePhone;

  const installationType = normalizeText(values.installationType);
  if (installationType) payload.installationType = installationType;
  if (leadPrefill?.districtId) payload.districtId = leadPrefill.districtId;

  const propertyOwnership = normalizeText(values.propertyOwnership);
  if (propertyOwnership) payload.propertyOwnership = propertyOwnership;

  const roofArea = toPositiveNumber(values.roofArea);
  if (roofArea !== undefined) payload.roofArea = roofArea;

  const recommendedCapacity = toPositiveNumber(values.recommendedCapacity);
  if (recommendedCapacity !== undefined) payload.recommendedCapacity = recommendedCapacity;

  const shadowFreeArea =
    shadowNumericFromOption(values.shadowFreeArea) ?? toPositiveNumber(values.shadowFreeArea);
  if (shadowFreeArea !== undefined) payload.shadowFreeArea = shadowFreeArea;

  const roofType = normalizeText(values.roofType);
  if (roofType) payload.roofType = roofType;

  const verifiedMonthlyBill = toPositiveNumber(values.verifiedMonthlyBill);
  if (verifiedMonthlyBill !== undefined) payload.verifiedMonthlyBill = verifiedMonthlyBill;

  const connectionType = normalizeText(values.connectionType);
  if (connectionType) payload.connectionType = connectionType;

  const consumerNumber = normalizeText(values.consumerNumber);
  if (consumerNumber) payload.consumerNumber = consumerNumber;

  const discomName = normalizeText(values.discomName);
  if (discomName) payload.discomName = discomName;

  const bankAccountNumber = normalizeText(values.bankAccountNumber)?.replace(/\s/g, "");
  if (bankAccountNumber) payload.bankAccountNumber = bankAccountNumber;

  const bankName = normalizeText(values.bankName);
  if (bankName) payload.bankName = bankName;

  const ifscCode = sanitizeIfsc(values.ifscCode);
  if (ifscCode) payload.ifscCode = ifscCode;

  const accountHolderName = normalizeText(values.accountHolderName);
  if (accountHolderName) payload.accountHolderName = accountHolderName;

  const loanAmountRequired = toPositiveNumber(values.loanAmountRequired);
  if (loanAmountRequired !== undefined) payload.loanAmountRequired = loanAmountRequired;

  const preferredLender = normalizeText(values.preferredLender);
  if (preferredLender) payload.preferredLender = preferredLender;

  return payload;
}

function LabeledInput(props: {
  label: string;
  children: React.ReactNode;
  labelColor?: string;
  helperColor?: string;
  errorColor?: string;
  error?: string;
  helper?: string;
}) {
  const labelColor = props.labelColor ?? "#111827";
  const helperColor = props.helperColor ?? "#6b7280";
  const errorColor = props.errorColor ?? "#b91c1c";
  return (
    <View style={{ gap: 4 }}>
      <Text style={{ fontWeight: "700", color: labelColor }}>{props.label}</Text>
      {props.children}
      {props.helper ? (
        <Text style={{ color: helperColor, fontSize: 12 }}>{props.helper}</Text>
      ) : null}
      {props.error ? (
        <Text style={{ color: errorColor, fontSize: 12 }}>{props.error}</Text>
      ) : null}
    </View>
  );
}

function OptionSelect(props: {
  label: string;
  value: string;
  options: readonly string[];
  editable: boolean;
  onChange: (value: string) => void;
  helper?: string;
  colors: ReturnType<typeof useAppPalette>;
}) {
  return (
    <LabeledInput
      label={props.label}
      helper={props.helper}
      labelColor={props.colors.text}
      helperColor={props.colors.textMuted}
      errorColor={props.colors.danger}
    >
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {props.options.map((option) => {
          const selected = props.value === option;
          return (
            <Pressable
              key={option}
              onPress={() => props.onChange(option)}
              disabled={!props.editable}
              style={{
                borderWidth: 1,
                borderColor: selected ? props.colors.primary : props.colors.border,
                backgroundColor: selected ? props.colors.accent : props.colors.surface,
                borderRadius: 999,
                paddingVertical: 8,
                paddingHorizontal: 12,
                opacity: props.editable ? 1 : 0.7
              }}
            >
              <Text
                style={{
                  color: selected ? props.colors.primary : props.colors.text,
                  fontWeight: selected ? "700" : "500"
                }}
              >
                {option}
              </Text>
            </Pressable>
          );
        })}
      </View>
    </LabeledInput>
  );
}

export function CustomerDetailsScreen({ route }: CustomerDetailsScreenProps) {
  const colors = useAppPalette();
  const textInputStyle = useTextInputStyle();
  const { leadId, leadName } = route.params;
  const user = useAuthStore((s) => s.user);
  const enqueue = useQueueStore((s) => s.enqueue);
  const queueItems = useQueueStore((s) => s.items);
  const draftKey = useMemo(() => `${DRAFT_KEY_PREFIX}${leadId}`, [leadId]);
  const cacheKey = useMemo(() => `${CUSTOMER_DETAILS_CACHE_PREFIX}:${leadId}`, [leadId]);

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [ifscLookupLoading, setIfscLookupLoading] = useState(false);
  const [ifscLookupMeta, setIfscLookupMeta] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [currentStatusName, setCurrentStatusName] = useState<string>("-");
  const [isTerminal, setIsTerminal] = useState(false);
  const [isEditable, setIsEditable] = useState(true);
  const [aadhaarFocused, setAadhaarFocused] = useState(false);
  const [existingAadhaarMasked, setExistingAadhaarMasked] = useState<string | null>(null);
  const [existingBankMasked, setExistingBankMasked] = useState<string | null>(null);
  const [leadPrefill, setLeadPrefill] = useState<ApiCustomerDetailsResponse["leadPrefill"] | null>(
    null
  );
  const [sitePhotoCount, setSitePhotoCount] = useState(0);
  const [sitePhotoMin, setSitePhotoMin] = useState(3);
  const [sitePhotoMax, setSitePhotoMax] = useState(10);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [isHydrated, setIsHydrated] = useState(false);
  const [offlineNotice, setOfflineNotice] = useState<string | null>(null);

  const {
    control,
    reset,
    setValue,
    getValues,
    handleSubmit,
    formState: { errors }
  } = useForm<FormValues>({
    defaultValues: defaultFormValues
  });

  const watchedValues = useWatch({ control });

  const inputStyle = useMemo(
    () => [textInputStyle, !isEditable ? { opacity: 0.65 } : null],
    [isEditable, textInputStyle]
  );
  const loanRequiredSelected = Boolean(watchedValues?.loanRequired);
  const queuedSitePhotoCount = useMemo(
    () =>
      queueItems.filter(
        (item) =>
          item.kind === "UPLOAD_LEAD_DOCUMENT" &&
          item.payload.leadId === leadId &&
          item.payload.category.startsWith("site_photo") &&
          (!item.ownerUserId || item.ownerUserId === user?.id)
      ).length,
    [leadId, queueItems, user?.id]
  );

  const applyPayloadMeta = useCallback((payload: ApiCustomerDetailsResponse) => {
    setCurrentStatusName(payload.currentStatus?.name ?? "-");
    setIsTerminal(Boolean(payload.currentStatus?.isTerminal));
    setIsEditable(Boolean(payload.isEditable));
    setLeadPrefill(payload.leadPrefill ?? null);
    setSitePhotoCount(payload.sitePhotographs?.count ?? 0);
    setSitePhotoMin(payload.sitePhotographs?.minRequired ?? 3);
    setSitePhotoMax(payload.sitePhotographs?.maxAllowed ?? 10);
    setExistingAadhaarMasked(payload.customerDetail?.aadhaarMasked ?? null);
    setExistingBankMasked(payload.customerDetail?.bankAccountMasked ?? null);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setOfflineNotice(null);
    setIsHydrated(false);

    try {
      const [response, draftRaw] = await Promise.all([
        api.get(`/api/leads/${leadId}/customer-details`),
        AsyncStorage.getItem(draftKey)
      ]);

      const payload = response.data?.data as ApiCustomerDetailsResponse;
      const remoteValues = mapCustomerDetailToForm(payload.customerDetail);
      remoteValues.installationType = normalizeCaseInsensitiveOption(
        toInputString(payload.leadPrefill?.installationType),
        ALLOWED_INSTALLATION_TYPES
      );
      applyPayloadMeta(payload);

      let mergedValues = remoteValues;
      if (draftRaw) {
        try {
          const parsed = JSON.parse(draftRaw) as
            | { values?: Partial<FormValues> }
            | Partial<FormValues>;
          const draftValues = parsed && "values" in parsed ? parsed.values : parsed;
          if (draftValues && typeof draftValues === "object") {
            mergedValues = { ...remoteValues, ...draftValues };
          }
        } catch {
          // Ignore corrupted local draft and continue with server values.
        }
      }

      reset(mergedValues);
      setIsHydrated(true);
      if (user?.id) {
        await writeOfflineCache(user.id, cacheKey, payload);
      }
    } catch (err) {
      if (user?.id) {
        const [cachedPayload, draftRaw] = await Promise.all([
          readOfflineCache<ApiCustomerDetailsResponse>(user.id, cacheKey),
          AsyncStorage.getItem(draftKey)
        ]);

        if (cachedPayload) {
          const remoteValues = mapCustomerDetailToForm(cachedPayload.customerDetail);
          remoteValues.installationType = normalizeCaseInsensitiveOption(
            toInputString(cachedPayload.leadPrefill?.installationType),
            ALLOWED_INSTALLATION_TYPES
          );
          applyPayloadMeta(cachedPayload);

          let mergedValues = remoteValues;
          if (draftRaw) {
            try {
              const parsed = JSON.parse(draftRaw) as
                | { values?: Partial<FormValues> }
                | Partial<FormValues>;
              const draftValues = parsed && "values" in parsed ? parsed.values : parsed;
              if (draftValues && typeof draftValues === "object") {
                mergedValues = { ...remoteValues, ...draftValues };
              }
            } catch {
              // ignore corrupt draft
            }
          }

          reset(mergedValues);
          setOfflineNotice("Offline mode: showing cached customer details.");
          setIsHydrated(true);
          setLoading(false);
          return;
        }
      }
      setError(extractErrorMessage(err, "Failed to load customer details."));
    } finally {
      setLoading(false);
    }
  }, [applyPayloadMeta, cacheKey, draftKey, leadId, reset, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isHydrated) return;
    const timer = setTimeout(() => {
      void AsyncStorage.setItem(
        draftKey,
        JSON.stringify({
          values: watchedValues,
          updatedAt: new Date().toISOString()
        })
      );
    }, 200);
    return () => clearTimeout(timer);
  }, [draftKey, isHydrated, watchedValues]);

  const lookupIfsc = async () => {
    const ifsc = sanitizeIfsc(getValues("ifscCode"));
    setValue("ifscCode", ifsc, { shouldDirty: true });

    if (!IFSC_REGEX.test(ifsc)) {
      Alert.alert("Invalid IFSC", "Enter a valid IFSC code before lookup.");
      return;
    }

    setIfscLookupLoading(true);
    try {
      const response = await fetch(`https://ifsc.razorpay.com/${ifsc}`);
      if (!response.ok) {
        throw new Error("No bank found for this IFSC code.");
      }
      const data = (await response.json()) as IfscLookupResponse;

      if (typeof data.BANK === "string" && data.BANK.trim()) {
        setValue("bankName", data.BANK.trim(), { shouldDirty: true });
      }

      const meta = [data.BRANCH, data.CITY, data.STATE]
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(", ");
      setIfscLookupMeta(meta || null);
    } catch (err) {
      Alert.alert("IFSC lookup failed", extractErrorMessage(err, "Unable to fetch IFSC details."));
    } finally {
      setIfscLookupLoading(false);
    }
  };

  const canAddMoreSitePhotos = useCallback(() => {
    if (!isEditable) {
      Alert.alert("Editing disabled", "Site photos cannot be uploaded for this lead right now.");
      return false;
    }
    if (sitePhotoCount >= sitePhotoMax) {
      Alert.alert(
        "Limit reached",
        `A maximum of ${sitePhotoMax} site photographs can be uploaded for this lead.`
      );
      return false;
    }
    return true;
  }, [isEditable, sitePhotoCount, sitePhotoMax]);

  const normalizeSitePhotoMimeType = useCallback((fileName?: string, mimeType?: string | null) => {
    const normalizedMime = mimeType?.toLowerCase().trim();
    if (normalizedMime === "image/jpg") return "image/jpeg";
    if (normalizedMime === "image/jpeg" || normalizedMime === "image/png") {
      return normalizedMime;
    }
    const lower = (fileName ?? "").toLowerCase();
    if (lower.endsWith(".png")) return "image/png";
    return "image/jpeg";
  }, []);

  const uploadSitePhoto = useCallback(
    async (file: { uri: string; name?: string; mimeType?: string; size?: number | null }) => {
      if (!canAddMoreSitePhotos()) return;

      const resolvedType = normalizeSitePhotoMimeType(file.name, file.mimeType);
      if (!["image/jpeg", "image/png"].includes(resolvedType)) {
        Alert.alert("Unsupported file type", "Only JPEG and PNG images are allowed.");
        return;
      }
      if (typeof file.size === "number" && file.size > MAX_UPLOAD_SIZE_BYTES) {
        Alert.alert("File too large", "Each file must be 10 MB or smaller.");
        return;
      }

      setPhotoUploading(true);
      try {
        const nextIndex = Math.min(sitePhotoCount + 1, sitePhotoMax);
        const fallbackName = `site-photo-${Date.now()}.jpg`;
        const category = `site_photo_${nextIndex}`;
        const queueFile = {
          uri: file.uri,
          fileName: file.name || fallbackName,
          fileType: resolvedType,
          fileSize: typeof file.size === "number" && file.size > 0 ? file.size : 0
        };
        const netState = await NetInfo.fetch();
        const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;

        if (!connected) {
          await enqueue(
            {
              id: `${Date.now()}-site-photo-${leadId}`,
              kind: "UPLOAD_LEAD_DOCUMENT",
              payload: {
                leadId,
                category,
                file: queueFile
              }
            },
            {
              ownerUserId: user?.id,
              dedupeKey: `upload:${leadId}:${category}:${queueFile.fileName}:${queueFile.fileSize}`
            }
          );
          setSitePhotoCount((value) => Math.min(value + 1, sitePhotoMax));
          Alert.alert("Saved offline", "Site photo queued for upload when internet reconnects.");
          return;
        }

        await uploadLeadDocument({
          leadId,
          category,
          file: queueFile
        });
        setSitePhotoCount((value) => Math.min(value + 1, sitePhotoMax));
        Alert.alert("Upload complete", "Site photograph uploaded successfully.");
      } catch (err) {
        const netState = await NetInfo.fetch();
        const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;
        const hasHttpResponse = Boolean((err as { response?: unknown })?.response);
        if (!connected || !hasHttpResponse) {
          const nextIndex = Math.min(sitePhotoCount + 1, sitePhotoMax);
          const fallbackName = `site-photo-${Date.now()}.jpg`;
          const category = `site_photo_${nextIndex}`;
          const queueFile = {
            uri: file.uri,
            fileName: file.name || fallbackName,
            fileType: resolvedType,
            fileSize: typeof file.size === "number" && file.size > 0 ? file.size : 0
          };
          await enqueue(
            {
              id: `${Date.now()}-site-photo-${leadId}`,
              kind: "UPLOAD_LEAD_DOCUMENT",
              payload: {
                leadId,
                category,
                file: queueFile
              }
            },
            {
              ownerUserId: user?.id,
              dedupeKey: `upload:${leadId}:${category}:${queueFile.fileName}:${queueFile.fileSize}`
            }
          );
          setSitePhotoCount((value) => Math.min(value + 1, sitePhotoMax));
          Alert.alert("Saved offline", "Site photo queued for upload when internet reconnects.");
          return;
        }

        Alert.alert("Upload failed", extractErrorMessage(err, "Unable to upload site photograph."));
      } finally {
        setPhotoUploading(false);
      }
    },
    [canAddMoreSitePhotos, enqueue, leadId, normalizeSitePhotoMimeType, sitePhotoCount, sitePhotoMax, user?.id]
  );

  const pickFromCamera = useCallback(async () => {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Camera permission is required to capture photos.");
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await uploadSitePhoto({
      uri: asset.uri,
      name: asset.fileName ?? undefined,
      mimeType: asset.mimeType ?? undefined,
      size: asset.fileSize
    });
  }, [uploadSitePhoto]);

  const pickFromGallery = useCallback(async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert("Permission required", "Media library permission is required to select photos.");
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.9
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await uploadSitePhoto({
      uri: asset.uri,
      name: asset.fileName ?? undefined,
      mimeType: asset.mimeType ?? undefined,
      size: asset.fileSize
    });
  }, [uploadSitePhoto]);

  const pickFromFiles = useCallback(async () => {
    const result = await DocumentPicker.getDocumentAsync({
      type: ["image/jpeg", "image/png"],
      multiple: false,
      copyToCacheDirectory: true
    });
    if (result.canceled || result.assets.length === 0) return;
    const asset = result.assets[0];
    await uploadSitePhoto({
      uri: asset.uri,
      name: asset.name,
      mimeType: asset.mimeType,
      size: asset.size
    });
  }, [uploadSitePhoto]);

  const onSubmit = handleSubmit(async (values) => {
    if (!isEditable) {
      Alert.alert(
        "Editing disabled",
        "This lead is in terminal status. Only allowed roles can edit customer details."
      );
      return;
    }

    const aadhaar = sanitizeAadhaar(values.aadhaarNumber);
    if (aadhaar && !AADHAAR_REGEX.test(aadhaar)) {
      Alert.alert("Invalid Aadhaar", "Aadhaar must be exactly 12 digits.");
      return;
    }

    const pan = sanitizePan(values.panNumber);
    if (pan && !PAN_REGEX.test(pan)) {
      Alert.alert("Invalid PAN", "PAN must follow format like ABCDE1234F.");
      return;
    }

    const ifsc = sanitizeIfsc(values.ifscCode);
    if (ifsc && !IFSC_REGEX.test(ifsc)) {
      Alert.alert("Invalid IFSC", "IFSC must follow standard 11-character format.");
      return;
    }

    const dateOfBirth = normalizeText(values.dateOfBirth);
    if (dateOfBirth && !DATE_REGEX.test(dateOfBirth)) {
      Alert.alert("Invalid Date", "Date of birth must be in YYYY-MM-DD format.");
      return;
    }

    const installationType = normalizeText(values.installationType);
    if (
      installationType &&
      !ALLOWED_INSTALLATION_TYPES.some(
        (value) => value.toLowerCase() === installationType.toLowerCase()
      )
    ) {
      Alert.alert(
        "Invalid Installation Type",
        "Installation Type must be Residential, Industrial, Agricultural, or Other."
      );
      return;
    }

    const gender = normalizeText(values.gender);
    if (
      gender &&
      !ALLOWED_GENDERS.some((value) => value.toLowerCase() === gender.toLowerCase())
    ) {
      Alert.alert("Invalid Gender", "Gender must be Male, Female, or Other.");
      return;
    }

    const propertyOwnership = normalizeText(values.propertyOwnership);
    if (
      propertyOwnership &&
      !ALLOWED_PROPERTY_OWNERSHIP.some(
        (value) => value.toLowerCase() === propertyOwnership.toLowerCase()
      )
    ) {
      Alert.alert("Invalid Property Ownership", "Property ownership must be Owned, Rented, or Leased.");
      return;
    }

    const roofType = normalizeText(values.roofType);
    if (
      roofType &&
      !ALLOWED_ROOF_TYPE.some((value) => value.toLowerCase() === roofType.toLowerCase())
    ) {
      Alert.alert("Invalid Roof Type", "Roof type must be RCC, Tin, or Other.");
      return;
    }

    const connectionType = normalizeText(values.connectionType);
    if (
      connectionType &&
      !ALLOWED_CONNECTION_TYPE.some(
        (value) => value.toLowerCase() === connectionType.toLowerCase()
      )
    ) {
      Alert.alert(
        "Invalid Connection Type",
        "Connection type must be Single Phase or Three Phase."
      );
      return;
    }

    const shadowFree = normalizeText(values.shadowFreeArea);
    if (
      shadowFree &&
      !ALLOWED_SHADOW_FREE.some((value) => value.toLowerCase() === shadowFree.toLowerCase())
    ) {
      Alert.alert(
        "Invalid Shadow-Free Area",
        "Shadow-Free Area must be Yes, Partial, or No."
      );
      return;
    }

    const missingRequired: string[] = [];
    if (!normalizeText(values.fullName)) missingRequired.push("Full Name");
    if (!normalizeText(values.dateOfBirth)) missingRequired.push("Date of Birth");
    if (!normalizeText(values.gender)) missingRequired.push("Gender");
    if (!normalizeText(values.fatherHusbandName)) missingRequired.push("Father / Husband Name");
    if (!aadhaar && !existingAadhaarMasked) missingRequired.push("Aadhaar Number");
    if (!pan) missingRequired.push("PAN Number");
    if (!normalizeText(values.addressLine1)) missingRequired.push("Complete Address");
    if (!normalizeText(values.villageLocality)) missingRequired.push("Village / Locality");
    if (!normalizeText(values.pincode)) missingRequired.push("Pin Code");
    if (!leadPrefill?.districtName) missingRequired.push("District");
    if (!leadPrefill?.state) missingRequired.push("State");
    if (!normalizeText(values.installationType)) missingRequired.push("Installation Type");
    if (!normalizeText(values.propertyOwnership)) missingRequired.push("Property Ownership");
    if (!toPositiveNumber(values.roofArea)) missingRequired.push("Total Roof / Land Area");
    if (!toPositiveNumber(values.recommendedCapacity))
      missingRequired.push("Recommended Solar Capacity");
    if (!normalizeText(values.shadowFreeArea)) missingRequired.push("Shadow-Free Area");
    if (!normalizeText(values.roofType)) missingRequired.push("Type of Roof");
    if (!toPositiveNumber(values.verifiedMonthlyBill))
      missingRequired.push("Current Monthly Electricity Bill");
    if (!normalizeText(values.connectionType))
      missingRequired.push("Current Electricity Connection Type");
    if (!normalizeText(values.consumerNumber)) missingRequired.push("Electricity Consumer Number");
    if (!normalizeText(values.discomName)) missingRequired.push("DISCOM / Electricity Board Name");
    if (!normalizeText(values.bankAccountNumber) && !existingBankMasked)
      missingRequired.push("Bank Account Number");
    if (!normalizeText(values.bankName)) missingRequired.push("Bank Name");
    if (!ifsc) missingRequired.push("IFSC Code");
    if (!normalizeText(values.accountHolderName)) missingRequired.push("Account Holder Name");

    if (missingRequired.length > 0) {
      Alert.alert("Required fields missing", missingRequired.join(", "));
      return;
    }

    if (values.loanRequired && !toPositiveNumber(values.loanAmountRequired)) {
      Alert.alert(
        "Loan Amount Required",
        "Loan amount is required when Loan Required is set to Yes."
      );
      return;
    }

    if (sitePhotoCount < sitePhotoMin) {
      Alert.alert(
        "Site photographs required",
        `Upload at least ${sitePhotoMin} site photographs before submitting this form.`
      );
      return;
    }

    const payload = buildCustomerDetailsPayload(values, leadPrefill ?? undefined);

    setSubmitting(true);
    try {
      const netState = await NetInfo.fetch();
      const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;
      if (!connected) {
        await enqueue(
          {
            id: `${Date.now()}-customer-details-${leadId}`,
            kind: "UPSERT_CUSTOMER_DETAILS",
            payload: {
              leadId,
              data: payload
            }
          },
          {
            ownerUserId: user?.id,
            dedupeKey: `customer-details:${leadId}`
          }
        );
        Alert.alert(
          "Saved offline",
          "Customer details were queued and will sync when internet reconnects."
        );
        return;
      }

      const response = await api.put(`/api/leads/${leadId}/customer-details`, payload);
      const saved = response.data?.data as ApiCustomerDetailsResponse;
      applyPayloadMeta(saved);
      if (user?.id) {
        await writeOfflineCache(user.id, cacheKey, saved);
      }

      const savedValues = mapCustomerDetailToForm(saved.customerDetail);
      savedValues.installationType = normalizeCaseInsensitiveOption(
        toInputString(saved.leadPrefill?.installationType),
        ALLOWED_INSTALLATION_TYPES
      );
      reset(savedValues);
      await AsyncStorage.removeItem(draftKey);
      setIsHydrated(true);
      Alert.alert("Saved", "Customer details submitted successfully.");
    } catch (err) {
      const netState = await NetInfo.fetch();
      const connected = Boolean(netState.isConnected) && netState.isInternetReachable !== false;
      const hasHttpResponse = Boolean((err as { response?: unknown })?.response);
      if (!connected || !hasHttpResponse) {
        await enqueue(
          {
            id: `${Date.now()}-customer-details-${leadId}`,
            kind: "UPSERT_CUSTOMER_DETAILS",
            payload: {
              leadId,
              data: payload
            }
          },
          {
            ownerUserId: user?.id,
            dedupeKey: `customer-details:${leadId}`
          }
        );
        Alert.alert(
          "Saved offline",
          "Customer details were queued and will sync when internet reconnects."
        );
        return;
      }

      Alert.alert("Submit failed", extractErrorMessage(err, "Unable to submit customer details."));
    } finally {
      setSubmitting(false);
    }
  });

  if (loading) {
    return (
      <AppScreen contentContainerStyle={{ alignItems: "center", justifyContent: "center", gap: 12 }}>
        <ActivityIndicator size="large" color={colors.primary} />
        <Text style={{ color: colors.text }}>Loading customer details...</Text>
      </AppScreen>
    );
  }

  if (error) {
    return (
      <AppScreen contentContainerStyle={{ gap: 12 }}>
        <Text style={{ color: colors.danger }}>{error}</Text>
        <AppButton title="Retry" onPress={() => void load()} />
      </AppScreen>
    );
  }

  return (
    <AppScreen scroll contentContainerStyle={{ gap: 10, paddingBottom: 20 }}>
      <Card style={{ gap: 4 }}>
        <SectionTitle title={leadName || "Lead Customer Details"} subtitle={`Status: ${currentStatusName}`} />
        {offlineNotice ? (
          <Text style={{ color: colors.warning, fontWeight: "700" }}>{offlineNotice}</Text>
        ) : null}
        {isTerminal ? (
          <Text style={{ color: colors.warning, fontWeight: "700" }}>Lead is in terminal status.</Text>
        ) : null}
        {!isEditable ? (
          <Text style={{ color: colors.danger }}>
            Editing is locked for this lead in terminal status unless role-based override is allowed.
          </Text>
        ) : null}
        <Text style={{ color: colors.textMuted }}>
          District: {leadPrefill?.districtName || "Not set"} | State: {leadPrefill?.state || "Not set"}
        </Text>
        <Text style={{ color: colors.textMuted }}>
          Installation Type: {normalizeText(getValues("installationType")) || "Not set"}
        </Text>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Personal & Address</Text>

        <LabeledInput label="Full Name" error={errors.fullName?.message} labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="fullName"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Full name"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Date of Birth (YYYY-MM-DD)" error={errors.dateOfBirth?.message} labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="dateOfBirth"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="1999-12-31"
                autoCapitalize="none"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <Controller
          control={control}
          name="gender"
          render={({ field: { value, onChange } }) => (
            <OptionSelect
              label="Gender"
              value={value}
              options={ALLOWED_GENDERS}
              editable={isEditable}
              onChange={onChange}
              colors={colors}
            />
          )}
        />

        <LabeledInput label="Father / Husband Name" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="fatherHusbandName"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Relative name"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput
          label="Aadhaar Number"
          helper={
            existingAadhaarMasked
              ? `Saved Aadhaar: ${existingAadhaarMasked}`
              : "Aadhaar is masked after save; only last 4 digits are shown."
          }
        >
          <Controller
            control={control}
            name="aadhaarNumber"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={aadhaarFocused ? value : maskLast4(value)}
                onFocus={() => setAadhaarFocused(true)}
                onBlur={() => setAadhaarFocused(false)}
                onChangeText={(text) => onChange(sanitizeAadhaar(text))}
                editable={isEditable}
                keyboardType="number-pad"
                placeholder="Enter 12-digit Aadhaar"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="PAN (uppercase)" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="panNumber"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={(text) => onChange(sanitizePan(text))}
                editable={isEditable}
                placeholder="ABCDE1234F"
                autoCapitalize="characters"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Address Line 1" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="addressLine1"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="House / street"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Address Line 2" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="addressLine2"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Area / landmark"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Village / Locality" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="villageLocality"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Village / locality"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Pincode" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="pincode"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={(text) => onChange(text.replace(/\D/g, "").slice(0, 6))}
                editable={isEditable}
                keyboardType="number-pad"
                placeholder="6-digit pincode"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="District (Prefilled)" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <TextInput
            value={leadPrefill?.districtName ?? ""}
            editable={false}
            placeholder="District from lead"
            style={[textInputStyle, { opacity: 0.7 }]}
          />
        </LabeledInput>

        <LabeledInput label="State (Prefilled)" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <TextInput
            value={leadPrefill?.state ?? ""}
            editable={false}
            placeholder="State from lead"
            style={[textInputStyle, { opacity: 0.7 }]}
          />
        </LabeledInput>

        <LabeledInput label="Alternate Phone" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="alternatePhone"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                keyboardType="phone-pad"
                placeholder="Alternate contact number"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Technical Details</Text>

        <Controller
          control={control}
          name="installationType"
          render={({ field: { value, onChange } }) => (
            <OptionSelect
              label="Installation Type"
              value={value}
              options={ALLOWED_INSTALLATION_TYPES}
              editable={isEditable}
              onChange={onChange}
              colors={colors}
            />
          )}
        />

        <Controller
          control={control}
          name="propertyOwnership"
          render={({ field: { value, onChange } }) => (
            <OptionSelect
              label="Property Ownership"
              value={value}
              options={ALLOWED_PROPERTY_OWNERSHIP}
              editable={isEditable}
              onChange={onChange}
              colors={colors}
            />
          )}
        />

        <LabeledInput label="Roof Area (sq ft)" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="roofArea"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                keyboardType="numeric"
                placeholder="Roof area"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Recommended Capacity (kW)" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="recommendedCapacity"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                keyboardType="numeric"
                placeholder="Recommended capacity"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <Controller
          control={control}
          name="shadowFreeArea"
          render={({ field: { value, onChange } }) => (
            <OptionSelect
              label="Shadow-Free Area Available"
              value={value}
              options={ALLOWED_SHADOW_FREE}
              editable={isEditable}
              onChange={onChange}
              colors={colors}
            />
          )}
        />

        <Controller
          control={control}
          name="roofType"
          render={({ field: { value, onChange } }) => (
            <OptionSelect
              label="Type of Roof"
              value={value}
              options={ALLOWED_ROOF_TYPE}
              editable={isEditable}
              onChange={onChange}
              colors={colors}
            />
          )}
        />

        <LabeledInput label="Verified Monthly Bill" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="verifiedMonthlyBill"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                keyboardType="numeric"
                placeholder="Verified monthly bill"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <Controller
          control={control}
          name="connectionType"
          render={({ field: { value, onChange } }) => (
            <OptionSelect
              label="Current Electricity Connection Type"
              value={value}
              options={ALLOWED_CONNECTION_TYPE}
              editable={isEditable}
              onChange={onChange}
              colors={colors}
            />
          )}
        />

        <LabeledInput label="Consumer Number" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="consumerNumber"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Electricity consumer number"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="DISCOM Name" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="discomName"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="DISCOM name"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Bank & Loan</Text>

        <LabeledInput
          label="Bank Account Number"
          helper={existingBankMasked ? `Saved account: ${existingBankMasked}` : undefined}
        >
          <Controller
            control={control}
            name="bankAccountNumber"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                keyboardType="number-pad"
                placeholder="Enter account number to update"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="IFSC Code" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="ifscCode"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={(text) => onChange(sanitizeIfsc(text))}
                editable={isEditable}
                placeholder="SBIN0000123"
                autoCapitalize="characters"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <Pressable
          onPress={() => {
            void lookupIfsc();
          }}
          disabled={!isEditable || ifscLookupLoading}
          style={{
            backgroundColor: !isEditable || ifscLookupLoading ? colors.textMuted : colors.info,
            borderRadius: 8,
            padding: 10
          }}
        >
          <Text style={{ textAlign: "center", color: "white", fontWeight: "700" }}>
            {ifscLookupLoading ? "Looking up IFSC..." : "Lookup IFSC"}
          </Text>
        </Pressable>
        {ifscLookupMeta ? <Text style={{ color: colors.text }}>IFSC Match: {ifscLookupMeta}</Text> : null}

        <LabeledInput label="Bank Name" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="bankName"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Bank name"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Account Holder Name" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="accountHolderName"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Account holder name"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>

        <Controller
          control={control}
          name="loanRequired"
          render={({ field: { value, onChange } }) => (
            <Pressable
              onPress={() => onChange(!value)}
              disabled={!isEditable}
              style={{
                borderWidth: 1,
                borderColor: value ? colors.primary : colors.border,
                backgroundColor: value ? colors.accent : colors.surfaceMuted,
                borderRadius: 8,
                padding: 10
              }}
            >
              <Text style={{ fontWeight: "700", color: value ? colors.primary : colors.text }}>
                Loan Required: {value ? "Yes" : "No"}
              </Text>
            </Pressable>
          )}
        />

        <LabeledInput label="Loan Amount Required" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="loanAmountRequired"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable && loanRequiredSelected}
                keyboardType="numeric"
                placeholder="Loan amount"
                style={[
                  inputStyle,
                  !loanRequiredSelected ? { backgroundColor: colors.surfaceMuted, color: colors.textMuted } : null
                ]}
              />
            )}
          />
        </LabeledInput>

        <LabeledInput label="Preferred Lender" labelColor={colors.text} helperColor={colors.textMuted} errorColor={colors.danger}>
          <Controller
            control={control}
            name="preferredLender"
            render={({ field: { value, onChange } }) => (
              <TextInput
                value={value}
                onChangeText={onChange}
                editable={isEditable}
                placeholder="Preferred lender"
                style={inputStyle}
              />
            )}
          />
        </LabeledInput>
      </Card>

      <Card style={{ gap: 10 }}>
        <Text style={{ fontSize: 16, fontWeight: "700", color: colors.text }}>Site Photographs</Text>
        <Text style={{ color: colors.textMuted }}>
          Uploaded: {sitePhotoCount} / {sitePhotoMax}
        </Text>
        {queuedSitePhotoCount > 0 ? (
          <Text style={{ color: colors.warning, fontWeight: "700" }}>
            Queued for sync: {queuedSitePhotoCount}
          </Text>
        ) : null}
        <Text style={{ color: colors.textMuted }}>
          Minimum required before submit: {sitePhotoMin}
        </Text>
        {sitePhotoCount < sitePhotoMin ? (
          <Text style={{ color: colors.warning }}>
            Upload at least {sitePhotoMin - sitePhotoCount} more photo(s) to continue.
          </Text>
        ) : null}

        <Pressable
          onPress={() => {
            void pickFromCamera();
          }}
          disabled={photoUploading || !isEditable}
          style={{
            backgroundColor: photoUploading || !isEditable ? colors.textMuted : colors.info,
            borderRadius: 8,
            padding: 10
          }}
        >
          <Text style={{ textAlign: "center", color: "#fff", fontWeight: "700" }}>
            {photoUploading ? "Uploading..." : "Capture Photo"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            void pickFromGallery();
          }}
          disabled={photoUploading || !isEditable}
          style={{
            backgroundColor: photoUploading || !isEditable ? colors.textMuted : colors.info,
            borderRadius: 8,
            padding: 10
          }}
        >
          <Text style={{ textAlign: "center", color: "#fff", fontWeight: "700" }}>
            {photoUploading ? "Uploading..." : "Choose from Gallery"}
          </Text>
        </Pressable>

        <Pressable
          onPress={() => {
            void pickFromFiles();
          }}
          disabled={photoUploading || !isEditable}
          style={{
            backgroundColor: photoUploading || !isEditable ? colors.textMuted : colors.info,
            borderRadius: 8,
            padding: 10
          }}
        >
          <Text style={{ textAlign: "center", color: "#fff", fontWeight: "700" }}>
            {photoUploading ? "Uploading..." : "Choose from Files"}
          </Text>
        </Pressable>
      </Card>

      <Pressable
        onPress={() => {
          void onSubmit();
        }}
        disabled={submitting || !isEditable}
        style={{
          backgroundColor: submitting || !isEditable ? colors.textMuted : colors.primary,
          borderRadius: 8,
          padding: 12
        }}
      >
        <Text style={{ color: "#fff", textAlign: "center", fontWeight: "700" }}>
          {submitting ? "Submitting..." : "Submit Customer Details"}
        </Text>
      </Pressable>
        </AppScreen>
  );
}
