import type { SalonType } from "@/lib/app/salon-profile";

export type AuthRealm = "platform" | "tenant";

export type AuthResponse = {
  accessToken: string;
  tokenType: "bearer";
  expiresIn: number;
};

export type ApiErrorPayload = {
  statusCode?: number;
  error?: string;
  message?: string | Array<{ field?: string; message?: string; type?: string }>;
  code?: string;
  details?: unknown;
  requestId?: string;
};

export type UserView = {
  id: string;
  email: string;
  role: string | null;
  fullName: string | null;
  phone: string | null;
  emailVerified: boolean;
  status: string;
  createdAt: string;
  tenantId?: string | null;
};

export type PlanView = {
  id: string;
  code: string;
  name: string;
  price: string | number;
  period: string;
  limits: Record<string, number | null>;
  features: string[];
  isActive: boolean;
};

export type MeResponse = {
  user: UserView;
  subscription: null | {
    id: string;
    plan: PlanView;
    status: string;
    currentPeriodStart: string | null;
    currentPeriodEnd: string | null;
    autoRenew: boolean;
    graceUntil: string | null;
  };
};

export type SiteView = {
  id: string;
  ownerId: string;
  name: string;
  slug: string;
  salonType: SalonType;
  serviceFocuses: string[];
  locale: string;
  currency: string;
  customDomain: string | null;
  domainVerified: boolean;
  description: string | null;
  city: string | null;
  street: string | null;
  phone: string | null;
  workHours: Record<string, Array<{ start: string; end: string }>>;
  socials: Record<string, string>;
  logoUrl: string | null;
  theme: Record<string, unknown>;
  timezone: string;
  templateKey: string;
  status: string;
  publishedAt: string | null;
  draftVersion: number;
  publishedVersion: number | null;
  createdAt: string;
  updatedAt: string;
};

export type SiteBlockView = {
  id: string;
  type: string;
  position: number;
  config: Record<string, unknown>;
  enabled: boolean;
};

export type BlockCatalogItem = {
  type: string;
  name: string;
  allowed: boolean;
  lockedReason: string | null;
  defaultConfig: Record<string, unknown>;
};

export type SitePreview = {
  previewToken: string;
  previewUrl: string;
  expiresAt: string;
};

export type SitePublishResult = {
  url: string;
  version: number;
  publishedAt: string;
};

export type PublicSiteSnapshot = {
  id: string;
  name: string;
  slug: string;
  salonType: SalonType;
  serviceFocuses: string[];
  locale: string;
  currency: string;
  customDomain?: string | null;
  description: string | null;
  city: string | null;
  street: string | null;
  phone: string | null;
  workHours: Record<string, Array<{ start: string; end: string }>>;
  socials: Record<string, string>;
  logoUrl: string | null;
  theme: Record<string, unknown>;
  timezone: string;
  templateKey: string;
  blocks: SiteBlockView[];
  version?: number;
  publishedAt?: string;
};

export type ServiceAudience = "women" | "men" | "all" | "kids";
export type ServicePriceType = "fixed" | "from" | "range" | "consultation";

export type ServiceCategoryView = {
  id: string;
  tenantId: string;
  name: string;
  slug: string;
  audience: ServiceAudience;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type PublicServiceVariantView = {
  id: string;
  label: string;
  priceDelta: string | number;
  durationDeltaMin: number;
};

export type PublicServiceAddonView = {
  id: string;
  name: string;
  priceDelta: string | number;
  durationDeltaMin: number;
};

export type ServiceVariantView = PublicServiceVariantView & {
  serviceId: string;
  sortOrder: number;
  isActive: boolean;
};

export type ServiceAddonView = PublicServiceAddonView & {
  serviceId: string;
  sortOrder: number;
  isActive: boolean;
};

export type PublicServiceView = {
  id: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: string | number;
  maxPrice: string | number | null;
  priceType: ServicePriceType;
  currency: "RUB";
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  requiresConsultation: boolean;
  requiresPatchTest: boolean;
  variantSelectionRequired: boolean;
  preparationText: string | null;
  aftercareText: string | null;
  variants: PublicServiceVariantView[];
  addons: PublicServiceAddonView[];
};

export type PublicStaffView = {
  id: string;
  name: string;
  specialization: string | null;
  photoUrl: string | null;
  serviceIds: string[];
};

export type SlotView = { startAt: string; endAt: string; available: boolean };
export type SlotsResponse = {
  timezone: string;
  serviceId: string;
  staffId: string;
  slots: SlotView[];
};

export type AnalyticsOverview = {
  from: string;
  to: string;
  appointments: number;
  revenue: string | number;
  newClients: number;
  staffUtilizationPercent: number;
};

export type ServiceAnalytics = {
  serviceId: string;
  serviceName: string;
  appointments: number;
  revenue: string | number;
};

export type Paginated<T> = {
  items: T[];
  total: number;
  page: number;
  limit: number;
};

export type ServiceView = {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  categoryId: string | null;
  categoryName: string | null;
  price: string | number;
  maxPrice: string | number | null;
  priceType: ServicePriceType;
  currency: "RUB";
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  category: string | null;
  requiresConsultation: boolean;
  requiresPatchTest: boolean;
  allowOnlineBooking: boolean;
  variantSelectionRequired: boolean;
  preparationText: string | null;
  aftercareText: string | null;
  sortOrder: number;
  isActive: boolean;
  variants: ServiceVariantView[];
  addons: ServiceAddonView[];
  createdAt: string;
  updatedAt: string;
};

export type StaffView = {
  id: string;
  tenantId: string;
  userId: string | null;
  name: string;
  specialization: string | null;
  photoUrl: string | null;
  schedule: SiteView["workHours"];
  serviceIds: string[];
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

export type AppointmentItemAddonView = {
  id: string;
  addonId: string;
  name: string;
  price: string | number;
  durationMin: number;
};

export type AppointmentItemView = {
  id: string;
  serviceId: string;
  variantId: string | null;
  assignedStaffId: string | null;
  serviceName: string;
  variantLabel: string | null;
  selectedOptions: Record<string, unknown>;
  unitPrice: string | number;
  finalPrice: string | number | null;
  durationMin: number;
  bufferBeforeMin: number;
  bufferAfterMin: number;
  currency: "RUB";
  sortOrder: number;
  adjustmentReason: string | null;
  addons: AppointmentItemAddonView[];
};

export type ScheduleExceptionView = {
  id: string;
  staffId: string;
  startsAt: string;
  endsAt: string;
  kind: "day_off" | "working" | "break";
  reason: string | null;
  createdAt: string;
  updatedAt: string;
};

export type MediaView = {
  id: string;
  url: string;
  purpose: "logo" | "gallery" | "staff";
  isPublic: boolean;
  contentType: string;
  sizeBytes: number;
  createdAt: string;
};

export type PublicReviewView = {
  id: string;
  rating: number;
  text: string | null;
  authorName: string | null;
  createdAt: string;
};

export type AppointmentView = {
  id: string;
  tenantId: string;
  tenantUserId: string;
  petId: string;
  serviceId: string;
  staffId: string | null;
  startAt: string;
  endAt: string;
  status: "new" | "confirmed" | "completed" | "cancelled" | "no_show";
  price: string | number;
  prepaid: boolean;
  notes: string | null;
  version: number;
  createdAt: string;
  clientName: string | null;
  petName: string | null;
  serviceName: string | null;
  staffName: string | null;
  items: AppointmentItemView[];
};

export type PhotoView = {
  id: string;
  url: string;
  isCover: boolean;
  position: number;
  uploadedAt: string;
};

export type PetDocumentView = {
  id: string;
  type: "passport";
  filename: string | null;
  url: string;
  uploadedAt: string;
};

export type PetView = {
  id: string;
  tenantId: string;
  ownerId: string;
  name: string;
  species: "dog" | "cat" | "other";
  breed: string | null;
  birthDate: string | null;
  weightKg: string | number | null;
  coatType: string | null;
  temperament: string | null;
  allergies: string | null;
  medicalNotes: string | null;
  additionalInfo: string | null;
  vaccinatedUntil: string | null;
  photos: PhotoView[];
  documents: PetDocumentView[];
  ageYears: number | null;
  vaccinationCurrent: boolean | null;
  archivedAt: string | null;
  createdAt: string;
};

export type ClientView = {
  id: string;
  tenantId: string;
  email: string | null;
  fullName: string | null;
  phone: string | null;
  emailVerified: boolean;
  status: string;
  createdAt: string;
  pets: PetView[];
};

export type ClientAppointmentSummary = {
  id: string;
  petId: string;
  serviceId: string;
  staffId: string | null;
  startAt: string;
  endAt: string;
  status: string;
  price: string | number | null;
  prepaid: boolean;
  petName: string | null;
  serviceName: string | null;
  staffName: string | null;
};

export type ClientDetailsView = ClientView & {
  appointmentHistory: ClientAppointmentSummary[];
};

export type HairLength = "shaved" | "short" | "medium" | "long" | "very_long";
export type HairDensity = "low" | "medium" | "high";
export type HairTexture = "straight" | "wavy" | "curly" | "coily";
export type HairPorosity = "low" | "medium" | "high" | "unknown";

export type ClientHairProfileView = {
  id: string;
  tenantId: string;
  clientId: string;
  hairLength: HairLength | null;
  density: HairDensity | null;
  texture: HairTexture | null;
  porosity: HairPorosity | null;
  conditionNotes: string | null;
  scalpSensitivityNotes: string | null;
  grayPercentage: number | null;
  naturalColor: string | null;
  currentColor: string | null;
  colorHistory: string | null;
  beardLength: string | null;
  beardStyle: string | null;
  moustacheStyle: string | null;
  preferences: string | null;
  version: number;
  updatedById: string | null;
  createdAt: string;
  updatedAt: string;
};
