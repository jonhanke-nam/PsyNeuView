/**
 * Settings ▸ AI assistant (#179).
 *
 * One control per setting from docs/ai-assistant/contract.md, every value
 * stored by the backend (`/api/assistant/settings`), never in this browser.
 * One clear consent (#369): turning it on shows what is shared, with whom,
 * what it can do and which folders, with Turn on / Cancel; the backend
 * answers the PUT with `needs_confirmation` until the page sends it again
 * with `confirm_raise`. A new destination while on asks the same way. Every
 * other change saves directly, and a summary at the top always says what is
 * shared and with whom.
 *
 * The API key is write-only: the page learns only whether one is set.
 *
 * Claude over MCP (#201) is one more agent choice: the user's own Claude
 * subscription, through Claude Desktop or Claude Code, which connect to
 * PsyNeuView's MCP server. Choosing it shows the setup to copy (with the
 * connection token) and whether a client is connected, instead of the model
 * and the API key.
 */

import { useEffect, useState, type ReactNode } from "react";

import { agentKey, useAssistantStore, type ConnectionTest } from "@/stores/assistantStore";
import type { AssistantSettings, Autonomy, AgentType, FolderAccess, SandboxStatus, Saving } from "@/stores/assistantTypes";
import { ANTHROPIC_DEFAULT_MODEL, destinationHost, mcpConnectionWords, sharedWords, whereDataGoes } from "@/utils/assistantProposals";
import { copyToClipboard } from "@/utils/revealPath";
import { Button } from "../Button";
import { Group, SettingLabel, errorStyle, inputStyle, mutedStyle, selectStyle } from "./shared";

const AGENT_LABELS: Record<AgentType, string> = {
  none: "None (off)",
  anthropic: "Anthropic (Claude), with your API key",
  openai_compatible: "An OpenAI-compatible server (local or remote)",
  claude_mcp: "Claude (your subscription, via Claude Desktop or Claude Code)",
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
  const sandbox = useAssistantStore((s) => s.sandbox);

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
      <PrivacySummary settings={settings} />
      {pendingRaise && (pendingRaise.next.enabled && !settings.enabled ? <TurnOnConsent next={pendingRaise.next} /> : <RaiseConfirm raised={pendingRaise.raised} />)}

      <Group id="assistant-on" title="On or off">
        <Check
          input={<input data-testid="setting-assistant-enabled" type="checkbox" checked={settings.enabled} disabled={saving} onChange={(e) => change({ enabled: e.target.checked })} style={{ marginTop: 3 }} />}
          title="Use an AI assistant"
        >
          Off by default. With it off, nothing is sent anywhere and the Assistant tab is not shown. An external agent's
          own access can't be limited by PsyNeuView: what it does with what it receives is between you and that
          service.
        </Check>
        {settings.enabled && sandbox?.state === "unavailable" && (
          <div data-testid="assistant-sandbox-warning" style={{ ...warningBoxStyle, marginTop: 10 }}>
            Model runs are not sandboxed on this system, so code in a model can get round the rule that nothing the
            assistant writes runs before you approve it. {sandbox.reason}
          </div>
        )}
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
        {settings.agent.type === "claude_mcp" ? <McpSetupPanel /> : <ModelChoice settings={settings} disabled={saving} onChange={change} />}
        {settings.agent.type === "openai_compatible" && (
          <div style={{ marginTop: 12 }}>
            <SettingLabel title="Server address" htmlFor="setting-assistant-agent-base-url">
              Where messages go. A server on this machine keeps everything local.
            </SettingLabel>
            <DraftInput
              id="setting-assistant-agent-base-url"
              data-testid="setting-assistant-agent-base-url"
              value={settings.agent.base_url}
              disabled={saving}
              placeholder="http://localhost:11434/v1"
              onCommit={(base_url) => change({ agent: { ...settings.agent, base_url } })}
            />
          </div>
        )}
        {settings.agent.type !== "claude_mcp" && <ApiKeySetting />}
      </Group>

      <Group id="assistant-permissions" title="What it may do">
        <SettingLabel title="Autonomy" htmlFor="setting-assistant-autonomy">
          Nothing is changed without you accepting a proposal.
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

      <Group id="assistant-sandbox" title="Sandbox for model runs">
        <SandboxState status={sandbox} />
        <Check
          input={<input data-testid="setting-assistant-sandbox-all-runs" type="checkbox" checked={settings.sandbox.all_runs} disabled={saving} onChange={(e) => change({ sandbox: { ...settings.sandbox, all_runs: e.target.checked } })} style={{ marginTop: 3 }} />}
          title="Sandbox every model run while the assistant is on"
        >
          Opening any model runs its code, so every run is sandboxed, not only while files the assistant wrote are
          waiting for review (those always are). The sandbox costs no noticeable time.
        </Check>
        <Check
          input={<input data-testid="setting-assistant-sandbox-require" type="checkbox" checked={settings.sandbox.require} disabled={saving} onChange={(e) => change({ sandbox: { ...settings.sandbox, require: e.target.checked } })} style={{ marginTop: 3 }} />}
          title="Require the sandbox"
        >
          The assistant doesn't turn on where model runs can't be sandboxed.
        </Check>
      </Group>

      <Group
        id="assistant-limits"
        title="Limits and log"
        defaultFolded
        controls={["setting-assistant-limit-tool-calls", "setting-assistant-limit-minutes", "setting-assistant-limit-max-tokens", "setting-assistant-keep-log"]}
        summary={`${settings.limits.tool_calls} tool calls, ${settings.limits.minutes} minutes per turn, ${settings.limits.max_tokens.toLocaleString()} tokens per session${settings.keep_log ? ", log kept" : ""}`}>
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

const warningBoxStyle = {
  border: "1px solid var(--pnv-warning)",
  background: "var(--pnv-warning-tint)",
  borderRadius: 6,
  padding: "8px 10px",
  maxWidth: 560,
} as const;

const MECHANISM_WORDS: Record<string, string> = {
  seatbelt: "the macOS sandbox (Seatbelt)",
};

function mechanismWords(mechanism: string | null): string {
  if (!mechanism) return "the operating system";
  if (MECHANISM_WORDS[mechanism]) return MECHANISM_WORDS[mechanism];
  if (mechanism.startsWith("landlock")) return "Linux's Landlock and seccomp";
  return mechanism;
}

/**
 * Whether model runs are sandboxed now (#311): never silently unsandboxed.
 * "unavailable" is the case that matters, so it is the one shown as a warning.
 */
function SandboxState({ status }: { status: SandboxStatus | null }) {
  if (!status) return null;
  const by = mechanismWords(status.mechanism);
  let text: string;
  if (status.state === "on") text = `Model runs are sandboxed by ${by}: no network, no reading files the assistant wrote before you approve them, no writing outside the task's folder and the assistant's read-write folders.`;
  else if (status.state === "unavailable") text = `Model runs are NOT sandboxed: ${status.reason ?? "no sandbox can be applied here"}.`;
  else if (status.state === "available") text = `Available here (${by}). Not in use now: ${status.why}.`;
  else text = `This system can't sandbox model runs: ${status.reason ?? "no sandbox is available"}.`;
  const warn = status.state === "unavailable" || status.state === "off_unavailable";
  return (
    <div data-testid="assistant-sandbox-status" data-state={status.state} style={warn ? warningBoxStyle : { ...mutedStyle, maxWidth: 560 }}>
      {text}
      {status.forced && <div style={{ marginTop: 4 }}>Set by PSYNEUVIEW_OS_SANDBOX={status.forced} when PsyNeuView started.</div>}
    </div>
  );
}

/**
 * A text setting typed into a local draft and saved on blur or Enter, when
 * it differs from what the backend holds. The draft follows the backend's
 * value when that changes (a reload, a refused save).
 */
function DraftInput({
  id,
  "data-testid": testId,
  value,
  disabled,
  placeholder,
  onCommit,
}: {
  id: string;
  /** Written literally at each call site, so settingsInventory.test.ts can see it. */
  "data-testid": string;
  value: string;
  disabled: boolean;
  placeholder?: string;
  onCommit: (value: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const commit = () => {
    if (draft.trim() !== value) onCommit(draft.trim());
  };
  return (
    <input
      id={id}
      data-testid={testId}
      value={draft}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
      style={{ ...inputStyle, marginTop: 6, width: "100%" }}
    />
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

/** Always shown (#369): what is shared and with whom, now, in one or two lines. */
function PrivacySummary({ settings }: { settings: AssistantSettings }) {
  const host = destinationHost(settings.agent);
  const folders = settings.folders.length
    ? settings.folders.map((f) => `${f.path} (${f.access === "read_write" ? "read and write" : "read"})`).join(", ")
    : "none";
  let text: string;
  if (!settings.enabled) text = "Off: nothing is sent anywhere.";
  else if (!host) text = "On, but no agent is chosen, so nothing is sent anywhere.";
  else text = `On. Shares ${sharedWords(settings)} with ${host}. ${AUTONOMY_LABELS[settings.autonomy]}. Folders: ${folders}.`;
  return (
    <div data-testid="assistant-summary" data-enabled={String(settings.enabled)} style={{ ...mutedStyle, marginBottom: 12, maxWidth: 560 }}>
      {text}
    </div>
  );
}

/** A new destination while the assistant is on (#369): who receives the data changes, so it asks. */
function RaiseConfirm({ raised }: { raised: string[] }) {
  const confirmRaise = useAssistantStore((s) => s.confirmRaise);
  const cancelRaise = useAssistantStore((s) => s.cancelRaise);
  return (
    <div data-testid="assistant-raise-confirm" data-kind="destination" style={{ ...consentBoxStyle, marginBottom: 14 }}>
      <div style={{ fontWeight: 600 }}>Send messages somewhere new?</div>
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

const consentBoxStyle = {
  border: "1px solid var(--pnv-warning)",
  background: "var(--pnv-warning-tint)",
  borderRadius: 6,
  padding: "10px 12px",
  maxWidth: 620,
} as const;

/**
 * The one consent (#369), before the assistant is turned on: what is shared,
 * with whom, what it can do, and the folders. Nothing is saved until Turn on.
 */
function TurnOnConsent({ next }: { next: AssistantSettings }) {
  const confirmRaise = useAssistantStore((s) => s.confirmRaise);
  const cancelRaise = useAssistantStore((s) => s.cancelRaise);
  const host = destinationHost(next.agent);
  return (
    <div data-testid="assistant-raise-confirm" data-kind="turn-on" style={{ ...consentBoxStyle, marginBottom: 14 }}>
      <div style={{ fontWeight: 600 }}>Turn on the AI assistant? Privacy and permissions</div>
      <ul style={{ margin: "6px 0 8px 18px", padding: 0, lineHeight: 1.5 }}>
        <li>
          <b>What is shared:</b> {sharedWords(next)},{" "}
          {next.agent.type === "claude_mcp" ? "when Claude asks for it through PsyNeuView's tools." : "with each message you send in the Assistant tab."}
        </li>
        <li>
          <b>With whom:</b>{" "}
          {host ? (
            <>
              {host}. {whereDataGoes(next.agent)} PsyNeuView can't limit what that service does with what it receives.
            </>
          ) : (
            "no one yet: no agent is chosen, so nothing is sent until you choose one."
          )}
        </li>
        <li>
          <b>What it can do:</b> {AUTONOMY_LABELS[next.autonomy].toLowerCase()}. Nothing changes until you accept a
          proposal, and nothing it writes runs until you have reviewed it.
          {next.sandbox.all_runs ? " Model runs are sandboxed while it is on." : " Model runs are sandboxed only while something it wrote is unreviewed."}
        </li>
        <li>
          <b>Folders:</b>{" "}
          {next.folders.length
            ? next.folders.map((f) => `${f.path} (${f.access === "read_write" ? "read and write" : "read only"})`).join(", ")
            : "none; it can't list or read your files."}
        </li>
      </ul>
      <div style={{ ...mutedStyle, marginBottom: 8 }}>After this, changes here save without asking; the summary above always shows the current state.</div>
      <div style={{ display: "flex", gap: 8 }}>
        <Button kind="primary" size="compact" data-testid="assistant-raise-confirm-yes" onClick={() => void confirmRaise()}>
          Turn on
        </Button>
        <Button kind="secondary" size="compact" data-testid="assistant-raise-confirm-no" onClick={cancelRaise}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** "Alias — Display name (id)", or as much of it as there is. */
function modelOptionLabel(id: string, displayName: string, alias: string | undefined): string {
  const name = displayName && displayName !== id ? `${displayName} (${id})` : id;
  return alias ? `${alias} — ${name}` : name;
}

/**
 * The model, chosen from the list the service offers (#370), with a Refresh
 * button and a short name of your own for it. A saved model the service no
 * longer lists is kept and flagged, never changed silently. Typing an id is
 * in Developer (`AssistantModelIdSetting`).
 */
function ModelChoice({
  settings,
  disabled,
  onChange,
}: {
  settings: AssistantSettings;
  disabled: boolean;
  onChange: (patch: Partial<AssistantSettings>) => void;
}) {
  const models = useAssistantStore((s) => s.models);
  const loadModels = useAssistantStore((s) => s.loadModels);
  const keySet = useAssistantStore((s) => s.keySet);
  const agent = settings.agent;
  const key = agentKey(agent);
  useEffect(() => {
    if (agent.type !== "none") void loadModels();
    // Fetch again when the agent, its address or the key changes; `agent.type` is in `key`.
  }, [key, keySet, loadModels]);

  const current = models.forAgent === key ? models : null;
  const list = current?.list ?? [];
  const aliases = settings.model_aliases;
  const anthropicDefault = current?.default || ANTHROPIC_DEFAULT_MODEL;
  // What is in use: the saved id, or for Anthropic its default (preselected).
  const shown = agent.model || (agent.type === "anthropic" ? anthropicDefault : "");
  const offered = list.some((m) => m.id === shown);
  const notOffered = Boolean(agent.model) && current?.ok === true && !offered;

  const choose = (model: string) => onChange({ agent: { ...agent, model } });
  return (
    <div style={{ marginTop: 12 }}>
      <SettingLabel title="Model" htmlFor="setting-assistant-agent-model">
        The models the agent's service offers, asked with your key. Refresh after the service adds one.
      </SettingLabel>
      <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <select
          id="setting-assistant-agent-model"
          data-testid="setting-assistant-agent-model"
          value={shown}
          disabled={disabled || agent.type === "none"}
          onChange={(e) => choose(e.target.value)}
          style={{ ...selectStyle, flex: 1, minWidth: 0 }}
        >
          {agent.type === "none" && <option value="">Choose an agent first</option>}
          {agent.type === "openai_compatible" && <option value="">The server's default</option>}
          {shown && !offered && (
            <option value={shown}>
              {modelOptionLabel(shown, "", aliases[shown])}
              {notOffered ? " — no longer offered by the service" : ""}
            </option>
          )}
          {list.map((m) => (
            <option key={m.id} value={m.id}>
              {modelOptionLabel(m.id, m.display_name, aliases[m.id])}
            </option>
          ))}
        </select>
        <Button
          kind="small"
          data-testid="assistant-models-refresh"
          disabled={agent.type === "none" || models.loading}
          title="Ask the service for its list of models again"
          onClick={() => void loadModels()}
        >
          Refresh
        </Button>
      </div>
      {agent.type !== "none" && (current?.loading || current?.ok === false || notOffered) && (
        <div data-testid="assistant-models-message" data-ok={String(current?.ok)} style={{ marginTop: 4, color: current?.loading ? "var(--pnv-text-hint)" : "var(--pnv-warning)" }}>
          {current?.loading
            ? "Fetching the list…"
            : notOffered
              ? `${agent.model} is no longer offered by the service. It stays chosen until you pick another.`
              : `${current?.message} The saved choice is kept.`}
        </div>
      )}
      <div style={{ marginTop: 10 }}>
        <SettingLabel title="Short name for this model" htmlFor="setting-assistant-model-alias">
          Optional, for example "fast" or "big". Shown here and in the Assistant tab; the real id is what is sent.
        </SettingLabel>
        <DraftInput
          id="setting-assistant-model-alias"
          data-testid="setting-assistant-model-alias"
          value={(shown && aliases[shown]) || ""}
          disabled={disabled || !shown}
          placeholder={shown ? `A name for ${shown}` : "Choose a model first"}
          onCommit={(alias) => {
            const next = { ...aliases };
            if (alias) next[shown] = alias;
            else delete next[shown];
            onChange({ model_aliases: next });
          }}
        />
      </div>
    </div>
  );
}

/**
 * Developer ▸ AI assistant model (#370): type a model id the service's list
 * doesn't show. The everyday control is the drop-down in AI assistant.
 */
export function AssistantModelIdSetting() {
  const settings = useAssistantStore((s) => s.settings);
  const save = useAssistantStore((s) => s.save);
  const saving = useAssistantStore((s) => s.saving);
  return (
    <>
      <SettingLabel title="Model id" htmlFor="setting-assistant-agent-model-id">
        The AI assistant's model, typed exactly as the service names it, for one its list doesn't show. Blank uses
        the service's default.
      </SettingLabel>
      <DraftInput
        id="setting-assistant-agent-model-id"
        data-testid="setting-assistant-agent-model-id"
        value={settings.agent.model}
        disabled={saving || settings.agent.type === "none" || settings.agent.type === "claude_mcp"}
        placeholder={settings.agent.type === "none" ? "Choose an agent in AI assistant first" : "claude-opus-5-5"}
        onCommit={(model) => void save({ ...settings, agent: { ...settings.agent, model } })}
      />
    </>
  );
}

/**
 * Claude over MCP (#201): the two setups to copy, the connection token they
 * carry, and whether a client is connected. Claude Desktop and Claude Code
 * are signed in with the user's subscription; PsyNeuView keeps no API key.
 */
function McpSetupPanel() {
  const setup = useAssistantStore((s) => s.mcpSetup);
  const setupError = useAssistantStore((s) => s.mcpSetupError);
  const status = useAssistantStore((s) => s.mcpStatus);
  const loadMcpSetup = useAssistantStore((s) => s.loadMcpSetup);
  const loadMcpStatus = useAssistantStore((s) => s.loadMcpStatus);
  const replaceMcpToken = useAssistantStore((s) => s.replaceMcpToken);
  const assistantOn = useAssistantStore((s) => s.settings.enabled);
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => void loadMcpSetup(), [loadMcpSetup]);
  useEffect(() => {
    void loadMcpStatus();
    const timer = setInterval(() => void loadMcpStatus(), 5000);
    return () => clearInterval(timer);
  }, [loadMcpStatus]);

  const copy = async (which: string, text: string) => {
    try {
      await copyToClipboard(text);
      setCopied(which);
    } catch {
      setCopied(`${which}-failed`);
    }
  };

  return (
    <div data-testid="assistant-mcp-setup" style={{ marginTop: 12, maxWidth: 620 }}>
      <div
        data-testid="assistant-mcp-status"
        data-connected={String(Boolean(status?.connected))}
        role="status"
        style={{ color: status?.connected ? "var(--pnv-success)" : "var(--pnv-text-hint)" }}
      >
        {status?.connected ? "● " : "○ "}
        {mcpConnectionWords(status, { inSettings: true })}
        {!assistantOn && " Claude can connect only while the assistant is on."}
      </div>
      {setupError && <div style={{ ...errorStyle, marginTop: 6 }}>{setupError}</div>}

      <div style={{ marginTop: 12 }}>
        <SettingLabel title="Claude Code">Run this once in Terminal. It adds PsyNeuView for every project.</SettingLabel>
      </div>
      <SetupText testId="assistant-mcp-claude-code" text={setup?.claude_code ?? "…"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <Button kind="small" data-testid="assistant-mcp-copy-claude-code" disabled={!setup} onClick={() => setup && void copy("claude-code", setup.claude_code)}>
          Copy
        </Button>
        <CopiedNote which="claude-code" copied={copied} />
      </div>

      <div style={{ marginTop: 12 }}>
        <SettingLabel title="Claude Desktop">
          In Claude Desktop, open Settings ▸ Developer ▸ Edit Config. Add this to claude_desktop_config.json (inside an
          existing "mcpServers", add only the "psyneuview" entry), save, and restart Claude Desktop.
        </SettingLabel>
      </div>
      <SetupText testId="assistant-mcp-claude-desktop" text={setup?.claude_desktop ?? "…"} />
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
        <Button kind="small" data-testid="assistant-mcp-copy-claude-desktop" disabled={!setup} onClick={() => setup && void copy("claude-desktop", setup.claude_desktop)}>
          Copy
        </Button>
        <CopiedNote which="claude-desktop" copied={copied} />
      </div>

      <div style={{ ...mutedStyle, marginTop: 12 }}>
        Both include a connection token, kept in your Keychain, that lets the command in; without it PsyNeuView refuses
        the connection. Treat it like a password. Claude can read the open model and the files you allow, and propose
        changes; it can't change these settings, accept its own proposals, or run anything you haven't reviewed.{" "}
        <Button kind="link" data-testid="assistant-mcp-replace-token" onClick={() => void replaceMcpToken()}>
          Make a new token
        </Button>{" "}
        (then copy the setup again; the old one stops working).
      </div>
    </div>
  );
}

function SetupText({ text, testId }: { text: string; testId: string }) {
  return (
    <pre
      data-testid={testId}
      dir="ltr"
      style={{ margin: "6px 0 0", padding: "6px 8px", background: "var(--pnv-surface-sunken)", border: "1px solid var(--pnv-border-faint)", borderRadius: 4, fontFamily: "var(--pnv-font-mono)", fontSize: "var(--pnv-fs-12)", whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 220, overflowY: "auto" }}
    >
      {text}
    </pre>
  );
}

function CopiedNote({ which, copied }: { which: string; copied: string | null }) {
  if (copied === which) return <span data-testid={`assistant-mcp-copied-${which}`} style={{ color: "var(--pnv-success)", fontSize: "var(--pnv-fs-12)" }}>Copied.</span>;
  if (copied === `${which}-failed`) return <span style={{ ...errorStyle, fontSize: "var(--pnv-fs-12)" }}>Couldn't copy; select the text and copy it.</span>;
  return null;
}

/** Write-only: the page shows set or not set, and never the key. */
function ApiKeySetting() {
  const keySet = useAssistantStore((s) => s.keySet);
  const setKey = useAssistantStore((s) => s.setKey);
  const clearKey = useAssistantStore((s) => s.clearKey);
  const agentType = useAssistantStore((s) => s.settings.agent.type);
  const testConnection = useAssistantStore((s) => s.testConnection);
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ConnectionTest | null>(null);
  const agent = useAssistantStore((s) => s.settings.agent);
  // A result is about the agent and key it tested; a change makes it stale.
  useEffect(() => setResult(null), [agent.type, agent.model, agent.base_url, keySet]);
  const test = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await testConnection());
    } finally {
      setTesting(false);
    }
  };
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
        <Button
          kind="small"
          data-testid="assistant-test-connection"
          disabled={agentType === "none" || testing}
          title={agentType === "none" ? "Choose an agent first" : "Send one small request to check the key, the model and the network"}
          onClick={() => void test()}
        >
          Test connection
        </Button>
      </div>
      {failed && <div style={{ ...errorStyle, marginTop: 4 }}>The key was not saved.</div>}
      {(testing || result) && (
        <div
          data-testid="assistant-test-connection-result"
          data-ok={testing ? undefined : String(result?.ok)}
          role="status"
          style={{ marginTop: 4, color: testing ? "var(--pnv-text-hint)" : result?.ok ? "var(--pnv-success)" : "var(--pnv-warning)" }}
        >
          {testing ? "Testing…" : `${result?.ok ? "✓" : "⚠"} ${result?.message}`}
        </div>
      )}
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
