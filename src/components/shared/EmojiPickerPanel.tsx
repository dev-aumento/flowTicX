import { useMemo, useState } from "react";
import { EMOJI_CATEGORIES } from "@/lib/emoji-data";

type EmojiPickerPanelProps = {
  onSelect: (emoji: string) => void;
};

export function EmojiPickerPanel({ onSelect }: EmojiPickerPanelProps) {
  const [activeCategoryId, setActiveCategoryId] = useState(EMOJI_CATEGORIES[0]?.id ?? "smileys");

  const activeCategory = useMemo(
    () => EMOJI_CATEGORIES.find((category) => category.id === activeCategoryId) ?? EMOJI_CATEGORIES[0],
    [activeCategoryId],
  );

  return (
    <div className="w-[320px] max-w-[min(320px,calc(100vw-2rem))] rounded-xl border border-gray-200 bg-[#F8FAFC] shadow-xl overflow-hidden">
      <div className="flex items-center gap-1 px-2 py-2 border-b border-gray-200 bg-white overflow-x-auto scrollbar-thin">
        {EMOJI_CATEGORIES.map((category) => (
          <button
            key={category.id}
            type="button"
            onClick={() => setActiveCategoryId(category.id)}
            className={`shrink-0 h-8 px-2.5 rounded-lg text-lg transition-colors ${
              activeCategoryId === category.id
                ? "bg-blue-50 ring-1 ring-blue-100"
                : "hover:bg-gray-100"
            }`}
            title={category.label}
            aria-label={category.label}
          >
            {category.emojis[0]}
          </button>
        ))}
      </div>

      <div className="px-3 py-2 border-b border-gray-100 bg-white">
        <p className="text-xs font-medium text-gray-500">{activeCategory.label}</p>
      </div>

      <div className="max-h-[280px] overflow-y-auto p-2 scrollbar-thin">
        <div className="grid grid-cols-8 gap-0.5">
          {activeCategory.emojis.map((emoji, index) => (
            <button
              key={`${activeCategory.id}-${emoji}-${index}`}
              type="button"
              onClick={() => onSelect(emoji)}
              className="h-9 w-9 flex items-center justify-center rounded-lg text-xl hover:bg-white hover:shadow-sm transition-colors"
              aria-label={`Insert ${emoji}`}
            >
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
