"use client";

import { useEffect, useRef, useState } from "react";
import { EMOTES, type ChatMessage } from "../platform/roomTypes";

export interface RoomChatProps {
  chat: ChatMessage[];
  nameOf: (id: string) => string;
  onSend: (text: string) => void;
  onEmote: (emote: string) => void;
}

/** Room chat + emotes. Owned by the platform, so every game gets it free. */
export function RoomChat({ chat, nameOf, onSend, onEmote }: RoomChatProps) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLOListElement>(null);
  const lastCount = useRef(chat.length);

  /**
   * Keep the log pinned to the newest message.
   *
   * Deliberately NOT scrollIntoView: that scrolls the nearest scrollable
   * ancestor, which is the page, so the whole window jumped on every server
   * snapshot — and since each snapshot is freshly parsed JSON, the `chat`
   * array is a new object every time, including on every dice roll. Scroll
   * the log's own box, and only when a message actually arrives.
   */
  useEffect(() => {
    if (chat.length === lastCount.current) return;
    lastCount.current = chat.length;
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [chat.length]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
  }

  return (
    <aside className="room-chat card-panel">
      <h3>Chat</h3>
      <ol className="chat-log" ref={logRef}>
        {chat.map((m) => (
          <li key={m.id} className={`chat-${m.kind}`}>
            {m.kind === "system" ? (
              <em>{m.text}</em>
            ) : (
              <>
                <strong>{nameOf(m.playerId)}</strong>{" "}
                <span className={m.kind === "emote" ? "emote-bubble" : ""}>{m.text}</span>
              </>
            )}
          </li>
        ))}
      </ol>

      <div className="emote-row">
        {EMOTES.map((e) => (
          <button key={e} type="button" className="emote-button" onClick={() => onEmote(e)} aria-label={`Send ${e}`}>
            {e}
          </button>
        ))}
      </div>

      <form onSubmit={submit} className="chat-form">
        <input
          value={draft}
          maxLength={240}
          placeholder="Say something…"
          aria-label="Chat message"
          onChange={(e) => setDraft(e.target.value)}
        />
        <button type="submit" disabled={!draft.trim()}>
          Send
        </button>
      </form>
    </aside>
  );
}
