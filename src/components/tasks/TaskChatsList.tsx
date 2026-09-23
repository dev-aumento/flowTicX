import { UserAvatar } from "@/components/shared/UserAvatar";
import { formatTimeAgo } from "@/lib/utils";
import { MessageSquare, Loader2 } from "lucide-react";

export type TaskChatItem = {
  taskId: number;
  title: string;
  lastMessage: string;
  lastAt: Date;
  unread: boolean;
  assignee?: { name: string | null; avatar?: string | null } | null;
};

interface TaskChatsListProps {
  chats: TaskChatItem[];
  isLoading?: boolean;
  onTaskClick: (id: number) => void;
  onMarkAsRead?: (taskId: number) => void;
}

export function TaskChatsList({
  chats,
  isLoading,
  onTaskClick,
  onMarkAsRead,
}: TaskChatsListProps) {
  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={28} className="animate-spin text-gray-400" />
      </div>
    );
  }

  if (chats.length === 0) {
    return (
      <div className="bg-white border border-gray-200 rounded-xl py-16 text-center">
        <MessageSquare size={36} className="mx-auto text-gray-300 mb-2" />
        <p className="text-sm text-gray-500">No task conversations yet</p>
      </div>
    );
  }

  return (
    <div className="bg-white border border-gray-200 rounded-xl overflow-hidden divide-y divide-gray-100">
      {chats.map((chat) => {
        const showMarkAsRead = chat.unread && Boolean(onMarkAsRead);

        return (
          <div
            key={chat.taskId}
            className="group relative px-5 py-4 hover:bg-gray-50 transition-colors"
          >
            <div className="flex items-start gap-4">
              <button
                type="button"
                onClick={() => onTaskClick(chat.taskId)}
                className="flex items-start gap-4 flex-1 min-w-0 text-left"
              >
                {chat.assignee ? (
                  <UserAvatar
                    name={chat.assignee.name}
                    avatar={chat.assignee.avatar}
                    size={40}
                  />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center shrink-0">
                    <MessageSquare size={18} className="text-gray-400" />
                  </div>
                )}

                <div className={`flex-1 min-w-0 ${showMarkAsRead ? "md:pr-24" : ""}`}>
                  <div className="flex items-center justify-between gap-2 mb-0.5">
                    <span
                      className={`text-sm truncate ${
                        chat.unread
                          ? "font-semibold text-[#1F2937]"
                          : "font-medium text-gray-700"
                      }`}
                    >
                      {chat.title}
                    </span>
                    <span className="text-xs text-gray-400 shrink-0">
                      {formatTimeAgo(chat.lastAt)}
                    </span>
                  </div>
                  <p
                    className={`text-sm truncate ${
                      chat.unread ? "text-gray-700" : "text-gray-500"
                    }`}
                  >
                    {chat.lastMessage}
                  </p>
                </div>

                {chat.unread ? (
                  <span className="w-2 h-2 rounded-full bg-[#0EA5E9] mt-2 shrink-0" />
                ) : null}
              </button>

              {showMarkAsRead ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onMarkAsRead?.(chat.taskId);
                  }}
                  className="hidden md:block opacity-0 group-hover:opacity-100 absolute right-4 top-1/2 -translate-y-1/2 text-[11px] font-medium text-[#2563EB] bg-white border border-blue-100 rounded-lg px-2.5 py-1 shadow-sm hover:bg-blue-50 transition-opacity shrink-0"
                >
                  Mark as read
                </button>
              ) : null}
            </div>

            {showMarkAsRead ? (
              <div className="mt-2 pl-14 md:hidden">
                <button
                  type="button"
                  onClick={() => onMarkAsRead?.(chat.taskId)}
                  className="text-[11px] font-medium text-[#2563EB] bg-white border border-blue-100 rounded-lg px-2.5 py-1 shadow-sm active:bg-blue-50"
                >
                  Mark as read
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
