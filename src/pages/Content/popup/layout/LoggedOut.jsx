import React from "react";

const LoggedOut = ({ onManageClick, onDowngradeClick }) => {
  return (
    <div
      className="announcement"
      style={{ marginTop: "50px", paddingBottom: "0px" }}
    >
      <div className="announcement-wrap">
        <div className="announcement-details">
          <div className="welcome-title" style={{ marginBottom: "10px" }}>
            {chrome.i18n.getMessage("loggedOutTitle") ||
              "You’ve been logged out"}
          </div>

          <div
            className="welcome-description"
            style={{
              fontSize: "14px",
              color: "var(--rf-text-secondary)",
              lineHeight: "1.5",
              marginBottom: "20px",
            }}
          >
            {chrome.i18n.getMessage("loggedOutDescription") ||
              "To keep your recordings synced to your account, and access premium features, you’ll need to log back in."}
          </div>

          <div
            className="welcome-cta"
            style={{
              marginBottom: "20px",
              backgroundColor: "var(--rf-strong)",
              boxSizing: "border-box",
              color: "var(--rf-text-contrast)",
              height: "45px",
              width: "100%",
              borderRadius: "999px",
              textAlign: "center",
              fontWeight: "600",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
            }}
            onClick={onManageClick}
          >
            {chrome.i18n.getMessage("logBackInButton") || "Log back in"}
          </div>
        </div>
      </div>

      <div className="welcome-content">
        <div className="welcome-content-wrap">
          <div
            style={{
              marginBottom: "12px",
              fontSize: "14px",
              color: "var(--rf-text-secondary)",
              textAlign: "center",
            }}
          >
            {chrome.i18n.getMessage("loggedOutFreeVersion") ||
              "You can keep using the extension without an account - but your recordings won’t be saved and can’t be recovered later."}
          </div>

          <div
            className="welcome-cta"
            style={{
              backgroundColor: "var(--rf-bg)",
              border: "1px solid var(--rf-border)",
              boxSizing: "border-box",
              height: "45px",
              width: "100%",
              borderRadius: "999px",
              textAlign: "center",
              fontWeight: "600",
              cursor: "pointer",
              color: "var(--rf-text-strong)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
            }}
            onClick={onDowngradeClick}
          >
            {chrome.i18n.getMessage("continueWithoutLogin") ||
              "Continue without login"}
          </div>
        </div>
      </div>
    </div>
  );
};

export default LoggedOut;
