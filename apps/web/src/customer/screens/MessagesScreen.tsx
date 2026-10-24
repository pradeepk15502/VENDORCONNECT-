import { useNavigate } from "react-router-dom";
import { ChatListScreen } from "../../chat/ChatListScreen";

export function MessagesScreen() {
  const nav = useNavigate();
  // eslint-disable-next-line jsx-a11y/aria-role -- `role` is our own ChatRole prop ("customer"|"vendor"), not an ARIA role
  return <ChatListScreen role="customer" onOpen={(chatId) => nav(`/chat/${chatId}`)} />;
}
