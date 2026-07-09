import React from "react";

// Assignable role badges. Colours are chosen to read on the dark surface and
// stay distinct from the channel/status badges used elsewhere.
export const BADGE_COLORS = {
  Founder: "#ff6b73",
  Admin: "#ff6b73",
  Operations: "#5aa2f0",
  Artist: "#a99cf0",
  Marketing: "#f0864f",
  Support: "#4fc07a",
};

export const BADGE_OPTIONS = ["Founder", "Admin", "Operations", "Artist", "Marketing", "Support"];

export function RoleBadges({ badges, size = 11 }) {
  if (!badges || !badges.length) return null;
  return (
    <>
      {badges.map((b) => {
        const c = BADGE_COLORS[b] || "#9aa0aa";
        return (
          <span
            key={b}
            className="role-badge"
            style={{ color: c, borderColor: c + "66", background: c + "1f", fontSize: size }}
          >
            {b}
          </span>
        );
      })}
    </>
  );
}
