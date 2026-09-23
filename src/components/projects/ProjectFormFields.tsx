import {
  LEGACY_PROJECT_ICON_OPTIONS,
  PROJECT_ICON_OPTIONS,
  getProjectIconLabel,
  normalizeProjectColor,
  resolveProjectIcon,
  type ProjectFormValues,
} from "@/lib/project-appearance";
import { cn } from "@/lib/utils";

const FIELD_SELECT_CLASS = cn(
  "h-10 w-full rounded-lg border border-gray-200 bg-white px-3 pr-9",
  "text-sm text-gray-800 appearance-none bg-no-repeat bg-[length:16px] bg-[right_0.7rem_center]",
  "bg-[url('data:image/svg+xml;charset=utf-8,%3Csvg xmlns%3D%22http://www.w3.org/2000/svg%22 width%3D%2216%22 height%3D%2216%22 viewBox%3D%220 0 24 24%22 fill%3D%22none%22 stroke%3D%22%239CA3AF%22 stroke-width%3D%222%22 stroke-linecap%3D%22round%22 stroke-linejoin%3D%22round%22%3E%3Cpath d%3D%22m6 9 6 6 6-6%22/%3E%3C/svg%3E')]",
);

type ProjectFormFieldsProps = {
  value: ProjectFormValues;
  onChange: (value: ProjectFormValues) => void;
  clientNameSuggestions?: string[];
  idPrefix?: string;
  hideClientAgency?: boolean;
};

export function ProjectFormFields({
  value,
  onChange,
  clientNameSuggestions = [],
  idPrefix = "project",
  hideClientAgency = false,
}: ProjectFormFieldsProps) {
  const clientListId = `${idPrefix}-client-suggestions`;
  const SelectedIcon = resolveProjectIcon(value.icon);
  const colorValue = normalizeProjectColor(value.color);

  const update = (patch: Partial<ProjectFormValues>) => {
    onChange({ ...value, ...patch });
  };

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`${idPrefix}-name`}>
          Name *
        </label>
        <input
          id={`${idPrefix}-name`}
          type="text"
          required
          value={value.name}
          onChange={(e) => update({ name: e.target.value })}
          className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          placeholder="Project name..."
        />
      </div>

      {!hideClientAgency ? (
      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`${idPrefix}-client`}>
          Client / Agency
        </label>
        <input
          id={`${idPrefix}-client`}
          type="text"
          list={clientListId}
          value={value.clientName}
          onChange={(e) => update({ clientName: e.target.value })}
          className="w-full h-10 px-3 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
          placeholder="Select or type client / agency name..."
        />
        <datalist id={clientListId}>
          {clientNameSuggestions.map((name) => (
            <option key={name} value={name} />
          ))}
        </datalist>
      </div>
      ) : null}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`${idPrefix}-description`}>
          Description
        </label>
        <textarea
          id={`${idPrefix}-description`}
          value={value.description}
          onChange={(e) => update({ description: e.target.value })}
          className="w-full h-20 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20 resize-none"
          placeholder="Project description..."
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`${idPrefix}-icon`}>
          Icon
        </label>
        <div className="flex items-center gap-3">
          <span
            className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: colorValue }}
            aria-hidden
          >
            <SelectedIcon size={18} />
          </span>
          <select
            id={`${idPrefix}-icon`}
            value={value.icon}
            onChange={(e) => update({ icon: e.target.value })}
            className={FIELD_SELECT_CLASS}
          >
            {PROJECT_ICON_OPTIONS.map(({ key, label }) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
            {LEGACY_PROJECT_ICON_OPTIONS.some((option) => option.key === value.icon) ? (
              LEGACY_PROJECT_ICON_OPTIONS.filter((option) => option.key === value.icon).map(
                ({ key, label }) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ),
              )
            ) : null}
          </select>
        </div>
        <p className="mt-1 text-xs text-gray-400">
          Selected: {getProjectIconLabel(value.icon)}
        </p>
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor={`${idPrefix}-color`}>
          Color
        </label>
        <div className="flex items-center gap-3">
          <input
            id={`${idPrefix}-color`}
            type="color"
            value={colorValue}
            onChange={(e) => update({ color: normalizeProjectColor(e.target.value) })}
            className="h-10 w-14 shrink-0 cursor-pointer rounded-lg border border-gray-200 bg-white p-1"
            aria-label="Pick project color"
          />
          <input
            type="text"
            value={colorValue}
            onChange={(e) => update({ color: normalizeProjectColor(e.target.value) })}
            className="h-10 flex-1 px-3 border border-gray-200 rounded-lg text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-[#2563EB]/20"
            placeholder="#2563EB"
            maxLength={7}
          />
          <span
            className="h-10 w-10 shrink-0 rounded-lg border border-gray-200"
            style={{ backgroundColor: colorValue }}
            aria-hidden
          />
        </div>
      </div>
    </div>
  );
}
