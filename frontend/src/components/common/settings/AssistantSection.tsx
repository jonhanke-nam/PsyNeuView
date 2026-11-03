/**
 * Settings ▸ AI assistant (#179).
 *
 * One control per setting from docs/ai-assistant/contract.md, every value
 * stored by the backend (`/api/assistant/settings`), never in this browser.
 * Raising a permission — turning it on, more autonomy, more visibility, a
 * writable folder — is confirmed first: the backend answers the PUT with a
 * 409 naming what would be raised, and this section asks before sending it
 * again with `confirm_raise`. The first time it is turned on, a short
 * explanation says what is shared, with whom, and what it can do.
 *
 * The API key is write-only: the page learns only whether one is set.
 */

import { useEffect, useState, type ReactNode } from "react";

import { useAssistantStore } from "@/stores/assistantStore";
import type { AssistantSettings, Autonomy, AgentType, FolderAccess, Saving } from "@/stores/assistantTypes";
import { VISIBILITY_WORDS, whereDataGoes } from "@/utils/assistantProposals";
import { Button } from "../Button";
import { Group, SettingLabel, errorStyle, inputStyle, mutedStyle, selectStyle } from "./shared";

const AGENT_LABELS: Record<AgentType, string> = {
  none: "None (off)",
  anthropic: "Anthropic (Claude), with your API key",
  openai_compatible: "An OpenAI-compatible server (local or remote)",
};

const AUTONOMY_LABELS: Record<Autonomy, string> = {
  answer: "Answer questions only",
  suggest: "Suggest edits as proposals you accept or reject",
  app_edits: "Propose edits to the open model, applied when you accept",
};

const SAVING_LABELS: Record<Saving, string> = {
  always_ask: "Always ask before saving",
  structured_without_asking: "Save structured edits without asking",
};

export function AssistantSection() {
  const settings = useAssistantStore((s) => s.settings);
  const save = useAssistantStore((s) => s.save);
  const saving = useAssistantStore((s) => s.saving);
  const loadError = useAssistantStore((s) => s.loadError);
  const pendingRaise = useAssistantStore((s) => s.pendingRaise);
  const explanation = useAssistantStore((s) => s.explanation);

  const change = (patch: Partial<AssistantSettings>) => void save({ ...settings, ...patch });
  const visibility = (key: keyof AssistantSettings["visibility"], value: boolean) =>
    change({ visibility: { ...settings.visibility, [key]: value } });

  return (
    <div data-testid="assistant-section" style={{ fontSize: "var(--pnv-fs-13)" }}>
      {loadError && (
        <div data-testid="assistant-settings-error" style={{ ...errorStyle, marginBottom: 10 }}>
          {loadError}
        </div>
      )}
      {pendingRaise && <RaiseConfirm raised={pendingRaise.raised} />}
      {explanation && <FirstTimeExplanation settings={explanation} />}

      <Group id="assistant-on" title="On or off">
        <Check
          input={<input data-testid="setting-assistant-enabled" type="checkbox" checked={settings.enabled} disabled={saving} onChange={(e) => change({ enabled: e.target.checked })} style={{ marginTop: 3 }} />}
          title="Use an AI assistant"
        >
          Off by default. With it off, nothing is sent anywhere and the Assistant tab is not shown. An external agent's
          own access can't be limited by PsyNeuView: what it does with what it receives is between you and that
          service.
        </Check>
      </Group>

      <Group id="assistant-agent" title="Agent">
        <SettingLabel title="Which agent" htmlFor="setting-assistant-agent-type">
          {whereDataGoes(settings.agent)}
        </SettingLabel>
        <select
          id="setting-assistant-agent-type"
          data-testid="setting-assistant-agent-type"
          value={settings.agent.type}
          disabled={saving}
          onChange={(e) => change({ agent: { ...settings.agent, type: e.target.value as AgentType } })}
          style={{ ...selectStyle, marginTop: 6 }}
        >
          {(Object.keys(AGENT_LABELS) as AgentType[]).map((t) => (
            <option key={t} value={t}>
              {AGENT_LABELS[t]}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <SettingLabel title="Model" htmlFor="setting-assistant-agent-model">
            The model name the agent's service expects. Blank uses the service's default.
          </SettingLabel>
          <input
            id="setting-assistant-agent-model"
            data-testid="setting-assistant-agent-model"
            value={settings.agent.model}
            disabled={saving}
            onChange={(e) => useAssistantStore.setState({ settings: { ...settings, agent: { ...settings.agent, model: e.target.value } } })}
            onBlur={(e) => {
              if (e.target.value !== settings.agent.model) change({ agent: { ...settings.agent, model: e.target.value } });
            }}
            style={{ ...inputStyle, marginTop: 6, width: "100%" }}
          />
        </div>
        {settings.agent.type === "openai_compatible" && (
          <div style={{ marginTop: 12 }}>
            <SettingLabel title="Server address" htmlFor="setting-assistant-agent-base-url">
              Where messages go. A server on this machine keeps everything local.
            </SettingLabel>
            <input
              id="setting-assistant-agent-base-url"
              data-testid="setting-assistant-agent-base-url"
              value={settings.agent.base_url}
              disabled={saving}
              placeholder="http://localhost:11434/v1"
              onChange={(e) => useAssistantStore.setState({ settings: { ...settings, agent: { ...settings.agent, base_url: e.target.value } } })}
              onBlur={(e) => {
                if (e.target.value !== settings.agent.base_url) change({ agent: { ...settings.agent, base_url: e.target.value } });
              }}
              style={{ ...inputStyle, marginTop: 6, width: "100%" }}
            />
          </div>
        )}
        <ApiKeySetting />
      </Group>

      <Group id="assistant-permissions" title="What it may do">
        <SettingLabel title="Autonomy" htmlFor="setting-assistant-autonomy">
          Nothing is changed without you accepting a proposal. Raising this asks for confirmation.
        </SettingLabel>
        <select
          id="setting-assistant-autonomy"
          data-testid="setting-assistant-autonomy"
          value={settings.autonomy}
          disabled={saving}
          onChange={(e) => change({ autonomy: e.target.value as Autonomy })}
          style={{ ...selectStyle, marginTop: 6 }}
        >
          {(Object.keys(AUTONOMY_LABELS) as Autonomy[]).map((a) => (
            <option key={a} value={a}>
              {AUTONOMY_LABELS[a]}
            </option>
          ))}
        </select>
        <div style={{ marginTop: 12 }}>
          <SettingLabel title="Saving" htmlFor="setting-assistant-saving">
            Whether an accepted structured edit may be saved to the file without a further question.
          </SettingLabel>
          <select
            id="setting-assistant-saving"
            data-testid="setting-assistant-saving"
            value={settings.saving}
            disabled={saving}
            onChange={(e) => change({ saving: e.target.value as Saving })}
            style={{ ...selectStyle, marginTop: 6 }}
          >
            {(Object.keys(SAVING_LABELS) as Saving[]).map((v) => (
              <option key={v} value={v}>
                {SAVING_LABELS[v]}
              </option>
            ))}
          </select>
        </div>
        <FoldersSetting settings={settings} disabled={saving} onChange={(folders) => change({ folders })} />
      </Group>

      <Group id="assistant-visibility" title="What it can see">
        <div style={{ ...mutedStyle, marginBottom: 6 }}>
          Only what is ticked is sent with a message; the backend drops anything else before the agent sees it.
        </div>
        <Check input={<input data-testid="setting-assistant-visibility-model" type="checkbox" checked={settings.visibility.model} disabled={saving} onChange={(e) => visibility("model", e.target.checked)} style={{ marginTop: 3 }} />} title="The open model's code" />
        <Check input={<input data-testid="setting-assistant-visibility-selection" type="checkbox" checked={settings.visibility.selection} disabled={saving} onChange={(e) => visibility("selection", e.target.checked)} style={{ marginTop: 3 }} />} title="What is selected" />
        <Check input={<input data-testid="setting-assistant-visibility-errors" type="checkbox" checked={settings.visibility.errors} disabled={saving} onChange={(e) => visibility("errors", e.target.checked)} style={{ marginTop: 3 }} />} title="Errors shown in the diagnostics bar" />
        <Check input={<input data-testid="setting-assistant-visibility-results" type="checkbox" checked={settings.visibility.results} disabled={saving} onChange={(e) => visibility("results", e.target.checked)} style={{ marginTop: 3 }} />} title="Run results" />
        <Check input={<input data-testid="setting-assistant-visibility-files" type="checkbox" checked={settings.visibility.files} disabled={saving} onChange={(e) => visibility("files", e.target.checked)} style={{ marginTop: 3 }} />} title="Model files in the allowed folders (list and read, never run)" />
      </Group>

      <Group id="assistant-limits" title="Limits and log" defaultFolded summary={`${settings.limits.tool_calls} tool calls, ${settings.limits.minutes} minutes per turn, ${settings.limits.max_tokens.toLocaleString()} tokens per session${settings.keep_log ? ", log kept" : ""}`}>
        <div style={{ display: "flex", gap: 16, alignItems: "flex-end" }}>
          <div>
            <SettingLabel title="Tool calls per turn" htmlFor="setting-assistant-limit-tool-calls" />
            <input
              id="setting-assistant-limit-tool-calls"
              data-testid="setting-assistant-limit-tool-calls"
              type="number"
              min={1}
              value={settings.limits.tool_calls}
              disabled={saving}
              onChange={(e) => change({ limits: { ...settings.limits, tool_calls: Number(e.target.value) } })}
              style={{ ...inputStyle, width: 90, marginTop: 6 }}
            />
          </div>
          <div>
            <SettingLabel title="Minutes per turn" htmlFor="setting-assistant-limit-minutes" />
            <input
              id="setting-assistant-limit-minutes"
              data-testid="setting-assistant-limit-minutes"
              type="number"
              min={1}
              value={settings.limits.minutes}
              disabled={saving}
              onChange={(e) => change({ limits: { ...settings.limits, minutes: Number(e.target.value) } })}
              style={{ ...inputStyle, width: 90, marginTop: 6 }}
            />
          </div>
          <div>
            <SettingLabel title="Tokens per session" htmlFor="setting-assistant-limit-max-tokens" />
            <input
              id="setting-assistant-limit-max-tokens"
              data-testid="setting-assistant-limit-max-tokens"
              type="number"
              min={1}
              step={1000}
              value={settings.limits.max_tokens}
              disabled={saving}
              onChange={(e) => change({ limits: { ...settings.limits, max_tokens: Number(e.target.value) } })}
              style={{ ...inputStyle, width: 120, marginTop: 6 }}
            />
          </div>
        </div>
        <div style={{ ...mutedStyle, marginTop: 4, maxWidth: 560 }}>
          Spending: the tokens the agent's service reports, input and output, added up over a session. The turn stops
          when the total is reached. A service that reports no usage isn't limited this way.
        </div>
        <div style={{ marginTop: 12 }}>
          <Check input={<input data-testid="setting-assistant-keep-log" type="checkbox" checked={settings.keep_log} disabled={saving} onChange={(e) => change({ keep_log: e.target.checked })} style={{ marginTop: 3 }} />} title="Keep a log of tool calls">
            Every tool call, its arguments, the result and who approved it, on this machine only. Prompts, replies and
            source stay out of problem reports.
          </Check>
        </div>
      </Group>
    </div>
  );
}

/** A checkbox and its words. The `<input>` is written at each call site, so its test id is literal (settingsInventory.test.ts). */
function Check({ input, title, children }: { input: ReactNode; title: string; children?: ReactNode }) {
  return (
    <label style={{ display: "flex", gap: 8, alignItems: "flex-start", cursor: "pointer", marginTop: 6 }}>
      {input}
      <span>
        <span style={{ fontWeight: 500 }}>{title}</span>
        {children && <div style={{ ...mutedStyle, marginTop: 2, maxWidth: 560 }}>{children}</div>}
      </span>
    </label>
  );
}

/** The backend's 409: what the change would allow, confirmed before it is sent again. */
function RaiseConfirm({ raised }: { raised: string[] }) {
  const confirmRaise = useAssistantStore((s) => s.confirmRaise);
  const cancelRaise = useAssistantStore((s) => s.cancelRaise);
  return (
    <div
      data-testid="assistant-raise-confirm"
      style={{
        border: "1px solid var(--pnv-warning)",
        background: "var(--pnv-warning-tint)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 14,
      }}
    >
      <div style={{ fontWeight: 600 }}>This change gives the assistant more than it has now</div>
      <ul style={{ margin: "6px 0 8px 18px", padding: 0 }}>
        {raised.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      <div style={{ display: "flex", gap: 8 }}>
        <Button kind="primary" size="compact" data-testid="assistant-raise-confirm-yes" onClick={() => void confirmRaise()}>
          Allow
        </Button>
        <Button kind="secondary" size="compact" data-testid="assistant-raise-confirm-no" onClick={cancelRaise}>
          Keep as it was
        </Button>
      </div>
    </div>
  );
}

/** Shown once, the first time the assistant is turned on: what is shared, with whom, what it can do. */
function FirstTimeExplanation({ settings }: { settings: AssistantSettings }) {
  const acknowledge = useAssistantStore((s) => s.acknowledgeExplanation);
  const sees = (Object.keys(VISIBILITY_WORDS) as (keyof typeof VISIBILITY_WORDS)[])
    .filter((k) => settings.visibility[k])
    .map((k) => VISIBILITY_WORDS[k]);
  return (
    <div
      data-testid="assistant-explanation"
      style={{
        border: "1px solid var(--pnv-primary)",
        background: "var(--pnv-primary-tint)",
        borderRadius: 6,
        padding: "10px 12px",
        marginBottom: 14,
      }}
    >
      <div style={{ fontWeight: 600 }}>The assistant is on. Here is what that means.</div>
      <ul style={{ margin: "6px 0 8px 18px", padding: 0, lineHeight: 1.5 }}>
        <li>
          <b>What is shared:</b> what you type in the Assistant tab, and {sees.length ? `your ${sees.join(", ")}` : "nothing else"}.
        </li>
        <li>
          <b>With whom:</b> {whereDataGoes(settings.agent)}
        </li>
        <li>
          <b>What it can do:</b> {AUTONOMY_LABELS[settings.autonomy].toLowerCase()}. It never runs a model, and nothing
          it writes runs until you have reviewed it. PsyNeuView can't limit what the agent's own service does with
          what it receives.
        </li>
      </ul>
      <Button kind="secondary" size="compact" data-testid="assistant-explanation-ok" onClick={acknowledge}>
        Got it
      </Button>
    </div>
  );
}

/** Write-only: the page shows set or not set, and never the key. */
function ApiKeySetting() {
  const keySet = useAssistantStore((s) => s.keySet);
  const setKey = useAssistantStore((s) => s.setKey);
  const clearKey = useAssistantStore((s) => s.clearKey);
  const [draft, setDraft] = useState("");
  const [failed, setFailed] = useState(false);
  const submit = async () => {
    if (!draft) return;
    const ok = await setKey(draft);
    setFailed(!ok);
    if (ok) setDraft("");
  };
  return (
    <div style={{ marginTop: 12 }}>
      <SettingLabel title="API key" htmlFor="setting-assistant-api-key">
        Kept by the backend on this machine and never shown again.{" "}
        <span data-testid="assistant-api-key-state" style={{ color: keySet ? "var(--pnv-success)" : "var(--pnv-text-hint)" }}>
          {keySet ? "A key is set." : "No key is set."}
        </span>
      </SettingLabel>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <input
          id="setting-assistant-api-key"
          data-testid="setting-assistant-api-key"
          type="password"
          autoComplete="off"
          value={draft}
          placeholder={keySet ? "Enter a new key to replace it" : "Paste the key"}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void submit();
          }}
          style={inputStyle}
        />
        <Button kind="small" data-testid="assistant-api-key-save" disabled={!draft} onClick={() => void submit()}>
          Save key
        </Button>
        {keySet && (
          <Button kind="small" data-testid="assistant-api-key-remove" onClick={() => void clearKey()}>
            Remove
          </Button>
        )}
      </div>
      {failed && <div style={{ ...errorStyle, marginTop: 4 }}>The key was not saved.</div>}
    </div>
  );
}

/** The folders the assistant may list and read, and which it may write in. */
function FoldersSetting({
  settings,
  disabled,
  onChange,
}: {
  settings: AssistantSettings;
  disabled: boolean;
  onChange: (folders: AssistantSettings["folders"]) => void;
}) {
  const [draft, setDraft] = useState("");
  useEffect(() => setDraft(""), [settings.folders.length]);
  const folders = settings.folders;
  return (
    <div style={{ marginTop: 12 }}>
      <SettingLabel title="Folders it may reach">
        Model files in these folders can be listed and read when "model files" is ticked below, never run. Writing is
        allowed only where you say so, and every write keeps the previous version.
      </SettingLabel>
      <div data-testid="setting-assistant-folders" style={{ marginTop: 6 }}>
        {folders.length === 0 && <div style={mutedStyle}>No folders: it can see only the open model.</div>}
        {folders.map((f, i) => (
          <div key={f.path} style={{ display: "flex", gap: 8, alignItems: "center", padding: "3px 0" }}>
            <code style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere", fontSize: "var(--pnv-fs-12)" }}>{f.path}</code>
            <select
              aria-label={`Access to ${f.path}`}
              value={f.access}
              disabled={disabled}
              onChange={(e) => onChange(folders.map((g, j) => (j === i ? { ...g, access: e.target.value as FolderAccess } : g)))}
              style={{ ...selectStyle, flex: "0 0 auto" }}
            >
              <option value="read">Read</option>
              <option value="read_write">Read and write</option>
            </select>
            <Button kind="small" disabled={disabled} onClick={() => onChange(folders.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
        <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
          <input
            aria-label="Folder to add"
            value={draft}
            placeholder="~/Models"
            disabled={disabled}
            onChange={(e) => setDraft(e.target.value)}
            style={inputStyle}
          />
          <Button
            kind="small"
            disabled={disabled || !draft.trim()}
            onClick={() => onChange([...folders, { path: draft.trim(), access: "read" }])}
          >
            Add (read only)
          </Button>
        </div>
      </div>
    </div>
  );
}
