import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Briefcase,
  Building2,
  Calendar,
  Car,
  ClipboardList,
  Cloud,
  Code,
  Coins,
  Compass,
  Database,
  Factory,
  Flag,
  FolderKanban,
  Globe,
  GraduationCap,
  Hammer,
  Heart,
  Image,
  Laptop,
  Layers,
  LayoutGrid,
  Map,
  Megaphone,
  Package,
  Paintbrush,
  PenTool,
  Plane,
  Rocket,
  Scale,
  Shield,
  ShoppingBag,
  Smartphone,
  Stethoscope,
  Store,
  Target,
  Truck,
  Users,
  Utensils,
  Video,
} from "lucide-react";

export const DEFAULT_PROJECT_COLOR = "#2563EB";
export const DEFAULT_PROJECT_ICON = "folder-kanban";

export const PROJECT_ICON_OPTIONS = [
  { key: "folder-kanban", label: "Project board", Icon: FolderKanban },
  { key: "briefcase", label: "Business", Icon: Briefcase },
  { key: "building-2", label: "Corporate", Icon: Building2 },
  { key: "globe", label: "Website", Icon: Globe },
  { key: "layout-grid", label: "Layout", Icon: LayoutGrid },
  { key: "layers", label: "Design system", Icon: Layers },
  { key: "clipboard-list", label: "Task list", Icon: ClipboardList },
  { key: "target", label: "Goals", Icon: Target },
  { key: "flag", label: "Milestone", Icon: Flag },
  { key: "compass", label: "Planning", Icon: Compass },
  { key: "calendar", label: "Schedule", Icon: Calendar },
  { key: "map", label: "Location", Icon: Map },
  { key: "package", label: "Product", Icon: Package },
  { key: "shopping-bag", label: "E-commerce", Icon: ShoppingBag },
  { key: "truck", label: "Logistics", Icon: Truck },
  { key: "factory", label: "Manufacturing", Icon: Factory },
  { key: "hammer", label: "Construction", Icon: Hammer },
  { key: "paintbrush", label: "Branding", Icon: Paintbrush },
  { key: "pen-tool", label: "UI / UX", Icon: PenTool },
  { key: "image", label: "Media", Icon: Image },
  { key: "video", label: "Video production", Icon: Video },
  { key: "code", label: "Development", Icon: Code },
  { key: "database", label: "Data", Icon: Database },
  { key: "cloud", label: "Cloud", Icon: Cloud },
  { key: "smartphone", label: "Mobile app", Icon: Smartphone },
  { key: "book-open", label: "Documentation", Icon: BookOpen },
  { key: "graduation-cap", label: "Training", Icon: GraduationCap },
  { key: "stethoscope", label: "Healthcare", Icon: Stethoscope },
  { key: "scale", label: "Legal", Icon: Scale },
  { key: "coins", label: "Finance", Icon: Coins },
  { key: "bar-chart-3", label: "Analytics", Icon: BarChart3 },
  { key: "shield", label: "Security", Icon: Shield },
  { key: "utensils", label: "Hospitality", Icon: Utensils },
  { key: "plane", label: "Travel", Icon: Plane },
  { key: "car", label: "Automotive", Icon: Car },
] as const;

/** Icons kept only for displaying older saved projects. */
export const LEGACY_PROJECT_ICON_OPTIONS = [
  { key: "rocket", label: "Launch (legacy)", Icon: Rocket },
  { key: "store", label: "Store (legacy)", Icon: Store },
  { key: "users", label: "Team (legacy)", Icon: Users },
  { key: "palette", label: "Creative (legacy)", Icon: Paintbrush },
  { key: "laptop", label: "Tech (legacy)", Icon: Laptop },
  { key: "heart", label: "Care (legacy)", Icon: Heart },
  { key: "megaphone", label: "Marketing (legacy)", Icon: Megaphone },
] as const;

export type ProjectIconKey = (typeof PROJECT_ICON_OPTIONS)[number]["key"];

export type ProjectFormValues = {
  name: string;
  description: string;
  clientName: string;
  color: string;
  icon: string;
};

export const EMPTY_PROJECT_FORM: ProjectFormValues = {
  name: "",
  description: "",
  clientName: "",
  color: DEFAULT_PROJECT_COLOR,
  icon: DEFAULT_PROJECT_ICON,
};

export function normalizeProjectColor(color?: string | null) {
  if (!color) return DEFAULT_PROJECT_COLOR;
  const trimmed = color.trim();
  if (/^#[0-9A-Fa-f]{6}$/.test(trimmed)) return trimmed.toUpperCase();
  if (/^#[0-9A-Fa-f]{3}$/.test(trimmed)) {
    const [r, g, b] = trimmed.slice(1);
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  return DEFAULT_PROJECT_COLOR;
}

export function isProjectIconKey(value: string): value is ProjectIconKey {
  return PROJECT_ICON_OPTIONS.some((option) => option.key === value);
}

export function isKnownProjectIcon(value: string) {
  return (
    isProjectIconKey(value) ||
    LEGACY_PROJECT_ICON_OPTIONS.some((option) => option.key === value)
  );
}

export function resolveProjectIcon(iconKey?: string | null): LucideIcon {
  const match =
    PROJECT_ICON_OPTIONS.find((option) => option.key === iconKey) ??
    LEGACY_PROJECT_ICON_OPTIONS.find((option) => option.key === iconKey);
  return match?.Icon ?? FolderKanban;
}

export function getProjectIconLabel(iconKey?: string | null) {
  const match =
    PROJECT_ICON_OPTIONS.find((option) => option.key === iconKey) ??
    LEGACY_PROJECT_ICON_OPTIONS.find((option) => option.key === iconKey);
  return match?.label ?? "Project board";
}

export function projectToFormValues(project: {
  name: string;
  description?: string | null;
  clientName?: string | null;
  color?: string | null;
  icon?: string | null;
}): ProjectFormValues {
  const icon = project.icon ?? DEFAULT_PROJECT_ICON;
  return {
    name: project.name,
    description: project.description ?? "",
    clientName: project.clientName ?? "",
    color: normalizeProjectColor(project.color),
    icon: isKnownProjectIcon(icon) ? icon : DEFAULT_PROJECT_ICON,
  };
}

export function collectClientNameSuggestions(
  projects: Array<{ clientName?: string | null }>,
) {
  return [
    ...new Set(
      projects
        .map((project) => project.clientName?.trim())
        .filter((name): name is string => Boolean(name)),
    ),
  ].sort((a, b) => a.localeCompare(b));
}
