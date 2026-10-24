import { ChatConversationScreen } from "../../chat/ChatConversationScreen";

export function ChatScreen() {
  // eslint-disable-next-line jsx-a11y/aria-role -- `role` is our own ChatRole prop ("customer"|"vendor"), not an ARIA role
  return <ChatConversationScreen role="vendor" />;
}
