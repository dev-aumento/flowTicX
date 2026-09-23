import { useTheme } from "next-themes";
import { Toaster as Sonner } from "sonner";

export function AppToaster() {
  const { resolvedTheme } = useTheme();
  const isDark = resolvedTheme === "dark";

  return (
    <Sonner
      position="top-right"
      theme={isDark ? "dark" : "light"}
      closeButton
      expand
      toastOptions={{
        classNames: {
          toast: isDark
            ? "rounded-xl border border-[#2d3a4f] bg-[#151c2c] text-[#f3f4f6] shadow-lg"
            : "rounded-xl border border-gray-200 bg-white text-gray-900 shadow-lg",
          title: isDark
            ? "text-sm font-semibold text-[#f3f4f6]"
            : "text-sm font-semibold text-gray-900",
          description: isDark
            ? "text-xs text-[#c4cdd8]"
            : "text-xs text-gray-600",
          closeButton: isDark
            ? "bg-[#1e293b] border-[#2d3a4f] text-[#c4cdd8]"
            : undefined,
        },
      }}
    />
  );
}
