import {
  ApiError, useSession,
  type ChatItem, type ChatMessage, type ChatRole, type QuickReplyItem, type ReportChatReason, type VendorProductItem,
} from "@vc/api-client";
import { useI18n, type MessageKey } from "@vc/i18n";
import { errorMessage } from "@vc/shell";
import { AppBar, Banner, Button, Card, Chip, EmptyState, Icon, Loading, Modal, Screen, StatusBadge } from "@vc/ui";
import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { UNIT_KEY } from "../shared/units";
import { formatMessageTime, isVendorRef, otherDisplayName } from "./chatHelpers";

const REPORT_REASONS: ReportChatReason[] = ["spam", "wrong_info", "abusive", "fraud", "other"];
const POLL_MS = 3000;

function Bubble({ msg, mine }: { msg: ChatMessage; mine: boolean }) {
  const { t, lang } = useI18n();
  return (
    <div className={`chat-bubble-row${mine ? " is-mine" : ""}`}>
      <div className={`chat-bubble${mine ? " chat-bubble--mine" : " chat-bubble--theirs"}`}>
        {msg.kind === "product" && msg.listing ? (
          <div className="chat-bubble__product">
            <Icon name="box" size={18} />
            <span className="chat-bubble__product-name">{msg.listing.name}</span>
            <span className="chat-bubble__product-price">
              ₹{msg.listing.price}
              <span className="vc-muted"> / {t(UNIT_KEY[msg.listing.unit] ?? "unit.piece")}</span>
            </span>
          </div>
        ) : msg.kind === "text" ? (
          <span className="chat-bubble__text">{msg.text}</span>
        ) : (
          <span className="chat-bubble__text vc-muted">{t("chat.preview_other")}</span>
        )}
        <span className="chat-bubble__time">{formatMessageTime(msg.created_at, lang)}</span>
      </div>
    </div>
  );
}

export function ChatConversationScreen({ role }: { role: ChatRole }) {
  const { chatId = "" } = useParams();
  const { t } = useI18n();
  const { api } = useSession();
  const nav = useNavigate();

  const [chat, setChat] = useState<ChatItem | null>(null);
  const [chatErr, setChatErr] = useState<unknown>(null);
  const [messages, setMessages] = useState<ChatMessage[] | null>(null);
  const [msgErr, setMsgErr] = useState<unknown>(null);
  const [hasMoreOlder, setHasMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [bottomTick, setBottomTick] = useState(0);

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [sendErr, setSendErr] = useState<string>();

  const [confirmBlock, setConfirmBlock] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockErr, setBlockErr] = useState<string>();

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState<ReportChatReason>("spam");
  const [reportDetails, setReportDetails] = useState("");
  const [reportBusy, setReportBusy] = useState(false);
  const [reportErr, setReportErr] = useState<string>();
  const [reportSent, setReportSent] = useState(false);

  const [quickReplies, setQuickReplies] = useState<QuickReplyItem[] | null>(null);
  const [qrManageOpen, setQrManageOpen] = useState(false);
  const [qrDraft, setQrDraft] = useState("");
  const [qrBusy, setQrBusy] = useState(false);
  const [qrErr, setQrErr] = useState<string>();
  const [removingQrId, setRemovingQrId] = useState<number>();

  const [shareOpen, setShareOpen] = useState(false);
  const [shareItems, setShareItems] = useState<VendorProductItem[] | null>(null);
  const [shareErr, setShareErr] = useState<unknown>(null);

  const highestCursor = useRef<number | undefined>(undefined);
  const pollBusy = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const loaded = messages !== null && chat !== null;

  const loadChat = useCallback(() => {
    setChatErr(null);
    api.chats.get(chatId).then(setChat).catch(setChatErr);
  }, [api, chatId]);
  useEffect(loadChat, [loadChat]);

  const loadMessages = useCallback(() => {
    setMsgErr(null);
    api.chats
      .messages(chatId)
      .then((res) => {
        setMessages(res.results);
        setHasMoreOlder(res.has_more);
        highestCursor.current = res.results.length ? res.results[res.results.length - 1].cursor : undefined;
        setBottomTick((n) => n + 1);
        api.chats.markRead(chatId).catch(() => undefined);
      })
      .catch(setMsgErr);
  }, [api, chatId]);
  useEffect(loadMessages, [loadMessages]);

  // Short polling (ARCHITECTURE D14: MVP transport, upgradeable to WebSockets later) — only once the
  // initial page has loaded, so this never races the first fetch and double-appends the same message.
  useEffect(() => {
    if (!loaded) return;
    const id = setInterval(() => {
      if (document.hidden || pollBusy.current) return;
      pollBusy.current = true;
      api.chats
        .messages(chatId, { after: highestCursor.current })
        .then((res) => {
          if (res.results.length === 0) return;
          setMessages((prev) => [...(prev ?? []), ...res.results]);
          highestCursor.current = res.results[res.results.length - 1].cursor;
          setBottomTick((n) => n + 1);
          api.chats.markRead(chatId).catch(() => undefined);
        })
        .catch(() => undefined)
        .finally(() => {
          pollBusy.current = false;
        });
    }, POLL_MS);
    return () => clearInterval(id);
  }, [api, chatId, loaded]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [bottomTick]);

  useEffect(() => {
    if (role !== "vendor") return;
    api.quickReplies.list().then(setQuickReplies).catch(() => setQuickReplies([]));
  }, [api, role]);

  useEffect(() => {
    if (!shareOpen) return;
    setShareItems(null);
    setShareErr(null);
    api.vendorProducts
      .list({ status: "active", page_size: 100 })
      .then((r) => setShareItems(r.results))
      .catch(setShareErr);
  }, [api, shareOpen]);

  async function loadOlder() {
    if (!messages?.length) return;
    setLoadingOlder(true);
    try {
      const res = await api.chats.messages(chatId, { before: messages[0].cursor });
      setMessages((prev) => [...res.results, ...(prev ?? [])]);
      setHasMoreOlder(res.has_more);
    } catch {
      /* transient failure — the button just stays there to try again */
    } finally {
      setLoadingOlder(false);
    }
  }

  async function send(kind: "text" | "product", opts: { text?: string; listing_id?: string }) {
    setSendErr(undefined);
    setSending(true);
    try {
      const msg = await api.chats.send(chatId, { kind, client_message_id: crypto.randomUUID(), ...opts });
      setMessages((prev) => [...(prev ?? []), msg]);
      highestCursor.current = msg.cursor;
      setBottomTick((n) => n + 1);
      setDraft("");
    } catch (e) {
      setSendErr(errorMessage(e, t));
    } finally {
      setSending(false);
    }
  }

  function submitComposer(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text || sending) return;
    send("text", { text });
  }

  async function toggleBlock() {
    setBlockBusy(true);
    setBlockErr(undefined);
    try {
      if (chat?.blocked_by_me) await api.chats.unblock(chatId);
      else await api.chats.block(chatId);
      setChat(await api.chats.get(chatId));
      setConfirmBlock(false);
    } catch (e) {
      setBlockErr(errorMessage(e, t));
    } finally {
      setBlockBusy(false);
    }
  }

  function closeReport() {
    setReportOpen(false);
    setReportSent(false);
    setReportReason("spam");
    setReportDetails("");
    setReportErr(undefined);
  }

  async function submitReport() {
    setReportBusy(true);
    setReportErr(undefined);
    try {
      await api.chats.report(chatId, { reason: reportReason, details: reportDetails.trim() || undefined });
      setReportSent(true);
    } catch (e) {
      setReportErr(errorMessage(e, t));
    } finally {
      setReportBusy(false);
    }
  }

  async function addQuickReply() {
    const text = qrDraft.trim();
    if (!text) return;
    setQrBusy(true);
    setQrErr(undefined);
    try {
      const created = await api.quickReplies.create(text);
      setQuickReplies((prev) => [...(prev ?? []), created]);
      setQrDraft("");
    } catch (e) {
      setQrErr(errorMessage(e, t));
    } finally {
      setQrBusy(false);
    }
  }

  async function removeQuickReply(id: number) {
    setRemovingQrId(id);
    setQrErr(undefined);
    try {
      await api.quickReplies.remove(id);
      setQuickReplies((prev) => prev?.filter((q) => q.id !== id) ?? prev);
    } catch (e) {
      setQrErr(errorMessage(e, t));
    } finally {
      setRemovingQrId(undefined);
    }
  }

  const back = () => (window.history.length > 1 ? nav(-1) : nav(role === "customer" ? "/messages" : "/vendor/messages"));

  if (chatErr instanceof ApiError && (chatErr.status === 403 || chatErr.status === 404)) {
    return (
      <Screen>
        <AppBar title="" onBack={back} backLabel={t("common.back")} />
        <EmptyState icon="chat" title={t("common.error_title")} message={errorMessage(chatErr, t)} />
      </Screen>
    );
  }
  if (chatErr) {
    return (
      <Screen>
        <AppBar title="" onBack={back} backLabel={t("common.back")} />
        <EmptyState icon="chat" title={t("common.error_title")} message={errorMessage(chatErr, t)} action={<Button onClick={loadChat}>{t("common.retry")}</Button>} />
      </Screen>
    );
  }
  if (!chat) return <Loading label={t("common.loading")} />;

  const vendorRef = isVendorRef(chat.other) ? chat.other : null;
  const blockedByThem = chat.blocked_by_them;
  const blockedByMe = chat.blocked_by_me;

  return (
    <Screen>
      <AppBar title={otherDisplayName(chat.other)} onBack={back} backLabel={t("common.back")} />
      <Card className="vc-row">
        <Icon name={vendorRef ? "store" : "user"} size={26} aria-hidden="true" />
        <div style={{ flex: 1 }}>
          <p className="vc-h2" style={{ margin: 0 }}>{otherDisplayName(chat.other)}</p>
          {vendorRef ? <StatusBadge kind={vendorRef.is_open ? "open" : "closed"} size="sm" label={vendorRef.is_open ? t("status.open") : t("status.closed")} /> : null}
        </div>
      </Card>

      <div className={vendorRef ? "vc-grid-3" : "vc-grid-2"}>
        {vendorRef ? (
          <a className="vc-btn vc-btn--secondary" href={`tel:${vendorRef.public_phone}`}>
            <Icon name="phone" /> <span>{t("common.call")}</span>
          </a>
        ) : null}
        <Button variant="secondary" onClick={() => setConfirmBlock(true)}>
          {blockedByMe ? t("chat.unblock") : t("chat.block")}
        </Button>
        <Button variant="ghost" onClick={() => setReportOpen(true)}>{t("chat.report")}</Button>
      </div>

      {blockedByThem ? <Banner tone="warn" icon="alert">{t("chat.blocked_by_them")}</Banner> : null}
      {blockedByMe ? <Banner tone="info" icon="shield">{t("chat.blocked_by_me")}</Banner> : null}

      {msgErr ? (
        <EmptyState icon="chat" title={t("common.error_title")} message={errorMessage(msgErr, t)} action={<Button onClick={loadMessages}>{t("common.retry")}</Button>} />
      ) : messages === null ? (
        <Loading label={t("common.loading")} />
      ) : (
        <div className="chat-thread">
          {hasMoreOlder ? (
            <div style={{ textAlign: "center" }}>
              <Button variant="ghost" loading={loadingOlder} onClick={loadOlder}>{t("chat.load_older")}</Button>
            </div>
          ) : null}
          {messages.length === 0 ? (
            <EmptyState icon="chat" title={t("chat.thread_empty_title")} message={t("chat.thread_empty_body")} />
          ) : (
            messages.map((m) => <Bubble key={m.id} msg={m} mine={m.sender_side === role} />)
          )}
          <div ref={bottomRef} />
        </div>
      )}

      {role === "vendor" && quickReplies && quickReplies.length > 0 ? (
        <div className="chat-quickreplies" role="group" aria-label={t("chat.quick_replies")}>
          {quickReplies.map((q) => (
            <Chip key={q.id} onClick={() => send("text", { text: q.text })}>{q.text}</Chip>
          ))}
          <button type="button" className="vc-iconbtn" onClick={() => setQrManageOpen(true)} aria-label={t("chat.quick_reply_manage")}>
            <Icon name="pencil" size={18} />
          </button>
        </div>
      ) : role === "vendor" ? (
        <div className="chat-quickreplies">
          <Button variant="ghost" onClick={() => setQrManageOpen(true)}>{t("chat.quick_reply_manage")}</Button>
        </div>
      ) : null}

      {sendErr ? <Banner tone="error" icon="alert">{sendErr}</Banner> : null}

      <form className="chat-composer" onSubmit={submitComposer}>
        {role === "vendor" ? (
          <button type="button" className="vc-iconbtn" onClick={() => setShareOpen(true)} disabled={blockedByThem} aria-label={t("chat.share_product")}>
            <Icon name="box" />
          </button>
        ) : null}
        <input
          className="chat-composer__input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t("chat.composer_ph")}
          aria-label={t("chat.composer_ph")}
          disabled={blockedByThem}
          maxLength={2000}
        />
        <button type="submit" className="vc-iconbtn chat-composer__send" disabled={!draft.trim() || sending || blockedByThem} aria-label={t("chat.send_label")}>
          <Icon name="send" />
        </button>
      </form>

      {/* Block confirmation */}
      <Modal open={confirmBlock} onClose={() => setConfirmBlock(false)} title={blockedByMe ? t("chat.unblock_confirm_title") : t("chat.block_confirm_title")} closeLabel={t("common.close")}>
        <p>{role === "customer" ? t("chat.block_confirm_body_customer") : t("chat.block_confirm_body_vendor")}</p>
        {blockErr ? <Banner tone="error" icon="alert">{blockErr}</Banner> : null}
        <div className="vc-row">
          <Button variant="secondary" onClick={() => setConfirmBlock(false)}>{t("common.back")}</Button>
          <Button variant="danger" loading={blockBusy} onClick={toggleBlock}>{blockedByMe ? t("chat.unblock") : t("chat.block")}</Button>
        </div>
      </Modal>

      {/* Report */}
      <Modal open={reportOpen} onClose={closeReport} title={t("chat.report_title")} closeLabel={t("common.close")}>
        {reportSent ? (
          <>
            <p>{t("chat.report_sent")}</p>
            <Button block onClick={closeReport}>{t("common.done")}</Button>
          </>
        ) : (
          <div className="vc-stack">
            <p className="vc-field__label">{t("chat.report_reason_label")}</p>
            <div className="vc-row" role="group" aria-label={t("chat.report_reason_label")}>
              {REPORT_REASONS.map((r) => (
                <Chip key={r} selected={reportReason === r} onClick={() => setReportReason(r)}>
                  {t(`chat.report_reason.${r}` as MessageKey)}
                </Chip>
              ))}
            </div>
            <textarea
              className="chat-report__details"
              value={reportDetails}
              onChange={(e) => setReportDetails(e.target.value)}
              placeholder={t("chat.report_details_ph")}
              aria-label={t("chat.report_details_ph")}
              maxLength={1000}
              rows={3}
            />
            {reportErr ? <Banner tone="error" icon="alert">{reportErr}</Banner> : null}
            <Button block loading={reportBusy} onClick={submitReport}>{t("chat.report_submit")}</Button>
          </div>
        )}
      </Modal>

      {/* Quick-reply management (vendor only) */}
      {role === "vendor" ? (
        <Modal open={qrManageOpen} onClose={() => setQrManageOpen(false)} title={t("chat.quick_reply_manage")} closeLabel={t("common.close")}>
          <div className="vc-stack">
            {quickReplies === null ? (
              <p className="vc-muted">{t("common.loading")}</p>
            ) : quickReplies.length === 0 ? (
              <p className="vc-muted">{t("chat.quick_reply_empty")}</p>
            ) : (
              <ul className="c-list">
                {quickReplies.map((q) => (
                  <li key={q.id} className="chat-qr-row">
                    <span>{q.text}</span>
                    <button type="button" className="vc-iconbtn" onClick={() => removeQuickReply(q.id)} disabled={removingQrId === q.id} aria-label={t("chat.quick_reply_delete_label")}>
                      <Icon name="trash" size={18} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {qrErr ? <Banner tone="error" icon="alert">{qrErr}</Banner> : null}
            {(quickReplies?.length ?? 0) < 20 ? (
              <div className="vc-row">
                <input
                  className="chat-composer__input"
                  value={qrDraft}
                  onChange={(e) => setQrDraft(e.target.value)}
                  placeholder={t("chat.quick_reply_add_ph")}
                  aria-label={t("chat.quick_reply_add_ph")}
                  maxLength={200}
                />
                <Button loading={qrBusy} onClick={addQuickReply}>{t("chat.quick_reply_add")}</Button>
              </div>
            ) : null}
          </div>
        </Modal>
      ) : null}

      {/* Share-a-product picker (vendor only) */}
      {role === "vendor" ? (
        <Modal open={shareOpen} onClose={() => setShareOpen(false)} title={t("chat.share_product_title")} closeLabel={t("common.close")}>
          {shareErr ? (
            <Banner tone="error" icon="alert">{errorMessage(shareErr, t)}</Banner>
          ) : shareItems === null ? (
            <p className="vc-muted">{t("common.loading")}</p>
          ) : shareItems.length === 0 ? (
            <p className="vc-muted">{t("chat.share_product_empty")}</p>
          ) : (
            <ul className="c-list">
              {shareItems.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    className="c-listbtn"
                    onClick={() => {
                      setShareOpen(false);
                      send("product", { listing_id: item.id });
                    }}
                  >
                    <span>{item.name}</span>
                    <span className="vc-muted">₹{item.price}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Modal>
      ) : null}
    </Screen>
  );
}
