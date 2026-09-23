import { getAvatarColor, getInitials } from "@/lib/utils";

interface UserAvatarProps {
  name?: string | null;
  avatar?: string | null;
  size?: number;
  className?: string;
}

export function UserAvatar({ name, avatar, size = 40, className = "" }: UserAvatarProps) {
  const bgColor = getAvatarColor(name || "?");
  const initials = getInitials(name);

  return (
    <div
      className={`inline-flex items-center justify-center rounded-full overflow-hidden flex-shrink-0 ${className}`}
      style={{ width: size, height: size, backgroundColor: avatar ? "transparent" : bgColor }}
    >
      {avatar ? (
        <img src={avatar} alt={name || "User"} className="w-full h-full object-cover" />
      ) : (
        <span
          className="text-white font-semibold"
          style={{ fontSize: size * 0.4 }}
        >
          {initials}
        </span>
      )}
    </div>
  );
}
