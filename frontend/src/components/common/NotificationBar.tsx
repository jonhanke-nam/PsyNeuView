/**
 * Notification bar — displays errors, warnings, and info messages
 * as floating toast notifications that don't push content down.
 * Positioned at top-right so they don't interfere with toolbar clicks.
 *
 * A toast is a notice, not a dialog (#1289): each has the shared × and no
 * Escape — it never takes the key from whatever dialog or menu is open, and
 * it asks nothing, so there is nothing to cancel.
 *
 * A notice may carry one action, drawn as a link beside its text so the
 * notice keeps its one-line height: Redo on an undo notice (#1377). A notice
 * given a `key` is replaced in place (notificationStore), so a burst of undos
 * is one notice whose text changes, not a column of them.
 */

import { Button } from "@/components/common/Button";
import { DialogCloseButton } from "@/components/common/dialog/DialogHeader";
import { useNotificationStore, type NotificationType } from "@/stores/notificationStore";

const STYLES: Record<NotificationType, { bg: string; border: string; color: string; icon: string }> = {
  error: { bg: "var(--pnv-danger-tint)", border: "var(--pnv-danger-border)", color: "var(--pnv-danger)", icon: "✕" },
  warning: { bg: "var(--pnv-warning-tint)", border: "var(--pnv-warning-border)", color: "var(--pnv-warning)", icon: "⚠" },
  info: { bg: "var(--pnv-primary-tint)", border: "var(--pnv-primary-tint-border)", color: "var(--pnv-primary-deep)", icon: "ℹ" },
  success: { bg: "var(--pnv-success-tint)", border: "var(--pnv-success-border)", color: "var(--pnv-success)", icon: "✓" },
};

export function NotificationBar() {
  const notifications = useNotificationStore((s) => s.notifications);
  const dismiss = useNotificationStore((s) => s.dismissNotification);

  if (notifications.length === 0) return null;

  return (
    <div
      style={{
        position: "fixed",
        top: 8,
        right: 16,
        zIndex: 9999,
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxWidth: 400,
        pointerEvents: "auto",
      }}
    >
      {notifications.map((notif) => {
        const style = STYLES[notif.type];
        return (
          <div
            key={notif.id}
            data-testid="notification"
            data-notification-type={notif.type}
            style={{
              display: "flex",
              alignItems: "flex-start",
              gap: 8,
              padding: "6px 14px",
              background: style.bg,
              border: `1px solid ${style.border}`,
              borderRadius: 6,
              color: style.color,
              fontSize: "var(--pnv-fs-12)",
              boxShadow: "var(--pnv-shadow-float)",
              animation: "notifSlideIn 0.2s ease-out",
            }}
          >
            <span style={{ fontWeight: 600, flexShrink: 0 }}>{style.icon}</span>
            {/* minWidth:0 lets this flex item shrink below its content's
                intrinsic width, and overflowWrap breaks long unbroken tokens
                (e.g. file paths in error messages) so the text wraps instead
                of shoving the × dismiss button off-screen (#302). */}
            <span
              data-testid="notification-message"
              data-notification-key={notif.key}
              style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}
            >
              {notif.message}
            </span>
            {notif.action && (
              <Button
                kind="link"
                data-testid={notif.action.testId ?? "notification-action"}
                title={notif.action.title}
                onClick={notif.action.onClick}
                style={{ flexShrink: 0, fontWeight: 600 }}
              >
                {notif.action.label}
              </Button>
            )}
            <DialogCloseButton
              onClick={() => dismiss(notif.id)}
              label="Dismiss"
              title="Dismiss"
              color={style.color}
              inline
              opacity={0.7}
              testId="notification-dismiss"
            />
          </div>
        );
      })}
      <style>{`
        @keyframes notifSlideIn {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
