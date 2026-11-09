"use client";

import { useEffect, useRef, useState } from "react";

export interface PromptRequest {
  title: string;
  message?: string;
  label?: string; // with `value`, shows a text field
  value?: string;
  confirm: string;
  danger?: boolean;
}

// Resolves with the field's text ("" when there is no field), or null if cancelled.
export default function PromptDialog({ request, onClose }: { request: PromptRequest; onClose: (result: string | null) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [value, setValue] = useState(request.value ?? "");
  const hasField = request.value !== undefined;

  useEffect(() => {
    if (!ref.current?.open) ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="prompt" onClose={() => onClose(ref.current?.returnValue === "ok" ? value : null)}>
      <form method="dialog">
        <h2>{request.title}</h2>
        {request.message && <p>{request.message}</p>}
        {hasField && (
          <label>
            <span>{request.label}</span>
            <input
              type="text"
              className="text-field"
              value={value}
              autoFocus
              autoComplete="off"
              onChange={(e) => setValue(e.target.value)}
              onFocus={(e) => e.target.select()}
            />
          </label>
        )}
        <div className="prompt-actions">
          <button type="button" className="btn" onClick={() => ref.current?.close()}>
            Cancel
          </button>
          <button
            type="submit"
            value="ok"
            className={`btn primary${request.danger ? " danger" : ""}`}
            disabled={hasField && !value.trim()}
          >
            {request.confirm}
          </button>
        </div>
      </form>
    </dialog>
  );
}
