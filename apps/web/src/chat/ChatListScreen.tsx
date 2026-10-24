import { useSession, type ChatItem, type ChatRole } from "@vc/api-client";
import { useI18n } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Button, EmptyState, ErrorState, Icon, Screen, Skeleton, TextField } from "@vc/ui";
import { useCallback, useEffect, useState } from "react";
import { isVendorRef, lastMessagePreview, otherDisplayName, formatMessageTime } from "./chatHelpers";

/** Debounces the search box so it doesn't fire a request on every keystroke (same pattern as
 * SearchScreen's product search). */
function useDebounced<Val>(value: Val, delayMs: number): Val {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(id);
  }, [value, delayMs]);
  return debounced;
}

function Row({ item, role, onOpen }: { item: ChatItem; role: ChatRole; onOpen: () => void }) {
  const { t, lang } = useI18n();
  const preview = lastMessagePreview(t, role, item.last_message);
  const vendor = isVendorRef(item.other) ? item.other : null;
  return (
    <button type="button" className="chat-row" onClick={onOpen}>
      <span className="chat-row__avatar" aria-hidden="true">
        <Icon name={vendor ? "store" : "user"} size={22} />
      </span>
      <span className="chat-row__body">
        <span className="chat-row__top">
          <span className="chat-row__name">{otherDisplayName(item.other)}</span>
          {item.last_message ? <span className="chat-row__time">{formatMessageTime(item.last_message.created_at, lang)}</span> : null}
        </span>
        <span className="chat-row__bottom">
          <span className="chat-row__preview">
            {vendor && !vendor.is_open ? <span className="chat-row__closed">{t("status.closed")} · </span> : null}
            {preview ?? t("chat.no_messages_yet")}
          </span>
          {item.unread_count > 0 ? <span className="chat-row__badge">{item.unread_count}</span> : null}
        </span>
      </span>
    </button>
  );
}

export function ChatListScreen({ role, onOpen }: { role: ChatRole; onOpen: (chatId: string) => void }) {
  const { t } = useI18n();
  const { api } = useSession();
  const [q, setQ] = useState("");
  const debouncedQ = useDebounced(q.trim(), 350);
  const [items, setItems] = useState<ChatItem[] | null>(null);
  const [count, setCount] = useState(0);
  const [page, setPage] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [err, setErr] = useState<unknown>(null);

  const load = useCallback(
    (pageToLoad: number) => {
      if (pageToLoad === 1) {
        setErr(null);
        setItems(null);
      } else {
        setLoadingMore(true);
      }
      api.chats
        .list({ role, q: debouncedQ, page: pageToLoad, page_size: 20 })
        .then((res) => {
          setCount(res.count);
          setItems((prev) => (pageToLoad > 1 && prev ? [...prev, ...res.results] : res.results));
        })
        .catch((e) => {
          if (pageToLoad === 1) setErr(e);
        })
        .finally(() => setLoadingMore(false));
    },
    [api, role, debouncedQ],
  );

  useEffect(() => {
    setPage(1);
    load(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, debouncedQ]);

  const loadMore = () => {
    const next = page + 1;
    setPage(next);
    load(next);
  };

  return (
    <Screen withNav>
      <AppBar title={t("chat.list_title")} />
      <TextField
        label={t("chat.search_ph")}
        placeholder={t("chat.search_ph")}
        value={q}
        onChange={(e) => setQ(e.target.value)}
        type="search"
      />
      {err ? (
        <ErrorState title={t("common.error_title")} message={errorMessage(err, t)} onRetry={() => load(1)} retryLabel={t("common.retry")} />
      ) : items === null ? (
        <Skeleton lines={4} />
      ) : items.length === 0 ? (
        <EmptyState
          icon="chat"
          title={t("chat.empty_title")}
          message={role === "customer" ? t("chat.empty_body_customer") : t("chat.empty_body_vendor")}
        />
      ) : (
        <>
          <div className="vc-stack">
            {items.map((c) => (
              <Row key={c.id} item={c} role={role} onOpen={() => onOpen(c.id)} />
            ))}
          </div>
          {items.length < count ? (
            <Button variant="secondary" block loading={loadingMore} onClick={loadMore}>
              {t("search.load_more")}
            </Button>
          ) : null}
        </>
      )}
    </Screen>
  );
}
